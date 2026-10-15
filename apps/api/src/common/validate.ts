import { z, ZodTypeAny } from 'zod';

/** Parse a request body or query with a zod schema; failures become 400 VALIDATION errors. */
export function parse<S extends ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  return schema.parse(input);
}

export const uuid = z.string().uuid();
export const optionalUuid = z.string().uuid().optional();

/** Naira amounts come in as major units from forms and are stored as kobo. */
export const moneyMinor = z.number().int().nonnegative().max(1_000_000_000);
