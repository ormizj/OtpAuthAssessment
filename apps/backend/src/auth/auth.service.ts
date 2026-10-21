import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { KeyedMutex } from '../common/keyed-mutex';
import type { TableRow } from '../database/database.schema';
import { DatabaseService } from '../database/database.service';
import { SmsService } from '../sms/sms.service';
import { OTP_POLICY, TOKEN_TTL, type TokenType } from './auth.config';
import type { CompleteRegistrationDto } from './auth.dto';
import type { TokenPayload } from './jwt-auth.guard';
import { RetryLaterException } from './retry-later.exception';

/** Server-side secret mixed into every OTP hash, so a leaked database does not reveal codes. */
export const OTP_PEPPER = Symbol('OTP_PEPPER');

/** The user fields that may leave the server. */
export interface PublicUser {
  id: string;
  phone: string;
  name: string;
  email: string;
}

export interface RequestOtpResult {
  phone: string;
  /** Seconds until the code expires. */
  expiresIn: number;
  /** Seconds until another code may be requested. */
  resendIn: number;
}

export type VerifyOtpResult =
  | { status: 'authenticated'; token: string; user: PublicUser }
  | { status: 'registration_required'; registrationToken: string };

export interface SessionResult {
  token: string;
  user: PublicUser;
}

type Challenge = TableRow<'otpChallenges'>;

const INVALID_CODE = 'Invalid or expired code';

