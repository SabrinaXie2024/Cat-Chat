import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, resetDb, SEED_AUTHOR_ID } from '../../mocks/handlers'
import { renderApp } from '../../test/render'

beforeEach(() => resetDb())

const seedCard = () => screen.findByRole('listitem', { name: '橘子妈 的帖子' })

describe('likes and favorites', () => {
  it('asks visitors to sign in', async () => {
    const user = userEvent.setup()
    renderApp('/community')
    await user.click(within(await seedCard()).getByRole('button', { name: /点赞/ }))
    expect(await screen.findByText('登录后才能点赞和收藏')).toBeInTheDocument()
    expect(db.likes.size).toBe(0)
  })

  it('likes and saves a post, then finds it in the profile tabs', async () => {
    db.sessionUserId = 'demo'
    const user = userEvent.setup()
    renderApp('/community')
    const card = await seedCard()
    const like = within(card).getByRole('button', { name: /点赞/ })
    expect(like).toHaveAttribute('aria-pressed', 'false')
    await user.click(like)
    await waitFor(() => expect(like).toHaveAttribute('aria-pressed', 'true'))
    expect(like).toHaveTextContent('1')
    await user.click(within(card).getByRole('button', { name: '收藏' }))
    await waitFor(() =>
      expect(within(card).getByRole('button', { name: '收藏' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )
    expect(db.likes.has('demo>seed-1')).toBe(true)
    expect(db.favorites.has('demo>seed-1')).toBe(true)

    // My profile: likes and private favorites tabs.
    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: /演示用户/ }))
    await user.click(screen.getByRole('menuitem', { name: '个人主页' }))
    await user.click(await screen.findByRole('tab', { name: '点赞' }))
    expect(await screen.findByRole('listitem', { name: '橘子妈 的帖子' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: '收藏' }))
    expect(await screen.findByText('收藏只有你自己能看到')).toBeInTheDocument()
    const saved = await screen.findByRole('listitem', { name: '橘子妈 的帖子' })

    // Unsaving from the favorites tab removes it from the list.
    await user.click(within(saved).getByRole('button', { name: '收藏' }))
    expect(await screen.findByText('还没有收藏帖子')).toBeInTheDocument()
  })

  it('lists followers and following with links', async () => {
    db.follows.add(`demo>${SEED_AUTHOR_ID}`)
    const user = userEvent.setup()
    renderApp(`/users/${SEED_AUTHOR_ID}`)
    await user.click(await screen.findByRole('tab', { name: '粉丝' }))
    const link = await screen.findByRole('link', { name: '演示用户' })
    expect(link).toHaveAttribute('href', '/users/demo')
    await user.click(screen.getByRole('tab', { name: '关注' }))
    expect(await screen.findByText('还没有关注任何人')).toBeInTheDocument()
  })

  it('moves between tabs with the arrow keys', async () => {
    const user = userEvent.setup()
    renderApp(`/users/${SEED_AUTHOR_ID}`)
    const first = await screen.findByRole('tab', { name: '帖子' })
    first.focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: '点赞' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: '点赞' })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(screen.getByRole('tab', { name: '粉丝' })).toHaveFocus()
  })
})
