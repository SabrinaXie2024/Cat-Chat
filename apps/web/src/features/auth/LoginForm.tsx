import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useLogin } from '../../api/generated/auth/auth'
import type { User } from '../../api/generated/model'
import { errorMessage } from '../../api/http'
import { Field, inputClass, submitClass } from './AuthCard'
import { meQueryKey } from './useCurrentUser'

const schema = z.object({
  email: z.email('请输入有效的邮箱'),
  password: z.string().min(1, '请输入密码'),
})
type Values = z.infer<typeof schema>

export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const qc = useQueryClient()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  })
  const login = useLogin({
    mutation: {
      onSuccess: (res) => {
        qc.setQueryData(meQueryKey, res.data as User)
        onSuccess()
      },
    },
  })
  const { errors } = form.formState

  return (
    <form
      onSubmit={form.handleSubmit((data) => login.mutate({ data }))}
      className="space-y-4"
      noValidate
    >
      <Field id="email" label="邮箱" error={errors.email?.message}>
        <input
          id="email"
          type="email"
          autoComplete="email"
          className={inputClass}
          {...form.register('email')}
        />
      </Field>
      <Field id="password" label="密码" error={errors.password?.message}>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          className={inputClass}
          {...form.register('password')}
        />
      </Field>
      {login.error && (
        <p role="alert" className="text-sm text-red-600">
          {loginErrorText(login.error)}
        </p>
      )}
      <button type="submit" disabled={login.isPending} className={submitClass}>
        登录
      </button>
    </form>
  )
}

function loginErrorText(err: unknown) {
  const msg = errorMessage(err)
  if (msg.startsWith('incorrect')) return '邮箱或密码错误'
  if (msg.startsWith('too many')) return '失败次数太多，请 15 分钟后再试'
  return msg
}
