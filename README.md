# Full-Stack Assessment Boilerplate

This repository provides the foundational scaffolding for the full-stack assessment, including routing, API wiring, mock services, and UI components.

## Getting Started

Requirements: Node.js 24+ (`nvm use` picks it up from `.nvmrc`).

```bash
npm install
cp apps/backend/.env.example apps/backend/.env    # then fill in JWT_SECRET / OTP_PEPPER
cp apps/frontend/.env.example apps/frontend/.env
npm run dev        # backend on :3000, frontend on http://localhost:5173
```

The SMS service is a mock: **Any OTP codes generated will be printed in the backend terminal** (`[SMS SERVICE] Sending OTP ...`).

The monorepo is orchestrated with [Turborepo](https://turborepo.com) (`turbo.json`). Root scripts run the matching script in every app, in dependency order and with caching:

| Script              | What it does                                    |
| ------------------- | ----------------------------------------------- |
| `npm run dev`       | Runs backend (watch mode) and frontend together |
| `npm run typecheck` | Type-checks both apps                           |
| `npm test`          | Runs backend unit tests (Jest)                  |
| `npm run build`     | Production build of both apps                   |
| `npm start`         | Serves the built apps (backend :3000, frontend preview :5173) |

Run a single app with `npm run dev:backend` or `npm run dev:frontend`, or execute any task with a filter, e.g., `npx turbo run test --filter=backend`.

## Project Structure

```text
apps/
├── backend/                       NestJS
│   └── src/
│       ├── main.ts                bootstrap (global `/api` prefix, CORS)
│       ├── app.module.ts
│       ├── auth/
│       │   ├── auth.service.ts    
│       │   ├── auth.controller.ts HTTP endpoints 
│       │   └── auth.service.spec.ts 
│       ├── database/
│       │   ├── database.schema.ts table definitions as zod schemas (empty for now)
│       │   ├── database.service.ts JSON file DB (provided)
│       │   └── table.ts           typed table API (provided)
│       └── sms/sms.service.ts     mock SMS sender (provided)
└── frontend/                      React + React Router + MUI
    └── src/
        ├── pages/                 
        ├── components/            page layout (provided)
        └── router.tsx             routes / guards
```

## Architecture & Communication

The backend is a plain NestJS application relying on standard modules, controllers, and services. The `AuthController` exposes the REST API endpoints.

The frontend contains stub pages and components only; connecting it to the backend is part of the task.

## The Database

`DatabaseService` is a JSON file database built on [`@loewen-digital/flatdb`](https://github.com/loewen-digital/flatdb). Every row is stored as a JSON file in `apps/backend/data/<table>/<id>.json` (override with `DATABASE_DIR`), so data survives restarts; delete the folder to start fresh. Unit tests that provide `DatabaseService` directly keep their data in memory.

It has no tables initialized out of the box. You can define them as [zod](https://zod.dev) object schemas inside `apps/backend/src/database/database.schema.ts` (instructions are available in that file). Every write is validated against the schema:

```ts
export const databaseSchema = {
  examples: z.object({ title: z.string(), dueAt: z.coerce.date() }),
} satisfies Record<string, TableSchema>;

const examples = this.db.table('examples'); // fully typed, every call is async
await examples.insert({ ... });
await examples.findOne({ ... });
```
## Auth Flow, Security & Scaling

Every requirement / design assumption (and why) is listed in [ASSUMPTIONS.md](ASSUMPTIONS.md).

```text
/  (phone)  ──POST /api/auth/request-otp──▶  SMS (backend terminal)
/verify?phone=+…  ──POST /api/auth/verify-otp──▶  existing user → session JWT → /home
                                                 new user      → registration JWT → /register
/register  ──POST /api/auth/complete-registration (Bearer registration JWT)──▶ session JWT → /home
/home  ──GET /api/auth/me (Bearer session JWT)
```

**Security**

- OTP: 6 digits from `crypto.randomInt`, stored only as `HMAC-SHA256(OTP_PEPPER, phone:code)` and compared in constant time. Valid 3 minutes, single use, 3 wrong attempts kill it, a new code invalidates the previous one.
- Per-phone limits (in `AuthService`): 60s resend cooldown, 3 codes per hour, 1h lockout after 3 exhausted codes within an hour (429 + `Retry-After`). Per-IP limits (`@nestjs/throttler`): 60 req/min overall, 5/min on `request-otp` and `complete-registration`, 10/min on `verify-otp`.
- `request-otp` responds identically for registered and unknown numbers (no account enumeration).
- An account can only be created with a registration JWT, which is only issued after a correct OTP and carries the verified phone; the phone is never taken from the request body. It expires after 15 minutes and works once (the phone is registered afterwards). Tokens carry a `typ` claim, so a session cannot be used as a registration ticket and vice versa.
- Races: per-phone in-process mutex around every read-modify-write, plus flatdb unique constraints on `users.phone` and `users.email`.
- Inputs validated with zod (phone normalized to E.164 with libphonenumber-js, email lowercased); helmet headers; 10kb JSON body limit.
- Sessions are stateless 1h JWTs (`Authorization: Bearer`, stored in localStorage). They cannot be revoked before expiry; sign-out discards the token client-side.

Set `JWT_SECRET` and `OTP_PEPPER` (required when `NODE_ENV=production`; in development a random per-process secret is used, so restarts log users out). Set `TRUST_PROXY` behind a reverse proxy so rate limits see the client IP.

**Performance & scaling**

The request path is cheap: authenticated requests verify a JWT (no session lookup), OTP hashing is a single HMAC, and expired challenges are purged every 10 minutes. The app layer is stateless apart from three per-process pieces, which are the swap points for running multiple instances:

| Piece | Now | For horizontal scale |
| --- | --- | --- |
| Database | flatdb files (safe within one process only) | Postgres/MySQL with unique indexes |
| Per-phone lock (`KeyedMutex`) | in memory | row locks / atomic updates in the DB, or a Redis lock |
| Rate-limit counters (`ThrottlerModule`) | in memory | Redis throttler storage |
