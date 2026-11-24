import { createFileRoute } from '@tanstack/react-router'
import { NewPostForm } from '../features/community/NewPostForm'
import { PostList } from '../features/community/PostList'

export const Route = createFileRoute('/community/')({ component: Community })

function Community() {
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-bold">猫咪日常</h1>
      <NewPostForm />
      <PostList />
    </section>
  )
}
