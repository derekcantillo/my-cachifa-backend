import { BadRequestException } from '@nestjs/common';
import { AppValidationPipe } from '@common/pipes/validation.pipe';
import { UpdateTransactionDto } from './update-transaction.dto';

/** Pasa el body por el mismo pipe global que usa la app. */
function parseBody(
  body: Record<string, unknown>,
): Promise<UpdateTransactionDto> {
  return new AppValidationPipe().transform(body, {
    type: 'body',
    metatype: UpdateTransactionDto,
  }) as Promise<UpdateTransactionDto>;
}

describe('UpdateTransactionDto — recurringExpenseId', () => {
  it('acepta un id', async () => {
    const dto = await parseBody({ recurringExpenseId: 're_1' });
    expect(dto.recurringExpenseId).toBe('re_1');
  });

  it('acepta null para descruzar', async () => {
    const dto = await parseBody({ recurringExpenseId: null });
    expect(dto.recurringExpenseId).toBeNull();
  });

  it('lo deja sin definir si no se envía', async () => {
    const dto = await parseBody({ description: 'Internet' });
    expect(dto.recurringExpenseId).toBeUndefined();
  });

  it('rechaza un texto vacío', async () => {
    await expect(parseBody({ recurringExpenseId: '' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('UpdateTransactionDto — type', () => {
  it.each(['LOAN_GIVEN', 'LOAN_REPAYMENT'])(
    'rechaza cambiar el tipo a %s',
    async (type) => {
      await expect(parseBody({ type })).rejects.toMatchObject({
        response: {
          message: [
            'LOAN_GIVEN and LOAN_REPAYMENT movements are created from /loans',
          ],
        },
      });
    },
  );

  it('acepta los demás tipos', async () => {
    const dto = await parseBody({ type: 'INCOME' });
    expect(dto.type).toBe('INCOME');
  });
});

describe('UpdateTransactionDto — FINANCED_PURCHASE', () => {
  it('rechaza convertir un movimiento en compra a cuotas', async () => {
    await expect(
      parseBody({ type: 'FINANCED_PURCHASE' }),
    ).rejects.toMatchObject({
      response: {
        message: ['Financed purchases are created from /installment-plans'],
      },
    });
  });
});
