# Application Flow

How the OTP login / registration app fits together, as Mermaid diagrams. Everything here describes the code as it is today; policy numbers come from `apps/backend/src/auth/auth.config.ts`.

---

## 1. System overview

```mermaid
flowchart LR
    dev(["npm run dev<br/>(Turborepo)"])

    subgraph FE["apps/frontend — Vite :5173"]
        react["React 19 + React Router + MUI"]
        ls[("localStorage<br/>session / registration JWT")]
        react <--> ls
    end

    subgraph BE["apps/backend — NestJS :3000"]
        api["/api/auth/*<br/>request-otp · verify-otp<br/>complete-registration · me"]
    end

    store[("data/&lt;table&gt;/&lt;id&gt;.json<br/>flatdb (DATABASE_DIR)")]
    term[/"Backend terminal<br/>[SMS SERVICE] Sending OTP ..."/]

    user(("User")) --> react
    react -- "fetch VITE_API_URL (default http://localhost:3000/api)<br/>Authorization: Bearer &lt;jwt&gt;<br/>(no Vite proxy; CORS via CLIENT_ORIGIN)" --> api
    api --> store
    api -. "mock SMS" .-> term
    dev --> FE
    dev --> BE
```

## 2. Backend module graph

```mermaid
flowchart TB
    main["main.ts<br/>load .env if present<br/>setGlobalPrefix('api')<br/>enableCors(CLIENT_ORIGIN, exposes Retry-After)<br/>helmet() · JSON body limit 10kb<br/>trust proxy (TRUST_PROXY) · shutdown hooks<br/>listen(PORT ?? 3000)"]
    app["AppModule"]

    subgraph THR["ThrottlerModule"]
        thr["per-IP, in memory<br/>default 60 req / min<br/>ThrottlerGuard as APP_GUARD"]
    end

    subgraph DBM["DatabaseModule (@Global)"]
        dir["DATABASE_DIR token<br/>resolve(env.DATABASE_DIR ?? 'data')"]
        dbs["DatabaseService"]
        dir --> dbs
    end

    subgraph SMSM["SmsModule"]
        sms["SmsService.sendSMS(phone, code)<br/>console.log only"]
    end

    subgraph AUTHM["AuthModule"]
        jwt["JwtModule<br/>HS256, secret = JWT_SECRET"]
        ctrl["AuthController<br/>POST /auth/request-otp<br/>POST /auth/verify-otp<br/>POST /auth/complete-registration<br/>GET /auth/me"]
        svc["AuthService<br/>OTP logic + periodic cleanup"]
        guard["JwtAuthGuard<br/>@Auth(typ) · @TokenSubject()"]
        mutex["KeyedMutex<br/>per-phone serialization"]
        pepper["OTP_PEPPER<br/>secret = OTP_PEPPER"]
    end

    schema["database.schema.ts<br/>users · otpChallenges"]

    main --> app
    app --> THR
    app --> DBM
    app --> SMSM
    app --> AUTHM
    AUTHM -- imports --> SMSM
    ctrl --> svc
    ctrl --> guard
    guard --> jwt
    svc --> jwt
    svc --> mutex
    svc --> pepper
    svc --> sms
    schema -.-> dbs
    dbs -. "injectable anywhere (global)" .-> svc
```

`JWT_SECRET` and `OTP_PEPPER` go through `secretFromEnv`: required when `NODE_ENV=production`, otherwise a random per-process value is used (with a warning), so tokens and pending codes don't survive a restart.

## 3. HTTP request pipeline

What every auth request passes through before and after `AuthService`.

```mermaid
flowchart LR
    req(["Request<br/>/api/auth/..."]) --> mw["helmet · CORS · JSON body ≤ 10kb"]
    mw --> thr{"ThrottlerGuard<br/>per-IP limit ok?"}
    thr -- no --> r429a["429"]
    thr -- yes --> auth{"@Auth(typ) route?"}
    auth -- "no (request-otp, verify-otp)" --> pipe
    auth -- yes --> jwt{"Bearer JWT valid,<br/>HS256, not expired,<br/>typ matches?"}
    jwt -- no --> r401["401"]
    jwt -- yes --> pipe{"ZodValidationPipe<br/>body valid?"}
    pipe -- no --> r400["400 { message, errors[] }"]
    pipe -- yes --> svc["AuthService<br/>inside KeyedMutex.run(phone)"]
    svc --> ok["2xx JSON"]
    svc -- "RetryLaterException" --> filt["RetryLaterFilter<br/>sets Retry-After header"] --> r429b["429 { message, retryAfter }"]
    svc -- "other HttpException" --> err["401 / 409 / 503"]
```

