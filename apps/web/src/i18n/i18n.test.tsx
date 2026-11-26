import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEMO_USER, db } from '../mocks/handlers'
import { renderApp } from '../test/render'
import { detectLang, translate } from './I18nProvider'
import { en, type MessageKey, zh } from './messages'

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('dictionaries', () => {
  it('every key uses the same placeholders in both languages', () => {
    for (const key of Object.keys(zh) as MessageKey[]) {
      expect(placeholders(en[key]), key).toEqual(placeholders(zh[key]))
    }
  })

  it('fills product limits and explicit vars', () => {
    expect(translate('zh', 'err.postTooLong')).toBe('最多 500 字')
    expect(translate('en', 'err.replyTooLong')).toBe('At most 100 characters')
    expect(translate('en', 'images.hint', { count: 2, max: 5 })).toMatch(/^2\/5 /)
  })
})

describe('detectLang', () => {
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })
  const withLanguages = (languages: string[]) =>
    vi.stubGlobal('navigator', { ...navigator, languages, language: languages[0] })

  it('follows the browser: any zh-* → Chinese, otherwise English', () => {
    withLanguages(['zh-TW', 'en'])
    expect(detectLang()).toBe('zh')
    withLanguages(['fr-FR', 'en-US'])
    expect(detectLang()).toBe('en')
  })

  it('a saved choice wins over the browser', () => {
    withLanguages(['zh-CN'])
    localStorage.setItem('lang', 'en')
    expect(detectLang()).toBe('en')
  })
})

describe('switching language', () => {
  afterEach(() => localStorage.clear())

  it('toggles the whole UI, page title and <html lang>, and remembers the choice', async () => {
    const user = userEvent.setup()
    renderApp('/community')
    const nav = await screen.findByRole('navigation')
    expect(within(nav).getByText('喵友圈')).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('zh-CN')

    await user.click(within(nav).getByRole('button', { name: '切换到英文' }))
    expect(within(nav).getByText('MeowSphere')).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Cat Moments' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Cat Moments' })).toBeInTheDocument()
    expect(document.title).toBe('MeowSphere')
    expect(document.documentElement.lang).toBe('en')
    expect(localStorage.getItem('lang')).toBe('en')

    await user.click(within(nav).getByRole('button', { name: 'Switch to Chinese' }))
    expect(within(nav).getByText('喵友圈')).toBeInTheDocument()
    expect(document.title).toBe('喵友圈 · MeowSphere')
  })

  it('translates validation messages, already-shown errors included', async () => {
    const user = userEvent.setup()
    renderApp('/register', { lang: 'en' })
    await user.type(await screen.findByLabelText('Nickname'), 'Tom')
    await user.type(screen.getByLabelText('Email'), 'tom@cat.dev')
    await user.type(screen.getByLabelText('Password (at least 8 characters)'), 'short')
    await user.type(screen.getByLabelText('Confirm password'), 'other')
    await user.click(screen.getByRole('button', { name: 'Sign up' }))
    expect(await screen.findByText('Password must be at least 8 characters')).toBeInTheDocument()
    expect(screen.getByText("Passwords don't match")).toBeInTheDocument()

    // Switch while the errors are on screen: they re-render in Chinese.
    await user.click(screen.getByRole('button', { name: 'Switch to Chinese' }))
    expect(await screen.findByText('密码至少 8 位')).toBeInTheDocument()
  })

  it('translates server errors', async () => {
    const user = userEvent.setup()
    renderApp('/login', { lang: 'en' })
    await user.type(await screen.findByLabelText('Email'), DEMO_USER.email)
    await user.type(screen.getByLabelText('Password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password')
  })

  it('formats relative times in the active language', async () => {
    db.sessionUserId = 'demo'
    renderApp('/community', { lang: 'en' })
    const card = await screen.findByRole('listitem', { name: 'Post by 橘子妈' })
    await waitFor(() => expect(within(card).getByText(/ago$/)).toBeInTheDocument())
  })
})
