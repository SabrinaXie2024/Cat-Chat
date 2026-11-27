import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp } from '../test/render'

describe('care guide', () => {
  it('renders the Chinese guide as section cards with a table of contents', async () => {
    renderApp('/guide')
    expect(await screen.findByRole('heading', { level: 1, name: /养猫攻略/ })).toBeInTheDocument()

    const toc = screen.getByRole('navigation', { name: '养猫攻略' })
    const links = within(toc).getAllByRole('link')
    expect(links.length).toBeGreaterThanOrEqual(9)
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

  it('serves the English guide to non-Chinese languages', async () => {
    renderApp('/guide', { lang: 'fr' })
    expect(
      await screen.findByRole('heading', { level: 1, name: /Cat Care Guide/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /Emergencies/ })).toBeInTheDocument()
  })

  it('serves the Chinese guide to 繁體中文 readers', async () => {
    renderApp('/guide', { lang: 'zh-TW' })
    expect(await screen.findByRole('heading', { level: 1, name: /养猫攻略/ })).toBeInTheDocument()
  })
})
