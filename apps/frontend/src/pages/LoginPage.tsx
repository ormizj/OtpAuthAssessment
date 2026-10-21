import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import { AsYouType, isSupportedCountry, validatePhoneNumberLength } from 'libphonenumber-js';
import {
  MuiTelInput,
  matchIsValidTel,
  type MuiTelInputCountry,
  type MuiTelInputInfo,
} from 'mui-tel-input';
import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ApiError, api } from '../api';
import { AuthLayout } from '../components/AuthLayout';
import { formatSeconds, useCountdown } from '../hooks/useCountdown';
import { paths } from '../paths';
import type { VerifyLocationState } from './VerifyPage';

/** Last entered number, so going back from the code step keeps it. In memory only, so a reload clears it. */
let lastPhone = '';

/** Country preselected in the picker, guessed from the browser language (e.g. `en-GB` -> GB). */
const defaultCountry = guessCountry();

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
  const [phone, setPhone] = useState(() => lastPhone);
  /** Set once the field was left with digits in it (or submitted); from then on errors update live. */
  const [touched, setTouched] = useState(() => !isEmpty(lastPhone));
  const [serverError, setServerError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  /** Running while the server rate-limits this number (429); its error only shows until then. */
  const retry = useCountdown();
  const [rateLimitError, setRateLimitError] = useState<string>();
  const rateLimited = retry.secondsLeft > 0;

  // Validate as early as is fair: after the first blur / submit, or as soon as typing on can't help.
  const error =
    (rateLimited ? `${rateLimitError} (${formatSeconds(retry.secondsLeft)})` : undefined) ??
    serverError ??
    (touched || isDone(phone) ? phoneError(phone) : undefined);

  function handleChange(value: string, info: MuiTelInputInfo) {
    // Block digits beyond the longest number the country allows; switching country is always allowed.
    if (info.reason === 'input' && validatePhoneNumberLength(value) === 'TOO_LONG') return;
    setPhone(value);
    setServerError(undefined);
    if (rateLimited && value !== phone) retry.start(0); // The limit is per number; another may pass.
    lastPhone = value;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (phoneError(phone)) return;

    setSubmitting(true);
    setServerError(undefined);
    try {
      const { phone: normalized, resendIn } = await api.requestOtp(phone);
      const state: VerifyLocationState = { resendAt: Date.now() + resendIn * 1000 };
      navigate(`${paths.verify}?${new URLSearchParams({ phone: normalized })}`, { state });
    } catch (e) {
      if (e instanceof ApiError && e.status === 429 && e.retryAfter) {
        setRateLimitError(e.message);
        retry.start(e.retryAfter);
      } else {
        setServerError(e instanceof ApiError ? e.message : 'Something went wrong, please try again.');
      }
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
        <MuiTelInput
          name="phone"
          label="Phone number"
          defaultCountry={defaultCountry}
          forceCallingCode
          focusOnSelectCountry
          autoComplete="tel"
          autoFocus
          required
          value={phone}
          onChange={handleChange}
          onBlur={() => setTouched((was) => was || !isEmpty(phone))}
          error={Boolean(error)}
          helperText={error}
          disabled={submitting}
        />

        <Button
          type="submit"
          variant="contained"
          size="large"
          loading={submitting}
          disabled={rateLimited}
        >
          Send code
        </Button>
      </Stack>
    </AuthLayout>
  );
}

/** Client-side check, same rule as the server (`PhoneSchema`), which still validates on its own. */
function phoneError(value: string): string | undefined {
  if (isEmpty(value)) return 'Enter your phone number.';
  if (validatePhoneNumberLength(value) === 'TOO_SHORT') return 'This number is too short.';
  if (!matchIsValidTel(value)) return 'Enter a valid phone number.';
  return undefined;
}

/** True when only the calling code is there (the input always keeps e.g. `+1`). */
function isEmpty(value: string): boolean {
  const typer = new AsYouType();
  typer.input(value);
  return !typer.getNationalNumber();
}

/**
 * True when more digits can't make the number right: no more fit, or it was already valid one digit
 * ago (typed past the end of the number).
 */
function isDone(value: string): boolean {
  if (isEmpty(value)) return false;
  if (validatePhoneNumberLength(`${value}0`) === 'TOO_LONG') return true;
  return !matchIsValidTel(value) && matchIsValidTel(value.replace(/\d\D*$/, ''));
}

function guessCountry(): MuiTelInputCountry {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    if (region && isSupportedCountry(region)) return region;
  } catch {
    // Unknown locale or region: fall through to the default.
  }
  return 'US';
}
