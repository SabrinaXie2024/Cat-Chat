import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
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

  it('signs out', async () => {
    db.sessionUserId = 'demo'
    const user = userEvent.setup()
    renderApp('/')
    await user.click(await screen.findByRole('button', { name: '退出' }))
    expect(await screen.findByRole('link', { name: '登录' })).toBeInTheDocument()
    expect(nav()).not.toHaveTextContent(DEMO_USER.nickname)
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
    ['//evil.com', undefined],
    ['https://evil.com', undefined],
    [123, undefined],
  ])('%s -> %s', (input, want) => expect(safeRedirect(input)).toBe(want))
})
