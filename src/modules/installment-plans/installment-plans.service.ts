import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountType,
  Category,
  InstallmentPlanKind,
  InstallmentPlanStatus,
  Prisma,
  TransactionType,
  type Account,
  type InstallmentPlan,
} from '@prisma/client';
import { CurrentUserService } from '@common/services/current-user.service';
import { toMonthYear } from '@common/utils/month.util';
import { toFinancialCalendarDate } from '@common/utils/period.util';
import {
  compareDates,
  effectiveAnnualRate,
  formatCalendarDate,
  parseCalendarDate,
  statementOnOrAfter,
  type CalendarDate,
} from '@modules/accounts/lib/credit-card';
import { BudgetRecalculationService } from '@modules/budgets/budget-recalculation.service';
import {
  FinancialPeriodService,
  earliestDate,
} from '@modules/financial-periods/financial-period.service';
import { CASCADE_TRANSACTION_OPTIONS } from '@modules/period-ledger/period-ledger.constants';
import { PrismaService } from '@modules/prisma/prisma.service';
import type { CreateInstallmentPlanDto } from './dto/create-installment-plan.dto';
import type {
  ListInstallmentPlansQueryDto,
  SettleInstallmentPlanDto,
} from './dto/installment-plan-query.dto';
import type { UpdateInstallmentPlanDto } from './dto/update-installment-plan.dto';
import {
  toInstallmentPlanResponse,
  toScheduleItems,
  type IInstallmentPlanDetail,
  type IInstallmentPlanResponse,
  type IPendingInstallment,
  type IRegisteredInstallment,
} from './interfaces/installment-plan-response.interface';
import {
  describePlan,
  financialNoon,
  fromDbDate,
  inRange,
  normalizeStatementDate,
  periodRangeEnd,
  toDbDate,
  type CardCycle,
  type InstallmentView,
  type PlanView,
} from './lib/installment-schedule';

type Client = Prisma.TransactionClient;

export const PLAN_CARD_REQUIRED_MESSAGE =
  'accountId must be a CREDIT_CARD account';
export const PLAN_CARD_CYCLE_MESSAGE =
  'Set statementDay and paymentDueDay on the card first (PATCH /accounts/:id): they define when each installment is billed and due';
export const PLAN_RATE_REQUIRED_MESSAGE =
  'monthlyRate is required: the card has no defaultMonthlyRate';
export const PLAN_CATEGORY_REQUIRED_MESSAGE =
  'category is required for a PURCHASE and when the installments count as expenses';
export const PLAN_PURCHASE_BEFORE_ANCHOR_MESSAGE =
  "This purchase is before the card's anchor, so its debt is already in the anchored balance: register it as LEGACY";
export const PLAN_BILLED_RANGE_MESSAGE =
  'billedBeforeTracking must be less than installmentCount';
export const PLAN_FIRST_STATEMENT_MESSAGE =
  'firstStatementDate cannot be before the cut that follows startDate';
export const PLAN_HAS_RECOGNIZED_MESSAGE =
  'This plan has recognized installments: only description, category and monthlyRate can change. Undo them first';
export const PLAN_DELETE_RECOGNIZED_MESSAGE =
  'This plan has recognized installments: undo them first';
export const PLAN_SETTLED_MESSAGE = 'The plan is settled';
export const PLAN_NOT_SETTLED_MESSAGE = 'The plan is not settled';
export const PLAN_NOT_RECOGNIZING_MESSAGE =
  'This plan does not count its installments as expenses';
export const SETTLEMENT_INSTALLMENT_MESSAGE =
  'This installment holds the settlement: undo it with DELETE /installment-plans/:id/settle';

const notFound = (id: string) =>
  new NotFoundException(`InstallmentPlan ${id} not found`);
const futureDate = (field: string) =>
  new BadRequestException(`${field} cannot be in the future`);
const invalidDate = (field: string) =>
  new BadRequestException(`${field} is not a valid calendar date`);

