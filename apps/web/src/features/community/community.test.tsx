import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderWithQuery } from '../../test/render'
import { NewPostForm } from './NewPostForm'
import { PostList } from './PostList'

function Page() {
  return (
    <>
      <NewPostForm />
      <PostList />
    </>
  )
}

describe('community', () => {
  it('lists posts from the API', async () => {
    renderWithQuery(<PostList />)
    expect(await screen.findByText(/推下桌/)).toBeInTheDocument()
  })

  it('creates a post and shows it in the list', async () => {
    const user = userEvent.setup()
    renderWithQuery(<Page />)
    await screen.findByText(/推下桌/)
    await user.type(screen.getByLabelText('分享你的猫咪日常'), '新来的小黑猫')
    await user.click(screen.getByRole('button', { name: '发布' }))
    expect(await screen.findByText('新来的小黑猫')).toBeInTheDocument()
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
