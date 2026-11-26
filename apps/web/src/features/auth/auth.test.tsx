import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEMO_USER, db } from '../../mocks/handlers'
import { renderApp } from '../../test/render'
import { safeRedirect } from './useCurrentUser'

const nav = () => screen.getByRole('navigation')

describe('auth', () => {
  it('signs in and returns to the redirect target', async () => {
    const user = userEvent.setup()
    const { router } = renderApp('/login?redirect=/guide')
    await user.type(await screen.findByLabelText('邮箱'), DEMO_USER.email)
    await user.type(screen.getByLabelText('密码'), DEMO_USER.password)
    await user.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/guide'))
    expect(await screen.findByText(DEMO_USER.nickname)).toBeInTheDocument()
  })

  it('shows a generic error for a wrong password', async () => {
    const user = userEvent.setup()
    renderApp('/login')
    await user.type(await screen.findByLabelText('邮箱'), DEMO_USER.email)
    await user.type(screen.getByLabelText('密码'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('邮箱或密码错误')
  })

  it('registers a new account and signs in', async () => {
    const user = userEvent.setup()
    const { router } = renderApp('/register')
    await user.type(await screen.findByLabelText('邮箱'), 'new@cat.dev')
    await user.type(screen.getByLabelText('昵称'), '小黑')
    await user.type(screen.getByLabelText('密码（至少 8 位）'), 'password123')
    await user.type(screen.getByLabelText('确认密码'), 'password123')
    await user.click(screen.getByRole('button', { name: '注册' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/community'))
    expect(await screen.findByText('小黑')).toBeInTheDocument()
  })

  it('validates the register form before calling the API', async () => {
    const user = userEvent.setup()
    renderApp('/register')
    await user.type(await screen.findByLabelText('邮箱'), 'new@cat.dev')
    await user.type(screen.getByLabelText('昵称'), '小黑')
    await user.type(screen.getByLabelText('密码（至少 8 位）'), 'short')
    await user.type(screen.getByLabelText('确认密码'), 'different')
    await user.click(screen.getByRole('button', { name: '注册' }))
    expect(await screen.findByText('密码至少 8 位')).toBeInTheDocument()
    expect(screen.getByText('两次输入的密码不一致')).toBeInTheDocument()
    expect(db.users).toHaveLength(1) // only the demo user
  })

  it('reports an already-registered email', async () => {
    const user = userEvent.setup()
    renderApp('/register')
    await user.type(await screen.findByLabelText('邮箱'), DEMO_USER.email)
    await user.type(screen.getByLabelText('昵称'), 'x')
    await user.type(screen.getByLabelText('密码（至少 8 位）'), 'password123')
    await user.type(screen.getByLabelText('确认密码'), 'password123')
    await user.click(screen.getByRole('button', { name: '注册' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('这个邮箱已经注册过了')
  })

  it('ignores ?redirect= pointing at account settings', async () => {
    const user = userEvent.setup()
    const { router } = renderApp('/login?redirect=/settings')
    await user.type(await screen.findByLabelText('邮箱'), DEMO_USER.email)
    await user.type(screen.getByLabelText('密码'), DEMO_USER.password)
    await user.click(screen.getByRole('button', { name: '登录' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/community'))
  })
})

describe('account menu', () => {
  beforeEach(() => {
    db.sessionUserId = 'demo'
  })

  const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
    const button = await screen.findByRole('button', { name: DEMO_USER.nickname })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    return button
  }

  it('opens a dropdown with settings and sign-out', async () => {
    const user = userEvent.setup()
    renderApp('/')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await openMenu(user)
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual(['设置', '退出登录'])
  })

  it('closes on Escape (focus back on the button) and on outside click', async () => {
    const user = userEvent.setup()
    renderApp('/')
    const button = await openMenu(user)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(button).toHaveFocus()

    await user.click(button)
    await user.click(screen.getByRole('heading', { level: 1 }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('"设置" opens the settings page and closes the menu', async () => {
    const user = userEvent.setup()
    const { router } = renderApp('/')
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: '设置' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'))
    expect(await screen.findByRole('heading', { name: '账号设置' })).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('signing out on a normal page stays there and remembers it for the next login', async () => {
    const user = userEvent.setup()
    const { router } = renderApp('/guide')
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: '退出登录' }))
    const login = await screen.findByRole('link', { name: '登录' })
    expect(router.state.location.pathname).toBe('/guide')
    expect(login).toHaveAttribute('href', '/login?redirect=%2Fguide')
    expect(nav()).not.toHaveTextContent(DEMO_USER.nickname)
  })

  it('signing out on settings goes home, and the next login does not return to settings', async () => {
    const user = userEvent.setup()
    const { router } = renderApp('/settings')
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: '退出登录' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    const login = await screen.findByRole('link', { name: '登录' })
    expect(login.getAttribute('href')).not.toContain('settings')

    await user.click(login)
    await user.type(await screen.findByLabelText('邮箱'), DEMO_USER.email)
    await user.type(screen.getByLabelText('密码'), DEMO_USER.password)
    await user.click(screen.getByRole('button', { name: '登录' }))
    await screen.findByRole('button', { name: DEMO_USER.nickname })
    expect(router.state.location.pathname).toBe('/')
  })
})

// Password managers save the field marked `username` (or, failing that, the
// one right before the password) as the login. It must be the email, or
// autofill puts the nickname into the login form's email box.
describe('password manager hints', () => {
  const credentialFields = () =>
    Array.from(document.querySelectorAll('input')).map((i) => `${i.id}:${i.autocomplete}`)

  it.each([
    ['/login', ['email:username', 'password:current-password']],
    [
      '/register',
      ['nickname:nickname', 'email:username', 'password:new-password', 'confirm:new-password'],
    ],
  ])('%s', async (path, want) => {
    renderApp(path)
    await screen.findByLabelText('邮箱')
    expect(credentialFields()).toEqual(want)
  })
})

describe('safeRedirect', () => {
  it.each([
    ['/community', '/community'],
    ['/guide?x=1', '/guide?x=1'],
    ['/settings', undefined],
    ['/settings?tab=password', undefined],
    ['/settings/security', undefined],
    ['/settings-help', '/settings-help'],
    ['//evil.com', undefined],
    ['https://evil.com', undefined],
    [123, undefined],
  ])('%s -> %s', (input, want) => expect(safeRedirect(input)).toBe(want))
})