/** Lo que cada consulta trae junto al plan. */
const PLAN_INCLUDE = {
  account: true,
  transactions: {
    select: {
      id: true,
      type: true,
      installmentNumber: true,
      amount: true,
      transactionDate: true,
    },
  },
} satisfies Prisma.InstallmentPlanInclude;

type PlanWithRelations = Prisma.InstallmentPlanGetPayload<{
  include: typeof PLAN_INCLUDE;
}>;

/** Plan + calendario calculado, listo para responder o para operar. */
interface LoadedPlan {
  plan: PlanWithRelations;
  view: PlanView;
}

function cardCycle(account: Account): CardCycle {
  if (account.statementDay === null || account.paymentDueDay === null) {
    throw new BadRequestException(PLAN_CARD_CYCLE_MESSAGE);
  }
  return {
    statementDay: account.statementDay,
    paymentDueDay: account.paymentDueDay,
  };
}

/** Hoy en Bogotá. */
const today = () => toFinancialCalendarDate(new Date());

function parsePastDate(field: string, value: string): CalendarDate {
  const date = parseCalendarDate(value);
  if (!date) throw invalidDate(field);
  if (compareDates(date, today()) > 0) throw futureDate(field);
  return date;
}

/**
 * Planes de cuotas de tarjeta (docs/design-liabilities.md D). Una compra a N
 * cuotas sube la deuda completa el día de la compra (`FINANCED_PURCHASE`); el
 * gasto del presupuesto son las cuotas de capital, cada una en su fecha de
 * pago, y se registran a mano. `REFINANCE` y `LEGACY` no crean transacción:
 * esa deuda ya está dentro del ancla de la tarjeta.
 */
