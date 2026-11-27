import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { DEMO_USER, db } from '../../mocks/handlers'
import { renderApp } from '../../test/render'

async function requestCode(user: ReturnType<typeof userEvent.setup>, email: string) {
  await user.type(await screen.findByLabelText('邮箱'), email)
  await user.click(screen.getByRole('button', { name: '发送验证码' }))
  return screen.findByLabelText('验证码')
}

describe('forgot password', () => {
  it('is linked from the login page', async () => {
    const user = userEvent.setup()
    const { router } = renderApp('/login')
    await user.click(await screen.findByRole('link', { name: '忘记密码？' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/forgot-password'))
    expect(await screen.findByRole('heading', { name: '重置密码' })).toBeInTheDocument()
  })

  it('resets the password with the emailed code and signs in', async () => {
    const user = userEvent.setup()
    const { router } = renderApp('/forgot-password')
    const box = await requestCode(user, DEMO_USER.email)
    expect(
      screen.getByText(`如果 ${DEMO_USER.email} 已注册，验证码已发送到这个邮箱`),
    ).toBeInTheDocument()

    await user.type(box, db.resets.get(DEMO_USER.email)?.code ?? '')
    await user.type(screen.getByLabelText('新密码（至少 8 位）'), 'brand-new-pass')
    await user.type(screen.getByLabelText('确认新密码'), 'brand-new-pass')
    await user.click(screen.getByRole('button', { name: '重置密码并登录' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/community'))
    expect(await screen.findByRole('button', { name: DEMO_USER.nickname })).toBeInTheDocument()
    expect(db.users[0]?.password).toBe('brand-new-pass')
  })

  it('looks exactly the same for an unregistered email', async () => {
    const user = userEvent.setup()
    renderApp('/forgot-password')
    await requestCode(user, 'ghost@cat.dev')
    expect(
      screen.getByText('如果 ghost@cat.dev 已注册，验证码已发送到这个邮箱'),
    ).toBeInTheDocument()
  })

  it('reports a wrong code with tries left, keeping the password', async () => {
    const user = userEvent.setup()
    renderApp('/forgot-password')
    const box = await requestCode(user, DEMO_USER.email)
    const real = db.resets.get(DEMO_USER.email)?.code
    await user.type(box, real === '000000' ? '111111' : '000000')
    await user.type(screen.getByLabelText('新密码（至少 8 位）'), 'brand-new-pass')
    await user.type(screen.getByLabelText('确认新密码'), 'brand-new-pass')
    await user.click(screen.getByRole('button', { name: '重置密码并登录' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('验证码错误，还可以再试 4 次')
    expect(db.users[0]?.password).toBe(DEMO_USER.password)
  })

  it('validates code and password locally', async () => {
    const user = userEvent.setup()
    renderApp('/forgot-password')
    const box = await requestCode(user, DEMO_USER.email)
    await user.type(box, '12x')
    expect(box).toHaveValue('12')
    await user.type(screen.getByLabelText('新密码（至少 8 位）'), 'short')
    await user.type(screen.getByLabelText('确认新密码'), 'other')
    await user.click(screen.getByRole('button', { name: '重置密码并登录' }))
    expect(await screen.findByText('请输入 6 位数字验证码')).toBeInTheDocument()
    expect(screen.getByText('新密码至少 8 位')).toBeInTheDocument()
    expect(screen.getByText('两次输入的新密码不一致')).toBeInTheDocument()
  })

  it('"use a different email" goes back with the email kept; resend waits 60s', async () => {
    const user = userEvent.setup()
    renderApp('/forgot-password')
    await requestCode(user, DEMO_USER.email)
    expect(screen.getByRole('button', { name: /秒后可重新发送/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '换个邮箱' }))
    expect(await screen.findByLabelText('邮箱')).toHaveValue(DEMO_USER.email)
  })
})
