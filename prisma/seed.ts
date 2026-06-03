import { Category, GoalStatus, PlanPhase, PrismaClient } from '@prisma/client';

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

  // ─── Goals ─────────────────────────────────────────────────
  const goals: {
    name: string;
    targetAmount: number;
    targetDate: Date;
    phase: PlanPhase;
    status: GoalStatus;
  }[] = [
    {
      name: 'Pay credit card',
      targetAmount: 3_000_000,
      targetDate: new Date('2026-07-01'),
      phase: PlanPhase.PHASE_1_DEBT_CONTROL,
      status: GoalStatus.COMPLETED,
    },
    {
      name: 'Emergency fund',
      targetAmount: 6_000_000,
      targetDate: new Date('2026-08-01'),
      phase: PlanPhase.PHASE_1_DEBT_CONTROL,
      status: GoalStatus.ACTIVE,
    },
    {
      name: 'Vehicle down payment',
      targetAmount: 38_000_000,
      targetDate: new Date('2027-02-01'),
      phase: PlanPhase.PHASE_3_VEHICLE_PURCHASE,
      status: GoalStatus.ACTIVE,
    },
    {
      name: 'International trip',
      targetAmount: 4_000_000,
      targetDate: new Date('2026-12-01'),
      phase: PlanPhase.PHASE_3_VEHICLE_PURCHASE,
      status: GoalStatus.ACTIVE,
    },
  ];

  for (const goal of goals) {
    const existing = await prisma.goal.findFirst({
      where: { userId: user.id, name: goal.name },
    });

    if (!existing) {
      await prisma.goal.create({ data: { userId: user.id, ...goal } });
    }
  }

  console.log(`✓ Goals seeded (${goals.length})`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
