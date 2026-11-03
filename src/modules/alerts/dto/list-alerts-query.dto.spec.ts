import { BadRequestException } from '@nestjs/common';
import { AppValidationPipe } from '@common/pipes/validation.pipe';
import { ListAlertsQueryDto } from './list-alerts-query.dto';

/** Pasa el query por el mismo pipe global que usa la app. */
function parseQuery(
  query: Record<string, string>,
): Promise<ListAlertsQueryDto> {
  return new AppValidationPipe().transform(query, {
    type: 'query',
    metatype: ListAlertsQueryDto,
  }) as Promise<ListAlertsQueryDto>;
}

describe('ListAlertsQueryDto', () => {
  it('lee "false" como false', async () => {
    await expect(parseQuery({ unreadOnly: 'false' })).resolves.toEqual({
      unreadOnly: false,
    });
  });

  it('lee "true" como true', async () => {
    await expect(parseQuery({ unreadOnly: 'true' })).resolves.toEqual({
      unreadOnly: true,
    });
  });

  it('deja unreadOnly sin definir si se omite', async () => {
    const query = await parseQuery({});
    expect(query.unreadOnly).toBeUndefined();
  });

  it('rechaza un valor que no es booleano', async () => {
    await expect(parseQuery({ unreadOnly: 'abc' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
