import { Body, Query, UsePipes, applyDecorators } from '@nestjs/common';
import { ApiBody, ApiExtraModels, ApiQuery } from '@nestjs/swagger';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ZodValidationPipe } from './zod-validation.pipe';

/**
 * Turn a Zod schema into the JSON Schema that the OpenAPI document publishes.
 *
 * This is why the contracts package can be the single source of truth: the
 * same schema object validates the request AND documents it, so the published
 * API spec cannot drift from what the endpoint actually accepts.
 */
export function openApiSchemaFor(schema: ZodTypeAny): Record<string, unknown> {
  return zodToJsonSchema(schema, {
    target: 'openApi3',
    $refStrategy: 'none',
    errorMessages: false,
  }) as Record<string, unknown>;
}

/** Validated, documented request body. */
export function ZodBody(schema: ZodTypeAny): ParameterDecorator & MethodDecorator {
  return ((target: object, key?: string | symbol, indexOrDescriptor?: number | PropertyDescriptor) => {
    if (typeof indexOrDescriptor === 'number') {
      Body(new ZodValidationPipe(schema))(target, key, indexOrDescriptor);
    }
  }) as ParameterDecorator & MethodDecorator;
}

/** Documents the body schema on the operation (used with ZodBody). */
export function ApiZodBody(schema: ZodTypeAny, description?: string): MethodDecorator {
  return applyDecorators(
    ApiBody({ schema: openApiSchemaFor(schema) as never, description }),
  );
}

/** Validated, coerced query string. */
export function ZodQuery(schema: ZodTypeAny): ParameterDecorator {
  return ((target: object, key: string | symbol | undefined, index: number) => {
    Query(new ZodValidationPipe(schema))(target, key, index);
  }) as ParameterDecorator;
}

export function ApiZodQuery(schema: ZodTypeAny): MethodDecorator {
  const json = openApiSchemaFor(schema) as { properties?: Record<string, unknown>; required?: string[] };
  const props = json.properties ?? {};
  const required = new Set(json.required ?? []);
  return applyDecorators(
    ...Object.entries(props).map(([name, def]) =>
      ApiQuery({ name, required: required.has(name), schema: def as never }),
    ),
  );
}

export { ApiExtraModels, UsePipes };
