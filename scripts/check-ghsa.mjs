// Fails if any installed package version matches GHSA-g7cv-rxg3-hmpx
// (malicious @tanstack/* publishes, 2026-05-11). Checks the whole lockfile,
// including transitive deps.
import { readFileSync } from 'node:fs'

const { affected } = JSON.parse(
  readFileSync(new URL('./ghsa-g7cv-rxg3-hmpx.json', import.meta.url)),
)
const lock = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8')
const hits = []
for (const [name, versions] of Object.entries(affected)) {
  for (const v of versions) {
    if (lock.includes(`${name}@${v}`)) hits.push(`${name}@${v}`)
  }
}
if (hits.length) {
  console.error(`GHSA-g7cv-rxg3-hmpx: compromised versions in lockfile:\n  ${hits.join('\n  ')}`)
  process.exit(1)
}
console.log(`GHSA-g7cv-rxg3-hmpx: clean (${Object.keys(affected).length} packages checked)`)
