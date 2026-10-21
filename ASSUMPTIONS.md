# Assumptions

Every assumption made about the requirements and the code. Each entry gives the decision, the value, and why it was chosen. Policy numbers live in [`apps/backend/src/auth/auth.config.ts`](apps/backend/src/auth/auth.config.ts), which is the source of truth; if a value here disagrees with that file, the file wins.

---

## 1. Guiding priority

- **Security is enforced on the server, UX comes first on the client.** The backend is the only trust boundary. It enforces every rule: limits, token types, uniqueness. Client-side guards and validation only steer navigation and give faster feedback. So the client can pick convenience (localStorage, the phone number in the URL) without weakening what the server enforces.

## 2. OTP policy

Values are common industry defaults, and they are all tunable in `OTP_POLICY`.

| Decision | Value | Why |
| --- | --- | --- |
| Code length | 6 digits, from `crypto.randomInt` | Standard for SMS OTP. A CSPRNG makes codes unpredictable. |
| Validity | 3 minutes | Long enough for SMS delay, short enough to limit guessing. |
| Single use | yes (`consumedAt`) | A redeemed code can't be replayed. |
| Wrong attempts per code | 3, then the code is dead | Limits online guessing per code. |
| New code invalidates old | yes | Only one live code per phone, so guesses can't be spread across codes. |
| Resend cooldown | 60 seconds | Stops SMS spam and cost abuse while still allowing a quick retry. |
| Codes per phone per hour | 3 | Caps SMS cost and guessing per phone. |
| Lockout | 1 hour, after 3 codes run out of attempts within 1 hour | Stops repeated brute-force rounds. |
| Resulting guess cap | ≈ 9 guesses per phone per hour → about a 1-in-111,000 chance per hour | Lets the brute-force risk be bounded and stated as a number. |
| Clock | Server time is authoritative | The client is never trusted for expiry or cooldowns. It only shows countdowns. |

## 3. Rate limiting (per IP)

- In-memory `@nestjs/throttler`: **60 requests/min** overall, **5/min** on `request-otp`, **10/min** on `verify-otp`, **5/min** on `complete-registration`. These sit on top of the per-phone limits, so one IP can't cycle through many phones without limit.
- Every 429 response carries `Retry-After` (and `retryAfter` in the body), so the UI can show an exact countdown.
- Behind a reverse proxy, `TRUST_PROXY` must be set, or every client shares the proxy's IP.

## 4. Accepted risks

- **Lockout DoS:** the lockout is per phone, so someone who knows a victim's number can lock it for 1 hour by burning codes on purpose. **Accepted:** protecting accounts from brute force matters more than this availability risk.

## 5. OTP storage and delivery

- **Codes are never stored.** Only `HMAC-SHA256(OTP_PEPPER, phone:code)` is kept, and it is compared in constant time (`timingSafeEqual`).
- **HMAC instead of bcrypt/argon:** with 10⁶ possible codes, a slow hash adds little. The attempt limits stop online brute force, and the secret pepper stops offline brute force of a leaked database. HMAC is also cheap under load.
- **Retention:** challenges are deleted 3 hours after creation (a cleanup runs every 10 minutes). 3 hours is long enough to cover a full lockout window.
- **SMS failure:** the request returns 503 and the just-created code is invalidated, so a code that was never sent can't count as active.
- **SMS mock:** `SmsService` was provided as-is and is not modified. It prints the code to the backend terminal, which is acceptable only because it is a mock.

## 6. Identity and enumeration

- **The phone number is the only identity.** Whoever holds the number owns the account.
- **No account enumeration:** `request-otp` responds the same way for registered and unknown numbers. Whether an account exists is revealed only after a correct OTP, i.e. only to the number's owner.

## 7. Phone input

- International format with a leading `+` is required. Numbers are validated and normalized to E.164 with `libphonenumber-js` on the server. The client checks too, for quick feedback.
- **Any valid number is accepted on purpose:** any country, mobile, landline or VoIP. Whether an SMS can be delivered is left to the SMS provider.
- The country picker is pre-selected from the browser language (e.g. `en-GB` → GB).

## 8. Registration

