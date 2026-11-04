import { BadRequestException } from '@nestjs/common';
import { AppValidationPipe } from '@common/pipes/validation.pipe';
import { CreateTransactionDto } from './create-transaction.dto';

/** Pasa el body por el mismo pipe global que usa la app. */
function parseBody(
  body: Record<string, unknown>,
): Promise<CreateTransactionDto> {
  return new AppValidationPipe().transform(body, {
    type: 'body',
    metatype: CreateTransactionDto,
  }) as Promise<CreateTransactionDto>;
}

const VALID = { amount: 50_000, type: 'EXPENSE', category: 'FOOD' };

describe('CreateTransactionDto — type', () => {
  it.each(['LOAN_GIVEN', 'LOAN_REPAYMENT'])(
    'rechaza crear un movimiento %s',
    async (type) => {
      const result = parseBody({ ...VALID, type, category: 'LOAN' });

      await expect(result).rejects.toBeInstanceOf(BadRequestException);
      await expect(result).rejects.toMatchObject({
        response: {
          message: [
            'LOAN_GIVEN and LOAN_REPAYMENT movements are created from /loans',
          ],
        },
      });
    },
  );

  it('rechaza crear un FINANCED_PURCHASE: nace con su plan de cuotas', async () => {
    await expect(
      parseBody({ ...VALID, type: 'FINANCED_PURCHASE' }),
    ).rejects.toMatchObject({
      response: {
        message: ['Financed purchases are created from /installment-plans'],
      },
    });
  });

  it.each(['EXPENSE', 'INCOME', 'SAVING', 'DEBT_PAYMENT'])(
    'acepta %s',
    async (type) => {
      const dto = await parseBody({ ...VALID, type });
      expect(dto.type).toBe(type);
    },
  );
});

describe('CreateTransactionDto — TRANSFER', () => {
  const TRANSFER = {
    amount: 838_675,
    type: 'TRANSFER',
    accountId: 'acc_savings',
    toAccountId: 'acc_card',
  };

  it('acepta una transferencia sin categoría', async () => {
    const dto = await parseBody(TRANSFER);
    expect(dto).toMatchObject(TRANSFER);
    expect(dto.category).toBeUndefined();
  });

  it('acepta una transferencia con categoría (el servicio la ignora)', async () => {
    const dto = await parseBody({ ...TRANSFER, category: 'OTHER' });
    expect(dto.category).toBe('OTHER');
  });

  it('valida la categoría de una transferencia si llega', async () => {
    await expect(
      parseBody({ ...TRANSFER, category: 'NOPE' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sigue exigiendo categoría en los demás tipos', async () => {
    await expect(
      parseBody({ amount: 50_000, type: 'EXPENSE' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([0, -10])('rechaza un monto de %s', async (amount) => {
    await expect(parseBody({ ...TRANSFER, amount })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
