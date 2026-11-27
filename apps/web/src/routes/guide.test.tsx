import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderApp } from '../test/render'

describe('care guide', () => {
  it('renders the Chinese guide as section cards with a table of contents', async () => {
    renderApp('/guide')
    expect(await screen.findByRole('heading', { level: 1, name: /养猫攻略/ })).toBeInTheDocument()

    const toc = screen.getByRole('navigation', { name: '目录' })
    // Two renderings of the same TOC: mobile chips + desktop sidebar.
    const links = within(toc).getAllByRole('link')
    expect(links.length).toBeGreaterThanOrEqual(18)
    expect(links.map((l) => l.textContent)).toContain('🚨紧急情况')

    // Every TOC entry points at a real section heading.
    for (const link of links) {
      const id = link.getAttribute('href')?.slice(1) ?? ''
      const section = document.getElementById(id)
      expect(section?.tagName, id).toBe('SECTION')
      expect(within(section as HTMLElement).getByRole('heading', { level: 2 })).toBeInTheDocument()
    }
  })

  it('renders tips, warnings and emergencies as callouts without the emoji marker', async () => {
    renderApp('/guide')
    await screen.findByRole('heading', { level: 1, name: /养猫攻略/ })
    const asides = document.querySelectorAll('aside')
    expect(asides.length).toBeGreaterThanOrEqual(5)
    const lily = Array.from(asides).find((a) => a.textContent?.includes('百合'))
    expect(lily?.className).toMatch(/orange/)
    expect(lily?.textContent?.startsWith('⚠️')).toBe(false)
    const er = Array.from(asides).find((a) => a.textContent?.includes('24 小时宠物急诊'))
    expect(er?.className).toMatch(/red/)
  })

  it('covers the key safety topics', async () => {
    renderApp('/guide')
    await screen.findByRole('heading', { level: 1, name: /养猫攻略/ })
    const text = document.body.textContent ?? ''
    for (const topic of [
      '百合',
      '洋葱',
      '巧克力',
      '葡萄',
      '猫三联',
      '驱虫',
      '绝育',
      '尿不出来',
      '对乙酰氨基酚',
    ]) {
      expect(text, topic).toContain(topic)
    }
    expect(screen.getByText(/不能代替兽医/)).toBeInTheDocument()
  })

  it.each([
    ['en', 'Cat Care Guide', 'Emergencies'],
    ['zh-TW', '養貓攻略', '緊急情況'],
    ['ja', '猫の飼い方ガイド', '緊急時'],
    ['ko', '반려묘 가이드', '응급 상황'],
    ['ru', 'Руководство по уходу за кошкой', 'Неотложные ситуации'],
    ['fr', 'Guide pour bien s’occuper de son chat', 'Urgences'],
    ['de', 'Katzenratgeber', 'Notfälle'],
    ['es', 'Guía para cuidar a tu gato', 'Urgencias'],
    ['pt', 'Guia de cuidados com gatos', 'Emergências'],
  ] as const)('serves the %s guide', async (lang, title, emergencies) => {
    renderApp('/guide', { lang })
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: emergencies })).toBeInTheDocument()
  })
})

describe('reading position', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    // Undo fakeLayout's own-property overrides so tests don't leak layout.
    delete (window as { scrollY?: number }).scrollY
    delete (document.documentElement as { scrollHeight?: number }).scrollHeight
  })

  /** Fake layout: section i's top is at (i * 1000 - scrollY) px. */
  function fakeLayout(scrollY: number, { pageHeight = 12_000 } = {}) {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: scrollY })
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: pageHeight,
    })
    document.querySelectorAll('section[id^="section-"]').forEach((el, i) => {
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top: i * 1000 - scrollY } as DOMRect)
    })
    act(() => window.dispatchEvent(new Event('scroll')))
  }

  const current = () =>
    Array.from(document.querySelectorAll('nav a[aria-current="location"]')).map(
      (a) => a.textContent,
    )

  it('highlights the section being read in both TOCs', async () => {
    renderApp('/guide')
    await screen.findByRole('heading', { level: 1, name: /养猫攻略/ })
    fakeLayout(0)
    await waitFor(() => expect(current()).toEqual(['🐱选猫与领养', '1选猫与领养']))

    fakeLayout(2_100) // section 3's top has passed the 120px line
    await waitFor(() => expect(current()[0]).toBe('🏠到家第一周'))
    expect(current()).toHaveLength(2)

    fakeLayout(4_050)
    await waitFor(() => expect(current()[0]).toBe('🚽猫砂盆'))
  })

  it('marks earlier sections as read and shows progress', async () => {
    renderApp('/guide')
    await screen.findByRole('heading', { level: 1, name: /养猫攻略/ })
    fakeLayout(2_100)
    const bar = screen.getByRole('progressbar')
    await waitFor(() =>
      expect(bar).toHaveAttribute(
        'aria-valuenow',
        String(Math.round((2_100 / (12_000 - window.innerHeight)) * 100)),
      ),
    )
    expect(screen.getAllByText(/已读 \d+%/).length).toBeGreaterThan(0)
  })

  it('activates the last section at the bottom of the page, even if it is short', async () => {
    renderApp('/guide')
    await screen.findByRole('heading', { level: 1, name: /养猫攻略/ })
    fakeLayout(12_000 - window.innerHeight) // scrolled all the way down
    await waitFor(() => expect(current()[0]).toBe('🌈陪它走完最后一程'))
    await waitFor(() =>
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100'),
    )
  })

  it('shows a back-to-top button once you have scrolled', async () => {
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)
    renderApp('/guide')
    await screen.findByRole('heading', { level: 1, name: /养猫攻略/ })
    fakeLayout(0)
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '回到顶部' })).not.toBeInTheDocument(),
    )
    fakeLayout(3_000)
    await userEvent.setup().click(await screen.findByRole('button', { name: '回到顶部' }))
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 })
  })
})

describe('guide translations', () => {
  const files = import.meta.glob<string>('../content/guide.*.md', {
    query: '?raw',
    import: 'default',
    eager: true,
  })
  const sectionCount = (md: string) => md.match(/^## /gm)?.length ?? 0
  const calloutCount = (md: string) => md.match(/^> (💡|⚠️|🚨)/gm)?.length ?? 0
  const zh = files['../content/guide.zh.md'] ?? ''

  it('has a guide for every UI language', () => {
    for (const lang of ['zh', 'zh-TW', 'en', 'ja', 'ko', 'ru', 'fr', 'de', 'es', 'pt']) {
      expect(files[`../content/guide.${lang}.md`], lang).toBeTruthy()
    }
  })

  it.each(Object.entries(files))('%s matches the zh structure', (_path, md) => {
    expect(sectionCount(md)).toBe(sectionCount(zh))
    expect(calloutCount(md)).toBe(calloutCount(zh))
    expect(md).toMatch(/^---$/m) // disclaimer footer
  })
})
