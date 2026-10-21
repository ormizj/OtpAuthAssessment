# TODO — Candidate to implement

## Backend (`apps/backend`)
- [x] `src/database/database.schema.ts:48` — declare table schemas in `databaseSchema` (e.g. users, OTPs)
- [x] `src/auth/auth.service.ts:5` — implement `AuthService` logic (request OTP, verify OTP, complete registration)
- [x] `src/auth/auth.controller.ts:10` — `POST /api/auth/request-otp`
- [x] `src/auth/auth.controller.ts:16` — `POST /api/auth/verify-otp`
- [x] `src/auth/auth.controller.ts:22` — `POST /api/auth/complete-registration`
- [x] `src/auth/auth.module.ts:6` — wire up `AuthModule` (imports/providers as needed)
- [x] `src/auth/auth.service.spec.ts:4` — write `AuthService` unit tests
- [x] `src/main.ts:23` — *(optional)* extra bootstrap setup (e.g. global validation pipe)

## Frontend (`apps/frontend`)
- [x] `src/pages/LoginPage.tsx:9` — step 1: phone number → request OTP
- [x] `src/pages/VerifyPage.tsx:9` — step 2: one-time code → verify OTP
- [x] `src/pages/RegisterPage.tsx:9` — step 3 (new users): name + email → complete registration
- [x] `src/router.tsx:14` — routing/guards for `/`, `/verify`, `/register`
- [x] `src/main.tsx:9` — *(optional)* app-level setup (e.g. providers)
