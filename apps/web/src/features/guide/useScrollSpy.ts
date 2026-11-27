import { useEffect, useState } from 'react'

/**
 * Tracks which section is being read and overall reading progress.
 *
 * The active section is the last one whose top has scrolled above
 * `offset` px from the viewport top; at the very bottom of the page the last
 * section wins (it may be too short to ever reach the line). Updates are
 * batched to one per animation frame.
 */
export function useScrollSpy(ids: readonly string[], offset = 120) {
  const [active, setActive] = useState<string | undefined>(ids[0])
  const [progress, setProgress] = useState(0)
  const key = ids.join('|')

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands in for `ids`
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const max = document.documentElement.scrollHeight - window.innerHeight
      const y = window.scrollY
      setProgress(max > 0 ? Math.min(1, Math.max(0, y / max)) : 0)

      let current = ids[0]
      if (max > 0 && y >= max - 2) {
        current = ids[ids.length - 1]
      } else {
        for (const id of ids) {
          const el = document.getElementById(id)
          if (el && el.getBoundingClientRect().top - offset <= 0) current = id
        }
      }
      setActive(current)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [key, offset])

  return { active, progress }
}
