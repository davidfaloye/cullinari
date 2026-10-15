import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { ErrorCode } from '@cullinari/shared';

/** Every error the API returns has a stable `code` the clients can switch on. */
export class AppError extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    status: number = HttpStatus.BAD_REQUEST,
    readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export const notFound = (what = 'Resource') => new AppError(ErrorCode.NOT_FOUND, `${what} not found`, 404);
export const forbidden = (message = 'You do not have access to this') =>
  new AppError(ErrorCode.FORBIDDEN, message, 403);

/** Plan caps use 403 with a PLAN_LIMIT_* code; the admin turns these into upgrade prompts. */
export const planLimit = (code: ErrorCode, message: string, details?: unknown) =>
  new AppError(code, message, 403, details);

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof ZodError) {
      return res.status(400).json({
        code: ErrorCode.VALIDATION,
        message: 'Some fields are missing or invalid',
        details: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (exception instanceof AppError) {
      return res.status(exception.getStatus()).json(exception.getResponse());
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code =
        status === 401
          ? ErrorCode.UNAUTHENTICATED
          : status === 403
            ? ErrorCode.FORBIDDEN
            : status === 404
              ? ErrorCode.NOT_FOUND
              : ErrorCode.VALIDATION;
      return res.status(status).json({ code, message: exception.message });
    }
    const pg = exception as { code?: string; constraint?: string };
    if (pg?.code === '23505') {
      return res.status(409).json({ code: ErrorCode.CONFLICT, message: 'That already exists', details: pg.constraint });
    }
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    return res.status(500).json({ code: 'INTERNAL', message: 'Something went wrong' });
  }
}
