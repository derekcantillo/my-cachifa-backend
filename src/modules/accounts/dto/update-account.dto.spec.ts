import { BadRequestException } from '@nestjs/common';
import { AppValidationPipe } from '@common/pipes/validation.pipe';
import { RETIRED_ACCOUNT_TYPE_MESSAGE } from '../account-types';
import { UpdateAccountDto } from './update-account.dto';

/** Pasa el body por el mismo pipe global que usa la app. */
function parseBody(body: Record<string, unknown>): Promise<UpdateAccountDto> {
  return new AppValidationPipe().transform(body, {
    type: 'body',
    metatype: UpdateAccountDto,
  }) as Promise<UpdateAccountDto>;
}

describe('UpdateAccountDto', () => {
  it('acepta un body vacío', async () => {
    await expect(parseBody({})).resolves.toEqual({});
  });

  it('acepta null en institutionId y cardLast4 para borrarlos', async () => {
    const dto = await parseBody({ institutionId: null, cardLast4: null });

    expect(dto.institutionId).toBeNull();
    expect(dto.cardLast4).toBeNull();
  });

  it('acepta el cambio de DEBIT_CARD a cuenta de ahorros con tarjeta', async () => {
    const dto = await parseBody({
      type: 'SAVINGS_ACCOUNT',
      hasDebitCard: true,
      institutionId: 'bancolombia',
      cardLast4: '4321',
    });

    expect(dto).toMatchObject({ type: 'SAVINGS_ACCOUNT', hasDebitCard: true });
  });

  it('rechaza DEBIT_CARD', async () => {
    await expect(parseBody({ type: 'DEBIT_CARD' })).rejects.toMatchObject({
      response: { statusCode: 400, message: [RETIRED_ACCOUNT_TYPE_MESSAGE] },
    });
  });

  it.each(['name', 'type', 'hasDebitCard'])(
    'rechaza %s = null (no se puede borrar)',
    async (field) => {
      await expect(parseBody({ [field]: null })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );

  it.each([{ name: '' }, { cardLast4: '12' }, { institutionId: '' }])(
    'rechaza %p',
    async (body) => {
      await expect(parseBody(body)).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('rechaza campos que no se editan aquí (el saldo inicial tiene su ruta)', async () => {
    await expect(parseBody({ initialBalance: 0 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
