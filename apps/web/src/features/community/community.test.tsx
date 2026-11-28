import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEMO_USER, db } from '../../mocks/handlers'
import { renderApp, renderWithQuery } from '../../test/render'
import { NewPostForm } from './NewPostForm'

describe('community (signed out)', () => {
  it('asks visitors to sign in instead of showing the form', async () => {
    renderApp('/community')
    expect(await screen.findByText(/后就可以分享/)).toBeInTheDocument()
    expect(screen.queryByLabelText('分享你的猫咪日常')).not.toBeInTheDocument()
    expect(await screen.findByText(/推下桌/)).toBeInTheDocument() // reading is public
  })
})

describe('community (signed in)', () => {
  beforeEach(() => {
    db.sessionUserId = 'demo'
  })

  it('shows the form on the community page', async () => {
    renderApp('/community')
    expect(await screen.findByLabelText('分享你的猫咪日常')).toBeInTheDocument()
  })

  it('lists posts from the API', async () => {
    renderApp('/community')
    expect(await screen.findByText(/推下桌/)).toBeInTheDocument()
  })

  it('creates a post and shows it in the list', async () => {
    const user = userEvent.setup()
    renderApp('/community')
    await screen.findByText(/推下桌/)
    await user.type(screen.getByLabelText('分享你的猫咪日常'), '新来的小黑猫')
    await user.click(screen.getByRole('button', { name: '发布' }))
    expect(await screen.findByText('新来的小黑猫')).toBeInTheDocument()
    expect(
      screen.getByRole('listitem', { name: `${DEMO_USER.nickname} 的帖子` }),
    ).toBeInTheDocument()
  })

  it('blocks posts over 500 characters (counted as characters, not bytes)', async () => {
    const user = userEvent.setup()
    renderWithQuery(<NewPostForm />)
    const box = screen.getByLabelText('分享你的猫咪日常')
    await user.click(box)
    await user.paste('猫'.repeat(501))
    await user.click(screen.getByRole('button', { name: '发布' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('最多 500 字')
  })
})