@Injectable()
export class InstallmentPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    private readonly budgetRecalculation: BudgetRecalculationService,
    private readonly financialPeriods: FinancialPeriodService,
  ) {}

  async findAll(
    query: ListInstallmentPlansQueryDto,
  ): Promise<IInstallmentPlanResponse[]> {
    const userId = await this.currentUser.getUserId();
    const plans = await this.prisma.installmentPlan.findMany({
      where: {
        userId,
        ...(query.accountId ? { accountId: query.accountId } : {}),
      },
      include: PLAN_INCLUDE,
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    });
    return plans
      .map((plan) => this.load(plan))
      .filter(({ view }) => !query.status || view.status === query.status)
      .map((loaded) => this.toResponse(loaded));
  }

  async findOne(id: string): Promise<IInstallmentPlanDetail> {
    const userId = await this.currentUser.getUserId();
    return this.toDetail(await this.findOwned(this.prisma, id, userId));
  }

  async create(dto: CreateInstallmentPlanDto): Promise<IInstallmentPlanDetail> {
    const userId = await this.currentUser.getUserId();
    const card = await this.findCard(dto.accountId, userId);
    const cycle = cardCycle(card);

    const recognizeInstallments =
      dto.recognizeInstallments ?? dto.kind !== InstallmentPlanKind.REFINANCE;
    const category = dto.category ?? null;
    this.assertCategory(dto.kind, recognizeInstallments, category);

    const monthlyRate =
      dto.monthlyRate !== undefined
        ? new Prisma.Decimal(dto.monthlyRate)
        : card.defaultMonthlyRate;
    if (monthlyRate === null) {
      throw new BadRequestException(PLAN_RATE_REQUIRED_MESSAGE);
    }

    const startDate = parsePastDate('startDate', dto.startDate);
    const firstStatementDate = this.firstStatementDate(
      startDate,
      dto.firstStatementDate,
      cycle,
    );
    const billedBeforeTracking = dto.billedBeforeTracking ?? 0;
    if (billedBeforeTracking >= dto.installmentCount) {
      throw new BadRequestException(PLAN_BILLED_RANGE_MESSAGE);
    }
    const purchaseDate = financialNoon(startDate);
    if (dto.kind === InstallmentPlanKind.PURCHASE) {
      this.assertAfterAnchor(card, purchaseDate);
    }

    const principal = new Prisma.Decimal(dto.principal);
    const id = await this.prisma.$transaction(async (tx) => {
      const plan = await tx.installmentPlan.create({
        data: {
          userId,
          accountId: card.id,
          kind: dto.kind,
          description: dto.description,
          category,
          principal,
          installmentCount: dto.installmentCount,
          monthlyRate,
          startDate: toDbDate(startDate),
          firstStatementDate: toDbDate(firstStatementDate),
          billedBeforeTracking,
          recognizeInstallments,
        },
      });

      let affectedFrom = purchaseDate;
      if (dto.kind === InstallmentPlanKind.PURCHASE) {
        const purchase = await tx.transaction.create({
          data: {
            userId,
            accountId: card.id,
            amount: principal,
            type: TransactionType.FINANCED_PURCHASE,
            category: category ?? Category.OTHER,
            description: dto.description,
            tags: [],
            rawMessage: dto.description,
            transactionDate: purchaseDate,
            monthYear: toMonthYear(purchaseDate),
            installmentPlanId: plan.id,
          },
        });
        const assignment =
          await this.financialPeriods.assignTransactionToPeriod(tx, purchase);
        affectedFrom = earliestDate(affectedFrom, assignment.affectedFrom);
      }
      // The ledger does not change (FINANCED_PURCHASE is not an expense), but
      // the budget base of every period where an installment falls does.
      await this.budgetRecalculation.recalculateFrom(tx, userId, affectedFrom);
      return plan.id;
    }, CASCADE_TRANSACTION_OPTIONS);

    return this.findOne(id);
  }

  async update(
    id: string,
    dto: UpdateInstallmentPlanDto,
  ): Promise<IInstallmentPlanDetail> {
    const userId = await this.currentUser.getUserId();
    const { plan } = await this.findOwned(this.prisma, id, userId);
    const recognized = this.recognizedTransactions(plan);

    const structural =
      dto.principal !== undefined ||
      dto.installmentCount !== undefined ||
      dto.startDate !== undefined ||
      dto.firstStatementDate !== undefined ||
      dto.billedBeforeTracking !== undefined ||
      dto.recognizeInstallments !== undefined;
    if (structural && plan.status === InstallmentPlanStatus.SETTLED) {
      throw new ConflictException(PLAN_SETTLED_MESSAGE);
    }
    if (structural && recognized.length > 0) {
      throw new BadRequestException(PLAN_HAS_RECOGNIZED_MESSAGE);
    }

    const cycle = cardCycle(plan.account);
    const recognizeInstallments =
      dto.recognizeInstallments ?? plan.recognizeInstallments;
    const category = dto.category === undefined ? plan.category : dto.category;
    this.assertCategory(plan.kind, recognizeInstallments, category);

    const installmentCount = dto.installmentCount ?? plan.installmentCount;
    const billedBeforeTracking =
      dto.billedBeforeTracking ?? plan.billedBeforeTracking;
    if (billedBeforeTracking >= installmentCount) {
      throw new BadRequestException(PLAN_BILLED_RANGE_MESSAGE);
    }
    const startDate =
      dto.startDate !== undefined
        ? parsePastDate('startDate', dto.startDate)
        : fromDbDate(plan.startDate);
    const firstStatementDate =
      dto.firstStatementDate !== undefined || dto.startDate !== undefined
        ? this.firstStatementDate(
            startDate,
            dto.firstStatementDate ??
              formatCalendarDate(fromDbDate(plan.firstStatementDate)),
            cycle,
          )
        : fromDbDate(plan.firstStatementDate);
    const purchaseDate = financialNoon(startDate);
    const purchase = this.financedPurchase(plan);
    if (purchase && dto.startDate !== undefined) {
      this.assertAfterAnchor(plan.account, purchaseDate);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.installmentPlan.update({
        where: { id },
        data: {
          description: dto.description,
          category,
          monthlyRate:
            dto.monthlyRate === undefined
              ? undefined
              : new Prisma.Decimal(dto.monthlyRate),
          principal:
            dto.principal === undefined
              ? undefined
              : new Prisma.Decimal(dto.principal),
          installmentCount,
          startDate: toDbDate(startDate),
          firstStatementDate: toDbDate(firstStatementDate),
          billedBeforeTracking,
          recognizeInstallments,
        },
      });

      // Category, amount and date of the purchase and of the recognized
      // installments follow the plan.
      let affectedFrom = earliestDate(
        financialNoon(fromDbDate(plan.startDate)),
        purchaseDate,
        ...recognized.map(({ transactionDate }) => transactionDate),
      );
      if (purchase) {
        const updated = await tx.transaction.update({
          where: { id: purchase.id },
          data: {
            category: category ?? Category.OTHER,
            description: dto.description,
            amount:
              dto.principal === undefined
                ? undefined
                : new Prisma.Decimal(dto.principal),
            transactionDate: purchaseDate,
            monthYear: toMonthYear(purchaseDate),
          },
        });
        const assignment =
          await this.financialPeriods.assignTransactionToPeriod(tx, updated);
        affectedFrom = earliestDate(affectedFrom, assignment.affectedFrom);
      }
      if (category !== plan.category && category !== null) {
        await tx.transaction.updateMany({
          where: { installmentPlanId: id, installmentNumber: { not: null } },
          data: { category },
        });
      }
      await this.budgetRecalculation.recalculateFrom(tx, userId, affectedFrom);
    }, CASCADE_TRANSACTION_OPTIONS);

    return this.findOne(id);
  }

  /** Sin cuotas reconocidas; se lleva su `FINANCED_PURCHASE` (cascade). */
  async remove(id: string): Promise<void> {
    const userId = await this.currentUser.getUserId();
    const { plan } = await this.findOwned(this.prisma, id, userId);
    if (this.recognizedTransactions(plan).length > 0) {
      throw new BadRequestException(PLAN_DELETE_RECOGNIZED_MESSAGE);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.installmentPlan.delete({ where: { id } });
      await this.budgetRecalculation.recalculateFrom(
        tx,
        userId,
        financialNoon(fromDbDate(plan.startDate)),
      );
    }, CASCADE_TRANSACTION_OPTIONS);
  }

  /**
   * "Fijos por registrar" → "Cuotas de tarjeta": cuotas facturadas, sin
   * reconocer, cuya fecha de pago cae en el período (por defecto el actual).
   */
  async findPending(periodId?: string): Promise<IPendingInstallment[]> {
    const userId = await this.currentUser.getUserId();
    return this.pendingFor(this.prisma, userId, periodId);
  }

  /** "Registrar todas": reconoce como gasto todas las pendientes del período. */
  async registerPending(periodId?: string): Promise<IRegisteredInstallment[]> {
    const userId = await this.currentUser.getUserId();

    return this.prisma.$transaction(async (tx) => {
      const pending = await this.pendingFor(tx, userId, periodId);
      const registered: IRegisteredInstallment[] = [];
      let affectedFrom: Date | null = null;
      for (const item of pending) {
        const { plan } = await this.findOwned(tx, item.planId, userId);
        const { transactionId, from } = await this.createInstallmentExpense(
          tx,
          plan,
          item.number,
          new Prisma.Decimal(item.principal),
          financialNoon(parseCalendarDate(item.dueDate)!),
        );
        registered.push({ ...item, transactionId });
        affectedFrom = affectedFrom ? earliestDate(affectedFrom, from) : from;
      }
      if (affectedFrom) {
        await this.budgetRecalculation.recalculateFrom(
          tx,
          userId,
          affectedFrom,
        );
      }
      return registered;
    }, CASCADE_TRANSACTION_OPTIONS);
  }

  /** "Registrar" una cuota: un `EXPENSE` sin cuenta, en su fecha de pago. */
  async recognize(id: string, number: number): Promise<IInstallmentPlanDetail> {
    const userId = await this.currentUser.getUserId();
    const loaded = await this.findOwned(this.prisma, id, userId);
    const installment = this.recognizable(loaded, number);

    await this.prisma.$transaction(async (tx) => {
      const { from } = await this.createInstallmentExpense(
        tx,
        loaded.plan,
        number,
        installment.principal,
        financialNoon(installment.dueDate),
      );
      await this.budgetRecalculation.recalculateFrom(tx, userId, from);
    }, CASCADE_TRANSACTION_OPTIONS);

    return this.findOne(id);
  }

  /** Deshace una cuota reconocida (borra su `EXPENSE` y recalcula). */
  async unrecognize(
    id: string,
    number: number,
  ): Promise<IInstallmentPlanDetail> {
    const userId = await this.currentUser.getUserId();
    const { plan } = await this.findOwned(this.prisma, id, userId);
    const record = this.recognizedTransactions(plan).find(
      (item) => item.installmentNumber === number,
    );
    if (!record) {
      throw new NotFoundException(`Installment ${number} is not recognized`);
    }
    if (
      plan.status === InstallmentPlanStatus.SETTLED &&
      plan.settlementInstallment === number
    ) {
      throw new ConflictException(SETTLEMENT_INSTALLMENT_MESSAGE);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.transaction.delete({ where: { id: record.id } });
      await this.budgetRecalculation.recalculateFrom(
        tx,
        userId,
        record.transactionDate,
      );
    }, CASCADE_TRANSACTION_OPTIONS);

    return this.findOne(id);
  }

  /**
   * Liquidar (pagaste el total o abonaste a capital): todo el capital que
   * falta por reconocer se reconoce de una vez, en `settledAt`, y no salen
   * más cuotas. El pago en sí es la `TRANSFER` a la tarjeta, aparte.
   */
  async settle(
    id: string,
    dto: SettleInstallmentPlanDto,
  ): Promise<IInstallmentPlanDetail> {
    const userId = await this.currentUser.getUserId();
    const { plan, view } = await this.findOwned(this.prisma, id, userId);
    if (plan.status === InstallmentPlanStatus.SETTLED) {
      throw new ConflictException(PLAN_SETTLED_MESSAGE);
    }
    const settledAt = dto.settledAt
      ? parsePastDate('settledAt', dto.settledAt)
      : today();
    if (compareDates(settledAt, fromDbDate(plan.startDate)) < 0) {
      throw new BadRequestException('settledAt cannot be before startDate');
    }

    const remaining = plan.recognizeInstallments
      ? view.schedule.filter(
          ({ number, state }) =>
            number > plan.billedBeforeTracking && state !== 'RECOGNIZED',
        )
      : [];
    const settlementDate = financialNoon(settledAt);

    await this.prisma.$transaction(async (tx) => {
      let settlementInstallment: number | null = null;
      if (remaining.length > 0) {
        settlementInstallment = remaining[0].number;
        const amount = remaining.reduce(
          (sum, item) => sum.plus(item.principal),
          new Prisma.Decimal(0),
        );
        await this.createInstallmentExpense(
          tx,
          plan,
          settlementInstallment,
          amount,
          settlementDate,
          `${plan.description} · liquidación (cuotas ${settlementInstallment}-${plan.installmentCount}/${plan.installmentCount})`,
        );
      }
      await tx.installmentPlan.update({
        where: { id },
        data: {
          status: InstallmentPlanStatus.SETTLED,
          settledAt: toDbDate(settledAt),
          settlementInstallment,
        },
      });
      await this.budgetRecalculation.recalculateFrom(
        tx,
        userId,
        settlementDate,
      );
    }, CASCADE_TRANSACTION_OPTIONS);

    return this.findOne(id);
  }

  /** Deshace la liquidación: borra el gasto de la liquidación y el plan vuelve a `ACTIVE`. */
  async unsettle(id: string): Promise<IInstallmentPlanDetail> {
    const userId = await this.currentUser.getUserId();
    const { plan } = await this.findOwned(this.prisma, id, userId);
    if (plan.status !== InstallmentPlanStatus.SETTLED) {
      throw new ConflictException(PLAN_NOT_SETTLED_MESSAGE);
    }
    const record = this.recognizedTransactions(plan).find(
      (item) => item.installmentNumber === plan.settlementInstallment,
    );

    await this.prisma.$transaction(async (tx) => {
      if (record) {
        await tx.transaction.delete({ where: { id: record.id } });
      }
      await tx.installmentPlan.update({
        where: { id },
        data: {
          status: InstallmentPlanStatus.ACTIVE,
          settledAt: null,
          settlementInstallment: null,
        },
      });
      await this.budgetRecalculation.recalculateFrom(
        tx,
        userId,
        record?.transactionDate ??
          financialNoon(fromDbDate(plan.settledAt ?? plan.startDate)),
      );
    }, CASCADE_TRANSACTION_OPTIONS);

    return this.findOne(id);
  }

  private async pendingFor(
    client: Client,
    userId: string,
    periodId: string | undefined,
  ): Promise<IPendingInstallment[]> {
    const period = await this.financialPeriods.resolvePeriod(
      client,
      userId,
      periodId,
    );
    const end = periodRangeEnd(period, new Date());
    const plans = await client.installmentPlan.findMany({
      where: {
        userId,
        status: InstallmentPlanStatus.ACTIVE,
        recognizeInstallments: true,
      },
      include: PLAN_INCLUDE,
    });

    return plans
      .flatMap((plan) => {
        const { view } = this.load(plan);
        return view.schedule
          .filter(
            (item) =>
              item.state === 'PENDING' &&
              inRange(financialNoon(item.dueDate), period.startDate, end),
          )
          .map((item) => this.toPending(plan, item));
      })
      .sort(
        (a, b) =>
          a.dueDate.localeCompare(b.dueDate) ||
          a.description.localeCompare(b.description),
      );
  }

  /** La cuota `number` se puede reconocer: existe, se rastrea, está facturada y no reconocida. */
  private recognizable(
    { plan, view }: LoadedPlan,
    number: number,
  ): InstallmentView {
    if (plan.status === InstallmentPlanStatus.SETTLED) {
      throw new ConflictException(PLAN_SETTLED_MESSAGE);
    }
    if (!plan.recognizeInstallments) {
      throw new BadRequestException(PLAN_NOT_RECOGNIZING_MESSAGE);
    }
    const installment = view.schedule.find((item) => item.number === number);
    if (!installment || number <= plan.billedBeforeTracking) {
      throw new BadRequestException(
        `Installment ${number} does not exist or was paid before the plan was tracked`,
      );
    }
    if (installment.state === 'RECOGNIZED') {
      throw new ConflictException(
        `Installment ${number} is already recognized`,
      );
    }
    if (installment.state === 'FUTURE') {
      throw new BadRequestException(
        `Installment ${number} is not billed yet (cut ${formatCalendarDate(installment.statementDate)})`,
      );
    }
    return installment;
  }

  /**
   * Una cuota reconocida es un `EXPENSE` sin cuenta (no mueve saldos: la deuda
   * ya subió con la compra y el pago es la `TRANSFER`), con la categoría de la
   * compra y vinculado al plan. Devuelve desde cuándo recalcular.
   */
  private async createInstallmentExpense(
    tx: Client,
    plan: InstallmentPlan,
    number: number,
    amount: Prisma.Decimal,
    date: Date,
    description = `${plan.description} · cuota ${number}/${plan.installmentCount}`,
  ): Promise<{ transactionId: string; from: Date }> {
    const created = await tx.transaction.create({
      data: {
        userId: plan.userId,
        accountId: null,
        amount,
        type: TransactionType.EXPENSE,
        // assertCategory guarantees it while the plan recognizes installments.
        category: plan.category ?? Category.OTHER,
        description,
        tags: [],
        rawMessage: description,
        transactionDate: date,
        monthYear: toMonthYear(date),
        installmentPlanId: plan.id,
        installmentNumber: number,
      },
    });
    const { affectedFrom } =
      await this.financialPeriods.assignTransactionToPeriod(tx, created);
    return {
      transactionId: created.id,
      from: earliestDate(date, affectedFrom),
    };
  }

  private async findOwned(
    client: Client,
    id: string,
    userId: string,
  ): Promise<LoadedPlan> {
    const plan = await client.installmentPlan.findFirst({
      where: { id, userId },
      include: PLAN_INCLUDE,
    });
    if (!plan) throw notFound(id);
    return this.load(plan);
  }

  private async findCard(accountId: string, userId: string): Promise<Account> {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, userId },
    });
    if (!account) {
      throw new BadRequestException(`Account ${accountId} not found`);
    }
    if (account.type !== AccountType.CREDIT_CARD) {
      throw new BadRequestException(PLAN_CARD_REQUIRED_MESSAGE);
    }
    return account;
  }

  private load(plan: PlanWithRelations): LoadedPlan {
    const view = describePlan(
      {
        principal: plan.principal,
        installmentCount: plan.installmentCount,
        monthlyRate: plan.monthlyRate,
        firstStatementDate: fromDbDate(plan.firstStatementDate),
      },
      cardCycle(plan.account),
      plan,
      this.recognizedTransactions(plan).map((item) => ({
        number: item.installmentNumber!,
        transactionId: item.id,
        amount: item.amount,
        transactionDate: item.transactionDate,
      })),
      today(),
    );
    return { plan, view };
  }

  private recognizedTransactions(plan: PlanWithRelations) {
    return plan.transactions.filter((item) => item.installmentNumber !== null);
  }

  private financedPurchase(plan: PlanWithRelations) {
    return (
      plan.transactions.find(
        (item) => item.type === TransactionType.FINANCED_PURCHASE,
      ) ?? null
    );
  }

  /**
   * El corte de la cuota 1: el que se indique (vale su mes; el día es el de
   * corte de la tarjeta) o, por defecto, el primero desde la compra.
   */
  private firstStatementDate(
    startDate: CalendarDate,
    requested: string | undefined,
    cycle: CardCycle,
  ): CalendarDate {
    const firstCut = statementOnOrAfter(cycle.statementDay, startDate);
    if (requested === undefined) return firstCut;
    const date = parseCalendarDate(requested);
    if (!date) throw invalidDate('firstStatementDate');
    const normalized = normalizeStatementDate(date, cycle.statementDay);
    if (compareDates(normalized, firstCut) < 0) {
      throw new BadRequestException(PLAN_FIRST_STATEMENT_MESSAGE);
    }
    return normalized;
  }

  private assertCategory(
    kind: InstallmentPlanKind,
    recognizeInstallments: boolean,
    category: Category | null,
  ): void {
    if (
      category === null &&
      (kind === InstallmentPlanKind.PURCHASE || recognizeInstallments)
    ) {
      throw new BadRequestException(PLAN_CATEGORY_REQUIRED_MESSAGE);
    }
  }

  /** Lo anterior al ancla ya está dentro del saldo anclado: contarlo otra vez lo duplicaría. */
  private assertAfterAnchor(card: Account, purchaseDate: Date): void {
    if (card.initialBalanceDate && purchaseDate < card.initialBalanceDate) {
      throw new BadRequestException(PLAN_PURCHASE_BEFORE_ANCHOR_MESSAGE);
    }
  }

  private toResponse({ plan, view }: LoadedPlan): IInstallmentPlanResponse {
    return toInstallmentPlanResponse(
      plan,
      view,
      effectiveAnnualRate(plan.monthlyRate),
      this.financedPurchase(plan)?.id ?? null,
    );
  }

  private toDetail(loaded: LoadedPlan): IInstallmentPlanDetail {
    return {
      ...this.toResponse(loaded),
      schedule: toScheduleItems(loaded.view),
    };
  }

  private toPending(
    plan: PlanWithRelations,
    item: InstallmentView,
  ): IPendingInstallment {
    return {
      planId: plan.id,
      kind: plan.kind,
      number: item.number,
      installmentCount: plan.installmentCount,
      description: plan.description,
      category: plan.category,
      accountId: plan.accountId,
      accountName: plan.account.name,
      statementDate: formatCalendarDate(item.statementDate),
      dueDate: formatCalendarDate(item.dueDate),
      principal: item.principal.toNumber(),
      estimatedInterest: item.estimatedInterest.toNumber(),
    };
  }
}
