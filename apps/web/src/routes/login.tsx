import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { AuthCard } from '../features/auth/AuthCard'
import { LoginForm } from '../features/auth/LoginForm'
import { safeRedirect } from '../features/auth/useCurrentUser'

export const Route = createFileRoute('/login')({
  validateSearch: (s: Record<string, unknown>) => ({ redirect: safeRedirect(s.redirect) }),
  component: LoginPage,
})

function LoginPage() {
  const { redirect } = Route.useSearch()
  const router = useRouter()
  return (
    <AuthCard title="登录">
      <LoginForm onSuccess={() => router.history.push(redirect ?? '/community')} />
      <p className="text-center text-sm text-stone-500">
        还没有账号？
        <Link to="/register" search={{ redirect }} className="text-brand-700 hover:underline">
          注册
        </Link>
      </p>
    </AuthCard>
  )
}
