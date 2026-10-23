import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { decimalsToStrings } from '../pagination';

/**
 * Serialises every Prisma Decimal in a response as a decimal STRING.
 *
 * Registered globally so no endpoint can accidentally emit a quantity as a
 * JSON number. A JSON number is an IEEE-754 double: a 6-decimal rate can lose
 * its last digit on the way to the browser, silently.
 *
 * It preserves the exact VALUE, not the column's scale: a NUMERIC(18,4) holding
 * 2.5000 is emitted as "2.5", because the runtime cannot know each column's
 * declared scale. Endpoints that want a fixed scale — so a table of quantities
 * aligns — format those fields explicitly with `.toFixed(n)`.
 */
@Injectable()
export class DecimalSerializerInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((value) => {
        if (value === null || value === undefined) return value;
        if (Array.isArray(value)) {
          return value.map((v) => (isPlainObject(v) ? decimalsToStrings(v) : v));
        }
        if (isPlainObject(value)) return decimalsToStrings(value);
        return value;
      }),
    );
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !(v instanceof Date) && !Buffer.isBuffer(v);
}
