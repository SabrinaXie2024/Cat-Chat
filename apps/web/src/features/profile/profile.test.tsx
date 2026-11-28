import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, resetDb, SEED_AUTHOR_ID } from '../../mocks/handlers'
import { renderApp } from '../../test/render'

beforeEach(() => resetDb())

const stat = (label: string) => {
  const dt = screen.getByText(label, { selector: 'dt' })
  return dt.parentElement?.querySelector('dd')?.textContent
}

describe('profile page', () => {
  it('opens from a post author and shows counts', async () => {
    const user = userEvent.setup()
    renderApp('/community')
    const card = await screen.findByRole('listitem', { name: '橘子妈 的帖子' })
    await user.click(within(card).getByRole('link', { name: '橘子妈' }))
    expect(await screen.findByRole('heading', { level: 1, name: '橘子妈' })).toBeInTheDocument()
    expect(stat('帖子')).toBe('1')
    expect(stat('粉丝')).toBe('0')
    expect(screen.getByRole('heading', { name: 'TA 的帖子' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '登录后关注' })).toBeInTheDocument()
  })

  it('lets a signed-in user follow and unfollow', async () => {
    db.sessionUserId = 'demo'
    const user = userEvent.setup()
    renderApp(`/users/${SEED_AUTHOR_ID}`)
    await user.click(await screen.findByRole('button', { name: '关注' }))
    expect(await screen.findByRole('button', { name: '取消关注' })).toBeInTheDocument()
    await waitFor(() => expect(stat('粉丝')).toBe('1'))
    await user.click(screen.getByRole('button', { name: '取消关注' }))
    await waitFor(() => expect(stat('粉丝')).toBe('0'))
  })

  it('shows not found for unknown users', async () => {
    renderApp('/users/nobody')
    expect(await screen.findByText('找不到这个用户')).toBeInTheDocument()
  })

  it('edits own nickname and avatar from the user menu; posts follow along', async () => {
    db.sessionUserId = 'demo'
    Object.assign(db.posts[0] ?? {}, {
      authorId: 'demo',
      author: '演示用户',
      authorAvatar: 'orange',
    })
    const user = userEvent.setup()
    renderApp('/')
    const banner = await screen.findByRole('banner')
    await user.click(await within(banner).findByRole('button', { name: /演示用户/ }))
    await user.click(screen.getByRole('menuitem', { name: '个人主页' }))
    expect(await screen.findByRole('heading', { level: 1, name: '演示用户' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '我的帖子' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '关注' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '编辑资料' }))
    const form = screen.getByRole('form', { name: '编辑资料' })
    const name = within(form).getByLabelText('昵称')
    await user.clear(name)
    await user.click(within(form).getByRole('button', { name: '保存' }))
    expect(within(form).getByText('请输入昵称')).toBeInTheDocument()

    await user.type(name, '小橘')
    // Only the presets are offered.
    expect(within(form).getAllByRole('radio')).toHaveLength(8)
    await user.click(within(form).getByRole('radio', { name: '三花' }))
    await user.click(within(form).getByRole('button', { name: '保存' }))

    expect(await screen.findByRole('heading', { level: 1, name: '小橘' })).toBeInTheDocument()
    expect(db.users.find((u) => u.id === 'demo')?.avatar).toBe('calico')
    expect(await screen.findByRole('listitem', { name: '小橘 的帖子' })).toBeInTheDocument()
    expect(within(banner).getByRole('button', { name: /小橘/ })).toBeInTheDocument()
  })
})
