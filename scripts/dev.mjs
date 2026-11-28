#!/usr/bin/env node
// Cross-platform runner for the commands that need env setup (macOS + Windows).
//
//   node scripts/dev.mjs api        Go server on :8080 (pnpm dev:api)
//   node scripts/dev.mjs test-api   go test ./... against catchat_test
//   node scripts/dev.mjs web-real   Vite with MSW off, /api proxied to :8080
//
// Env precedence: already-set env > apps/api/.env.local > defaults below.
// Default database URLs per platform:
//   macOS/Linux: Homebrew Postgres over the Unix socket in /tmp (peer auth).
//   Windows:     postgres@localhost:5432; the password comes from libpq's
//                pgpass file (%APPDATA%\postgresql\pgpass.conf), which pgx reads.
// Put DATABASE_URL / TEST_DATABASE_URL in .env.local to override.

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const apiDir = join(root, 'apps', 'api')
const isWin = process.platform === 'win32'

function dbURL(name) {
  return isWin
    ? `postgres://postgres@localhost:5432/${name}?sslmode=disable`
    : `postgres:///${name}?host=/tmp`
}

// Minimal KEY=VALUE parser (same subset `. ./.env.local` accepted before).
function loadEnvFile(file) {
  if (!existsSync(file)) return {}
  const out = {}
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2]
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1)
    out[m[1]] = v
  }
  return out
}

// `shell` is for pnpm, a .cmd shim on Windows; with a shell the command is
// passed as one string (Node deprecates shell + args, DEP0190). Only use it
// with fixed, trusted arguments.
function run(cmd, args, { cwd, env, shell = false }) {
  const opts = { cwd, env: { ...process.env, ...env }, stdio: 'inherit' }
  const child = shell
    ? spawn([cmd, ...args].join(' '), { ...opts, shell: true })
    : spawn(cmd, args, opts)
  child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)))
  child.on('error', (err) => {
    console.error(`failed to start ${cmd}: ${err.message}`)
    process.exit(1)
  })
}

// Defaults overlaid with .env.local (all keys, or only `only`), without
// clobbering anything already set in the shell.
function apiEnv(defaults, only) {
  let file = loadEnvFile(join(apiDir, '.env.local'))
  if (only) file = Object.fromEntries(Object.entries(file).filter(([k]) => only.includes(k)))
  const merged = { ...defaults, ...file }
  for (const k of Object.keys(merged)) if (process.env[k] !== undefined) delete merged[k]
  return merged
}

const task = process.argv[2]
switch (task) {
  case 'api':
    run('go', ['run', './cmd/server'], {
      cwd: apiDir,
      env: apiEnv({ INSECURE_COOKIES: '1', DATABASE_URL: dbURL('catchat') }),
    })
    break
  case 'test-api':
    run('go', ['test', './...'], {
      cwd: apiDir,
      // Tests only take the DB URL from .env.local, not the dev server's
      // settings (ADMIN_EMAILS, DEV_FIXED_CODE, ...).
      env: apiEnv({ TEST_DATABASE_URL: dbURL('catchat_test') }, ['TEST_DATABASE_URL']),
    })
    break
  case 'web-real':
    run('pnpm', ['--filter', '@cat-chat/web', 'dev'], {
      cwd: root,
      env: { VITE_API: 'real' },
      shell: isWin,
    })
    break
  default:
    console.error('usage: node scripts/dev.mjs <api|test-api|web-real>')
    process.exit(2)
}
