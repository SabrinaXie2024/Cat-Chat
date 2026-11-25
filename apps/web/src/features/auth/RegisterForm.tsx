import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useRegister } from '../../api/generated/auth/auth'
import type { User } from '../../api/generated/model'
import { errorMessage } from '../../api/http'
import { charCount } from '../../lib/limits'
import { Field, inputClass, submitClass } from './AuthCard'
import { meQueryKey } from './useCurrentUser'

// Must match apps/api/internal/api/auth.go.
const schema = z
  .object({
    email: z.email('请输入有效的邮箱'),
    nickname: z
      .string()
      .refine((s) => charCount(s) >= 1, '请输入昵称')
      .refine((s) => charCount(s) <= 20, '昵称最多 20 个字'),
    password: z.string().min(8, '密码至少 8 位').max(128, '密码最多 128 位'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: '两次输入的密码不一致' })
type Values = z.infer<typeof schema>

export function RegisterForm({ onSuccess }: { onSuccess: () => void }) {
  const qc = useQueryClient()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', nickname: '', password: '', confirm: '' },
  })
  const register = useRegister({
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
      onSubmit={form.handleSubmit(({ email, nickname, password }) =>
        register.mutate({ data: { email, nickname: nickname.trim(), password } }),
      )}
      className="space-y-4"
      noValidate
    >
      {/* Nickname first: password managers treat the field right before the
          password as the username when hints are missing. The email is the
          login identifier, so it must be `autocomplete="username"` and sit
          directly above the password. */}
      <Field id="nickname" label="昵称" error={errors.nickname?.message}>
        <input
          id="nickname"
          autoComplete="nickname"
          className={inputClass}
          {...form.register('nickname')}
        />
      </Field>
      <Field id="email" label="邮箱" error={errors.email?.message}>
        <input
          id="email"
          type="email"
          autoComplete="username"
          className={inputClass}
          {...form.register('email')}
        />
      </Field>
      <Field id="password" label="密码（至少 8 位）" error={errors.password?.message}>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          className={inputClass}
          {...form.register('password')}
        />
      </Field>
      <Field id="confirm" label="确认密码" error={errors.confirm?.message}>
        <input
          id="confirm"
          type="password"
          autoComplete="new-password"
          className={inputClass}
          {...form.register('confirm')}
        />
      </Field>
      {register.error && (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage(register.error).includes('already registered')
            ? '这个邮箱已经注册过了'
            : errorMessage(register.error)}
        </p>
      )}
      <button type="submit" disabled={register.isPending} className={submitClass}>
        注册
      </button>
    </form>
  )
}
