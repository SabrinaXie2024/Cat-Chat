import { describe, expect, it } from 'vitest'
import { checkImage } from './images'
import { charCount } from './limits'

describe('charCount', () => {
  it('counts CJK and emoji as one character each, ignoring outer whitespace', () => {
    expect(charCount('  猫咪🐱 ')).toBe(3)
  })
})

describe('checkImage', () => {
  const file = (type: string, size: number) => new File([new Uint8Array(size)], 'x', { type })

  it('accepts a small JPEG', () => expect(checkImage(file('image/jpeg', 1000)).ok).toBe(true))
  it('rejects GIF', () => expect(checkImage(file('image/gif', 1000)).ok).toBe(false))
  it('rejects > 5 MB', () =>
    expect(checkImage(file('image/png', 5 * 1024 * 1024 + 1)).ok).toBe(false))
})
