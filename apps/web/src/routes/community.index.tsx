import { createFileRoute, Link } from '@tanstack/react-router'
import { useCurrentUser } from '../features/auth/useCurrentUser'
import { NewPostForm } from '../features/community/NewPostForm'
import { PostList } from '../features/community/PostList'

export const Route = createFileRoute('/community/')({ component: Community })

function Community() {
  const { data: user } = useCurrentUser()
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-bold">猫咪日常</h1>
      {user ? (
        <NewPostForm />
      ) : user === null ? (
        <p className="rounded-xl bg-white p-4 text-stone-600 shadow-sm">
          <Link
            to="/login"
            search={{ redirect: '/community' }}
            className="text-brand-700 hover:underline"
          >
            登录
          </Link>
          后就可以分享你的猫咪日常啦
        </p>
      ) : null}
      <PostList />
    </section>
  )
}
