import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

const SESSION_KEY = 'auth.sessionToken';
const REGISTRATION_KEY = 'auth.registrationToken';

interface AuthState {
  /** Bearer token of a logged-in user. */
  sessionToken: string | null;
  /** Ticket proving a verified phone that still has to register. */
  registrationToken: string | null;
  signIn(sessionToken: string): void;
  startRegistration(registrationToken: string): void;
  signOut(): void;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Holds the auth tokens, persisted in localStorage. Expired tokens are dropped on load; this is
 * only for a smoother UX, the server validates every token.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessionToken, setSessionToken] = useState(() => load(SESSION_KEY));
  const [registrationToken, setRegistrationToken] = useState(() => load(REGISTRATION_KEY));

  const signIn = useCallback((token: string) => {
    setSessionToken(save(SESSION_KEY, token));
    setRegistrationToken(save(REGISTRATION_KEY, null));
  }, []);

  const startRegistration = useCallback((token: string) => {
    setSessionToken(save(SESSION_KEY, null));
    setRegistrationToken(save(REGISTRATION_KEY, token));
  }, []);

  const signOut = useCallback(() => {
    setSessionToken(save(SESSION_KEY, null));
    setRegistrationToken(save(REGISTRATION_KEY, null));
  }, []);

  const value = useMemo(
    () => ({ sessionToken, registrationToken, signIn, startRegistration, signOut }),
    [sessionToken, registrationToken, signIn, startRegistration, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside <AuthProvider>');
  return auth;
}

function load(key: string): string | null {
  try {
    const token = localStorage.getItem(key);
    if (token && !isExpired(token)) return token;
    localStorage.removeItem(key);
  } catch {
    // Storage unavailable (private mode, blocked): behave as logged out.
  }
  return null;
}

function save(key: string, token: string | null): string | null {
  try {
    if (token) localStorage.setItem(key, token);
    else localStorage.removeItem(key);
  } catch {
    // Keep the in-memory state even if it cannot be persisted.
  }
  return token;
}

/** Reads the (unverified) `exp` claim of a JWT. */
function isExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}