Per-route IP limits (`@Throttle`, on top of the global 60/min): `request-otp` 5/min, `verify-otp` 10/min, `complete-registration` 5/min.

## 4. API reference

| Endpoint | Auth | Body | Success | Errors |
| --- | --- | --- | --- | --- |
| `POST /api/auth/request-otp` | — | `{ phone }` (international, `+` required) | `202 { phone, expiresIn: 180, resendIn: 60 }` — `phone` normalized to E.164 | `400` invalid phone · `429 { retryAfter }` cooldown / hourly cap / lockout · `503` SMS failed |
| `POST /api/auth/verify-otp` | — | `{ phone, code }` (6 digits) | `200 { status: 'authenticated', token, user }` or `200 { status: 'registration_required', registrationToken }` | `400` invalid input · `401 { message, attemptsLeft? }` |
| `POST /api/auth/complete-registration` | Bearer **registration** | `{ name, email }` | `201 { token, user }` | `400` · `401` bad/expired ticket · `409` phone already registered / email in use |
| `GET /api/auth/me` | Bearer **session** | — | `200 { user }` | `401` |

`user` is always the public shape `{ id, phone, name, email }`. `request-otp` responds the same whether or not the phone has an account.

## 5. User journey

```mermaid
flowchart TD
    start(["Open app"]) --> guest{"Session token<br/>in localStorage?"}
    guest -- yes --> home
    guest -- no --> login["/ — enter phone (MuiTelInput,<br/>country guessed from browser locale,<br/>kept in memory when going back)"]

    login -- "Send code" --> check{"matchIsValidTel?<br/>(client check)"}
    check -- no --> login
    check -- yes --> req["POST request-otp"]
    req -- "429 / 400 / 503" --> login
    req -- "202" --> sms[/"OTP printed in backend terminal"/]
    sms --> verify["/verify?phone=E.164 — enter code<br/>resend countdown kept in history state"]

    verify -- "Verify" --> ver["POST verify-otp"]
    ver -- "401" --> err["Wrong code, N attempts left<br/>or invalid / expired → request a new code"] --> verify
    ver -- "authenticated" --> signIn["store session token"] --> home
    ver -- "registration_required" --> ticket["store registration token"] --> register["/register — name + email"]

    register -- "Complete registration" --> reg["POST complete-registration<br/>(Bearer registration token)"]
    reg -- "201" --> signIn
    reg -- "409 email in use" --> register
    reg -- "401 expired / 409 phone registered" --> notice["sign out, back to / with a notice"] --> login

    verify -- "Resend code (after cooldown)" --> resend["POST request-otp"] --> verify
    verify -- "Use a different number" --> login

    home["/home — GET /me, show profile"]
    home -- "Sign out / 401 from /me" --> out["clear tokens"] --> login
```

## 6. End-to-end sequence

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant P as React pages
    participant C as AuthController
    participant S as AuthService
    participant D as DatabaseService
    participant M as SmsService

    rect rgba(127,127,127,0.08)
    note over U,M: Step 1 — request OTP (inside mutex for phone)
    U->>P: enter phone, "Send code"
    P->>C: POST /api/auth/request-otp { phone }
    C->>S: requestOtp(E.164 phone)
    S->>D: otpChallenges.findMany(phone, created within retention)
    S->>S: assertCanSend → lockout / hourly cap / cooldown (else 429)
    S->>D: update active challenges { invalidatedAt: now }
    S->>S: code = randomInt, 6 digits<br/>codeHash = HMAC-SHA256(pepper, phone:code)
    S->>D: otpChallenges.insert({ phone, codeHash, expiresAt: now + 3 min })
    S->>M: await sendSMS(phone, code)
    alt SMS fails
        S->>D: update challenge { invalidatedAt }
        C-->>P: 503
    else sent
        M-->>M: console.log [SMS SERVICE] Sending OTP ...
        C-->>P: 202 { phone, expiresIn, resendIn }
        P->>P: navigate /verify?phone=... with state { resendAt }
    end
    end

    rect rgba(127,127,127,0.08)
    note over U,M: Step 2 — verify OTP (inside mutex for phone)
    U->>P: enter code, "Verify"
    P->>C: POST /api/auth/verify-otp { phone, code }
    C->>S: verifyOtp(phone, code)
    S->>D: newest active challenge for phone
    alt no active challenge
        C-->>P: 401 Invalid or expired code
    else hash mismatch (timingSafeEqual)
        S->>D: update { attempts + 1 }
        C-->>P: 401 { attemptsLeft }
    else code matches
        S->>D: update { consumedAt: now }
        S->>D: users.findOne({ phone })
        alt existing user
            S->>S: sign session JWT (sub = user id, 1h)
            C-->>P: 200 { status: authenticated, token, user }
            P->>P: signIn(token), navigate /home
        else new user
            S->>S: sign registration JWT (sub = phone, 15m)
            C-->>P: 200 { status: registration_required, registrationToken }
            P->>P: startRegistration(token), navigate /register
        end
    end
    end

    rect rgba(127,127,127,0.08)
    note over U,M: Step 3 — complete registration (new users only)
    U->>P: enter name + email
    P->>C: POST /api/auth/complete-registration { name, email }<br/>Authorization: Bearer registrationToken
    C->>C: JwtAuthGuard (typ = registration), phone = token sub
    C->>S: completeRegistration(phone, { name, email })
    S->>D: users.findOne by phone, then by email
    alt either exists
        C-->>P: 409
    else free
        S->>D: users.insert({ phone, name, email })
        note right of D: unique index backstop:<br/>UniqueConstraintError → 409
        S->>S: sign session JWT
        C-->>P: 201 { token, user }
        P->>P: signIn(token), navigate /home
    end
    end

    rect rgba(127,127,127,0.08)
    note over U,M: Step 4 — home
    P->>C: GET /api/auth/me (Bearer session)
    C->>S: getUser(token sub)
    S->>D: users.findById
    C-->>P: 200 { user } or 401 (→ signOut)
    end
