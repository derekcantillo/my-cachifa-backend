import { AccountType, Prisma, type Account } from '@prisma/client';
import { toAccountResponse } from '../interfaces/account-response.interface';
import {
  creditCardFigures,
  effectiveAnnualRate,
  formatCalendarDate,
  nextPaymentDate,
  nextStatementDate,
  parseCalendarDate,
  startOfNextFinancialDay,
} from './credit-card';

const decimal = (value: number) => new Prisma.Decimal(value);
const figures = (balance: number, limit: number) => {
  const { debt, available, overLimit } = creditCardFigures(
    decimal(balance),
    decimal(limit),
  );
  return {
    debt: debt.toNumber(),
    available: available.toNumber(),
    overLimit: overLimit.toNumber(),
  };
};
/** Bogotá 12:00 of that day. */
const bogotaNoon = (date: string) => new Date(`${date}T17:00:00Z`);

describe('creditCardFigures', () => {
  it('TC VISA al corte de octubre: disponible 0 (nunca negativo) y sobrecupo', () => {
    expect(figures(-4_539_024, 4_300_000)).toEqual({
      debt: 4_539_024,
      available: 0,
      overLimit: 239_024,
    });
  });

  it('TC Davivienda: deuda dentro del cupo, sin sobrecupo', () => {
    expect(figures(-4_670_990, 11_500_000)).toEqual({
      debt: 4_670_990,
      available: 6_829_010,
      overLimit: 0,
    });
  });

  it('un saldo a favor no es deuda y deja todo el cupo disponible', () => {
    expect(figures(50_000, 1_000_000)).toEqual({
      debt: 0,
      available: 1_000_000,
      overLimit: 0,
    });
  });
});

describe('startOfNextFinancialDay', () => {
  it('el corte del 31/10 se ancla el 1/11 a las 00:00 de Bogotá (05:00 UTC)', () => {
    expect(
      startOfNextFinancialDay({ year: 2026, month: 10, day: 31 }).toISOString(),
    ).toBe('2026-11-01T05:00:00.000Z');
  });

  it('cruza el año', () => {
    expect(
      startOfNextFinancialDay({ year: 2026, month: 12, day: 31 }).toISOString(),
    ).toBe('2027-01-01T05:00:00.000Z');
  });
});

describe('parseCalendarDate', () => {
  it('lee YYYY-MM-DD', () => {
    expect(parseCalendarDate('2026-10-29')).toEqual({
      year: 2026,
      month: 10,
      day: 29,
    });
  });

  it.each(['2026-02-30', '2026-13-01', '2026-10-31T00:00:00Z', '31/10/2026'])(
    'rechaza %p',
    (value) => {
      expect(parseCalendarDate(value)).toBeNull();
    },
  );
});

describe('nextStatementDate', () => {
  const next = (day: number, now: string) =>
    formatCalendarDate(nextStatementDate(day, bogotaNoon(now)));

  it('el día 31 se ajusta a meses cortos', () => {
    expect(next(31, '2026-11-04')).toBe('2026-11-30');
    expect(next(31, '2027-02-10')).toBe('2027-02-28');
    expect(next(31, '2028-02-10')).toBe('2028-02-29');
  });

  it('el día del corte cuenta como próximo corte; el día siguiente ya no', () => {
    expect(next(29, '2026-10-29')).toBe('2026-10-29');
    expect(next(29, '2026-10-30')).toBe('2026-11-29');
  });

  it('usa el día de Bogotá, no el de UTC', () => {
    // 29/10 a las 21:00 en Bogotá ya es 30/10 en UTC.
    const lateOnCutDay = new Date('2026-10-30T02:00:00Z');
    expect(formatCalendarDate(nextStatementDate(29, lateOnCutDay))).toBe(
      '2026-10-29',
    );
  });
});

describe('nextPaymentDate', () => {
  const next = (cut: number, due: number, now: Date) =>
    formatCalendarDate(nextPaymentDate(cut, due, now));

  it('después del corte, el pago de ese corte (mes siguiente)', () => {
    expect(next(31, 17, bogotaNoon('2026-11-04'))).toBe('2026-11-17');
    expect(next(29, 15, bogotaNoon('2026-11-04'))).toBe('2026-11-15');
  });

  it('vencido ese pago, el del siguiente corte', () => {
    expect(next(31, 17, bogotaNoon('2026-11-18'))).toBe('2026-12-17');
  });

  it('el día de pago, a las 22:00 en Bogotá, sigue siendo ese pago', () => {
    expect(next(31, 17, new Date('2026-11-18T03:00:00Z'))).toBe('2026-11-17');
  });

  it('el día de pago 31 se ajusta al mes del pago', () => {
    expect(next(15, 31, bogotaNoon('2026-10-20'))).toBe('2026-11-30');
  });
});

describe('effectiveAnnualRate', () => {
  it('2,1155 % mensual = 28,5583 % EA', () => {
    expect(effectiveAnnualRate(decimal(2.1155))).toBe(28.5583);
  });

  it('0 % mensual = 0 % EA', () => {
    expect(effectiveAnnualRate(decimal(0))).toBe(0);
  });
});

describe('bloque creditCard de IAccountResponse', () => {
  const NOW = bogotaNoon('2026-11-04');
  const base: Account = {
    id: 'visa',
    userId: 'user_1',
    name: 'TC VISA Clásica',
    type: AccountType.CREDIT_CARD,
    initialBalance: decimal(-4_539_024),
    initialBalanceDate: new Date('2026-11-01T05:00:00Z'),
    institutionId: null,
    hasDebitCard: false,
    cardLast4: null,
    creditLimit: decimal(4_300_000),
    statementDay: 31,
    paymentDueDay: 17,
    defaultMonthlyRate: decimal(2.1155),
    createdAt: NOW,
    updatedAt: NOW,
  };
  const respond = (account: Account, balance: number) =>
    toAccountResponse({ ...account, institution: null }, decimal(balance), NOW);

  it('tarjeta configurada: deuda, disponible, sobrecupo, corte y pago', () => {
    expect(respond(base, -4_539_024).creditCard).toEqual({
      configured: true,
      creditLimit: 4_300_000,
      statementDay: 31,
      paymentDueDay: 17,
      defaultMonthlyRate: 2.1155,
      defaultEffectiveAnnualRate: 28.5583,
      debt: 4_539_024,
      available: 0,
      overLimit: 239_024,
      nextStatementDate: '2026-11-30',
      nextPaymentDate: '2026-11-17',
    });
  });

  it('tarjeta sin cupo: sin deuda ni disponible (el signo no es confiable)', () => {
    const unconfigured = {
      ...base,
      creditLimit: null,
      statementDay: null,
      paymentDueDay: null,
      defaultMonthlyRate: null,
    };

    expect(respond(unconfigured, 1_007_408).creditCard).toEqual({
      configured: false,
      creditLimit: null,
      statementDay: null,
      paymentDueDay: null,
      defaultMonthlyRate: null,
      defaultEffectiveAnnualRate: null,
      debt: null,
      available: null,
      overLimit: null,
      nextStatementDate: null,
      nextPaymentDate: null,
    });
  });

  it('una cuenta que no es tarjeta no trae bloque', () => {
    const savings = {
      ...base,
      type: AccountType.SAVINGS_ACCOUNT,
      creditLimit: null,
    };

    expect(respond(savings, 1_000).creditCard).toBeNull();
  });
});
