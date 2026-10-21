import { ConflictException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { KeyedMutex } from '../common/keyed-mutex';
import { DatabaseService } from '../database/database.service';
import { SmsService } from '../sms/sms.service';
import { OTP_POLICY } from './auth.config';
import { AuthService, OTP_PEPPER, type VerifyOtpResult } from './auth.service';
import { RetryLaterException } from './retry-later.exception';

const PHONE = '+12025550143';
const OTHER_PHONE = '+12025550144';

describe('AuthService', () => {
  let service: AuthService;
  let db: DatabaseService;
  let jwt: JwtService;
  let sendSMS: jest.Mock<Promise<void>, [string, string]>;
  let now: number;

  /** Codes sent per phone, latest last. */
  const sent = (phone = PHONE) => sendSMS.mock.calls.filter(([to]) => to === phone).map(([, code]) => code);
  const lastCode = (phone = PHONE) => sent(phone).at(-1)!;
  const wrongCode = (phone = PHONE) => (lastCode(phone) === '000000' ? '111111' : '000000');
  const advance = (ms: number) => jest.setSystemTime((now += ms));

  async function verifiedTicket(phone = PHONE) {
    await service.requestOtp(phone);
    const result = await service.verifyOtp(phone, lastCode(phone));
    if (result.status !== 'registration_required') throw new Error('expected a new user');
    return result.registrationToken;
  }

  /** The registration flow as the controller runs it: the guard turns the ticket into the phone. */
  async function register(ticket: string, profile = { name: 'Ada', email: 'ada@example.com' }) {
    const { sub, typ } = await jwt.verifyAsync<{ sub: string; typ: string }>(ticket);
    if (typ !== 'registration') throw new UnauthorizedException();
    return service.completeRegistration(sub, profile);
  }

  async function expectRetryLater(promise: Promise<unknown>) {
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RetryLaterException);
    expect((error as RetryLaterException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    return (error as RetryLaterException).retryAfterSeconds;
  }

  beforeEach(async () => {
    // Only `Date` is faked: flatdb and the event loop keep their real timers.
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'],
    });
    now = new Date('2026-01-01T12:00:00Z').getTime();
    jest.setSystemTime(now);

    sendSMS = jest.fn(async (_phone: string, _code: string) => undefined);
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test-secret' })],
      providers: [
        AuthService,
        DatabaseService,
        KeyedMutex,
        { provide: SmsService, useValue: { sendSMS } },
        { provide: OTP_PEPPER, useValue: 'test-pepper' },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
    db = moduleRef.get(DatabaseService);
    jwt = moduleRef.get(JwtService);
    await db.reset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('requestOtp', () => {
    it('sends a 6-digit code and stores only its hash', async () => {
      await expect(service.requestOtp(PHONE)).resolves.toEqual({ phone: PHONE, expiresIn: 180, resendIn: 60 });

      expect(lastCode()).toMatch(/^\d{6}$/);
      const [challenge] = await db.table('otpChallenges').findMany();
      expect(challenge.codeHash).not.toContain(lastCode());
      expect(JSON.stringify(challenge)).not.toContain(lastCode());
    });

    it('responds identically for registered and unregistered phones', async () => {
      await register(await verifiedTicket(OTHER_PHONE));
      advance(OTP_POLICY.resendCooldownMs);

      const registered = await service.requestOtp(OTHER_PHONE);
      const unregistered = await service.requestOtp(PHONE);
      expect({ ...registered, phone: '' }).toEqual({ ...unregistered, phone: '' });
    });

    it('enforces the resend cooldown', async () => {
      await service.requestOtp(PHONE);
      advance(10_000);

      await expect(expectRetryLater(service.requestOtp(PHONE))).resolves.toBe(50);
      expect(sent()).toHaveLength(1);

      advance(50_000);
      await expect(service.requestOtp(PHONE)).resolves.toBeDefined();
    });

    it('caps the number of codes per hour', async () => {
      for (let i = 0; i < OTP_POLICY.maxSendsPerWindow; i++) {
        await service.requestOtp(PHONE);
        advance(OTP_POLICY.resendCooldownMs);
      }

      await expectRetryLater(service.requestOtp(PHONE));
      // Other phones are unaffected.
      await expect(service.requestOtp(OTHER_PHONE)).resolves.toBeDefined();

      advance(OTP_POLICY.windowMs);
      await expect(service.requestOtp(PHONE)).resolves.toBeDefined();
    });

    it('locks the phone after repeatedly exhausting the attempts', async () => {
      for (let i = 0; i < OTP_POLICY.lockoutAfterExhausted; i++) {
        await service.requestOtp(PHONE);
        for (let a = 0; a < OTP_POLICY.maxAttempts; a++) {
          await service.verifyOtp(PHONE, wrongCode()).catch(() => undefined);
        }
        advance(OTP_POLICY.resendCooldownMs);
      }

      const request = service.requestOtp(PHONE);
      await expect(request).rejects.toThrow('Too many failed attempts');
      expect(await expectRetryLater(request)).toBeGreaterThan(55 * 60);

      // Still locked after the hourly cap alone would have expired.
      advance(OTP_POLICY.windowMs - 2 * OTP_POLICY.resendCooldownMs);
      await expect(service.requestOtp(PHONE)).rejects.toThrow('Too many failed attempts');
    });

    it('invalidates the previous code', async () => {
      await service.requestOtp(PHONE);
      const first = lastCode();
      advance(OTP_POLICY.resendCooldownMs);
      await service.requestOtp(PHONE);

      if (first !== lastCode()) {
        await expect(service.verifyOtp(PHONE, first)).rejects.toThrow(UnauthorizedException);
      }
      await expect(service.verifyOtp(PHONE, lastCode())).resolves.toMatchObject({ status: 'registration_required' });
    });
  });

  describe('verifyOtp', () => {
    it('issues a registration ticket for a new phone', async () => {
      const ticket = await verifiedTicket();

      await expect(jwt.verifyAsync(ticket)).resolves.toMatchObject({ sub: PHONE, typ: 'registration' });
      await expect(db.table('users').count()).resolves.toBe(0);
    });

    it('logs an existing user in', async () => {
      const { user } = await register(await verifiedTicket());
      advance(OTP_POLICY.resendCooldownMs);

      await service.requestOtp(PHONE);
      const result = await service.verifyOtp(PHONE, lastCode());

      expect(result).toMatchObject({ status: 'authenticated', user });
      const { token } = result as Extract<VerifyOtpResult, { status: 'authenticated' }>;
      await expect(jwt.verifyAsync(token)).resolves.toMatchObject({ sub: user.id, typ: 'session' });
    });

    it('rejects without a requested code', async () => {
      await expect(service.verifyOtp(PHONE, '123456')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a code sent to another phone', async () => {
      await service.requestOtp(OTHER_PHONE);
      await service.requestOtp(PHONE);
      if (lastCode(OTHER_PHONE) !== lastCode(PHONE)) {
        await expect(service.verifyOtp(PHONE, lastCode(OTHER_PHONE))).rejects.toThrow(UnauthorizedException);
      }
    });

    it('rejects an expired code', async () => {
      await service.requestOtp(PHONE);
      advance(OTP_POLICY.ttlMs + 1);

      await expect(service.verifyOtp(PHONE, lastCode())).rejects.toThrow(UnauthorizedException);
    });

    it('accepts a code only once', async () => {
      await service.requestOtp(PHONE);
      await service.verifyOtp(PHONE, lastCode());

      await expect(service.verifyOtp(PHONE, lastCode())).rejects.toThrow(UnauthorizedException);
    });

    it('kills the code after the maximum number of wrong attempts', async () => {
      await service.requestOtp(PHONE);

      for (let left = OTP_POLICY.maxAttempts - 1; left >= 0; left--) {
        await expect(service.verifyOtp(PHONE, wrongCode())).rejects.toMatchObject({
          response: expect.objectContaining({ attemptsLeft: left }),
        });
      }
      await expect(service.verifyOtp(PHONE, lastCode())).rejects.toThrow(UnauthorizedException);
    });

    it('does not let parallel guesses exceed the attempt limit', async () => {
      await service.requestOtp(PHONE);

      const guesses = Array.from({ length: 10 }, () => service.verifyOtp(PHONE, wrongCode()));
      await Promise.allSettled(guesses);

      const [challenge] = await db.table('otpChallenges').findMany({ phone: PHONE });
      expect(challenge.attempts).toBe(OTP_POLICY.maxAttempts);
      await expect(service.verifyOtp(PHONE, lastCode())).rejects.toThrow(UnauthorizedException);
    });

    it('redeems a correct code only once under concurrency', async () => {
      await service.requestOtp(PHONE);

      const results = await Promise.allSettled(Array.from({ length: 5 }, () => service.verifyOtp(PHONE, lastCode())));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });
  });

  describe('completeRegistration', () => {
    it('creates the user and logs them in', async () => {
      const { token, user } = await register(await verifiedTicket(), { name: 'Ada', email: 'ada@example.com' });

      expect(user).toEqual({ id: expect.any(String), phone: PHONE, name: 'Ada', email: 'ada@example.com' });
      await expect(jwt.verifyAsync(token)).resolves.toMatchObject({ sub: user.id, typ: 'session' });
      await expect(service.getUser(user.id)).resolves.toEqual(user);
    });

    it('accepts a ticket only once', async () => {
      const ticket = await verifiedTicket();
      await register(ticket);

      await expect(register(ticket, { name: 'Eve', email: 'eve@example.com' })).rejects.toThrow(ConflictException);
      await expect(db.table('users').count()).resolves.toBe(1);
    });

    it('rejects an expired ticket', async () => {
      const ticket = await verifiedTicket();
      advance(15 * 60_000 + 1000);

      await expect(register(ticket)).rejects.toThrow();
      await expect(db.table('users').count()).resolves.toBe(0);
    });

    it('rejects a session token used as a ticket', async () => {
      const { token } = await register(await verifiedTicket());

      await expect(register(token)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an email that is already in use', async () => {
      await register(await verifiedTicket(OTHER_PHONE), { name: 'Ada', email: 'ada@example.com' });

      await expect(register(await verifiedTicket(), { name: 'Bob', email: 'ada@example.com' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('creates one user when the same ticket is used concurrently', async () => {
      const ticket = await verifiedTicket();

      await Promise.allSettled(Array.from({ length: 5 }, () => register(ticket)));
      await expect(db.table('users').count()).resolves.toBe(1);
    });

    it('enforces unique emails at the database level across phones', async () => {
      const [a, b] = [await verifiedTicket(OTHER_PHONE), await verifiedTicket()];
      const profile = { name: 'Ada', email: 'ada@example.com' };

      // Different phones, so the per-phone mutex does not serialize them.
      const results = await Promise.allSettled([register(a, profile), register(b, profile)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      await expect(db.table('users').count()).resolves.toBe(1);
    });
  });

  describe('cleanup', () => {
    it('removes challenges past the retention period', async () => {
      await service.requestOtp(PHONE);
      advance(OTP_POLICY.retentionMs + 1);
      await service.requestOtp(OTHER_PHONE);

      await expect(service.cleanup()).resolves.toBe(1);
      await expect(db.table('otpChallenges').findMany()).resolves.toEqual([expect.objectContaining({ phone: OTHER_PHONE })]);
    });
  });
});
