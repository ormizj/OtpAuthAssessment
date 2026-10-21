# Application Flow

How the OTP login / registration app fits together, as Mermaid diagrams.

The diagrams come in two parts:

- **Part 1 — Current**: what exists in the code today. Stubbed pieces are drawn with dashed, amber-filled nodes.
- **Part 2 — Target**: the intended OTP flow that the `TODO: Candidate to implement` markers (see `TODO.md`) should produce. Table names, payload shapes and guard rules there are **suggestions**, not existing code.

---

## Part 1 — Current architecture

### 1. System overview

```mermaid
flowchart LR
    dev(["npm run dev<br/>(Turborepo)"])

    subgraph FE["apps/frontend — Vite :5173"]
        react["React 19 + React Router + MUI"]
    end

    subgraph BE["apps/backend — NestJS :3000"]
        api["/api/* routes"]
    end

    store[("data/&lt;table&gt;/&lt;id&gt;.json<br/>flatdb (DATABASE_DIR)")]
    term[/"Backend terminal<br/>[SMS SERVICE] Sending OTP ..."/]

    user(("User")) --> react
    react -- "fetch http://localhost:3000/api<br/>(no Vite proxy; CORS via CLIENT_ORIGIN)" --> api
    api --> store
    api -. "mock SMS" .-> term
    dev --> FE
    dev --> BE
```

### 2. Backend module graph

```mermaid
flowchart TB
    main["main.ts<br/>setGlobalPrefix('api')<br/>enableCors(CLIENT_ORIGIN)<br/>listen(PORT ?? 3000)"]
    app["AppModule"]

    subgraph DBM["DatabaseModule (@Global)"]
        dir["DATABASE_DIR token<br/>resolve(env.DATABASE_DIR ?? 'data')"]
        dbs["DatabaseService"]
        dir --> dbs
    end

    subgraph SMSM["SmsModule"]
        sms["SmsService.sendSMS(phone, code)<br/>console.log only"]
    end

    subgraph AUTHM["AuthModule"]
        ctrl["AuthController<br/>POST /auth/request-otp<br/>POST /auth/verify-otp<br/>POST /auth/complete-registration"]
        svc["AuthService<br/>(empty)"]
    end

    schema["database.schema.ts<br/>databaseSchema = {} (no tables)"]

    main --> app
    app --> DBM
    app --> SMSM
    app --> AUTHM
    AUTHM -- imports --> SMSM
    schema -.-> dbs
    dbs -. "injectable anywhere (global)" .-> svc

    classDef stub fill:#fff4e5,stroke:#e69500,stroke-dasharray: 5 5,color:#000
    class ctrl,svc,schema stub
```

### 3. Request lifecycle today

Every auth endpoint is a stub, so any call currently ends in `501`.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser (:5173)
    participant N as Nest HTTP layer
    participant C as AuthController

    B->>N: POST http://localhost:3000/api/auth/request-otp
    N->>N: CORS check (origin = CLIENT_ORIGIN)<br/>strip global "/api" prefix
    N->>C: requestOtp()
    C-->>N: throw NotImplementedException
    N-->>B: 501 Not Implemented
```

### 4. Database layer

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
    w3 -- yes --> adapter
    table --> r1 --> adapter
    adapter -- yes --> fs
    adapter -- no --> mem
    adapter --> r2 --> r3 --> caller
```

### 5. Frontend routes

```mermaid
flowchart LR
    main["main.tsx<br/>ThemeProvider + RouterProvider"] --> router["router.tsx<br/>createBrowserRouter"]

    router -- "/" --> login["LoginPage<br/>phone"]
    router -- "/verify" --> verify["VerifyPage<br/>code · resend · change number"]
    router -- "/register" --> register["RegisterPage<br/>name + email"]
    router -- "*" --> redirect["Navigate → /"]

    subgraph Layout["AuthLayout (stepper)"]
        s0["0 · Phone"] --- s1["1 · Verify"] --- s2["2 · Profile"]
    end

    login -. "activeStep=0" .-> s0
    verify -. "activeStep=1" .-> s1
    register -. "activeStep=2" .-> s2

    classDef stub fill:#fff4e5,stroke:#e69500,stroke-dasharray: 5 5,color:#000
    class login,verify,register stub
```

The pages are UI only right now: forms don't submit anywhere, there are no route guards, and nothing is shared between steps.

---

## Part 2 — Target OTP flow *(to implement)*

### 6. User journey *(Target)*

