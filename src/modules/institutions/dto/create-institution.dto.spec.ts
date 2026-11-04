import { BadRequestException } from '@nestjs/common';
import { AppValidationPipe } from '@common/pipes/validation.pipe';
import { CreateInstitutionDto } from './create-institution.dto';

/** Pasa el body por el mismo pipe global que usa la app. */
function parseBody(
  body: Record<string, unknown>,
): Promise<CreateInstitutionDto> {
  return new AppValidationPipe().transform(body, {
    type: 'body',
    metatype: CreateInstitutionDto,
  }) as Promise<CreateInstitutionDto>;
}

describe('CreateInstitutionDto', () => {
  it('trims the name', async () => {
    const dto = await parseBody({ name: '  Bancolombia ' });
    expect(dto.name).toBe('Bancolombia');
  });

  it.each([{}, { name: '' }, { name: '   ' }])('rejects %p', async (body) => {
    await expect(parseBody(body)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unknown fields', async () => {
    await expect(
      parseBody({ name: 'Nequi', logo: 'x.png' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
