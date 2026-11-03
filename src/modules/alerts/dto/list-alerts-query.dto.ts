import { Transform } from 'class-transformer';
import { IsOptional, IsBoolean } from 'class-validator';

/**
 * Los query params llegan como texto y `enableImplicitConversion` los pasa por
 * `Boolean()`, así que `"false"` llegaría como `true`. Se lee el valor crudo de
 * `obj`; cualquier otro texto se deja tal cual para que `@IsBoolean` lo rechace.
 */
function parseBooleanQuery({
  obj,
  key,
}: {
  obj: object;
  key: string;
}): unknown {
  const raw: unknown = (obj as Record<string, unknown>)[key];
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}

export class ListAlertsQueryDto {
  /** Si se omite o es `false`, devuelve todas (últimas 50). */
  @IsOptional()
  @Transform(parseBooleanQuery)
  @IsBoolean()
  unreadOnly?: boolean;
}
