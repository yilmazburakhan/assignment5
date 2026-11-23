# Assignment 5: Tasks API

**Student:** Burakhan Yılmaz\
**Student Number:** 2200005240\
**GitHub Repository:** https://github.com/yilmazburakhan/assignment5\
**Live Deployment:** https://assignment5-zhwh.onrender.com\
**Interactive API Docs:** https://assignment5-zhwh.onrender.com/docs

A production-ready Tasks REST API built with **Deno 2**, **Hono (`@hono/zod-openapi`)**,
**Drizzle ORM**, **SQLite / Turso (libSQL)**, **Zod**, **JWT (`jose`)**, **Deno KV**, and
**Docker**. All core requirements and all **20 bonus features** are implemented and
verified with **29 automated tests**.

---

## Quick Start

```bash
cp .env.example .env
deno task db:migrate
deno task seed
deno task dev
```

### Verification Commands

```bash
deno fmt --check
deno lint
deno task check
deno task test
```

All **29 tests** pass (`ok | 29 passed | 0 failed`).

---

## API Endpoints

| Method   | Path                        | Auth      | Description                                                         |
| :------- | :-------------------------- | :-------- | :------------------------------------------------------------------ |
| `GET`    | `/health`, `/healthz`       | Public    | Liveness check (`{ ok: true }`)                                     |
| `GET`    | `/readyz`                   | Public    | Readiness check (`SELECT 1` against DB; `503` if down)              |
| `GET`    | `/openapi.json`, `/docs`    | Public    | OpenAPI 3.0 specification and Swagger UI                            |
| `POST`   | `/auth/register`            | Public    | Register user + create `"Welcome!"` task in a single transaction    |
| `POST`   | `/auth/login`               | Public    | Issue HS256 JWT (rate-limited: 5 failures/min -> `429 Retry-After`) |
| `GET`    | `/api/tasks`                | Bearer    | List active tasks (`page`, `limit`, `status` filter + `total`)      |
| `POST`   | `/api/tasks`                | Bearer    | Create task + broadcast via WebSocket                               |
| `GET`    | `/api/tasks/:id`            | Bearer    | Get single active task (cached in Deno KV for 60s)                  |
| `PUT`    | `/api/tasks/:id`            | Bearer    | Update own task + invalidate KV cache + WebSocket broadcast         |
| `DELETE` | `/api/tasks/:id`            | Bearer    | Soft-delete own task (`deletedAt`) + invalidate cache + broadcast   |
| `POST`   | `/api/tasks/:id/restore`    | Bearer    | Restore soft-deleted task + invalidate cache + broadcast            |
| `GET`    | `/api/me/summary`           | Bearer    | Task counts grouped by status (single `GROUP BY` query)             |
| `POST`   | `/api/tasks/:id/attachment` | Bearer    | Upload PNG/JPEG attachment (max 1 MB, UUID filename)                |
| `GET`    | `/api/tasks/:id/attachment` | Bearer    | Download own task attachment                                        |
| `GET`    | `/api/admin/users`          | Admin     | List all users (`401` unauthenticated, `403` non-admin)             |
| `GET`    | `/ws?token=<jwt>`           | Query JWT | Per-user live task event stream                                     |

---

## Live Deployment Verification (`curl`)

Executed against the live deployment at `https://assignment5-zhwh.onrender.com` backed by
Turso (libSQL):

