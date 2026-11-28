# MeowSphere（喵友圈）

Product name: **MeowSphere** (English) / **喵友圈** (Chinese); each UI
language has its own name (`brand` key: ニャン友, 냥친구, Мяусфера,
MiaouSphère, MiauSphäre, Miausfera) and tab titles read "<local> · MeowSphere". Code-level
identifiers still say `cat-chat`/`catchat` (npm scopes, Go module, databases,
repo) on purpose — renaming them is churn with no user-visible effect.

Cat community site: care guide, owner's cat gallery, and a user post/reply
community. Product requirements: the original brief is kept in the local `aichat/history.md` (not in git).

## Layout (pnpm monorepo)

```
packages/api-spec/openapi.yaml   API contract — the single source of truth
apps/api/                        Go backend (net/http, oapi-codegen strict server)
apps/web/                        React 19 + Vite + TanStack Router/Query frontend
scripts/                         repo tooling (GHSA check, dev.mjs env runner)
```

## macOS + Windows

The project is developed on both a Mac and a Windows PC. **Every change
pushed to GitHub must work on both.** In practice:

- npm scripts must run under both sh and cmd.exe: no `VAR=x cmd`, `set -a`,
  `${VAR:-default}`, `[ ... ]` or `source` in `package.json`. Anything that
  needs env setup goes through `scripts/dev.mjs` (Node), which loads
  `apps/api/.env.local` and picks per-platform defaults.