```

## 7. Per-phone send limits (`assertCanSend`)

Checked in this order on every `request-otp`; the first that applies wins.

```mermaid
flowchart TD
    in(["request-otp for phone"]) --> recent["Load the phone's challenges<br/>from the last 3h (retention)"]
    recent --> lock{"3 exhausted challenges<br/>(attempts ≥ 3) within 1h?"}
    lock -- "yes, and now &lt; last exhausted + 1h" --> l429["429 Too many failed attempts<br/>Retry-After = until lock ends"]
    lock -- no --> cap{"≥ 3 codes sent<br/>in the last hour?"}
    cap -- yes --> c429["429 Too many codes requested<br/>Retry-After = oldest + 1h"]
    cap -- no --> cool{"Last code sent<br/>&lt; 60s ago?"}
    cool -- yes --> w429["429 Please wait<br/>Retry-After = last + 60s"]
    cool -- no --> send["Invalidate active code,<br/>issue and send a new one"]
```

Combined with 3 attempts per code, this allows at most 9 guesses per phone per hour; the per-IP throttles apply on top.

## 8. OTP challenge lifecycle

A challenge is **active** while it is not consumed, not invalidated, not expired and has attempts left. Only the newest active one is checked.

```mermaid
stateDiagram-v2
    [*] --> Active: request-otp (insert)
    Active --> Active: wrong code (attempts + 1)
    Active --> Consumed: correct code (consumedAt)
    Active --> Exhausted: 3rd wrong code
    Active --> Expired: 3 min passed (expiresAt)
    Active --> Invalidated: new request for same phone,<br/>or SMS send failed (invalidatedAt)
    Consumed --> Deleted
    Exhausted --> Deleted
    Expired --> Deleted
    Invalidated --> Deleted
    Deleted --> [*]

    note right of Exhausted: counts toward the 1h lockout
    note right of Deleted: cleanup every 10 min removes<br/>challenges older than 3h
