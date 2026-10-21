import { Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

/** OTP policy. Together with the IP throttling this allows at most 9 guesses per phone per hour. */
export const OTP_POLICY = {
  length: 6,
  ttlMs: 3 * 60_000,
  maxAttempts: 3,
  resendCooldownMs: 60_000,
  maxSendsPerWindow: 3,
  /** A phone is locked for `windowMs` once this many of its challenges ran out of attempts. */
  lockoutAfterExhausted: 3,
  windowMs: 60 * 60_000,
  /**
   * Challenges older than this are deleted by the periodic cleanup. Must cover a lockout: up to
   * `lockoutAfterExhausted` challenges spread over one window, plus the window itself.
   */
  retentionMs: 3 * 60 * 60_000,
  cleanupIntervalMs: 10 * 60_000,
} as const;

export const TOKEN_TTL = {
  session: '1h',
  registration: '15m',
} as const;

export type TokenType = keyof typeof TOKEN_TTL;

/**
 * Reads a secret from the environment. Production refuses to start without it; development falls
 * back to a random per-process value (tokens and pending codes do not survive a restart).
 */
export function secretFromEnv(name: string): string {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === 'production') throw new Error(`${name} must be set in production`);
  Logger.warn(`${name} is not set, using a random secret for this process`, 'AuthConfig');
  return randomBytes(32).toString('hex');
}