- Build paths with `path.join` / `filepath.Join`, never hard-coded `/` or
  `\`; don't assume `/tmp`, Homebrew paths or a Unix socket.
- Line endings are LF everywhere (`.gitattributes`; Biome and gofmt need it).
- lefthook runs hooks through sh (Git Bash on Windows), so `lefthook.yml` may
  use POSIX shell.

Toolchain (same versions on both): Node 24, pnpm 12.23.0, Go 1.27.4,
PostgreSQL 18, ffmpeg.

- **macOS** (Homebrew): Node 24 at `/opt/homebrew/opt/node@24/bin` (keg-only
  — must be on PATH); `brew services start postgresql@18` (binaries in
  `/opt/homebrew/opt/postgresql@18/bin`). Postgres is reached over the Unix
  socket in `/tmp` with peer auth.
- **Windows** (winget): `OpenJS.NodeJS.24`, `GoLang.Go`,
  `PostgreSQL.PostgreSQL.18` (runs as a Windows service), and
  `Gyan.FFmpeg.Essentials`; pnpm via `npm i -g pnpm@12.23.0`. Postgres is
  `postgres@localhost:5432`, password in `%APPDATA%\postgresql\pgpass.conf`
  (`localhost:5432:*:postgres:<password>`), which psql and pgx both read.
  Use Git Bash or PowerShell.

Local databases: `catchat` (dev) and `catchat_test` (tests, truncated
freely); create them with `createdb` (add `-h localhost -U postgres` on
Windows). Override either URL with `DATABASE_URL` / `TEST_DATABASE_URL` in
`apps/api/.env.local`.

## Commands (run from repo root)

| | |
|---|---|
| `pnpm dev:web` | Vite on :5173, API served by MSW (no backend needed) |
| `pnpm dev:api` | Go server on :8080 against local `catchat` DB (migrates on boot) |
| `pnpm dev:web:real` | Vite with MSW off, `/api` proxied to :8080 |
| `pnpm gen` | Regenerate Go server + TS client/mocks from the spec |
| `pnpm test` | Vitest + `go test` (needs Postgres running; uses `catchat_test`) |
| `pnpm test:api` | Only the Go tests |
| `pnpm lint` / `pnpm typecheck` / `pnpm build` | |
| `pnpm audit:ghsa` | Fail if lockfile has any GHSA-g7cv-rxg3-hmpx version |

## Changing the API

1. Edit `packages/api-spec/openapi.yaml`.
2. `pnpm gen` — rewrites `apps/api/internal/api/api.gen.go` and
   `apps/web/src/api/generated/**` (both committed; never hand-edit).
3. Fix compile errors in `apps/api/internal/api/server.go` (it asserts
   `StrictServerInterface`) and in `apps/web/src/mocks/handlers.ts`.

## Database (apps/api/internal/db)

- Migrations: goose SQL files in `internal/db/migrations/`, embedded and
  applied on server boot (`db.Migrate`). Add a new numbered file; never edit
  an applied one.
- Queries: write SQL in `internal/db/queries/*.sql`, then
  `cd apps/api && go generate ./...` (sqlc → `internal/db/dbq`, committed).
- `store.Postgres` maps sqlc rows to API types. `store.Memory` is a test
  double; `internal/store/conformance_test.go` runs one suite against both
  — add cases there when you change store behavior. The Postgres half skips
  unless `TEST_DATABASE_URL` is set (root `pnpm test` sets it).
- IDs are UUIDv7 (`uuidv7()`, Postgres 18). Non-UUID ids from URLs map to
  `api.ErrNotFound`.
- The schema repeats the content limits as CHECK constraints (char_length,
  so CJK counts per character) as a backstop.
- Reply limit is enforced atomically (`ClaimReplySlot` conditional UPDATE in
  the same tx as the insert), so concurrent replies can't exceed 10.
- Expired sessions are purged hourly by `main`.

## Image uploads

- Flow: browser validates type/size (`lib/images.ts`), compresses to ≤ 1920px,
  `POST /api/images` (multipart `file`, signed in) → `{id, url}`. Posts and
  replies send image **ids**; the server returns **urls** (`/api/images/{id}`).
  Ids must be the author's own uploads (`ErrInvalidImages` → 400), so posts
  can't embed external/tracking images.
- Server processing (`internal/images`): sniff real type (never trust the
  client), reject > 5 MB and > 50 MP / 12000px before decoding
  (decompression bombs), apply EXIF orientation, resize ≤ 1920px, flatten
  alpha onto white, re-encode JPEG q85 — re-encoding strips all metadata.
- Storage: `blob.Store` interface; `blob.Local` writes
  `apps/api/data/images/<2-char shard>/<uuid>.jpg` (gitignored, `IMAGE_DIR`
  overrides). Swap in an S3-compatible implementation for production. Blob is
  written before the `images` row, so failures leave orphan files, never
  dangling rows.
- Serving: `GET /api/images/{id}` is public with `Cache-Control: immutable`,
  `nosniff` and a sandbox CSP (set in `main.go` middleware).
- Body limits: 64 KB for JSON, 6 MB for `POST /api/images` (`limitBodies`).
- Frontend: `ImagePicker` (pick → compress → upload, previews, remove, busy
  state disables submit) and `ImageGrid` (read-only thumbnails). Tests mock
  `browser-image-compression` (no canvas in happy-dom).

## 我的猫咪 gallery (admin)

- Admins = `ADMIN_EMAILS` (comma list, case-insensitive). Locally it lives in
  gitignored `apps/api/.env.local` (see `.env.example`), loaded by
  `pnpm dev:api`. Never commit real emails. `User.isAdmin` is computed per
  request, not stored.
- Photos reuse the image pipeline (`POST /images`), then
  `POST /gallery {kind:"photo", mediaId}`. Videos: `POST /videos` (≤ 200 MB,
  MP4/WebM) → ffmpeg remux with `-c copy` (no re-encode) dropping global,
  stream and chapter metadata, plus a poster frame run through the image
  pipeline; then `POST /gallery {kind:"video", mediaId}`. Media must be the
  admin's own upload (`ErrInvalidMedia`).
- ffmpeg is a runtime dependency (`brew install ffmpeg` / winget
  `Gyan.FFmpeg.Essentials`; `FFMPEG` overrides
  the path). It's invoked with `-protocol_whitelist file` and an explicit
  demuxer for the sniffed container — keep both when changing args.
- `GET /api/videos/{id}` is hand-written (`Server.ServeVideo`,
  `http.ServeContent`) for Range/seeking: excluded from Go codegen
  (`oapi.yaml`) and from the TS client (tag `media-stream`, orval filter).
- Video bytes: `blob.Local{Dir: VIDEO_DIR, Ext: ".video"}`; temp files in
  `VIDEO_DIR/.tmp` so `Import` can rename on the same filesystem.
- Frontend: `GalleryUploader` (admin only; video upload via XHR for
  progress — fetch upload progress needs HTTP/2), `GalleryGrid` (videos use
  `preload="none"` + poster; aspect ratio reserved from width/height).
- MSW demo account is admin; tests sign in as a non-admin by pushing a user
  with `isAdmin: false`.

## Languages (apps/web/src/i18n)

- 10 languages: 简体中文 (source), 繁體中文, English, 日本語, 한국어, Русский,
  Français, Deutsch, Español, Português (BR). Registry: `languages.ts`
  (native name, `<html lang>`, date-fns locale, dictionary).
- `messages.ts` holds `zh` (source of truth) and `en`; the rest live in
  `locales/*.ts`. Every dictionary is typed `Messages`, so a missing/extra
  key fails typecheck; a test checks every language keeps zh's
  `{placeholders}` and has no blank strings. **Adding a key = add it to all
  10 files.** Non-zh/en translations were written by Claude — have native
  speakers review before relying on them.
- `useI18n()` → `{ lang, setLang, t, dateLocale }`. `t(key, vars)`; product
  limits (`{postMax}`, `{passwordMin}`, `{captionMax}` …) are always vars.
- Language = pinned choice (`localStorage.lang`) → system language: first
  supported entry of `navigator.languages` (`matchLang`: zh-Hant/TW/HK/MO →
  zh-TW, other zh → zh, else by base tag) → English. With nothing pinned the
  UI follows `languagechange` live. Picker: `LanguageSwitch` dropdown —
  "跟随系统 / Match system" (un-pins) + the 10 languages.
- **Never hard-code UI text.** Zod schemas use message *keys* as messages
  and forms translate with `useFieldError()`, so shown errors follow a
  language switch. Server errors stay English in the API and are mapped to
  keys in `serverErrors.ts` (unknown ones shown raw).
- The care guide has one file per UI language: `content/guide.<lang>.md`
  (lazy `import.meta.glob`, one chunk per language; missing → `en`).
  Tests next to routes must be named `-*.test.tsx` so the router ignores them.
  `guide.zh.md` is the source; a test checks every translation has the same
  number of sections and callouts. Conventions (parsed by
  `routes/guide.tsx`): `# Title` + intro, `## <emoji> Section` → card + TOC
  entry, `> 💡/⚠️/🚨 …` → tip/warning/emergency callout, trailing `---` +
  text → disclaimer. Keep medical advice hedged ("follow your vet");
  translations were written by Claude and should get native/vet review.
- Tests render in 简体中文 by default; pass `{ lang }` to
  `renderApp`/`renderWithQuery` for others.

## UI system

- Tokens in `apps/web/src/index.css` (`@theme`): brand ramp `brand-50…700`,
  `cream` page background, `shadow-card` / `shadow-lift`, CJK-friendly
  `font-sans`, `--header-h` (sticky header height — offset any sticky/
  scroll-margin element by it).
- Icons: lucide-react line icons, used sparingly; **no emoji in the UI**
  (user content excepted). The guide's Markdown keeps emoji as section/
  callout *markers* only; `routes/guide.tsx` maps them to lucide icons.
- Building blocks in `src/components/ui.tsx`: `PageHero` (every page starts
  with one), `Card`, `buttonClass.{primary,secondary,ghost,link}`,
  `inputClass`, `EmptyState`. Avatars: `components/CatAvatar.tsx` (inline
  SVG cat faces, one per `Avatar` enum value). Use these
  instead of one-off classes so pages stay consistent.
- Shell (`routes/__root.tsx`): sticky blurred header with pill nav, footer;
  content max width `max-w-5xl` (reading pages narrower, e.g. community
  `max-w-3xl`).

## Profiles & follows

- Avatars are presets only: the 13 values of the `Avatar` enum in the spec
  (orange, black, white, gray, calico, siamese, tuxedo, tabby, silver,
  tortie, cream, orange-white, lihua 狸花). No custom uploads. New users default to
  `orange`. Adding one touches: the enum, a new migration replacing the
  `users_avatar_check` CHECK (latest: 00008), a design in `CatAvatar.tsx`
  (`Record<Avatar, …>`, so a missing one fails typecheck), an
  `avatar.<id>` name in all 10 languages, and the list in the store
  conformance test (which checks the CHECK accepts every enum value).
- `PATCH /auth/me/profile` (nickname/avatar), `GET /users/{id}` (public:
  counts + `followedByMe`), `GET /users/{id}/posts`, `PUT|DELETE
  /users/{id}/follow` (idempotent; self-follow → 400).
- Posts/replies carry `authorId` + `authorAvatar`, joined live from `users`,
  so renaming updates old posts too (Memory/MSW rewrite them on update).
- Page: `/users/$userId` (opened from the user menu or any author name/
  avatar); own profile shows an inline edit form instead of Follow.
- Likes (public) and favorites (private to the owner): `PUT|DELETE
  /posts/{id}/like|favorite` (idempotent). Every `Post` carries
  `likeCount`, `likedByMe`, `favoritedByMe` (false when signed out), so
  every post list takes the viewer; the four post-list SQL queries select
  identical columns and are converted to `ListPostsRow` (`convertRows`) —
  keep them in sync. Lists: `GET /users/{id}/likes`, `GET
  /auth/me/favorites`, `GET /users/{id}/followers|following`
  (`UserSummary`).
- Profile tabs (`features/profile/ProfileTabs.tsx`, ARIA tablist with arrow
  keys): 帖子 / 点赞 / 收藏 (own profile only) / 关注 / 粉丝. Post buttons
  (`community/Reactions.tsx`) flip optimistically, then refresh every post
  list and profile query.
- When an avatar and a name next to it both link to the same profile, the
  avatar link is mouse-only (`tabIndex={-1}`, `aria-hidden`, hover
  `title`), so keyboard/screen-reader users get one link per author.

## Conventions

- **Content limits live in three places and must agree:** the spec,
  `apps/api/internal/api/server.go`, `apps/web/src/lib/limits.ts`. Post ≤ 500
  chars / 5 images; reply ≤ 100 chars / 3 images; ≤ 10 replies per post.
  Limits count characters (runes / code points), not bytes, so CJK text gets
  the full allowance.
- Images: see "Image uploads" below.
- MSW (`apps/web/src/mocks/handlers.ts`) is the only mock layer, shared by dev
  and Vitest. It's stateful and mirrors server validation; don't add ad-hoc
  `fetch` mocks in tests — override with `server.use(...)` instead.
- HTTP goes through `apps/web/src/api/http.ts` (ky). Non-2xx throws; use
  `errorMessage(err)` for user-facing text.
- User content is rendered as text, never `dangerouslySetInnerHTML`.
- Replies render inline under each post card (`Replies.tsx`, fetched only
  while expanded): reply box on top, newest reply first (API stays oldest
  first; the UI reverses). After a reply or a 409, both the thread and the post list
  are invalidated so `replyCount` stays in sync.
- `useListReplies` etc. return orval's `{ data, status }` union that includes
  error bodies; since `http` throws on non-2xx, narrow with
  `select: (res) => res.data as T`.
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

## Auth (email + password)

- Sign-up is two steps and **requires the emailed code**:
  `POST /auth/register/start` (validates, stores a `pending_registrations`
  row with the argon2id hash, emails a 6-digit code valid **5 min**) →
  `POST /auth/register/verify` (creates the user + session atomically). No
  `users` row exists before verification; there is no one-step register.
- Code rules (`internal/api/registration.go`): crypto/rand 6 digits, stored
  as sha256(email:code), constant-time compare, 5 wrong tries void it (410),
  60 s resend cooldown, ≤ 5 sends/email/hour, ≤ 20 sends/IP/hour
  (`SendLimiter`, keyed on the TCP peer — swap in the proxy's header when
  deploying behind one). Stale pending rows are purged hourly.
- Email: `mail.Mailer`. `RESEND_API_KEY` + `MAIL_FROM` → Resend; otherwise
  `DevMailer` writes each message to `apps/api/data/mail/` (gitignored) and
  logs it — read codes there locally. The email is bilingual (中文/English).
  Go tests use a capturing mailer and an injectable clock.
- `DEV_FIXED_CODE=123456` (set in the local `.env.local`) makes every code
  fixed for manual testing; `main` refuses to start if it's combined with
  `RESEND_API_KEY`. MSW mocks always use `MOCK_CODE` (123456).
- Forgot password (`/forgot-password`, linked from login):
  `POST /auth/password-reset/start` always answers 202 with the same body
  for registered and unregistered emails (rows are stored for both, so
  cooldowns match too); only registered emails get mail. `.../complete`
  checks the new password first (a typo doesn't burn a try; `attemptsLeft:
  -1`), then the code, then `Store.ChangePassword` (revokes every session),
  signs this client in and clears the login lockout. Shares
  `sendGate`/code rules with sign-up.
- MSW: codes live in `db.pending` / `db.resets` (and are `console.info`'d in
  the browser).

- Passwords: argon2id (`apps/api/internal/auth/password.go`), PHC string with
  params embedded. Unknown-email logins verify against `DummyHash` so timing
  doesn't reveal which emails exist.
- Sessions: 256-bit random token in the `cc_session` cookie (httpOnly,
  SameSite=Lax, Path=/api, 30 days, Secure unless `INSECURE_COOKIES=1`, which
  `pnpm dev:api` sets). The store keeps only the SHA-256 of the token; logout
  deletes it server-side.
- CSRF: `http.CrossOriginProtection` wraps the whole API — cross-origin
  POST/PUT/DELETE get 403. Never make GET handlers change state.
- Login limiter: 5 failures / 15 min per normalized email → 429 (in-memory,
  per process).
- Sessions and users live in Postgres; the login limiter doesn't (see below).
- `SessionMiddleware` puts the user in ctx; handlers call `UserFrom(ctx)` and
  return 401 themselves. Reads (`listPosts`, `listReplies`) are public.
- Change password (`POST /auth/password`, page `/settings`): requires the
  current password (403 if wrong; shares the login limiter), then
  `Store.ChangePassword` swaps the hash and deletes *all* the user's sessions
  in one tx, and the handler issues a fresh cookie so only this device stays
  signed in.
- Password forms: the login identifier (email) is `autocomplete="username"`
  and sits directly above the password; the settings form carries a hidden
  username input. Tests pin this — password managers misfile credentials
  otherwise.
- Frontend: `useCurrentUser()` (`null` = signed out), login/register pages
  take `?redirect=` filtered by `safeRedirect` (same-site paths only).
- Account pages (`/settings` and below, `isAccountPath`) are never a
  post-login destination: `safeRedirect` drops them, and `useSignOut`
  navigates home before clearing the user when signing out from one. Put any
  new account/security page under `/settings/` to inherit this.
- Nav: signed-in users get an accessible dropdown (`UserMenu.tsx`: 设置,
  退出登录; Escape/outside-click close). Add new account actions there.
- MSW dev account: `demo@meowsphere.dev` / `password123`. In tests, sign in with
  `db.sessionUserId = 'demo'`.

## Not built yet

- A Resend account, verified sending domain and production
  `RESEND_API_KEY`/`MAIL_FROM`.
- Login limiter is still in-memory (per process) — move to Postgres/Redis
  before running more than one API instance.
- Post list returns the newest 100; no pagination yet.
- Image/video upload endpoint + S3-compatible storage (R2/OSS; MinIO locally)
  and server-side resize/EXIF strip (`disintegration/imaging`).
- Orphaned uploads (picked but never posted) aren't cleaned up yet.
- Production blob storage (S3-compatible) and per-user upload quotas.
