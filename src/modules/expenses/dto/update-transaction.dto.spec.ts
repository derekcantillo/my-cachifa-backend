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
