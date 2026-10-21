import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ApiError, api } from '../api';
import { useAuth } from '../auth/AuthProvider';
import { AuthLayout } from '../components/AuthLayout';
import { paths } from '../paths';
import type { LoginLocationState } from './LoginPage';

/**
 * "/register" - Step 3 (new users only): profile details.
 */
export function RegisterPage() {
  const navigate = useNavigate();
  const { registrationToken, signIn, signOut } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<{ name?: string; email?: string; form?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const nextErrors = {
      name: name.trim() ? undefined : 'Enter your name.',
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? undefined : 'Enter a valid email.',
    };
    setErrors(nextErrors);
    if (nextErrors.name || nextErrors.email) return;

    setSubmitting(true);
    try {
      const { token } = await api.completeRegistration(registrationToken!, { name, email });
      signIn(token);
      navigate(paths.home, { replace: true });
    } catch (e) {
      setSubmitting(false);
      if (!(e instanceof ApiError)) return setErrors({ form: 'Something went wrong, please try again.' });
      // The ticket expired, or the phone got registered meanwhile: verify the phone again.
      if (e.status === 401 || (e.status === 409 && e.message.includes('phone'))) {
        signOut();
        const state: LoginLocationState = {
          notice: e.status === 401 ? 'Your verification expired, please verify your phone again.' : `${e.message}, please sign in.`,
        };
        return navigate(paths.login, { replace: true, state });
      }
      if (e.status === 409) return setErrors({ email: e.message });
      setErrors({ form: e.message });
    }
  }

  return (
    <AuthLayout
      activeStep={2}
      title="Complete your profile"
      subtitle="Your phone number is verified. Tell us a bit about yourself to finish signing up."
    >
      <Stack component="form" spacing={2.5} noValidate onSubmit={handleSubmit}>
        {errors.form && <Alert severity="error">{errors.form}</Alert>}
        <TextField
          name="name"
          label="Full name"
          autoComplete="name"
          autoFocus
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={Boolean(errors.name)}
          helperText={errors.name}
          disabled={submitting}
          slotProps={{ htmlInput: { maxLength: 100 } }}
        />
        <TextField
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={Boolean(errors.email)}
          helperText={errors.email}
          disabled={submitting}
          slotProps={{ htmlInput: { maxLength: 254 } }}
        />

        <Button type="submit" variant="contained" size="large" loading={submitting}>
          Complete registration
        </Button>
      </Stack>
    </AuthLayout>
  );
}
