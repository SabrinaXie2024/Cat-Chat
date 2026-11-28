#!/usr/bin/env node
// Pre-commit check: fail if any given Go file isn't gofmt-formatted.
// A Node script rather than `test -z "$(gofmt -l ...)"` in lefthook.yml,
// because that shell one-liner doesn't parse under lefthook on Windows.
//
//   node scripts/gofmt-check.mjs file1.go file2.go ...

import { spawnSync } from 'node:child_process'

const files = process.argv.slice(2)
if (files.length === 0) process.exit(0)

const res = spawnSync('gofmt', ['-l', ...files], { encoding: 'utf8' })
if (res.error) {
  console.error(`gofmt-check: could not run gofmt: ${res.error.message}`)
  process.exit(1)
}
if (res.status !== 0) {
  process.stderr.write(res.stderr)
  process.exit(res.status ?? 1)
}
const unformatted = res.stdout.trim()
if (unformatted) {
  console.error(`Not gofmt-formatted (run gofmt -w):\n${unformatted}`)
  process.exit(1)
}
