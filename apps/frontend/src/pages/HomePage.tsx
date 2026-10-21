import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { ApiError, api, type User } from '../api';
import { useAuth } from '../auth/AuthProvider';
import { AuthLayout } from '../components/AuthLayout';

/**
 * "/home" - Logged in.
 */
export function HomePage() {
  const { sessionToken, signOut } = useAuth();
  const [user, setUser] = useState<User>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    api.me(sessionToken!).then(
      ({ user }) => active && setUser(user),
      (e) => {
        if (!active) return;
        // Expired or invalid session: the guard sends the user back to the login.
        if (e instanceof ApiError && e.status === 401) signOut();
        else setError(e instanceof ApiError ? e.message : 'Could not load your profile.');
      },
    );
    return () => {
      active = false;
    };
  }, [sessionToken, signOut]);

  return (
    <AuthLayout activeStep={3} title={user ? `Welcome, ${user.name}` : 'Welcome'} subtitle="You are signed in.">
      <Stack spacing={2.5}>
        {error && <Alert severity="error">{error}</Alert>}
        {!user && !error && <CircularProgress sx={{ alignSelf: 'center' }} />}
        {user && (
          <Stack spacing={0.5}>
            <Typography variant="body2" color="text.secondary">
              Phone
            </Typography>
            <Typography>{user.phone}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ pt: 1 }}>
              Email
            </Typography>
            <Typography>{user.email}</Typography>
          </Stack>
        )}
        <Button variant="outlined" size="large" onClick={signOut}>
          Sign out
        </Button>
      </Stack>
    </AuthLayout>
  );
}
