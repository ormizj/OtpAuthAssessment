import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { SmsModule } from './sms/sms.module';

/**
 * Root module.
 *
 * - `DatabaseModule` is global: `DatabaseService` can be injected anywhere without re-importing.
 * - `SmsModule` exports `SmsService` for modules that import it.
 * - `AuthModule` hosts the OTP flow (service + controller).
 * - `ThrottlerModule` rate-limits every route per client IP (60/min by default, tighter on the
 *   auth routes). Its storage is in memory, i.e. per process.
 */
@Module({
  imports: [
    ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: 60 }] }),
    DatabaseModule,
    SmsModule,
    AuthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
