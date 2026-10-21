import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { ApiError, api } from '../api';
import { useAuth } from '../auth/AuthProvider';
import { AuthLayout } from '../components/AuthLayout';
import { useCountdown } from '../hooks/useCountdown';
import { paths } from '../paths';

const CODE_LENGTH = 6;

/**
 * "/verify?phone=<E.164>" - Step 2: one-time code.
 */
export function VerifyPage() {
  const phone = useSearchParams()[0].get('phone');
  const resendIn = (useLocation().state as { resendIn?: number } | null)?.resendIn ?? 0;
  const navigate = useNavigate();
  const { signIn, startRegistration } = useAuth();
  const cooldown = useCountdown(resendIn);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [info, setInfo] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  if (!phone) return <Navigate to={paths.login} replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (code.length !== CODE_LENGTH) {
      setError(`Enter the ${CODE_LENGTH}-digit code.`);
      return;
    }

    setSubmitting(true);
    setError(undefined);
    setInfo(undefined);
    try {
      const result = await api.verifyOtp(phone!, code);
      if (result.status === 'authenticated') {
        signIn(result.token);
        navigate(paths.home, { replace: true });
      } else {
        startRegistration(result.registrationToken);
        navigate(paths.register, { replace: true });
      }
    } catch (e) {
      setError(verifyError(e));
      setCode('');
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setResending(true);
    setError(undefined);
    setInfo(undefined);
    try {
      const result = await api.requestOtp(phone!);
      cooldown.start(result.resendIn);
      setCode('');
      setInfo('We sent you a new code.');
    } catch (e) {
      if (e instanceof ApiError && e.retryAfter) cooldown.start(e.retryAfter);
      setError(e instanceof ApiError ? e.message : 'Could not send a new code.');
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthLayout activeStep={1} title="Enter verification code" subtitle={`We sent a code to ${phone}.`}>
      <Stack component="form" spacing={2.5} noValidate onSubmit={handleSubmit}>
        {info && <Alert severity="success">{info}</Alert>}
        <TextField
          name="code"
          label="Verification code"
          autoComplete="one-time-code"
          autoFocus
          required
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
          error={Boolean(error)}
          helperText={error}
          disabled={submitting}
          slotProps={{
            htmlInput: {
              inputMode: 'numeric',
              maxLength: CODE_LENGTH,
              sx: { letterSpacing: '0.5em', textAlign: 'center', fontSize: '1.25rem' },
            },
          }}
        />

        <Button type="submit" variant="contained" size="large" loading={submitting}>
          Verify
        </Button>

        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
          <Button type="button" variant="text" size="small" onClick={() => navigate(paths.login)}>
            Use a different number
          </Button>
          <Button
            type="button"
            variant="text"
            size="small"
            onClick={handleResend}
            loading={resending}
            disabled={cooldown.secondsLeft > 0 || submitting}
          >
            {cooldown.secondsLeft > 0 ? `Resend code (${cooldown.secondsLeft}s)` : 'Resend code'}
          </Button>
        </Stack>
      </Stack>
    </AuthLayout>
  );
}

function verifyError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong, please try again.';
  if (error.status !== 401) return error.message;
  if (error.attemptsLeft === undefined) return 'This code is invalid or has expired. Request a new code.';
  if (error.attemptsLeft === 0) return 'Too many wrong attempts. Request a new code.';
  return `Wrong code. ${error.attemptsLeft} ${error.attemptsLeft === 1 ? 'attempt' : 'attempts'} left.`;
}