```

## 9. Tokens

| | `session` | `registration` |
| --- | --- | --- |
| Issued by | `verify-otp` (existing user), `complete-registration` | `verify-otp` (unknown phone) |
| `sub` | user id | verified E.164 phone |
| Lifetime | 1h | 15m |
| Accepted by | `GET /me` | `POST /complete-registration` |
| localStorage key | `auth.sessionToken` | `auth.registrationToken` |

Both are HS256 JWTs with a `typ` claim; `JwtAuthGuard` rejects a token of the wrong type, so one can't stand in for the other. The phone for registration is taken from the token, never from the body, and a ticket works only once (afterwards the phone is registered → 409).

On the frontend `AuthProvider` holds at most one of the two: `signIn` stores the session and clears the ticket, `startRegistration` does the reverse, `signOut` clears both. Tokens whose `exp` has passed are dropped on load. Sessions are stateless and can't be revoked before expiry.

## 10. Data model

Declared in `database.schema.ts`. `id`, `createdAt` and `updatedAt` are added by the database; dates use `z.coerce.date()`.

```mermaid
erDiagram
    users {
        string id PK "auto"
        string phone UK "E.164"
        string name "1-100 chars"
        string email UK "lowercased"
        date createdAt "auto"
        date updatedAt "auto"
    }
    otpChallenges {
        string id PK "auto"
        string phone "E.164"
        string codeHash "HMAC-SHA256 hex"
        date expiresAt "createdAt + 3 min"
        number attempts "default 0"
        date consumedAt "optional"
        date invalidatedAt "optional"
        date createdAt "auto, send time"
        date updatedAt "auto, last wrong attempt"
    }
    users ||--o{ otpChallenges : "phone"
```

Challenges exist before any `users` row (first-time sign-up), so the relation matches on the phone value; there is no hard foreign key. `users.phone` and `users.email` are unique via `tableOptions`.

## 11. Database layer

`DatabaseService` builds one typed `Table` per entry in `databaseSchema`. It uses the file adapter when `DATABASE_DIR` is provided (by `DatabaseModule`) and an in-memory adapter otherwise (a testing module that provides `DatabaseService` directly).

```mermaid
flowchart TB
    caller["Service code<br/>this.db.table('name')"]
    table["Table&lt;Schema&gt;<br/>insert · findById · findOne · findMany<br/>update · delete · deleteMany · count · clear"]

    subgraph Write["Write path"]
        w1["zod parse (schema)"]
        w2["add id / createdAt / updatedAt<br/>(update = shallow merge + bump updatedAt)"]
        w3{"survives JSON<br/>round-trip?"}
        rej["reject write"]
        w4{"unique columns free?<br/>(tableOptions, CAS on index)"}
        dup["UniqueConstraintError"]
    end

    subgraph Read["Read path"]
        r1["filter: Mongo-style ops<br/>($lt, $in, $or, ...) or predicate"]
        r2["re-parse row with zod"]
        r3["return fresh copy<br/>(mutations not persisted)"]
    end

    adapter{"DATABASE_DIR<br/>provided?"}
    fs[("FsAdapter<br/>data/&lt;table&gt;/&lt;id&gt;.json")]
    mem[("MemoryAdapter<br/>(unit tests)")]

    caller --> table
    table --> w1 --> w2 --> w3
    w3 -- no --> rej
    w3 -- yes --> w4
    w4 -- no --> dup
    w4 -- yes --> adapter
    table --> r1 --> adapter
    adapter -- yes --> fs
    adapter -- no --> mem
    adapter --> r2 --> r3 --> caller
```

## 12. Frontend routes & guards

```mermaid
flowchart TD
    main["main.tsx<br/>ThemeProvider + AuthProvider + RouterProvider"] --> nav(["Navigate to route"])
    nav --> which{"Route?"}

    which -- "/ or /verify" --> g1{"RequireGuest:<br/>session token?"}
    g1 -- yes --> toHome["Redirect → /home"]
    g1 -- "no, /" --> login["LoginPage"]
    g1 -- "no, /verify" --> ph{"?phone looks<br/>like E.164?"}
    ph -- yes --> verify["VerifyPage"]
    ph -- no --> toLogin["Redirect → /"]

    which -- "/register" --> g2{"RequireRegistration"}
    g2 -- "session token" --> toHome
    g2 -- "registration token" --> register["RegisterPage"]
    g2 -- "neither" --> toLogin

    which -- "/home" --> g3{"RequireSession:<br/>session token?"}
    g3 -- yes --> home["HomePage"]
    g3 -- no --> toLogin

    which -- "anything else" --> toLogin
```

The guards only steer navigation; the server enforces every rule itself. All screens share `AuthLayout`, whose stepper shows Phone (0) → Verify (1) → Profile (2); `HomePage` passes step 3 so all steps show as done.

## 13. Configuration

| Variable | App | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | backend | `3000` | HTTP port |
| `CLIENT_ORIGIN` | backend | `http://localhost:5173` | CORS origin |
| `DATABASE_DIR` | backend | `data` | flatdb folder (relative to backend cwd) |
| `JWT_SECRET` | backend | random per process (dev) | signs session / registration JWTs |
| `OTP_PEPPER` | backend | random per process (dev) | HMAC key for OTP hashes |
| `NODE_ENV` | backend | — | `production` makes the two secrets required |
| `TRUST_PROXY` | backend | unset | Express `trust proxy`, so rate limits see the client IP |
| `VITE_API_URL` | frontend | `http://localhost:3000/api` | API base URL |

The backend loads `apps/backend/.env` on start if it exists (shell variables win); see the `.env.example` files.
