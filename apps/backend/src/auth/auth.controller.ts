import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseFilters } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  CompleteRegistrationSchema,
  RequestOtpSchema,
  VerifyOtpSchema,
  type CompleteRegistrationDto,
  type RequestOtpDto,
  type VerifyOtpDto,
} from './auth.dto';
import { AuthService } from './auth.service';
import { Auth, TokenSubject } from './jwt-auth.guard';
import { RetryLaterFilter } from './retry-later.exception';

const PER_MINUTE = 60_000;

/**
 * Auth endpoints (under the global `/api` prefix).
 *
 * On top of the global per-IP limit (see `AppModule`), the OTP endpoints have tighter per-IP
 * limits; per-phone limits are enforced by `AuthService`.
 */
@Controller('auth')
@UseFilters(RetryLaterFilter)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('request-otp')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: PER_MINUTE } })
  requestOtp(@Body(new ZodValidationPipe(RequestOtpSchema)) { phone }: RequestOtpDto) {
    return this.auth.requestOtp(phone);
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: PER_MINUTE } })
  verifyOtp(@Body(new ZodValidationPipe(VerifyOtpSchema)) { phone, code }: VerifyOtpDto) {
    return this.auth.verifyOtp(phone, code);
  }

  /** Requires the registration ticket from `verify-otp` as bearer token. */
  @Post('complete-registration')
  @Auth('registration')
  @Throttle({ default: { limit: 5, ttl: PER_MINUTE } })
  completeRegistration(
    @TokenSubject() phone: string,
    @Body(new ZodValidationPipe(CompleteRegistrationSchema)) body: CompleteRegistrationDto,
  ) {
    return this.auth.completeRegistration(phone, body);
  }

  @Get('me')
  @Auth('session')
  async me(@TokenSubject() userId: string) {
    return { user: await this.auth.getUser(userId) };
  }
}
