import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { AuthCard } from '../features/auth/AuthCard'
import { RegisterForm } from '../features/auth/RegisterForm'
import { safeRedirect } from '../features/auth/useCurrentUser'

export const Route = createFileRoute('/register')({
  validateSearch: (s: Record<string, unknown>) => ({ redirect: safeRedirect(s.redirect) }),
  component: RegisterPage,
})

function RegisterPage() {
  const { redirect } = Route.useSearch()
  const router = useRouter()
  return (
    <AuthCard title="注册">
      <RegisterForm onSuccess={() => router.history.push(redirect ?? '/community')} />
      <p className="text-center text-sm text-stone-500">
        已有账号？
        <Link to="/login" search={{ redirect }} className="text-brand-700 hover:underline">
          登录
        </Link>
      </p>
    </AuthCard>
  )
}
