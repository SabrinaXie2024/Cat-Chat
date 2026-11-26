import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEMO_USER, db } from '../../mocks/handlers'
import { renderApp } from '../../test/render'

async function fill(current: string, next: string, confirm = next) {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('当前密码'), current)
  await user.type(screen.getByLabelText('新密码（至少 8 位）'), next)
  await user.type(screen.getByLabelText('确认新密码'), confirm)
  await user.click(screen.getByRole('button', { name: '修改密码' }))
}

describe('change password', () => {
  it('sends signed-out visitors to login without a redirect back to settings', async () => {
    const { router } = renderApp('/settings')
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.location.search).toEqual({})
  })

  describe('signed in', () => {
    beforeEach(() => {
      db.sessionUserId = 'demo'
    })

    it('shows account info', async () => {
      renderApp('/settings')
      expect(await screen.findByText(DEMO_USER.email)).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: '修改密码' })).toBeInTheDocument()
    })

    it('changes the password and clears the form', async () => {
      renderApp('/settings')
      await fill(DEMO_USER.password, 'brand-new-pass')
      await waitFor(() => expect(db.users[0]?.password).toBe('brand-new-pass'))
      await waitFor(() => expect(screen.getByLabelText('当前密码')).toHaveValue(''))
    })

    it('shows a clear error for a wrong current password', async () => {
      renderApp('/settings')
      await fill('not-my-password', 'brand-new-pass')
      expect(await screen.findByRole('alert')).toHaveTextContent('当前密码不正确')
      expect(db.users[0]?.password).toBe(DEMO_USER.password)
    })

    it('validates before calling the API', async () => {
      renderApp('/settings')
      await fill(DEMO_USER.password, 'short', 'different')
      expect(await screen.findByText('新密码至少 8 位')).toBeInTheDocument()
      expect(screen.getByText('两次输入的新密码不一致')).toBeInTheDocument()
    })

    it('rejects reusing the current password', async () => {
      renderApp('/settings')
      await fill(DEMO_USER.password, DEMO_USER.password)
      expect(await screen.findByText('新密码不能和当前密码相同')).toBeInTheDocument()
    })

    it('gives password managers the account email', async () => {
      renderApp('/settings')
      await screen.findByLabelText('当前密码')
      const hidden = document.querySelector<HTMLInputElement>('input[autocomplete="username"]')
      expect(hidden?.value).toBe(DEMO_USER.email)
    })
  })
})
