import { Prisma } from '@prisma/client';
import { formatCalendarDate } from '@modules/accounts/lib/credit-card';
import {
  buildSchedule,
  describePlan,
  installmentAmount,
  periodRangeEnd,
  type CardCycle,
  type PlanState,
  type PlanTerms,
} from './installment-schedule';

const decimal = (value: number) => new Prisma.Decimal(value);
const day = (value: string) => {
  const [year, month, dayOfMonth] = value.split('-').map(Number);
  return { year, month, day: dayOfMonth };
};
const TODAY = day('2026-11-04');
const VISA: CardCycle = { statementDay: 31, paymentDueDay: 17 };
const DAVIVIENDA: CardCycle = { statementDay: 29, paymentDueDay: 15 };
const active = (overrides: Partial<PlanState> = {}): PlanState => ({
  status: 'ACTIVE',
  billedBeforeTracking: 0,
  recognizeInstallments: true,
  settlementInstallment: null,
  ...overrides,
});

/** TC Davivienda: celular de 6.999.000 a 24 cuotas al 0 %, la 9/24 en el corte del 29/10. */
const CELULAR: PlanTerms = {
  principal: decimal(6_999_000),
  installmentCount: 24,
  monthlyRate: decimal(0),
  firstStatementDate: day('2026-02-28'),
};
/** TC VISA: ampliación de plazo de 2.016.132,08 a 12 cuotas al 1,9915 %, la 7/12 en el corte del 31/10. */
const AMPLIACION: PlanTerms = {
  principal: decimal(2_016_132.08),
  installmentCount: 12,
  monthlyRate: decimal(1.9915),
  firstStatementDate: day('2026-04-30'),
};
/** TC VISA: compra de 1.605.708 a 36 cuotas al 2,1155 % del 12/10/2026 (cuota 1 en el corte del 31/10). */
const COMPRA_OCTUBRE: PlanTerms = {
  principal: decimal(1_605_708),
  installmentCount: 36,
  monthlyRate: decimal(2.1155),
  firstStatementDate: day('2026-10-31'),
};

describe('installmentAmount', () => {
  it.each([
    [6_999_000, 24, 291_625],
    [2_016_132.08, 12, 168_011.01],
    [1_605_708, 36, 44_603],
    [93_900, 36, 2_608.33],
  ])('%d / %d = %d', (principal, count, expected) => {
    expect(installmentAmount(decimal(principal), count).toNumber()).toBe(
      expected,
    );
  });
});

describe('buildSchedule', () => {
  it('la última cuota absorbe el redondeo y el total da el principal', () => {
    const schedule = buildSchedule(
      { ...COMPRA_OCTUBRE, principal: decimal(93_900) },
      VISA,
    );

    expect(schedule).toHaveLength(36);
    expect(schedule[0].principal.toNumber()).toBe(2_608.33);
    expect(schedule[35].principal.toNumber()).toBe(2_608.45);
    expect(
      schedule.reduce((sum, item) => sum.plus(item.principal), decimal(0)),
    ).toEqual(decimal(93_900));
  });

  it('93.900 a 36 cuotas al 2,1155 %: interés estimado ≈ 36.749 (P × r × (N + 1) / 2)', () => {
    const schedule = buildSchedule(
      { ...COMPRA_OCTUBRE, principal: decimal(93_900) },
      VISA,
    );

    expect(schedule[0].estimatedInterest.toNumber()).toBe(1_986.45);
    expect(schedule[1].estimatedInterest.toNumber()).toBe(1_931.28);
    expect(schedule[35].estimatedInterest.toNumber()).toBe(55.18);
    const total = schedule.reduce(
      (sum, item) => sum.plus(item.estimatedInterest),
      decimal(0),
    );
    expect(total.toNumber()).toBeCloseTo(36_749, -1);
  });

  it('corte 31 = último día del mes, y el pago es el día 17 del mes siguiente', () => {
    const schedule = buildSchedule(AMPLIACION, VISA);

    expect(
      schedule
        .slice(0, 3)
        .map(({ statementDate, dueDate }) => [
          formatCalendarDate(statementDate),
          formatCalendarDate(dueDate),
        ]),
    ).toEqual([
      ['2026-04-30', '2026-05-17'],
      ['2026-05-31', '2026-06-17'],
      ['2026-06-30', '2026-07-17'],
    ]);
    expect(formatCalendarDate(schedule[10].statementDate)).toBe('2027-02-28');
  });

  it('corte 29 en febrero es el 28 (y el 29 en año bisiesto)', () => {
    const schedule = buildSchedule(CELULAR, DAVIVIENDA);

    expect(formatCalendarDate(schedule[0].statementDate)).toBe('2026-02-28');
    expect(formatCalendarDate(schedule[1].statementDate)).toBe('2026-03-29');
    expect(formatCalendarDate(schedule[8].statementDate)).toBe('2026-10-29');
    expect(formatCalendarDate(schedule[8].dueDate)).toBe('2026-11-15');
    expect(formatCalendarDate(schedule[23].statementDate)).toBe('2028-01-29');
  });
});

