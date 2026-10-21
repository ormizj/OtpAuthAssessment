import { Navigate, Outlet } from 'react-router';
import { paths } from '../paths';
import { useAuth } from './AuthProvider';

/*
 * Route guards. They only steer navigation; the server enforces every rule on its own.
 */

/** Login steps: logged-in users go straight to the home page. */
export function RequireGuest() {
  const { sessionToken } = useAuth();
  return sessionToken ? <Navigate to={paths.home} replace /> : <Outlet />;
}

/** Registration: only with a ticket from a verified phone. */
export function RequireRegistration() {
  const { sessionToken, registrationToken } = useAuth();
  if (sessionToken) return <Navigate to={paths.home} replace />;
  return registrationToken ? <Outlet /> : <Navigate to={paths.login} replace />;
}

/** Logged-in area. */
export function RequireSession() {
  const { sessionToken } = useAuth();
  return sessionToken ? <Outlet /> : <Navigate to={paths.login} replace />;
}
