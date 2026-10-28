import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { TenantRequiredError } from './decorators';

/**
 * Consistent API error envelope:
 *   { statusCode, error, message, details? }
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload =
        typeof body === 'string'
          ? { statusCode: status, error: exception.name, message: body }
          : {
              statusCode: status,
              error: (body as any)?.error ?? exception.name,
              message: (body as any)?.message ?? exception.message,
              ...(status === 422 ? { details: (body as any)?.details } : {}),
            };
      return response.status(status).json(payload);
    }

    // Cross-tenant / missing company scope → 403 (never leak existence)
    if (exception instanceof TenantRequiredError) {
      return response.status(HttpStatus.FORBIDDEN).json({
        statusCode: 403,
        error: 'Forbidden',
        message: exception.message,
      });
    }

    const message =
      exception instanceof Error ? exception.message : 'Internal server error';
    // Unique-violation shorthand (Prisma P2002)
    if (/unique constraint|P2002/i.test(message)) {
      return response.status(HttpStatus.CONFLICT).json({
        statusCode: 409,
        error: 'Conflict',
        message: 'A record with those values already exists',
      });
    }
    if (/append-only|payledger: unbalanced/i.test(message)) {
      return response.status(HttpStatus.CONFLICT).json({
        statusCode: 409,
        error: 'LedgerError',
        message,
      });
    }
    // eslint-disable-next-line no-console
    console.error(`[api] unhandled error on ${request.method} ${request.url}:`, exception);
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      error: 'InternalServerError',
      message: 'Internal server error',
    });
  }
}
