import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { AsYouType, parsePhoneNumberFromString } from 'libphonenumber-js';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ApiError, api } from '../api';
import { AuthLayout } from '../components/AuthLayout';
import { paths } from '../paths';
import type { VerifyLocationState } from './VerifyPage';

/** Last entered number, so going back from the code step keeps it. Per tab only. */
const PHONE_KEY = 'login.phone';

/** State other pages can pass when sending the user back here. */
export interface LoginLocationState {
  notice?: string;
}

/**
 * "/" - Step 1: phone number.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const notice = (useLocation().state as LoginLocationState | null)?.notice;
  const [phone, setPhone] = useState(loadPhone);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const { value, selectionStart } = event.target;
    // Format while typing (or pasting / autofilling) at the end; editing in the middle or deleting
    // keeps the raw text, so the caret doesn't jump and formatting characters can be removed.
    const appending = value.length > phone.length && selectionStart === value.length;
    const next = appending && value.startsWith('+') ? new AsYouType().input(value) : value;
    setPhone(next);
    savePhone(next);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const value = phone.trim();
    // Same rule as the server (`PhoneSchema`), which still validates on its own.
    if (!value.startsWith('+') || !parsePhoneNumberFromString(value)?.isValid()) {
      setError('Enter a valid number in international format, starting with + and the country code.');
      return;
    }

    setSubmitting(true);
    setError(undefined);
    try {
      const { phone: normalized, resendIn } = await api.requestOtp(value);
      const state: VerifyLocationState = { resendAt: Date.now() + resendIn * 1000 };
      navigate(`${paths.verify}?${new URLSearchParams({ phone: normalized })}`, { state });
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 429 && e.retryAfter
          ? `${e.message} (${e.retryAfter}s)`
          : e instanceof ApiError
            ? e.message
            : 'Something went wrong, please try again.',
      );
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      activeStep={0}
      title="Sign in or create an account"
      subtitle="Enter your phone number and we'll text you a verification code."
    >
      <Stack component="form" spacing={2.5} noValidate onSubmit={handleSubmit}>
        {notice && !error && <Alert severity="info">{notice}</Alert>}
        <TextField
          name="phone"
          label="Phone number"
          type="tel"
          placeholder="+1 202 555 0143"
          autoComplete="tel"
          autoFocus
          required
          value={phone}
          onChange={handleChange}
          error={Boolean(error)}
          helperText={error}
          disabled={submitting}
          slotProps={{ htmlInput: { maxLength: 32 } }}
        />

        <Button type="submit" variant="contained" size="large" loading={submitting}>
          Send code
        </Button>
      </Stack>
    </AuthLayout>
  );
}

function loadPhone(): string {
  try {
    return sessionStorage.getItem(PHONE_KEY) ?? '';
  } catch {
    return '';
  }
}

function savePhone(phone: string): void {
  try {
    sessionStorage.setItem(PHONE_KEY, phone);
  } catch {
    // Storage unavailable: the field just starts empty next time.
  }
}