```mermaid
flowchart TD
    start(["Open app"]) --> login["/ — enter phone number"]
    login -- "Send code" --> req["POST /api/auth/request-otp"]
    req --> sms[/"OTP printed in backend terminal"/]
    sms --> verify["/verify — enter code"]

    verify -- "Verify" --> ver["POST /api/auth/verify-otp"]
    ver --> valid{"Code valid<br/>and not expired?"}
    valid -- no --> err["Show error"] --> verify
    valid -- yes --> exists{"User with this<br/>phone exists?"}

    exists -- yes --> done(["Signed in"])
    exists -- no --> register["/register — name + email"]
    register -- "Complete registration" --> reg["POST /api/auth/complete-registration"]
    reg --> done

    verify -- "Resend code" --> req
    verify -- "Use a different number" --> login
```

### 7. End-to-end sequence *(Target)*

Payloads are suggestions; no DTOs exist yet.

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
    note over U,M: Step 1 — request OTP
    U->>P: enter phone, "Send code"
    P->>C: POST /api/auth/request-otp { phone }
    C->>S: requestOtp(phone)
    S->>D: invalidate previous pending OTPs for phone
    S->>D: otps.insert({ phone, codeHash, expiresAt, attempts: 0 })
    S->>M: await sendSMS(phone, code)
    M-->>M: console.log [SMS SERVICE] Sending OTP ...
    C-->>P: 200 { ok }
    P->>P: navigate("/verify"), keep phone in state
    end

    rect rgba(127,127,127,0.08)
    note over U,M: Step 2 — verify OTP
    U->>P: enter code, "Verify"
    P->>C: POST /api/auth/verify-otp { phone, code }
    C->>S: verifyOtp(phone, code)
    S->>D: otps.findOne({ phone, consumedAt: undefined, expiresAt: { $gt: now } })
    alt no OTP / expired / wrong code / too many attempts
        S->>D: otps.update(id, { attempts + 1 })
        C-->>P: 400/401 error
        P-->>U: show error, stay on /verify
    else code matches
        S->>D: otps.update(id, { consumedAt: now })
        S->>D: users.findOne({ phone })
        alt existing user
            C-->>P: 200 { status: "logged-in", user }
            P-->>U: signed in
        else new user
            C-->>P: 200 { status: "registration-required" }
            P->>P: navigate("/register")
        end
    end
    end

    rect rgba(127,127,127,0.08)
    note over U,M: Step 3 — complete registration (new users only)
    U->>P: enter name + email
    P->>C: POST /api/auth/complete-registration { phone, name, email }
    C->>S: completeRegistration(...)
    S->>S: check phone was verified recently
    S->>D: users.insert({ phone, name, email })
    C-->>P: 201 { user }
    P-->>U: signed in
    end
```

### 8. OTP lifecycle *(Target)*

```mermaid
stateDiagram-v2
    [*] --> Issued: request-otp
    Issued --> Verified: correct code before expiresAt
    Issued --> Issued: wrong code (attempts + 1)
    Issued --> Locked: attempts reach max
    Issued --> Expired: now > expiresAt
    Issued --> Superseded: resend / new request for same phone
    Verified --> [*]
    Locked --> [*]
    Expired --> [*]
    Superseded --> [*]
```

### 9. Proposed data model *(Target)*

These would be added to `databaseSchema` in `database.schema.ts`. `id`, `createdAt` and `updatedAt` are added automatically and must **not** be declared. Date columns use `z.coerce.date()`.

```mermaid
erDiagram
    users {
        string id PK "auto"
        string phone UK
        string name
        string email
        date createdAt "auto"
        date updatedAt "auto"
    }
    otps {
        string id PK "auto"
        string phone FK
        string codeHash
        date expiresAt "z.coerce.date()"
        number attempts
        date consumedAt "optional"
        date createdAt "auto"
        date updatedAt "auto"
    }
    users ||--o{ otps : "phone"
```

`otps.phone` can exist before any `users` row (a first-time sign-up), so the relation matches on the phone value; there is no hard foreign key.

### 10. Route guards *(Target)*

```mermaid
flowchart TD
    nav(["Navigate to route"]) --> which{"Route?"}

    which -- "/" --> login["LoginPage"]

    which -- "/verify" --> hasPhone{"Pending phone<br/>in auth state?"}
    hasPhone -- yes --> verify["VerifyPage"]
    hasPhone -- no --> toLogin["Redirect → /"]

    which -- "/register" --> isVerified{"Phone verified and<br/>registration required?"}
    isVerified -- yes --> register["RegisterPage"]
    isVerified -- no --> toLogin

    which -- "anything else" --> toLogin
```
