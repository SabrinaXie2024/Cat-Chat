import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Avatar } from '../../api/generated/model'
import { db, resetDb, SEED_AUTHOR_ID } from '../../mocks/handlers'
import { renderApp } from '../../test/render'

beforeEach(() => {
  resetDb()
  db.users.push({
    id: 'troll',
    email: 'troll@cat.dev',
    nickname: '捣蛋鬼',
    password: 'password123',
    isAdmin: false,
    avatar: Avatar.black,
    createdAt: new Date().toISOString(),
  })
  const base = { postId: 'seed-1', authorId: 'troll', author: '捣蛋鬼', authorAvatar: Avatar.black }
  db.replies.set('seed-1', [
    {
      ...base,
      id: 'bad',
      content: '难听的话',
      images: [],
      pinned: false,
      createdAt: new Date().toISOString(),
    },
    {
      ...base,
      id: 'ok',
      content: '普通评论',
      images: [],
      pinned: false,
      createdAt: new Date().toISOString(),
    },
  ])
  const post = db.posts[0]
  if (post) post.replyCount = 2
  const now = new Date().toISOString()
  db.reports.set(`bad>${SEED_AUTHOR_ID}`, {
    reason: 'abuse',
    note: '骂人',
    status: 'open',
    createdAt: now,
  })
  db.reports.set('bad>demo', { reason: 'spam', note: '', status: 'open', createdAt: now })
  db.reports.set(`ok>${SEED_AUTHOR_ID}`, {
    reason: 'other',
    note: '',
    status: 'open',
    createdAt: now,
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('admin report review', () => {
  it('is reachable from the menu and lists reports grouped by comment', async () => {
    db.sessionUserId = 'demo' // admin in mocks
    const user = userEvent.setup()
    renderApp('/')
    await user.click(
      await within(await screen.findByRole('banner')).findByRole('button', { name: /演示用户/ }),
    )
    await user.click(screen.getByRole('menuitem', { name: '举报审核' }))
    const cards = await screen.findAllByRole('listitem', { name: '捣蛋鬼 的帖子' })
    expect(cards).toHaveLength(2)
    const first = within(cards[0] as HTMLElement)
    expect(first.getByText('难听的话')).toBeInTheDocument()
    expect(first.getByText('2 次举报')).toBeInTheDocument()
    expect(first.getByText('辱骂或骚扰')).toBeInTheDocument()
    expect(first.getByText('骂人')).toBeInTheDocument()
    expect(first.getByText(/所在帖子：今天橘子/)).toBeInTheDocument()
  })

  it('deletes a reported comment or dismisses the reports', async () => {
    db.sessionUserId = 'demo'
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    )
    const user = userEvent.setup()
    renderApp('/admin')
    const [bad, ok] = (await screen.findAllByRole('listitem', { name: '捣蛋鬼 的帖子' })) as [
      HTMLElement,
      HTMLElement,
    ]
    await user.click(within(bad).getByRole('button', { name: '删除评论' }))
    expect(await screen.findByText('评论已删除')).toBeInTheDocument()
    expect(db.replies.get('seed-1')?.map((r) => r.id)).toEqual(['ok'])
    expect(db.posts[0]?.replyCount).toBe(1)

    await user.click(within(ok).getByRole('button', { name: '驳回举报' }))
    expect(await screen.findByText('没有待处理的举报')).toBeInTheDocument()
    expect(db.replies.get('seed-1')?.map((r) => r.id)).toEqual(['ok'])
  })

  it('turns away non-admins', async () => {
    db.sessionUserId = SEED_AUTHOR_ID
    renderApp('/admin')
    expect(await screen.findByText('只有管理员可以访问这个页面')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '删除评论' })).not.toBeInTheDocument(),
    )
  })
})
