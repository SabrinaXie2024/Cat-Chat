import { type LucideIcon, PawPrint } from 'lucide-react'
import type { ReactNode } from 'react'

/*
 * Shared UI building blocks so every page shares one visual language
 * (introduced with the care guide). Prefer these over one-off classes.
 */

/** Gradient page hero: icon badge, title, optional subtitle and actions. */
export function PageHero({
  icon: Icon,
  title,
  subtitle,
  children,
  size = 'md',
}: {
  icon: LucideIcon
  title: string
  subtitle?: ReactNode
  children?: ReactNode
  size?: 'md' | 'lg'
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-100 via-brand-50 to-amber-50 ring-1 ring-brand-100 ${
        size === 'lg' ? 'p-7 sm:p-12' : 'p-6 sm:p-8'
      }`}
    >
      <PawPrint
        className="pointer-events-none absolute -right-6 -bottom-8 size-44 rotate-12 text-brand-500 opacity-[0.07]"
        aria-hidden
      />
      <div className="relative flex items-start gap-4">
        <span
          className={`grid shrink-0 place-items-center rounded-2xl bg-white/80 text-brand-600 shadow-card ${
            size === 'lg' ? 'size-16' : 'size-12 sm:size-14'
          }`}
          aria-hidden
        >
          <Icon className={size === 'lg' ? 'size-8' : 'size-6 sm:size-7'} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 space-y-2">
          <h1
            className={`font-bold tracking-tight text-stone-900 ${
              size === 'lg' ? 'text-3xl sm:text-5xl' : 'text-2xl sm:text-3xl'
            }`}
          >
            {title}
          </h1>
          {subtitle && <div className="max-w-2xl text-stone-600 sm:text-lg">{subtitle}</div>}
        </div>
      </div>
      {children && <div className="relative mt-6">{children}</div>}
    </div>
  )
}

/** White content card. */
export function Card({
  children,
  className = '',
  as: Tag = 'div',
  ...rest
}: {
  children: ReactNode
  className?: string
  as?: 'div' | 'section' | 'li' | 'article' | 'form'
} & Record<string, unknown>) {
  return (
    <Tag
      className={`rounded-2xl bg-white p-5 shadow-card ring-1 ring-stone-100 sm:p-6 ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  )
}

/** Section heading inside a card. */
export function CardTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="text-lg font-semibold text-stone-900">
      {children}
    </h2>
  )
}

const buttonBase =
  'inline-flex items-center justify-center gap-1.5 rounded-xl font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'

export const buttonClass = {
  primary: `${buttonBase} bg-brand-500 px-4 py-2 text-white shadow-sm hover:bg-brand-600 active:bg-brand-700`,
  secondary: `${buttonBase} bg-white px-4 py-2 text-stone-700 ring-1 ring-stone-200 hover:bg-stone-50`,
  ghost: `${buttonBase} px-2.5 py-1.5 text-sm text-stone-500 hover:bg-stone-100 hover:text-stone-800`,
  link: 'font-medium text-brand-700 underline-offset-2 hover:underline',
} as const

export const inputClass =
  'w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-stone-900 placeholder:text-stone-400 transition-colors focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100'

/** First visible character as a coloured avatar (no profile photos yet). */
export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const palette = [
    'bg-orange-100 text-orange-700',
    'bg-amber-100 text-amber-700',
    'bg-rose-100 text-rose-700',
    'bg-lime-100 text-lime-700',
    'bg-sky-100 text-sky-700',
    'bg-violet-100 text-violet-700',
  ]
  let h = 0
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  const initial = [...name.trim()][0]?.toUpperCase() ?? '?'
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full font-semibold ${palette[h % palette.length]} ${
        size === 'sm' ? 'size-7 text-xs' : 'size-10 text-base'
      }`}
      aria-hidden
    >
      {initial}
    </span>
  )
}

/** Friendly empty state. */
export function EmptyState({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-brand-200 bg-white/60 px-6 py-12 text-center text-stone-500">
      <Icon className="mx-auto mb-3 size-10 text-brand-300" strokeWidth={1.5} aria-hidden />
      {children}
    </div>
  )
}