```powershell
# Health & Readiness
curl.exe -s "[https://assignment5-zhwh.onrender.com/health](https://assignment5-zhwh.onrender.com/health)"
# {"ok":true}

curl.exe -s "[https://assignment5-zhwh.onrender.com/readyz](https://assignment5-zhwh.onrender.com/readyz)"
# {"ready":true}

# Register & Login
curl.exe -s -X POST "[https://assignment5-zhwh.onrender.com/auth/register](https://assignment5-zhwh.onrender.com/auth/register)" -H "content-type: application/json" -d '{\"email\":\"deploy@example.com\",\"password\":\"password123\"}'
# {"id":1,"email":"deploy@example.com"}

curl.exe -s -X POST "[https://assignment5-zhwh.onrender.com/auth/login](https://assignment5-zhwh.onrender.com/auth/login)" -H "content-type: application/json" -d '{\"email\":\"deploy@example.com\",\"password\":\"password123\"}'
# {"token":"eyJhbGciOiJIUzI1NiJ9..."}

# Create Task
'{"title":"Test live Render API","priority":"high"}' | curl.exe -s -X POST "[https://assignment5-zhwh.onrender.com/api/tasks](https://assignment5-zhwh.onrender.com/api/tasks)" -H "content-type: application/json" -H "authorization: Bearer $TOKEN" -d "@-"
# {"id":2,"userId":1,"title":"Test live Render API","status":"todo","priority":"high","dueDate":null,"deletedAt":null,"attachment":null,"createdAt":1795463753}

# List Tasks (includes transactional "Welcome!" task)
curl.exe -s "[https://assignment5-zhwh.onrender.com/api/tasks?page=1&limit=10](https://assignment5-zhwh.onrender.com/api/tasks?page=1&limit=10)" -H "authorization: Bearer $TOKEN"
# {"items":[{"id":1,"userId":1,"title":"Welcome!","status":"todo","priority":"medium","dueDate":null,"deletedAt":null,"attachment":null,"createdAt":1795463436},{"id":2,"userId":1,"title":"Test live Render API","status":"todo","priority":"high","dueDate":null,"deletedAt":null,"attachment":null,"createdAt":1795463753}],"page":1,"limit":10,"total":2}

# Summary (GROUP BY)
curl.exe -s "[https://assignment5-zhwh.onrender.com/api/me/summary](https://assignment5-zhwh.onrender.com/api/me/summary)" -H "authorization: Bearer $TOKEN"
# {"todo":2,"in-progress":0,"done":0}

# Update, Soft-Delete, and Restore
'{"title":"Updated on Render","status":"done","priority":"medium"}' | curl.exe -s -X PUT "[https://assignment5-zhwh.onrender.com/api/tasks/2](https://assignment5-zhwh.onrender.com/api/tasks/2)" -H "content-type: application/json" -H "authorization: Bearer $TOKEN" -d "@-"
# {"id":2,"userId":1,"title":"Updated on Render","status":"done","priority":"medium","dueDate":null,"deletedAt":null,"attachment":null,"createdAt":1795463753}

curl.exe -s -X DELETE "[https://assignment5-zhwh.onrender.com/api/tasks/2](https://assignment5-zhwh.onrender.com/api/tasks/2)" -H "authorization: Bearer $TOKEN"
# {"ok":true}

curl.exe -s -X POST "[https://assignment5-zhwh.onrender.com/api/tasks/2/restore](https://assignment5-zhwh.onrender.com/api/tasks/2/restore)" -H "authorization: Bearer $TOKEN"
# {"id":2,"userId":1,"title":"Updated on Render","status":"done","priority":"medium","dueDate":null,"deletedAt":null,"attachment":null,"createdAt":1795463753}
```

---

## Bonus Features & Evidence

### Group 1 — Data & SQL

- **Bonus 1 (Drizzle Kit Migrations):** Replaced hand-written `CREATE TABLE` statements
  with `drizzle-kit generate` and `drizzle-orm/libsql/migrator`. Contains two migrations
  in `drizzle/` (`0000_*.sql` for initial tables and `0001_*.sql` adding `role`,
  `due_date`, `deleted_at`, `attachment`, and `idx_tasks_user_status`).
- **Bonus 2 (Soft Delete, Restore & Transaction):** `DELETE /api/tasks/:id` sets
  `deletedAt`; `POST /api/tasks/:id/restore` clears it. User registration creates the user
  and their `"Welcome!"` task inside `db.transaction(...)` (rollback verified in
  `tests/data_bonuses_test.ts`).
- **Bonus 3 (Summary Route & N+1 Proof):** `GET /api/me/summary` uses a single SQL
  `GROUP BY` query. Verified with Drizzle query logger via
  `deno run -A scripts/benchmark.ts`:
  - Naive version: **4 queries** (`SELECT *` + 3 `COUNT(*)` queries per status)
  - `GROUP BY` version: **1 query**
    (`select "status", count(*) from "tasks" where "tasks"."user_id" = ? group by "tasks"."status"`)
- **Bonus 4 (Composite Index & `EXPLAIN QUERY PLAN` Benchmark):** Added composite index
  `idx_tasks_user_status(user_id, status)`. Benchmarked on **20,000 tasks across 20
  users** (`deno run -A scripts/benchmark.ts`):
  - **Before index:** `SCAN tasks` — average **4.835 ms**
  - **After index:**
    `SEARCH tasks USING INDEX idx_tasks_user_status (user_id=? AND status=?)` — average
    **3.277 ms**
- **Bonus 5 (Idempotent Seed Script):** `scripts/seed.ts` refuses to run when
  `APP_ENV=production` and seeds 2 users + 20 tasks idempotently:
  - 1st run: `Seed complete. Users ensured: 2, new tasks inserted: 20`
  - 2nd run: `Seed complete. Users ensured: 2, new tasks inserted: 0`
- **Bonus 6B (Custom SQLite Connection Pool):** Implemented `Pool<T>` and
  `createSqlitePool` (WAL mode + `busy_timeout=5000`) in `src/pool.ts`. Verified
  concurrency limit of 3 across 20 concurrent jobs in `tests/data_bonuses_test.ts`.

### Group 2 — API Quality

- **Bonus 7 (JWT Auth):** Replaced DB sessions with stateless HS256 JWTs via `jose`
  (`src/auth.ts`). Tested tampered, expired, and wrong-secret rejections (`401`).
