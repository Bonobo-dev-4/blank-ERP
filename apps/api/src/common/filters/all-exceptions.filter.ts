import {
  ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import {
  ConfigurationError, DomainError, IllegalStateError, InvariantViolation, ValidationError,
} from '@dnd/domain';

/**
 * Single error boundary for the whole API.
 *
 * Domain errors keep their machine-readable `code` and their `details` all the
 * way to the client. That is deliberate: when a storekeeper is told an issue
 * was refused, "requested 300.0000, available 262.5000 at Fabric Room" lets
 * them fix it, whereas "Bad Request" sends them to find a developer.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const mapped = this.map(exception);

    const body = {
      statusCode: mapped.status,
      code: mapped.code,
      message: mapped.message,
      ...(mapped.details ? { details: mapped.details } : {}),
      ...(mapped.fieldErrors ? { fieldErrors: mapped.fieldErrors } : {}),
      path: req.originalUrl ?? req.url,
      timestamp: new Date().toISOString(),
      requestId: (req.headers['x-request-id'] as string | undefined) ?? undefined,
    };

    if (mapped.status >= 500) {
      this.logger.error(
        `${req.method} ${body.path} -> ${mapped.status} ${mapped.code}: ${mapped.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`${req.method} ${body.path} -> ${mapped.status} ${mapped.code}: ${mapped.message}`);
    }

    res.status(mapped.status).json(body);
  }

  private map(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
    fieldErrors?: Record<string, string[]>;
  } {
    // --- domain errors ------------------------------------------------------
    if (exception instanceof ValidationError || exception instanceof ConfigurationError) {
      return {
        status: exception instanceof ConfigurationError ? HttpStatus.FAILED_DEPENDENCY : HttpStatus.BAD_REQUEST,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }
    if (exception instanceof InvariantViolation) {
      // 409: the request was well formed but conflicts with the current state
      // of stock or production quantities.
      return {
        status: HttpStatus.CONFLICT,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }
    if (exception instanceof IllegalStateError) {
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }
    if (exception instanceof DomainError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    // --- prisma -------------------------------------------------------------
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.mapPrisma(exception);
    }
    if (exception instanceof Prisma.PrismaClientValidationError) {
      return { status: HttpStatus.BAD_REQUEST, code: 'DB_VALIDATION_ERROR', message: 'The query was rejected by the database layer' };
    }

    // --- nest --------------------------------------------------------------
    if (exception instanceof HttpException) {
      const resBody = exception.getResponse();
      if (typeof resBody === 'object' && resBody !== null) {
        const r = resBody as Record<string, unknown>;
        return {
          status: exception.getStatus(),
          code: (r.code as string) ?? defaultCodeFor(exception.getStatus()),
          message: (r.message as string) ?? exception.message,
          details: r.details as Record<string, unknown> | undefined,
          fieldErrors: r.fieldErrors as Record<string, string[]> | undefined,
        };
      }
      return {
        status: exception.getStatus(),
        code: defaultCodeFor(exception.getStatus()),
        message: String(resBody),
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    };
  }

  private mapPrisma(e: Prisma.PrismaClientKnownRequestError): {
    status: number; code: string; message: string; details?: Record<string, unknown>;
  } {
    const target = (e.meta?.target as string[] | string | undefined) ?? undefined;
    switch (e.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          code: 'DUPLICATE_RECORD',
          message: 'A record with these unique values already exists',
          details: { fields: target },
        };
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          code: 'INVALID_REFERENCE',
          message: 'A referenced record does not exist',
          details: { field: e.meta?.field_name },
        };
      case 'P2025':
        return { status: HttpStatus.NOT_FOUND, code: 'NOT_FOUND', message: 'The requested record was not found' };
      case 'P2034':
        return {
          status: HttpStatus.CONFLICT,
          code: 'TRANSACTION_CONFLICT',
          message: 'The operation conflicted with a concurrent change; please retry',
        };
      default: {
        // A violated CHECK constraint means a quantity invariant was broken.
        // The service layer should have caught it first, so surface it loudly.
        const msg = e.message ?? '';
        const checkMatch = /violates check constraint "([^"]+)"/.exec(msg);
        if (checkMatch) {
          return {
            status: HttpStatus.CONFLICT,
            code: 'INVARIANT_CONSTRAINT_VIOLATED',
            message: `The operation would break a quantity invariant (${checkMatch[1]})`,
            details: { constraint: checkMatch[1] },
          };
        }
        return {
          status: HttpStatus.BAD_REQUEST,
          code: `DB_${e.code}`,
          message: 'The database rejected this operation',
        };
      }
    }
  }
}

function defaultCodeFor(status: number): string {
  switch (status) {
    case 400: return 'BAD_REQUEST';
    case 401: return 'UNAUTHENTICATED';
    case 403: return 'FORBIDDEN';
    case 404: return 'NOT_FOUND';
    case 409: return 'CONFLICT';
    case 422: return 'UNPROCESSABLE';
    case 429: return 'RATE_LIMITED';
    default: return status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED';
  }
}
