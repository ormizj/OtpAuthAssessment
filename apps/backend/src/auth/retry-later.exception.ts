import {
  type ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';

/** 429 carrying how long the client has to wait, sent as `Retry-After` and in the body. */
export class RetryLaterException extends HttpException {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super({ statusCode: HttpStatus.TOO_MANY_REQUESTS, message, retryAfter: retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

@Catch(RetryLaterException)
export class RetryLaterFilter extends BaseExceptionFilter {
  catch(exception: RetryLaterException, host: ArgumentsHost) {
    host.switchToHttp().getResponse<Response>().setHeader('Retry-After', String(exception.retryAfterSeconds));
    super.catch(exception, host);
  }
}