- Only new users register. Existing users are signed in right after OTP verification.
- **Name:** trimmed, 1–100 characters.
- **Email:** trimmed, lowercased, valid format, max 254 characters, **unique** (enforced by a unique index as a backstop against races).
- **The registration ticket** is a 15-minute JWT that carries the verified phone. The phone is never taken from the request body. It works only once, because after use the phone is registered and a reuse gets 409.
- **Abandoned registration:** if the ticket expires, the user must request a new OTP. No partial account is ever created.
- Duplicate phone or email → **409**.

## 9. Sessions and tokens

- **Stateless HS256 JWTs** with a `typ` claim (`session` | `registration`). The guard rejects the wrong type, so one token can't stand in for the other.
- **Lifetimes:** session 1 hour, registration ticket 15 minutes.
- **No refresh token, no server-side revocation.** Sign-out only discards the token on the client. Chosen for **simplicity and horizontal scale**: there is no session store, and the short lifetime limits exposure.
- **Secrets:** `JWT_SECRET` and `OTP_PEPPER` are required when `NODE_ENV=production`. In development a random per-process secret is used, so restarting the backend logs everyone out and voids pending codes.

## 10. Client token storage: localStorage

- Tokens are stored in **localStorage** for the best user experience: you stay signed in across tabs, refreshes and browser restarts (until the token expires).
- **Trade-off:** if the page had an XSS bug, an attacker's script could read the token, and it would stay readable longer than with the alternatives considered:
  - *sessionStorage:* survives a refresh but is cleared when the tab closes.
  - *Memory only:* most resistant to XSS, but a refresh logs the user out and loses the registration ticket.
- Mitigations: the 1-hour token lifetime, expired tokens dropped on load, and helmet security headers.

## 11. Phone number in the URL

- The verify step is `/verify?phone=<E.164>` instead of keeping the phone in storage. This was treated as a possible product requirement: the URL survives a refresh and can be shared or bookmarked.
- **Trade-off:** the phone number (PII) ends up in browser history, the `Referer` header and server/proxy access logs.
- The resend countdown is kept in the history entry's state as an absolute time, so it resumes after a refresh.

## 12. Home page

- A custom `/home` page (not part of the brief) shows the user's name, phone and email, loaded from a new `GET /api/auth/me` endpoint, plus a Sign out button. It proves the session works end to end. A 401 from `/me` signs the user out.

## 13. Deployment and scale

- **Single process assumed.** flatdb (the JSON-file database), the per-phone `KeyedMutex` and the throttler counters all live in one process. The swap points for horizontal scale (SQL database, Redis lock, Redis throttler storage) are listed in the README.
- CORS allows exactly one origin (`CLIENT_ORIGIN`). JSON bodies are limited to 10 KB. Helmet headers are on.
- No Vite dev proxy: the frontend calls `VITE_API_URL` (default `http://localhost:3000/api`) directly.
- **Production build and start were added and tested.** `npm run build` builds both apps. `npm start` (`turbo run start`) then serves the built output: the backend runs `node dist/main` on :3000 and the frontend runs `vite preview` on :5173. Both were run end to end to confirm the app works from its production build, not only in dev mode. Turbo passes the production env vars through to `start` (`NODE_ENV`, `PORT`, `CLIENT_ORIGIN`, `TRUST_PROXY`, `DATABASE_DIR`, `JWT_SECRET`, `OTP_PEPPER`). With `NODE_ENV=production`, `JWT_SECRET` and `OTP_PEPPER` must be set (see §9).
- `vite preview` is good enough to check the built frontend. A real deployment would serve `apps/frontend/dist` from a static host or CDN, and `VITE_API_URL` must be set at build time because Vite inlines it into the bundle.

## 14. Out of scope

- Profile editing, account deletion, changing the phone number.
- Internationalization (English only).
- Frontend tests (only the backend has unit tests, as in the boilerplate).
- Audit logging and monitoring.

## 15. Known limitations / future work

- **Recycled phone numbers:** if a carrier gives a number to someone new, that person can sign into the previous owner's account. Future work: an extra check (e.g. a confirmation by email) when signing in on a new device.
- **Email is not verified.** It is collected and kept unique, but never confirmed. It should be verified before it is trusted for anything, such as account recovery or notifications.
- **No session revocation or refresh** (see §9).
- **Lockout DoS** (accepted, see §4).
- **Per-process state** limits the app to a single instance (see §13).
