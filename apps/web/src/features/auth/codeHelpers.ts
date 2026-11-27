import { HTTPError } from 'ky'
import { useEffect, useState } from 'react'

/** Error body fields beyond `message` (429 retryAfterSeconds, 400 attemptsLeft). */
export function errorField(
  err: unknown,
  field: 'retryAfterSeconds' | 'attemptsLeft',
): number | undefined {
  if (!(err instanceof HTTPError)) return undefined
  const v = (err.data as Record<string, unknown> | undefined)?.[field]
  return typeof v === 'number' ? v : undefined
}

/** Ticks once a second so countdowns re-render. */
export function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

export const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Keeps only digits, max 6 — for one-time-code inputs. */
export const digits6 = (v: string) => v.replace(/\D/g, '').slice(0, 6)
