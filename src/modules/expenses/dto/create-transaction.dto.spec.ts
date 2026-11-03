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

  it.each(['EXPENSE', 'INCOME', 'SAVING', 'DEBT_PAYMENT'])(
    'acepta %s',
    async (type) => {
      const dto = await parseBody({ ...VALID, type });
      expect(dto.type).toBe(type);
    },
  );
});
