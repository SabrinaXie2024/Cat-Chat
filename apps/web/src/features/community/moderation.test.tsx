import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Reply } from '../../api/generated/model'
import { db, resetDb, SEED_AUTHOR_ID } from '../../mocks/handlers'
import { renderApp } from '../../test/render'

const reply = (id: string, authorId: string, content: string, minutesAgo: number): Reply => ({
  id,
  postId: 'seed-1',
  authorId,
  author: authorId === 'demo' ? '演示用户' : '橘子妈',
  authorAvatar: 'gray',
  content,
  images: [],
  pinned: false,
  createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
})

beforeEach(() => {
  resetDb()
  db.replies.set('seed-1', [
    reply('r1', 'demo', '最早的评论', 3),
    reply('r2', 'demo', '中间的评论', 2),
    reply('r3', SEED_AUTHOR_ID, '作者自己的评论', 1),
  ])
  const post = db.posts[0]
  if (post) post.replyCount = 3
})
afterEach(() => vi.unstubAllGlobals())

async function openThread(user: ReturnType<typeof userEvent.setup>) {
  const card = await screen.findByRole('listitem', { name: '橘子妈 的帖子' })
  await user.click(within(card).getByRole('button', { name: /回复 \d+\/10/ }))
  return within(await within(card).findByRole('list', { name: '回复列表' }))
}

const texts = (list: ReturnType<typeof within>) =>
  list.getAllByRole('listitem').map((li: HTMLElement) => li.querySelector('p')?.textContent)

describe('reply moderation', () => {
  it('lets the post author pin (one at a time) and unpin', async () => {
    db.sessionUserId = SEED_AUTHOR_ID
    const user = userEvent.setup()
    renderApp('/community')
    const list = await openThread(user)
    expect(texts(list)).toEqual(['作者自己的评论', '中间的评论', '最早的评论'])

    const oldest = list.getAllByRole('listitem')[2] as HTMLElement
    await user.click(within(oldest).getByRole('button', { name: '置顶' }))
    await waitFor(() => expect(texts(list)[0]).toBe('最早的评论'))
    expect(
      within(list.getAllByRole('listitem')[0] as HTMLElement).getByText('置顶'),
    ).toBeInTheDocument()

    const middle = list.getAllByRole('listitem')[2] as HTMLElement
    expect(middle).toHaveTextContent('中间的评论')
    await user.click(within(middle).getByRole('button', { name: '置顶' }))
    await waitFor(() => expect(texts(list)[0]).toBe('中间的评论'))
    expect(
      db.replies
        .get('seed-1')
        ?.filter((r) => r.pinned)
        .map((r) => r.id),
    ).toEqual(['r2'])

    await user.click(
      within(list.getAllByRole('listitem')[0] as HTMLElement).getByRole('button', {
        name: '取消置顶',
      }),
    )
    await waitFor(() => expect(texts(list)).toEqual(['作者自己的评论', '中间的评论', '最早的评论']))
  })

  it('lets the post author delete a reply after confirming', async () => {
    db.sessionUserId = SEED_AUTHOR_ID
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
    vi.stubGlobal('confirm', confirm)
    const user = userEvent.setup()
    renderApp('/community')
    const list = await openThread(user)
    const target = list.getAllByRole('listitem')[1] as HTMLElement
    await user.click(within(target).getByRole('button', { name: '删除' }))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(db.replies.get('seed-1')).toHaveLength(3) // cancelled

    await user.click(within(target).getByRole('button', { name: '删除' }))
    expect(await screen.findByText('评论已删除')).toBeInTheDocument()
    await waitFor(() => expect(texts(list)).toEqual(['作者自己的评论', '最早的评论']))
    expect(await screen.findByRole('button', { name: /回复 2\/10/ })).toBeInTheDocument()
  })

  it('hides pin/delete from everyone else; others can report, but not their own replies', async () => {
    db.sessionUserId = 'demo'
    const user = userEvent.setup()
    renderApp('/community')
    const list = await openThread(user)
    expect(list.queryByRole('button', { name: '置顶' })).not.toBeInTheDocument()
    expect(list.queryByRole('button', { name: '删除' })).not.toBeInTheDocument()

    const [authors, mine] = [
      list.getAllByRole('listitem')[0] as HTMLElement,
      list.getAllByRole('listitem')[1] as HTMLElement,
    ]
    expect(within(mine).queryByRole('button', { name: '举报' })).not.toBeInTheDocument()

    await user.click(within(authors).getByRole('button', { name: '举报' }))
    const form = within(authors).getByRole('form', { name: '举报这条评论' })
    await user.click(within(form).getByRole('radio', { name: '辱骂或骚扰' }))
    await user.type(within(form).getByPlaceholderText(/补充说明/), '  说话很难听 ')
    await user.click(within(form).getByRole('button', { name: '提交举报' }))
    expect(await screen.findByText('已提交举报，管理员会尽快处理')).toBeInTheDocument()
    expect(db.reports.get(`r3>demo`)).toMatchObject({ reason: 'abuse', note: '说话很难听' })
    expect(within(authors).queryByRole('form')).not.toBeInTheDocument()
  })

  it('shows no moderation buttons to visitors', async () => {
    const user = userEvent.setup()
    renderApp('/community')
    const list = await openThread(user)
    for (const name of ['置顶', '删除', '举报'])
      expect(list.queryByRole('button', { name })).not.toBeInTheDocument()
  })
})
