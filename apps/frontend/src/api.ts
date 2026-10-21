/** Typed client for the backend auth API. */

const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';

export interface User {
  id: string;
  phone: string;
  name: string;
  email: string;
}

export interface RequestOtpResponse {
  /** The phone normalized to E.164, use it for the following calls. */
  phone: string;
  expiresIn: number;
  resendIn: number;
}

export type VerifyOtpResponse =
  | { status: 'authenticated'; token: string; user: User }
  | { status: 'registration_required'; registrationToken: string };

export interface SessionResponse {
  token: string;
  user: User;
}

/** A non-2xx response. `message` is safe to show to the user. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Seconds to wait before retrying (429). */
    readonly retryAfter?: number,
    /** Remaining tries for the current code (wrong OTP). */
    readonly attemptsLeft?: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, { body, token }: { body?: unknown; token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const retryAfter = Number(response.headers.get('Retry-After') ?? data.retryAfter) || undefined;
    throw new ApiError(response.status, errorMessage(response.status, data), retryAfter, data.attemptsLeft);
  }
  return data as T;
}

function errorMessage(status: number, data: { message?: unknown; errors?: { message: string }[] }): string {
  if (data.errors?.length) return data.errors[0].message;
  if (typeof data.message === 'string') return data.message;
  if (status === 429) return 'Too many requests, please wait a moment.';
  return 'Something went wrong, please try again.';
}

export const api = {
  requestOtp: (phone: string) => request<RequestOtpResponse>('/auth/request-otp', { body: { phone } }),
  verifyOtp: (phone: string, code: string) => request<VerifyOtpResponse>('/auth/verify-otp', { body: { phone, code } }),
  completeRegistration: (registrationToken: string, profile: { name: string; email: string }) =>
    request<SessionResponse>('/auth/complete-registration', { body: profile, token: registrationToken }),
  me: (sessionToken: string) => request<{ user: User }>('/auth/me', { token: sessionToken }),
};
