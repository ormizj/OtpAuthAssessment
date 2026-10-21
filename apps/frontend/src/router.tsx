import { createBrowserRouter, Navigate } from 'react-router';
import { RequireGuest, RequireRegistration, RequireSession } from './auth/guards';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { VerifyPage } from './pages/VerifyPage';
import { paths } from './paths';

/**
 * Application routes.
 *
 *   /          -> LoginPage     (phone number)              guests only
 *   /verify    -> VerifyPage    (one-time code, ?phone=)    guests only
 *   /register  -> RegisterPage  (name + email)              verified phone, not registered yet
 *   /home      -> HomePage      (logged in)                 session only
 */
export const router = createBrowserRouter([
  {
    element: <RequireGuest />,
    children: [
      { path: paths.login, element: <LoginPage /> },
      { path: paths.verify, element: <VerifyPage /> },
    ],
  },
  { element: <RequireRegistration />, children: [{ path: paths.register, element: <RegisterPage /> }] },
  { element: <RequireSession />, children: [{ path: paths.home, element: <HomePage /> }] },
  { path: '*', element: <Navigate to={paths.login} replace /> },
]);
