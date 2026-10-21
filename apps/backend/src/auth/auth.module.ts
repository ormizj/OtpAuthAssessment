import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { KeyedMutex } from '../common/keyed-mutex';
import { SmsModule } from '../sms/sms.module';
import { secretFromEnv } from './auth.config';
import { AuthController } from './auth.controller';
import { AuthService, OTP_PEPPER } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    SmsModule,
    JwtModule.registerAsync({
      useFactory: () => ({ secret: secretFromEnv('JWT_SECRET'), signOptions: { algorithm: 'HS256' } }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAuthGuard,
    KeyedMutex,
    { provide: OTP_PEPPER, useFactory: () => secretFromEnv('OTP_PEPPER') },
  ],
})
export class AuthModule {}