describe('describePlan — casos reales al 4/11/2026', () => {
  it('celular Davivienda: va en la 9/24, quedan 4.374.375, la 9 está pendiente', () => {
    const view = describePlan(
      CELULAR,
      DAVIVIENDA,
      active({ billedBeforeTracking: 8 }),
      [],
      TODAY,
    );

    expect(view.installmentAmount.toNumber()).toBe(291_625);
    expect(view.currentInstallment).toBe(9);
    // The bank shows 4.374.374: one peso of its own rounding.
    expect(view.remainingPrincipal.toNumber()).toBe(4_374_375);
    expect(view.estimatedRemainingInterest.toNumber()).toBe(0);
    expect(view.schedule.slice(7, 10).map(({ state }) => state)).toEqual([
      'BILLED_BEFORE_TRACKING',
      'PENDING',
      'FUTURE',
    ]);
    expect(view.status).toBe('ACTIVE');
  });

  it('ampliación VISA (cuenta como gasto): va en la 7/12, cuota 168.011,01, la última 168.010,97', () => {
    const view = describePlan(
      AMPLIACION,
      VISA,
      active({ billedBeforeTracking: 6 }),
      [],
      TODAY,
    );

    expect(view.installmentAmount.toNumber()).toBe(168_011.01);
    expect(view.schedule[11].principal.toNumber()).toBe(168_010.97);
    expect(view.currentInstallment).toBe(7);
    expect(view.remainingPrincipal.toNumber()).toBe(840_055.01);
    expect(view.schedule[6]).toMatchObject({ state: 'PENDING' });
    expect(formatCalendarDate(view.schedule[6].dueDate)).toBe('2026-11-17');
    // 7th installment interest: 1.008.066,02 pending before it × 1,9915 %.
    expect(view.schedule[6].principalBefore.toNumber()).toBe(1_008_066.02);
    expect(view.schedule[6].estimatedInterest.toNumber()).toBe(20_075.63);
  });

  it('compra VISA del 12/10: cuota 1 de 44.603 facturada el 31/10, vence el 17/11', () => {
    const view = describePlan(COMPRA_OCTUBRE, VISA, active(), [], TODAY);

    expect(view.currentInstallment).toBe(1);
    expect(view.remainingPrincipal.toNumber()).toBe(1_605_708 - 44_603);
    expect(view.schedule[0]).toMatchObject({ state: 'PENDING' });
    expect(view.schedule[0].estimatedInterest.toNumber()).toBe(33_968.75);
  });

  it('un plan que no cuenta sus cuotas como gasto las muestra NOT_RECOGNIZED', () => {
    const view = describePlan(
      AMPLIACION,
      VISA,
      active({ billedBeforeTracking: 6, recognizeInstallments: false }),
      [],
      TODAY,
    );

    expect(view.schedule[6].state).toBe('NOT_RECOGNIZED');
  });

  it('con la cuota reconocida deja de estar pendiente', () => {
    const view = describePlan(
      CELULAR,
      DAVIVIENDA,
      active({ billedBeforeTracking: 8 }),
      [
        {
          number: 9,
          transactionId: 'tx_9',
          amount: decimal(291_625),
          transactionDate: new Date('2026-11-15T17:00:00Z'),
        },
      ],
      TODAY,
    );

    expect(view.schedule[8]).toMatchObject({
      state: 'RECOGNIZED',
      transactionId: 'tx_9',
    });
  });

  it('liquidado: capital restante 0 y las cuotas que faltaban quedan SETTLED', () => {
    const view = describePlan(
      CELULAR,
      DAVIVIENDA,
      {
        ...active({ billedBeforeTracking: 8 }),
        status: 'SETTLED',
        settlementInstallment: 9,
      },
      [
        {
          number: 9,
          transactionId: 'tx_settle',
          amount: decimal(4_666_000),
          transactionDate: new Date('2026-11-04T17:00:00Z'),
        },
      ],
      TODAY,
    );

    expect(view.status).toBe('SETTLED');
    expect(view.remainingPrincipal.toNumber()).toBe(0);
    expect(view.schedule[8].recognizedAmount?.toNumber()).toBe(4_666_000);
    expect(view.schedule[9].state).toBe('SETTLED');
  });

  it('FINISHED cuando todas están facturadas y ninguna pendiente', () => {
    const view = describePlan(
      {
        ...CELULAR,
        installmentCount: 2,
        firstStatementDate: day('2026-08-29'),
      },
      DAVIVIENDA,
      active({ billedBeforeTracking: 1, recognizeInstallments: false }),
      [],
      TODAY,
    );

    expect(view.status).toBe('FINISHED');
    expect(view.remainingPrincipal.toNumber()).toBe(0);
  });
});

describe('periodRangeEnd', () => {
  const start = new Date('2026-10-29T05:00:00Z');

  it('un período cerrado termina en su endDate', () => {
    const end = new Date('2026-11-27T05:00:00Z');
    expect(periodRangeEnd({ startDate: start, endDate: end }, new Date())).toBe(
      end,
    );
  });

  it('el abierto termina un mes después del inicio (el salario esperado)', () => {
    expect(
      periodRangeEnd(
        { startDate: start, endDate: null },
        new Date('2026-11-04T17:00:00Z'),
      ).toISOString(),
    ).toBe('2026-11-29T05:00:00.000Z');
  });

  it('si ese día pasó sin salario, llega hasta hoy incluido', () => {
    expect(
      periodRangeEnd(
        { startDate: new Date('2026-09-29T05:00:00Z'), endDate: null },
        new Date('2026-11-04T17:00:00Z'),
      ).toISOString(),
    ).toBe('2026-11-05T05:00:00.000Z');
  });
});
