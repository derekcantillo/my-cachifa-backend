import {
  AccountType,
  Category,
  GoalStatus,
  PlanPhase,
  PrismaClient,
} from '@prisma/client';

if (process.env['DATABASE_URL_LOCAL']) {
  process.env['DATABASE_URL'] = process.env['DATABASE_URL_LOCAL'];
}

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const waNumber = process.env['MY_WA_NUMBER'];
  const userName = process.env['SEED_USER_NAME'] ?? 'Derek';

  if (!waNumber) {
    throw new Error('MY_WA_NUMBER env variable is required for seeding');
  }

  const now = new Date();
  const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // ─── User ─────────────────────────────────────────────────
  const user = await prisma.user.upsert({
    where: { waNumber },
    update: {},
    create: { waNumber, name: userName },
  });

  console.log(`✓ User: ${user.name} (${user.waNumber})`);

  // ─── Budgets ───────────────────────────────────────────────
  const budgets: { category: Category; limitAmount: number }[] = [
    { category: Category.FOOD, limitAmount: 500_000 },
    { category: Category.TRANSPORT, limitAmount: 400_000 },
    { category: Category.ENTERTAINMENT, limitAmount: 1_000_000 },
    { category: Category.SERVICES, limitAmount: 108_000 },
    { category: Category.DEBT, limitAmount: 297_615 },
    { category: Category.SAVING, limitAmount: 1_500_000 },
    { category: Category.OTHER, limitAmount: 200_000 },
  ];

  for (const budget of budgets) {
    await prisma.budget.upsert({
      where: {
        userId_monthYear_category: {
          userId: user.id,
          monthYear,
          category: budget.category,
        },
      },
      update: { limitAmount: budget.limitAmount },
      create: {
        userId: user.id,
        monthYear,
        category: budget.category,
        limitAmount: budget.limitAmount,
      },
    });
  }

  console.log(`✓ Budgets seeded for ${monthYear}`);

  // ─── Accounts ──────────────────────────────────────────────
  const accounts: { name: string; type: AccountType }[] = [
    { name: 'Tarjeta débito principal', type: AccountType.DEBIT_CARD },
    { name: 'Efectivo', type: AccountType.CASH },
    { name: 'Cuenta de ahorros', type: AccountType.SAVINGS_ACCOUNT },
  ];

  for (const account of accounts) {
    const existing = await prisma.account.findFirst({
      where: { userId: user.id, name: account.name },
    });

    if (!existing) {
      await prisma.account.create({ data: { userId: user.id, ...account } });
    }
  }

  console.log(`✓ Accounts seeded (${accounts.length})`);

  // ─── Goals + contributions ─────────────────────────────────
  // Cada meta trae su historial de aportes; `currentAmount` se sincroniza
  // con la suma de esos aportes para que el móvil vea datos coherentes.
  const goals: {
    name: string;
    targetAmount: number;
    targetDate: Date;
    phase: PlanPhase;
    status: GoalStatus;
    contributions: { amount: number; note: string; contributedAt: Date }[];
  }[] = [
    {
      name: 'Pay credit card',
      targetAmount: 3_000_000,
      targetDate: new Date('2026-07-01'),
      phase: PlanPhase.PHASE_1_DEBT_CONTROL,
      status: GoalStatus.COMPLETED,
      // Meta completada: los aportes suman exactamente el objetivo.
      contributions: [
        {
          amount: 1_000_000,
          note: 'Depósito mensual',
          contributedAt: new Date('2026-04-15'),
        },
        {
          amount: 1_000_000,
          note: 'Depósito mensual',
          contributedAt: new Date('2026-05-15'),
        },
        {
          amount: 1_000_000,
          note: 'Bono extra',
          contributedAt: new Date('2026-06-15'),
        },
      ],
    },
    {
      name: 'Emergency fund',
      targetAmount: 6_000_000,
      targetDate: new Date('2026-08-01'),
      phase: PlanPhase.PHASE_1_DEBT_CONTROL,
      status: GoalStatus.ACTIVE,
      contributions: [
        {
          amount: 1_200_000,
          note: 'Depósito mensual',
          contributedAt: new Date('2026-05-05'),
        },
        {
          amount: 1_200_000,
          note: 'Depósito mensual',
          contributedAt: new Date('2026-06-05'),
        },
        {
          amount: 1_500_000,
          note: 'Bono extra',
          contributedAt: new Date('2026-07-05'),
        },
      ],
    },
    {
      name: 'Vehicle down payment',
      targetAmount: 38_000_000,
      targetDate: new Date('2027-02-01'),
      phase: PlanPhase.PHASE_3_VEHICLE_PURCHASE,
      status: GoalStatus.ACTIVE,
      contributions: [
        {
          amount: 1_500_000,
          note: 'Depósito mensual',
          contributedAt: new Date('2026-05-20'),
        },
        {
          amount: 1_500_000,
          note: 'Depósito mensual',
          contributedAt: new Date('2026-06-20'),
        },
        {
          amount: 1_500_000,
          note: 'Depósito mensual',
          contributedAt: new Date('2026-07-20'),
        },
      ],
    },
    {
      name: 'International trip',
      targetAmount: 4_000_000,
      targetDate: new Date('2026-12-01'),
      phase: PlanPhase.PHASE_3_VEHICLE_PURCHASE,
      status: GoalStatus.ACTIVE,
      contributions: [
        {
          amount: 400_000,
          note: 'Depósito mensual',
          contributedAt: new Date('2026-06-10'),
        },
        {
          amount: 400_000,
          note: 'Depósito mensual',
          contributedAt: new Date('2026-07-10'),
        },
      ],
    },
  ];

  let contributionCount = 0;

  for (const goal of goals) {
    const { contributions, ...goalData } = goal;

    const existing = await prisma.goal.findFirst({
      where: { userId: user.id, name: goal.name },
    });

    const record =
      existing ??
      (await prisma.goal.create({ data: { userId: user.id, ...goalData } }));

    for (const contribution of contributions) {
      const existingContribution = await prisma.goalContribution.findFirst({
        where: {
          goalId: record.id,
          note: contribution.note,
          contributedAt: contribution.contributedAt,
        },
      });

      if (!existingContribution) {
        await prisma.goalContribution.create({
          data: { goalId: record.id, ...contribution },
        });
      }

      contributionCount += 1;
    }

    const currentAmount = contributions.reduce(
      (total, contribution) => total + contribution.amount,
      0,
    );

    await prisma.goal.update({
      where: { id: record.id },
      data: { currentAmount },
    });
  }

  console.log(`✓ Goals seeded (${goals.length})`);
  console.log(`✓ Goal contributions seeded (${contributionCount})`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