@Injectable()
export class AuthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthService.name);
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly db: DatabaseService,
    private readonly sms: SmsService,
    private readonly jwt: JwtService,
    private readonly mutex: KeyedMutex,
    @Inject(OTP_PEPPER) private readonly pepper: string,
  ) {}

  private get users() {
    return this.db.table('users');
  }

  private get challenges() {
    return this.db.table('otpChallenges');
  }

  /**
   * Sends a new code to `phone`, invalidating any previous one. Responds the same whether or not
   * the phone belongs to an account, so it cannot be used to discover registered numbers.
   */
  requestOtp(phone: string): Promise<RequestOtpResult> {
    return this.mutex.run(phone, async () => {
      const now = Date.now();
      const recent = await this.recentChallenges(phone, now);
      this.assertCanSend(recent, now);

      await Promise.all(
        recent
          .filter((challenge) => this.isActive(challenge, now))
          .map((challenge) => this.challenges.update(challenge.id, { invalidatedAt: new Date(now) })),
      );

      const code = randomInt(0, 10 ** OTP_POLICY.length)
        .toString()
        .padStart(OTP_POLICY.length, '0');
      const challenge = await this.challenges.insert({
        phone,
        codeHash: this.hashCode(phone, code),
        expiresAt: new Date(now + OTP_POLICY.ttlMs),
      });

      try {
        await this.sms.sendSMS(phone, code);
      } catch (error) {
        await this.challenges.update(challenge.id, { invalidatedAt: new Date() });
        this.logger.error('Sending the OTP failed', error instanceof Error ? error.stack : error);
        throw new ServiceUnavailableException('Could not send the code, try again later');
      }

      return {
        phone,
        expiresIn: OTP_POLICY.ttlMs / 1000,
        resendIn: OTP_POLICY.resendCooldownMs / 1000,
      };
    });
  }

  /**
   * Checks `code` against the phone's active challenge. Existing users get a session; new users
   * get a short-lived registration ticket bound to the now verified phone.
   */
  verifyOtp(phone: string, code: string): Promise<VerifyOtpResult> {
    // Serialized per phone, so parallel guesses cannot slip past the attempt limit and a correct
    // code cannot be redeemed twice.
    return this.mutex.run(phone, async () => {
      const now = Date.now();
      const challenge = (await this.recentChallenges(phone, now)).find((c) => this.isActive(c, now));
      if (!challenge) throw new UnauthorizedException(INVALID_CODE);

      if (!this.matches(challenge.codeHash, this.hashCode(phone, code))) {
        const attempts = challenge.attempts + 1;
        await this.challenges.update(challenge.id, { attempts });
        const attemptsLeft = OTP_POLICY.maxAttempts - attempts;
        throw new UnauthorizedException({ statusCode: 401, message: INVALID_CODE, attemptsLeft });
      }

      await this.challenges.update(challenge.id, { consumedAt: new Date(now) });

      const user = await this.users.findOne({ phone });
      if (user) return { status: 'authenticated', token: await this.sign('session', user.id), user: toPublic(user) };
      return { status: 'registration_required', registrationToken: await this.sign('registration', phone) };
    });
  }

  /**
   * Creates the account for a phone that passed OTP verification (proven by the registration
   * ticket, see `JwtAuthGuard`). A ticket only works once: afterwards the phone is registered.
   */
  completeRegistration(phone: string, { name, email }: CompleteRegistrationDto): Promise<SessionResult> {
    return this.mutex.run(phone, async () => {
      if (await this.users.findOne({ phone })) throw new ConflictException('This phone number is already registered');
      if (await this.users.findOne({ email })) throw new ConflictException('This email is already in use');

      let user: TableRow<'users'>;
      try {
        user = await this.users.insert({ phone, name, email });
      } catch (error) {
        // Backstop for races the checks above cannot see (the mutex is per phone, not per email).
        if (error instanceof Error && error.name === 'UniqueConstraintError') {
          throw new ConflictException('This email is already in use');
        }
        throw error;
      }

      return { token: await this.sign('session', user.id), user: toPublic(user) };
    });
  }

  async getUser(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException('Invalid or expired token');
    return toPublic(user);
  }

  /** Deletes challenges that no longer matter for any limit. */
  async cleanup(now = Date.now()): Promise<number> {
    return this.challenges.deleteMany({ createdAt: { $lt: new Date(now - OTP_POLICY.retentionMs) } });
  }

  onModuleInit() {
    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch((error) => this.logger.error('OTP cleanup failed', error));
    }, OTP_POLICY.cleanupIntervalMs);
    this.cleanupTimer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
  }

  /** The phone's challenges within the retention period, newest first. */
  private async recentChallenges(phone: string, now: number): Promise<Challenge[]> {
    const rows = await this.challenges.findMany({
      phone,
      createdAt: { $gt: new Date(now - OTP_POLICY.retentionMs) },
    });
    return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /** Throws `RetryLaterException` while the phone is locked, in its cooldown or over its cap. */
  private assertCanSend(recent: Challenge[], now: number) {
    const { windowMs, resendCooldownMs, maxSendsPerWindow, lockoutAfterExhausted, maxAttempts } = OTP_POLICY;
    const retryIn = (until: number) => Math.max(1, Math.ceil((until - now) / 1000));

    // Exhausted challenges are last touched by their final wrong attempt (`updatedAt`). Any
    // `lockoutAfterExhausted` of them within one window lock the phone for a window after the last.
    const exhausted = recent
      .filter((c) => c.attempts >= maxAttempts)
      .map((c) => c.updatedAt.getTime())
      .sort((a, b) => a - b);
    let lockedUntil = 0;
    for (let i = lockoutAfterExhausted - 1; i < exhausted.length; i++) {
      if (exhausted[i] - exhausted[i - lockoutAfterExhausted + 1] <= windowMs) lockedUntil = exhausted[i] + windowMs;
    }
    if (now < lockedUntil) {
      throw new RetryLaterException('Too many failed attempts, try again later', retryIn(lockedUntil));
    }

    const inWindow = recent.filter((c) => c.createdAt.getTime() > now - windowMs);
    if (inWindow.length >= maxSendsPerWindow) {
      const oldest = Math.min(...inWindow.map((c) => c.createdAt.getTime()));
      throw new RetryLaterException('Too many codes requested, try again later', retryIn(oldest + windowMs));
    }

    const latest = recent[0]?.createdAt.getTime();
    if (latest !== undefined && now - latest < resendCooldownMs) {
      throw new RetryLaterException('Please wait before requesting another code', retryIn(latest + resendCooldownMs));
    }
  }

  private isActive(challenge: Challenge, now: number): boolean {
    return (
      !challenge.consumedAt &&
      !challenge.invalidatedAt &&
      challenge.expiresAt.getTime() > now &&
      challenge.attempts < OTP_POLICY.maxAttempts
    );
  }

  /**
   * HMAC instead of a slow password hash: the code space is tiny anyway, so brute force is stopped
   * by the attempt limits, and the pepper keeps a leaked database from being brute-forced offline.
   * It is also cheap, which matters under load.
   */
  private hashCode(phone: string, code: string): string {
    return createHmac('sha256', this.pepper).update(`${phone}:${code}`).digest('hex');
  }

  private matches(storedHash: string, candidateHash: string): boolean {
    const a = Buffer.from(storedHash, 'hex');
    const b = Buffer.from(candidateHash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private sign(typ: TokenType, subject: string): Promise<string> {
    const payload: Omit<TokenPayload, 'sub'> = { typ };
    return this.jwt.signAsync(payload, { subject, expiresIn: TOKEN_TTL[typ], algorithm: 'HS256' });
  }
}

function toPublic({ id, phone, name, email }: TableRow<'users'>): PublicUser {
  return { id, phone, name, email };
}
