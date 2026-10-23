import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { ZodError, type ZodTypeAny } from 'zod';

/**
 * Validates and coerces a request payload with a Zod schema, and reports every
 * failing field at once.
 *
 * Returning all field errors together matters for this application: a goods
 * receipt form has dozens of line fields, and making a storekeeper resubmit
 * once per mistake is how data entry gets abandoned for a paper notebook.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodTypeAny) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'The submitted data is not valid',
      fieldErrors: flattenZodError(result.error),
    });
  }
}

export function flattenZodError(error: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_root';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