- **Bonus 8 (OpenAPI & Swagger UI):** Migrated routes to `OpenAPIHono` with Zod schemas,
  Bearer security scheme, `/openapi.json`, and `/docs`.
- **Bonus 9 (RBAC):** Added `role` (`"user" | "admin"`) to `users` and JWT payload,
  `requireRole("admin")` middleware, and `GET /api/admin/users` (`401` / `403` / `200`).
- **Bonus 10 (Observability & Health Probes):** Added `x-request-id` header + structured
  JSON request logs, `/healthz`, and `/readyz` (`503` when DB connection is closed).
- **Bonus 11 (Validated Config & Env Files):** `src/config.ts` validates `APP_ENV`,
  `PORT`, `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `KV_PATH`, and `JWT_SECRET` with Zod,
  refusing `dev-secret` in `production`. Included `.env.test` and `.env.production`
  templates.
- **Bonus 12 (File Upload):** `POST/GET /api/tasks/:id/attachment` validates missing file
  (`400`), 1 MB limit (`413`), and PNG/JPEG MIME types (`415`), storing files under random
  UUID filenames.

### Group 3 — Live & Background

- **Bonus 13 (WebSocket Live Updates):** `GET /ws?token=<jwt>` authenticates via JWT
  (`401` if invalid) and broadcasts `task.created`, `task.updated`, `task.deleted`, and
  `task.restored` events only to the owner's sockets (`src/live.ts`).
- **Bonus 14 (`Deno.cron` Purge Job):** `purgeOldDone(db, days)` in `src/jobs.ts` deletes
  `"done"` tasks older than 30 days idempotently and is scheduled daily via `Deno.cron` in
  `src/main.ts`.
- **Bonus 15 (Login Rate Limiting):** `LoginRateLimiter` allows 5 failed attempts per
  email per minute; the 6th attempt returns `429` with `Retry-After` even with valid
  credentials.
- **Bonus 16 (Deno KV Caching):** `GET /api/tasks/:id` caches task records under
  `["task", userId, id]` for 60s and invalidates on update, delete, restore, or attachment
  upload. Verified cache hit skips DB pool acquisition in `tests/live_bonuses_test.ts`.

### Group 4 — Ship It

- **Bonus 17 (Docker + Persistent Volume):** Non-root `Dockerfile` (`denoland/deno:2.6.3`)
  and `.dockerignore`.
  - Image size (`docker images tasks-api`): **424 MB** disk usage (**108 MB** content
    size).
  - Persistence verified with `tasksdata:/data`: `POST /auth/register` returned
    `201 Created` -> container stopped & restarted -> same `POST /auth/register` returned
    `409 Conflict`.
- **Bonus 18 (GitHub Actions CI):** `.github/workflows/ci.yml` runs `deno fmt --check`,
  `deno lint`, `deno task check`, and `deno task test`.
  - **Red (failed) CI run:**
    https://github.com/yilmazburakhan/assignment5/actions/runs/45247853636/job/137949263409
  - **Green (passing) CI run:**
    https://github.com/yilmazburakhan/assignment5/actions/runs/45249264641
- **Bonus 19 (Live Deployment):** Deployed via Docker on **Render** connected to **Turso
  (libSQL)** at https://assignment5-zhwh.onrender.com (all secrets configured via Render
  environment variables, never committed to Git).
- **Bonus 20 (Public GitHub Repository):** https://github.com/yilmazburakhan/assignment5
  with incremental, meaningful commit history.

---

## My Own Log

1. **Deno 2.9.6 Starter Lint Error (`jsx-button-has-type`):** Running `deno lint` on the
   untouched starter failed with 6 `jsx-button-has-type` errors inside `ui/src/App.tsx`.
   Added `"ui"` (and later `"drizzle"`) to `lint.exclude` in `deno.json` so backend
   linting stays strict without modifying the starter UI.
2. **Real Flaky JWT Tamper Test Caught by GitHub Actions CI:** My first push to GitHub
   failed CI (`28 passed | 1 failed`) on `tests/api_bonuses_test.ts` because tampering
   with the _last_ character of an HS256 Base64URL signature (43rd char) only flips the 2
   trailing unused padding bits in certain random signatures, allowing `jwtVerify` to
   still return `200`. Fixed the test to mutate the _first_ character of the signature
   segment, turning CI green.
3. **Deno Deploy New Signups Closed:** When attempting Bonus 19 on `dash.deno.com`, Deno
   Deploy displayed _"New signups are closed — Deno Deploy is winding down and will shut
   down in April 2027"_. Pivoted to deploying the exact same Docker image on **Render**
   connected to a **Turso (libSQL)** cloud database, validating all endpoints live over
   HTTPS.
4. **PowerShell `curl.exe` JSON Quoting:** Sending JSON payloads containing spaces
   (`"Test live Render API"`) inline via `-d` in Windows PowerShell broke JSON parsing on
   `curl.exe` and triggered an error. Solved by piping raw JSON strings through stdin with
   `-d "@-"`.
