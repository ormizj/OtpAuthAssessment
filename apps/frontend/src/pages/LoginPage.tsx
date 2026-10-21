import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ApiError, api } from '../api';
import { AuthLayout } from '../components/AuthLayout';
import { paths } from '../paths';

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
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const value = phone.trim();
    if (!/^\+[\d\s().-]{7,}$/.test(value)) {
      setError('Enter your number in international format, starting with + and the country code.');
      return;
    }

    setSubmitting(true);
    setError(undefined);
    try {
      const { phone: normalized, resendIn } = await api.requestOtp(value);
      navigate(`${paths.verify}?${new URLSearchParams({ phone: normalized })}`, { state: { resendIn } });
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
          placeholder="+1 555 123 4567"
          autoComplete="tel"
          autoFocus
          required
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          error={Boolean(error)}
          helperText={error}
          disabled={submitting}
        />

        <Button type="submit" variant="contained" size="large" loading={submitting}>
          Send code
        </Button>
      </Stack>
    </AuthLayout>
  );
}
