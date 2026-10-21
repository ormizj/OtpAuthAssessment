import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { z } from 'zod';
import { OTP_POLICY } from './auth.config';

/** International phone number (leading `+` required), normalized to E.164. */
export const PhoneSchema = z
  .string()
  .trim()
  .max(32)
  .transform((value, ctx) => {
    const phone = value.startsWith('+') ? parsePhoneNumberFromString(value) : undefined;
    if (!phone?.isValid()) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number including the country code, e.g. +1 555 123 4567' });
      return z.NEVER;
    }
    return phone.number;
  });

export const RequestOtpSchema = z.object({ phone: PhoneSchema });
export type RequestOtpDto = z.output<typeof RequestOtpSchema>;

export const VerifyOtpSchema = z.object({
  phone: PhoneSchema,
  code: z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{${OTP_POLICY.length}}$`), `Enter the ${OTP_POLICY.length}-digit code`),
});
export type VerifyOtpDto = z.output<typeof VerifyOtpSchema>;

export const CompleteRegistrationSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email').max(254)),
});
export type CompleteRegistrationDto = z.output<typeof CompleteRegistrationSchema>;
