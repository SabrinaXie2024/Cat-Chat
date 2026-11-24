# Cat Chat

Cat community site: care guide, owner's cat gallery, and a user post/reply
community. Product requirements: [Requirement.md](Requirement.md).

## Layout (pnpm monorepo)

```
packages/api-spec/openapi.yaml   API contract — the single source of truth
apps/api/                        Go backend (net/http, oapi-codegen strict server)
apps/web/                        React 19 + Vite + TanStack Router/Query frontend
scripts/                         repo tooling (GHSA lockfile check)
```

Toolchain: Node 24 (`/opt/homebrew/opt/node@24/bin`, keg-only — must be on
PATH), pnpm 12, Go 1.27, all via Homebrew.

## Commands (run from repo root)

| | |
|---|---|
| `pnpm dev:web` | Vite on :5173, API served by MSW (no backend needed) |
| `pnpm dev:api` | Go server on :8080 |
| `VITE_API=real pnpm dev:web` | Vite with MSW off, `/api` proxied to :8080 |
| `pnpm gen` | Regenerate Go server + TS client/mocks from the spec |
| `pnpm test` / `pnpm lint` / `pnpm typecheck` / `pnpm build` | |
| `pnpm audit:ghsa` | Fail if lockfile has any GHSA-g7cv-rxg3-hmpx version |

## Changing the API

1. Edit `packages/api-spec/openapi.yaml`.
2. `pnpm gen` — rewrites `apps/api/internal/api/api.gen.go` and
   `apps/web/src/api/generated/**` (both committed; never hand-edit).
3. Fix compile errors in `apps/api/internal/api/server.go` (it asserts
   `StrictServerInterface`) and in `apps/web/src/mocks/handlers.ts`.

## Conventions

- **Content limits live in three places and must agree:** the spec,
  `apps/api/internal/api/server.go`, `apps/web/src/lib/limits.ts`. Post ≤ 500
  chars / 5 images; reply ≤ 100 chars / 3 images; ≤ 10 replies per post.
  Limits count characters (runes / code points), not bytes, so CJK text gets
  the full allowance.
- Images: JPEG/PNG/WebP, ≤ 5 MB original, compressed client-side to ≤ 1920px /
  ~1 MB. The server must re-process and strip EXIF (GPS) when uploads land.
- MSW (`apps/web/src/mocks/handlers.ts`) is the only mock layer, shared by dev
  and Vitest. It's stateful and mirrors server validation; don't add ad-hoc
  `fetch` mocks in tests — override with `server.use(...)` instead.
- HTTP goes through `apps/web/src/api/http.ts` (ky). Non-2xx throws; use
  `errorMessage(err)` for user-facing text.
- User content is rendered as text, never `dangerouslySetInnerHTML`.
- Biome formats/lints TS (single quotes, no semicolons); gofmt for Go.
  lefthook runs both on pre-commit, tests + GHSA check on pre-push.

## Supply-chain hygiene

GHSA-g7cv-rxg3-hmpx (CVE-2026-45321): on 2026-05-11, 84 malicious versions of
42 `@tanstack/*` packages were published (credential-stealing install script).
The full affected list is in `scripts/ghsa-g7cv-rxg3-hmpx.json` (fetched from
the GitHub advisory API 2026-11-23); `pnpm audit:ghsa` checks the whole
lockfile, including transitive deps. Current direct pins, all outside the
affected ranges:

- `@tanstack/react-router` 1.169.2 (affected: 1.169.5, 1.169.8)
- `@tanstack/router-plugin` 1.167.35 (affected: 1.167.38, 1.167.41)
- `@tanstack/react-query` 5.100.10 (not affected)

`router-cli` / `router-generator` are intentionally not direct deps — the Vite
plugin covers route generation.

Guards in `pnpm-workspace.yaml`:
- `minimumReleaseAge: 10080` — refuse versions < 7 days old. To pick a version,
  use the newest one older than that; don't add exclusions casually.
- `allowBuilds` — only esbuild, lefthook, msw may run install scripts.
- `permissions` — `@tanstack/router-plugin`'s bundled agent skills are denied.
- `saveExact: true` — all versions pinned exactly.

## Not built yet

- Auth (planned: argon2id passwords, httpOnly session cookie, CSRF protection).
  Writes are currently attributed to `guest`.
- Persistence: `apps/api/internal/store` is in-memory; planned PostgreSQL with
  pgx + sqlc, migrations via goose.
- Image/video upload endpoint + S3-compatible storage (R2/OSS; MinIO locally)
  and server-side resize/EXIF strip (`disintegration/imaging`).
- Gallery page and reply UI (reply API + mocks exist).
