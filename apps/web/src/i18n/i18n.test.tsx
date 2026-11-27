import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEMO_USER, db } from '../mocks/handlers'
import { renderApp } from '../test/render'
import { detectLang, translate } from './I18nProvider'
import { LANGUAGES, matchLang } from './languages'
import { type MessageKey, zh } from './messages'

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('dictionaries', () => {
  it('offers 10 languages', () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual([
      'zh',
      'zh-TW',
      'en',
      'ja',
      'ko',
      'ru',
      'fr',
      'de',
      'es',
      'pt',
    ])
  })

  it.each(
    LANGUAGES.map((l) => [l.code, l.messages] as const),
  )('%s: same placeholders as zh, no blank strings', (_code, messages) => {
    for (const key of Object.keys(zh) as MessageKey[]) {
      expect(placeholders(messages[key]), key).toEqual(placeholders(zh[key]))
      expect(messages[key].trim(), key).not.toBe('')
    }
  })

  it('each language has its own product name; tab titles keep "MeowSphere"', () => {
    const brands = Object.fromEntries(LANGUAGES.map((l) => [l.code, l.messages.brand]))
    expect(brands).toEqual({
      zh: '喵友圈',
      'zh-TW': '喵友圈',
      en: 'MeowSphere',
      ja: 'ニャン友',
      ko: '냥친구',
      ru: 'Мяусфера',
      fr: 'MiaouSphère',
      de: 'MiauSphäre',
      es: 'Miausfera',
      pt: 'Miausfera',
    })
    for (const l of LANGUAGES) expect(l.messages.docTitle, l.code).toContain('MeowSphere')
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

  it('picks the first supported browser language, else English', () => {
    withLanguages(['fr-FR', 'en-US'])
    expect(detectLang()).toBe('fr')
    withLanguages(['it-IT', 'ja-JP'])
    expect(detectLang()).toBe('ja') // Italian unsupported → next preference
    withLanguages(['it-IT', 'nl'])
    expect(detectLang()).toBe('en')
  })

  it.each([
    ['zh-CN', 'zh'],
    ['zh-Hans', 'zh'],
    ['zh-TW', 'zh-TW'],
    ['zh-Hant-HK', 'zh-TW'],
    ['zh-HK', 'zh-TW'],
    ['pt-PT', 'pt'],
    ['ko-KR', 'ko'],
    ['xx', undefined],
  ])('matchLang(%s) = %s', (tag, want) => expect(matchLang(tag)).toBe(want))

  it('a saved choice wins over the browser', () => {
    withLanguages(['zh-CN'])
    localStorage.setItem('lang', 'en')
    expect(detectLang()).toBe('en')
  })
})

describe('switching language', () => {
  afterEach(() => localStorage.clear())

  const pick = async (
    user: ReturnType<typeof userEvent.setup>,
    current: string,
    target: string,
  ) => {
    const nav = screen.getByRole('navigation')
    const button = within(nav).getByRole('button', { name: new RegExp(`: ${current}$`) })
    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    await user.click(within(screen.getByRole('menu')).getByRole('menuitemradio', { name: target }))
  }

  it('dropdown lists all languages in their own names and marks the current one', async () => {
    const user = userEvent.setup()
    renderApp('/')
    const nav = await screen.findByRole('navigation')
    await user.click(within(nav).getByRole('button', { name: '语言: 简体中文' }))
    const items = within(screen.getByRole('menu', { name: '语言' })).getAllByRole('menuitemradio')
    expect(items.map((i) => i.textContent)).toEqual(LANGUAGES.map((l) => l.nativeName))
    expect(
      items.filter((i) => i.getAttribute('aria-checked') === 'true').map((i) => i.textContent),
    ).toEqual(['简体中文'])
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('switches the whole UI, page title and <html lang>, and remembers the choice', async () => {
    const user = userEvent.setup()
    renderApp('/community')
    const nav = await screen.findByRole('navigation')
    expect(within(nav).getByText('喵友圈')).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('zh-CN')

    await pick(user, '简体中文', 'English')
    expect(within(nav).getByText('MeowSphere')).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Cat Moments' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Cat Moments' })).toBeInTheDocument()
    expect(document.title).toBe('MeowSphere')
    expect(document.documentElement.lang).toBe('en')
    expect(localStorage.getItem('lang')).toBe('en')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await pick(user, 'English', '日本語')
    expect(screen.getByRole('heading', { name: 'ねこ日和' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('ja')

    await pick(user, '日本語', '繁體中文')
    expect(screen.getByRole('heading', { name: '貓咪日常' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('zh-TW')

    await pick(user, '繁體中文', '简体中文')
    expect(within(nav).getByText('喵友圈')).toBeInTheDocument()
    expect(document.title).toBe('喵友圈 · MeowSphere')
  })

  it.each([
    ['ko', '고양이 일상'],
    ['ru', 'Кошачьи будни'],
    ['fr', 'Moments de chats'],
    ['de', 'Katzenmomente'],
    ['es', 'Momentos gatunos'],
    ['pt', 'Momentos felinos'],
  ] as const)('renders in %s', async (lang, heading) => {
    renderApp('/community', { lang })
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
  })

  it('translates validation messages, already-shown errors included', async () => {
    const user = userEvent.setup()
    renderApp('/register', { lang: 'en' })
    await user.type(await screen.findByLabelText('Nickname'), 'Tom')
    await user.type(screen.getByLabelText('Email'), 'tom@cat.dev')
    await user.type(screen.getByLabelText('Password (at least 8 characters)'), 'short')
    await user.type(screen.getByLabelText('Confirm password'), 'other')
    await user.click(screen.getByRole('button', { name: 'Send code' }))
    expect(await screen.findByText('Password must be at least 8 characters')).toBeInTheDocument()
    expect(screen.getByText("Passwords don't match")).toBeInTheDocument()

    // Switch while the errors are on screen: they re-render in the new language.
    await pick(user, 'English', 'Deutsch')
    expect(
      await screen.findByText('Das Passwort muss mindestens 8 Zeichen lang sein'),
    ).toBeInTheDocument()
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
