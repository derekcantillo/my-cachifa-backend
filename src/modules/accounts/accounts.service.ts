import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Account, AccountType, Prisma, TransactionType } from '@prisma/client';
import { CurrentUserService } from '@common/services/current-user.service';
import { PrismaService } from '@modules/prisma/prisma.service';
import { DEBIT_CARD_HOLDER_TYPES } from './account-types';
import type { CreateAccountDto } from './dto/create-account.dto';
import type { UpdateAccountDto } from './dto/update-account.dto';
import {
  ACCOUNT_INCLUDE,
  toAccountResponse,
  type IAccountResponse,
} from './interfaces/account-response.interface';

const ZERO = new Prisma.Decimal(0);

export const DEBIT_CARD_NOT_ALLOWED_MESSAGE =
  'hasDebitCard is only allowed on SAVINGS_ACCOUNT, CHECKING_ACCOUNT and DIGITAL_WALLET accounts';

export const CREDIT_CARD_TYPE_CHANGE_MESSAGE =
  'An account with movements cannot change to or from CREDIT_CARD: the sign of its balance would change meaning';

export const CARD_LAST4_WITHOUT_CARD_MESSAGE =
  'cardLast4 needs a card: a CREDIT_CARD, or an account with hasDebitCard';

export const CARD_FIELDS_ONLY_ON_CREDIT_CARD_MESSAGE =
  'creditLimit, statementDay, paymentDueDay and defaultMonthlyRate are only allowed on CREDIT_CARD accounts';

export const CONFIGURE_WITH_STATEMENT_MESSAGE =
  'This card already has a balance or movements: set its credit limit with POST /accounts/:id/statement-balance, which also sets the debt';

/** Lo que define qué atributos de producto y de tarjeta admite una cuenta. */
interface ProductFields {
  type: AccountType;
  hasDebitCard: boolean;
  cardLast4: string | null;
  creditLimit: Prisma.Decimal | null;
  statementDay: number | null;
  paymentDueDay: number | null;
  defaultMonthlyRate: Prisma.Decimal | null;
}

/** `undefined` = no viene (no tocar); `null` = borrar. */
function toDecimal(value: number | null): Prisma.Decimal | null;
function toDecimal(
  value: number | null | undefined,
): Prisma.Decimal | null | undefined;
function toDecimal(value: number | null | undefined) {
  return value === undefined || value === null
    ? value
    : new Prisma.Decimal(value);
}

/** El valor del body si llegó, o el que ya tiene la cuenta. */
const patched = <T>(value: T | undefined, current: T): T =>
  value === undefined ? current : value;

export interface IAccountBalance {
  account: Account;
  currentBalance: Prisma.Decimal;
}

/** Suman al saldo de la cuenta. */
const BALANCE_INCREASING_TYPES: TransactionType[] = [
  TransactionType.INCOME,
  TransactionType.LOAN_REPAYMENT,
];

/**
 * Restan del saldo de la cuenta (`accountId`) — el ahorro también, porque sale
 * de aquí hacia la meta, y una `TRANSFER` desde su origen.
 */
