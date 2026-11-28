import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_AVATAR, PRESET_NAMES } from '../../components/CatAvatar'
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
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab')
    // Favorites are private, so other people's profiles don't show that tab.
    expect(tabs.map((x) => x.textContent)).toEqual(['帖子', '点赞', '关注', '粉丝'])
    expect(screen.getByRole('link', { name: '登录后关注' })).toBeInTheDocument()
  })

  it('gives keyboard users one link per post author (the avatar copy is mouse-only)', async () => {
    renderApp('/community')
    const card = await screen.findByRole('listitem', { name: '橘子妈 的帖子' })
    const links = within(card).getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual(['橘子妈'])
    const avatarLink = card.querySelector('a[tabindex="-1"]')
    expect(avatarLink).toHaveAttribute('aria-hidden', 'true')
    expect(avatarLink).toHaveAttribute('href', `/users/${SEED_AUTHOR_ID}`)
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
      authorAvatar: DEFAULT_AVATAR,
    })
    const user = userEvent.setup()
    renderApp('/')
    const banner = await screen.findByRole('banner')
    await user.click(await within(banner).findByRole('button', { name: /演示用户/ }))
    await user.click(screen.getByRole('menuitem', { name: '个人主页' }))
    expect(await screen.findByRole('heading', { level: 1, name: '演示用户' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '收藏' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '关注' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '编辑资料' }))
    const form = screen.getByRole('form', { name: '编辑资料' })
    const name = within(form).getByLabelText('昵称')
    await user.clear(name)
    await user.click(within(form).getByRole('button', { name: '保存' }))
    expect(within(form).getByText('请输入昵称')).toBeInTheDocument()

    await user.type(name, '小橘')
    // The 13 classic looks stay available as one-click presets.
    const presets = within(within(form).getByRole('group', { name: '经典款' }))
    expect(presets.getAllByRole('radio')).toHaveLength(PRESET_NAMES.length)
    expect(PRESET_NAMES).toHaveLength(13)
    for (const name of ['银虎斑', '玳瑁', '奶油猫', '橘白', '狸花']) {
      expect(presets.getByRole('radio', { name })).toBeInTheDocument()
    }
    // Then every part can be changed, only from the offered options.
    const group = (name: string) => within(within(form).getByRole('group', { name }))
    expect(group('品种').getAllByRole('radio')).toHaveLength(4)
    expect(group('毛色').getAllByRole('radio')).toHaveLength(7)
    expect(group('花纹').getAllByRole('radio')).toHaveLength(6)
    expect(group('眼睛').getAllByRole('radio')).toHaveLength(5)

    await user.click(presets.getByRole('radio', { name: '三花' }))
    expect(group('花纹').getByRole('radio', { name: '花斑' })).toBeChecked()
    await user.click(group('品种').getByRole('radio', { name: '折耳' }))
    await user.click(group('眼睛').getByRole('radio', { name: '异瞳' }))
    expect(presets.getByRole('radio', { name: '三花' })).not.toBeChecked() // eyes changed
    await user.click(within(form).getByRole('button', { name: '保存' }))

    expect(await screen.findByRole('heading', { level: 1, name: '小橘' })).toBeInTheDocument()
    expect(db.users.find((u) => u.id === 'demo')?.avatar).toEqual({
      breed: 'fold',
      coat: 'white',
      pattern: 'patches',
      eyes: 'odd',
    })
    expect(await screen.findByRole('listitem', { name: '小橘 的帖子' })).toBeInTheDocument()
    expect(within(banner).getByRole('button', { name: /小橘/ })).toBeInTheDocument()
  })
})
