# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

OTP-based login / registration assessment: NestJS backend + React frontend in an npm-workspaces monorepo orchestrated by Turborepo. The OTP flow is implemented (see README "Auth Flow, Security & Scaling").

@AGENTS.md

Per the above: before touching Turborepo config/commands, read the docs bundled with the installed `turbo` package (`node_modules/turbo/docs/`), not training data. Don't remove the managed block in AGENTS.md.

## Commands

Node 24+ (`.nvmrc`). Run from the repo root:

- `npm run dev` — backend (`nest start --watch`, :3000) + frontend (Vite, :5173)
- `npm run dev:backend` / `npm run dev:frontend`
- `npm run typecheck` · `npm run build` · `npm test` (only the backend has tests)
- Any task for one app: `npx turbo run <task> --filter=backend`

Single test (Jest, backend only; specs are `src/**/*.spec.ts`):

    npm test -w backend -- src/auth/auth.service.spec.ts
    npm test -w backend -- -t "test name pattern"

Jest runs via `node --experimental-vm-modules` because `@loewen-digital/flatdb` is ESM-only — use the package `test` script rather than invoking `jest` directly.

There is no linter; formatting follows `.prettierrc` (single quotes, trailing commas, width 100).

## Architecture

**Backend (`apps/backend`)** — `main.ts` sets the global `/api` prefix and CORS (`CLIENT_ORIGIN`, default `http://localhost:5173`; port from `PORT`). `AppModule` imports:
- `DatabaseModule` — `@Global`, so `DatabaseService` is injectable anywhere without importing.
- `SmsModule` — exports the mock `SmsService.sendSMS(phone, code)` (async; just logs `[SMS SERVICE] Sending OTP ...` — read OTPs from the backend terminal). Provided as-is; don't modify.
- `ThrottlerModule` — global per-IP rate limiting (`APP_GUARD`), tighter `@Throttle` limits on auth routes.
- `AuthModule` — `AuthController` (`POST /api/auth/request-otp`, `/verify-otp`, `/complete-registration`, `GET /me`) + `AuthService`. Tokens are HS256 JWTs with a `typ` claim (`session` | `registration`), checked by `@Auth(type)` (`jwt-auth.guard.ts`). Bodies are validated with zod via `ZodValidationPipe`; per-phone operations are serialized with `KeyedMutex` (`src/common/`). OTP policy constants live in `auth.config.ts`.

**Database** (`src/database/`) — JSON-file DB on `@loewen-digital/flatdb`, one file per row at `data/<table>/<id>.json` (relative to the backend cwd; override with `DATABASE_DIR`; delete the folder to reset).
- Tables (`users`, `otpChallenges`) are declared as zod object schemas in `databaseSchema` (`database.schema.ts`); `db.table('name')` returns a fully typed `Table`. Use `TableRow<'name'>` for row types. Unique columns go in `tableOptions` (enforced by flatdb).
- `id`, `createdAt`, `updatedAt` are auto-managed — declaring them in a schema throws.
- Rows round-trip through JSON: use `z.coerce.date()`, never `z.date()` (writes that don't round-trip are rejected).
- Every write is validated and every read re-parsed; returned objects are copies — persist changes with `update()` (shallow merge).
- Filters support Mongo-style operators (`$lt`, `$in`, `$or`, ...) or a predicate function; see `table.ts`.
- When `DatabaseService` is provided directly in a `Test.createTestingModule` (no `DATABASE_DIR` token), it uses an in-memory adapter — the intended setup for unit tests. `db.reset()` clears all tables.

**Frontend (`apps/frontend`)** — React 19, React Router (`createBrowserRouter` in `router.tsx`), MUI. Route paths live in `paths.ts` (`/` login → `/verify?phone=` code → `/register` name+email for new users → `/home`). `AuthProvider` keeps the session/registration JWTs in localStorage; `auth/guards.tsx` wraps routes. API calls go through `api.ts` to `VITE_API_URL` (default `http://localhost:3000/api`, no Vite proxy).
