import { BadRequestException } from '@nestjs/common';
import { AppValidationPipe } from '@common/pipes/validation.pipe';
import {
  CARD_LAST4_MESSAGE,
  RETIRED_ACCOUNT_TYPE_MESSAGE,
} from '../account-types';
import { CreateAccountDto } from './create-account.dto';

/** Pasa el body por el mismo pipe global que usa la app. */
function parseBody(body: Record<string, unknown>): Promise<CreateAccountDto> {
  return new AppValidationPipe().transform(body, {
    type: 'body',
    metatype: CreateAccountDto,
  }) as Promise<CreateAccountDto>;
}

describe('CreateAccountDto', () => {
  it.each(['SAVINGS_ACCOUNT', 'CHECKING_ACCOUNT', 'DIGITAL_WALLET', 'CASH'])(
    'acepta el tipo %s',
    async (type) => {
      await expect(parseBody({ name: 'Cuenta', type })).resolves.toMatchObject({
        type,
      });
    },
  );

  it('rechaza DEBIT_CARD con un mensaje que dice qué usar', async () => {
    await expect(
      parseBody({ name: 'Ahorros', type: 'DEBIT_CARD' }),
    ).rejects.toMatchObject({
      response: { statusCode: 400, message: [RETIRED_ACCOUNT_TYPE_MESSAGE] },
    });
  });

  it('acepta entidad, tarjeta débito y últimos 4 dígitos', async () => {
    const dto = await parseBody({
      name: 'Ahorros Bancolombia',
      type: 'SAVINGS_ACCOUNT',
      institutionId: 'inst_1',
      hasDebitCard: true,
      cardLast4: '0123',
    });

    expect(dto).toMatchObject({
      institutionId: 'inst_1',
      hasDebitCard: true,
      cardLast4: '0123',
    });
  });

  it.each(['123', '12345', '12a4', '    '])(
    'rechaza cardLast4 = %p',
    async (cardLast4) => {
      await expect(
        parseBody({ name: 'Visa', type: 'CREDIT_CARD', cardLast4 }),
      ).rejects.toMatchObject({
        response: { message: [CARD_LAST4_MESSAGE] },
      });
    },
  );

  it.each(['false', 'true', 1])(
    'rechaza hasDebitCard = %p (no lo convierte a boolean)',
    async (hasDebitCard) => {
      await expect(
        parseBody({ name: 'Ahorros', type: 'SAVINGS_ACCOUNT', hasDebitCard }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );
});