const BALANCE_DECREASING_TYPES: TransactionType[] = [
  TransactionType.EXPENSE,
  TransactionType.SAVING,
  TransactionType.DEBT_PAYMENT,
  TransactionType.LOAN_GIVEN,
  TransactionType.TRANSFER,
];

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  async findAll(): Promise<IAccountResponse[]> {
    const userId = await this.currentUser.getUserId();

    const accounts = await this.prisma.account.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: ACCOUNT_INCLUDE,
    });

    return Promise.all(
      accounts.map(async (account) =>
        toAccountResponse(account, await this.computeCurrentBalance(account)),
      ),
    );
  }

  async create(dto: CreateAccountDto): Promise<IAccountResponse> {
    const userId = await this.currentUser.getUserId();
    const product: ProductFields = {
      type: dto.type,
      hasDebitCard: dto.hasDebitCard ?? false,
      cardLast4: dto.cardLast4 ?? null,
      creditLimit: toDecimal(dto.creditLimit ?? null),
      statementDay: dto.statementDay ?? null,
      paymentDueDay: dto.paymentDueDay ?? null,
      defaultMonthlyRate: toDecimal(dto.defaultMonthlyRate ?? null),
    };
    this.assertProductFields(product);
    if (dto.institutionId) {
      await this.assertInstitutionOwned(dto.institutionId, userId);
    }

    const account = await this.prisma.account.create({
      data: {
        userId,
        name: dto.name,
        institutionId: dto.institutionId ?? null,
        ...product,
      },
      include: ACCOUNT_INCLUDE,
    });

    return toAccountResponse(
      account,
      await this.computeCurrentBalance(account),
    );
  }

  async update(id: string, dto: UpdateAccountDto): Promise<IAccountResponse> {
    const userId = await this.currentUser.getUserId();
    const existing = await this.findOwned(id, userId);

    const creditLimit = toDecimal(dto.creditLimit);
    const defaultMonthlyRate = toDecimal(dto.defaultMonthlyRate);
    this.assertProductFields({
      type: patched(dto.type, existing.type),
      hasDebitCard: patched(dto.hasDebitCard, existing.hasDebitCard),
      cardLast4: patched(dto.cardLast4, existing.cardLast4),
      creditLimit: patched(creditLimit, existing.creditLimit),
      statementDay: patched(dto.statementDay, existing.statementDay),
      paymentDueDay: patched(dto.paymentDueDay, existing.paymentDueDay),
      defaultMonthlyRate: patched(
        defaultMonthlyRate,
        existing.defaultMonthlyRate,
      ),
    });
    if (dto.type !== undefined && dto.type !== existing.type) {
      await this.assertTypeChangeAllowed(existing, dto.type);
    }
    if (existing.creditLimit === null && creditLimit) {
      await this.assertFirstLimitAllowed(existing);
    }
    if (dto.institutionId) {
      await this.assertInstitutionOwned(dto.institutionId, userId);
    }

    // `undefined` = no tocar; `null` = borrar.
    const account = await this.prisma.account.update({
      where: { id },
      data: {
        name: dto.name,
        type: dto.type,
        institutionId: dto.institutionId,
        hasDebitCard: dto.hasDebitCard,
        cardLast4: dto.cardLast4,
        creditLimit,
        statementDay: dto.statementDay,
        paymentDueDay: dto.paymentDueDay,
        defaultMonthlyRate,
      },
      include: ACCOUNT_INCLUDE,
    });

    return toAccountResponse(
      account,
      await this.computeCurrentBalance(account),
    );
  }

  /** Cada cuenta del usuario con su `currentBalance`, para quien necesite separarlas por tipo. */
  async getBalances(userId: string): Promise<IAccountBalance[]> {
    const accounts = await this.prisma.account.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(
      accounts.map(async (account) => ({
        account,
        currentBalance: await this.computeCurrentBalance(account),
      })),
    );
  }

  private async findOwned(id: string, userId: string): Promise<Account> {
    const account = await this.prisma.account.findFirst({
      where: { id, userId },
    });

    if (!account) {
      throw new NotFoundException(`Account ${id} not found`);
    }

    return account;
  }

  /**
   * Cupo, corte, pago y tasa son solo de tarjetas de crédito. La tarjeta débito
   * es de cuentas con plata propia (ahorros, corriente, billetera); los dígitos
   * necesitan una tarjeta: la de crédito o la débito. Se valida el estado
   * final, no solo lo que llega en el body.
   */
  private assertProductFields(product: ProductFields): void {
    const hasCardFields = [
      product.creditLimit,
      product.statementDay,
      product.paymentDueDay,
      product.defaultMonthlyRate,
    ].some((value) => value !== null);
    if (hasCardFields && product.type !== AccountType.CREDIT_CARD) {
      throw new BadRequestException(CARD_FIELDS_ONLY_ON_CREDIT_CARD_MESSAGE);
    }
    if (
      product.hasDebitCard &&
      !DEBIT_CARD_HOLDER_TYPES.includes(product.type)
    ) {
      throw new BadRequestException(DEBIT_CARD_NOT_ALLOWED_MESSAGE);
    }
    if (
      product.cardLast4 !== null &&
      product.type !== AccountType.CREDIT_CARD &&
      !product.hasDebitCard
    ) {
      throw new BadRequestException(CARD_LAST4_WITHOUT_CARD_MESSAGE);
    }
  }

  /**
   * En una tarjeta el saldo negativo es deuda; en las demás, plata que falta.
   * Con movimientos, cambiar de un lado al otro reinterpretaría todo su
   * historial, así que solo se permite en una cuenta sin movimientos.
   */
  private async assertTypeChangeAllowed(
    existing: Account,
    type: AccountType,
  ): Promise<void> {
    const wasCard = existing.type === AccountType.CREDIT_CARD;
    const willBeCard = type === AccountType.CREDIT_CARD;
    if (wasCard === willBeCard) return;

    const movements = await this.prisma.transaction.count({
      where: { OR: [{ accountId: existing.id }, { toAccountId: existing.id }] },
    });
    if (movements > 0) {
      throw new BadRequestException(CREDIT_CARD_TYPE_CHANGE_MESSAGE);
    }
  }

  /**
   * Poner cupo es lo que hace que el saldo cuente como −deuda. Una tarjeta que
   * ya tiene saldo o movimientos guarda otra cosa (la TC VISA guarda el cupo
   * disponible): ponerle cupo a secas convertiría ese número en un activo
   * falso. Para ella, `statement-balance` fija cupo y deuda a la vez.
   */
  private async assertFirstLimitAllowed(existing: Account): Promise<void> {
    const movements = await this.prisma.transaction.count({
      where: { OR: [{ accountId: existing.id }, { toAccountId: existing.id }] },
    });
    if (!existing.initialBalance.isZero() || movements > 0) {
      throw new BadRequestException(CONFIGURE_WITH_STATEMENT_MESSAGE);
    }
  }

  private async assertInstitutionOwned(
    institutionId: string,
    userId: string,
  ): Promise<void> {
    const institution = await this.prisma.financialInstitution.findFirst({
      where: { id: institutionId, userId },
      select: { id: true },
    });

    if (!institution) {
      throw new BadRequestException(`Institution ${institutionId} not found`);
    }
  }

  /**
   * `initialBalance` más lo que sumen o resten las `Transaction`s de esta
   * cuenta desde `initialBalanceDate` en adelante — sin esa fecha, se cuenta
   * todo el historial, que es como se comportaba antes de que existiera.
   * Una `TRANSFER` resta en su origen y suma en su destino (`toAccountId`):
   * pagar una tarjeta sube su saldo hacia 0.
   */
  async computeCurrentBalance(account: Account): Promise<Prisma.Decimal> {
    const dateFilter = account.initialBalanceDate
      ? { transactionDate: { gte: account.initialBalanceDate } }
      : {};

    const [increases, incomingTransfers, decreases] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: {
          accountId: account.id,
          type: { in: BALANCE_INCREASING_TYPES },
          ...dateFilter,
        },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: {
          toAccountId: account.id,
          type: TransactionType.TRANSFER,
          ...dateFilter,
        },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: {
          accountId: account.id,
          type: { in: BALANCE_DECREASING_TYPES },
          ...dateFilter,
        },
        _sum: { amount: true },
      }),
    ]);

    const increaseTotal = (increases._sum.amount ?? ZERO).plus(
      incomingTransfers._sum.amount ?? ZERO,
    );
    const decreaseTotal = decreases._sum.amount ?? ZERO;

    return account.initialBalance.plus(increaseTotal).minus(decreaseTotal);
  }
}
