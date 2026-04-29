import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse() as any;

      let code: string;
      let message: string;

      if (typeof exceptionResponse === 'object' && exceptionResponse.code) {
        code = exceptionResponse.code;
        message = exceptionResponse.message;
      } else if (typeof exceptionResponse === 'string') {
        code = toErrorCode(status);
        message = exceptionResponse;
      } else {
        code = exceptionResponse.code ?? toErrorCode(status);
        message = Array.isArray(exceptionResponse.message)
          ? exceptionResponse.message[0]
          : exceptionResponse.message ?? 'An error occurred';
      }

      return response.status(status).json({
        success: false,
        error: { code, message },
      });
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
      },
    });
  }
}

function toErrorCode(status: number): string {
  const map: Record<number, string> = {
    400: 'VALIDATION_ERROR',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    422: 'UNPROCESSABLE',
  };
  return map[status] ?? 'INTERNAL_SERVER_ERROR';
}
