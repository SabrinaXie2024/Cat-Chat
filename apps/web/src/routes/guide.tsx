import { createFileRoute } from '@tanstack/react-router'
import { AlertTriangle, Lightbulb, Siren } from 'lucide-react'
import { Children, isValidElement, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import guideEn from '../content/guide.en.md?raw'
import guideZh from '../content/guide.md?raw'
import { useI18n } from '../i18n/I18nProvider'

export const Route = createFileRoute('/guide')({ component: Guide })

/**
 * Markdown conventions (see content/guide*.md):
 * - `# Title` + first paragraph → page header
 * - `## <emoji> Section` → a card and a table-of-contents entry
 * - `> 💡 …` tip, `> ⚠️ …` warning, `> 🚨 …` emergency → coloured callouts
 */
type Section = { id: string; icon: string; title: string; body: string }

const sectionId = (i: number) => `section-${i + 1}`

function parseGuide(md: string) {
  const [head = '', ...parts] = md.split(/^## /m)
  const title = head.match(/^# (.+)$/m)?.[1]?.trim() ?? ''
  const intro = head.replace(/^# .+$/m, '').trim()
  let footer = ''
  const sections: Section[] = parts.map((part, i) => {
    const nl = part.indexOf('\n')
    const heading = part.slice(0, nl).trim()
    let body = part.slice(nl + 1).trim()
    // A trailing `---` + text is the page footer (disclaimer).
    const hr = body.search(/^---$/m)
    if (hr >= 0 && i === parts.length - 1) {
      footer = body.slice(hr + 3).trim()
      body = body.slice(0, hr).trim()
    }
    const [icon = '', ...rest] = heading.split(' ')
    const hasIcon = !/^[\p{L}\p{N}]/u.test(icon)
    return {
      id: sectionId(i),
      icon: hasIcon ? icon : '',
      title: hasIcon ? rest.join(' ') : heading,
      body,
    }
  })
  return { title, intro, sections, footer }
}

const calloutStyles = {
  '💡': {
    cls: 'border-amber-300 bg-amber-50 text-amber-950',
    Icon: Lightbulb,
    iconCls: 'text-amber-500',
  },
  '⚠️': {
    cls: 'border-orange-300 bg-orange-50 text-orange-950',
    Icon: AlertTriangle,
    iconCls: 'text-orange-500',
  },
  '🚨': { cls: 'border-red-300 bg-red-50 text-red-950', Icon: Siren, iconCls: 'text-red-500' },
} as const

/** Plain text of a React subtree (to detect a callout's leading emoji). */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)
  return ''
}

/** Removes the leading emoji (+ space) from the first text node. */
function stripLead(node: ReactNode, lead: string): ReactNode {
  let done = false
  const walk = (n: ReactNode): ReactNode => {
    if (done) return n
    if (typeof n === 'string') {
      done = true
      return n.startsWith(lead) ? n.slice(lead.length).trimStart() : n
    }
    if (isValidElement<{ children?: ReactNode }>(n)) {
      return { ...n, props: { ...n.props, children: Children.map(n.props.children, walk) } }
    }
    return n
  }
  return Children.map(node, walk)
}

const components: Components = {
  p: ({ children }) => <p className="leading-relaxed">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-stone-900">{children}</strong>,
  ul: ({ children }) => <ul className="space-y-1.5">{children}</ul>,
  li: ({ children }) => (
    <li className="relative pl-5 leading-relaxed before:absolute before:left-1 before:top-[0.6em] before:size-1.5 before:rounded-full before:bg-brand-500">
      {children}
    </li>
  ),
  blockquote: ({ children }) => {
    const text = textOf(children).trimStart()
    const lead = (Object.keys(calloutStyles) as (keyof typeof calloutStyles)[]).find((k) =>
      text.startsWith(k),
    )
    if (!lead) {
      return (
        <blockquote className="border-l-4 border-stone-200 pl-4 text-stone-600">
          {children}
        </blockquote>
      )
    }
    const { cls, Icon, iconCls } = calloutStyles[lead]
    return (
      <aside className={`flex gap-3 rounded-lg border p-4 ${cls}`}>
        <Icon className={`mt-0.5 size-5 shrink-0 ${iconCls}`} aria-hidden />
        <div className="space-y-2 [&_p]:leading-relaxed">{stripLead(children, lead)}</div>
      </aside>
    )
  },
}

function Guide() {
  const { lang } = useI18n()
  // Guide exists in zh and en; Chinese variants read zh, everyone else en.
  const { title, intro, sections, footer } = parseGuide(lang.startsWith('zh') ? guideZh : guideEn)

  return (
    <div className="space-y-8">
      <div className="space-y-3 rounded-2xl bg-gradient-to-br from-orange-100 via-brand-50 to-amber-50 p-6 sm:p-8">
        <h1 className="text-3xl font-bold text-stone-900">🐱 {title}</h1>
        <div className="max-w-2xl text-stone-700">
          <Markdown components={components}>{intro}</Markdown>
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-[13rem_1fr] lg:gap-8">
        {/* TOC: horizontal chips on small screens, sticky sidebar on large. */}
        <nav aria-label={title} className="mb-6 lg:mb-0">
          <ol className="flex gap-2 overflow-x-auto pb-2 lg:sticky lg:top-6 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
            {sections.map((s) => (
              <li key={s.id} className="shrink-0">
                <a
                  href={`#${s.id}`}
                  className="flex items-center gap-2 whitespace-nowrap rounded-full bg-white px-3 py-1.5 text-sm text-stone-700 shadow-sm hover:text-brand-700 lg:rounded-lg lg:bg-transparent lg:shadow-none lg:hover:bg-white"
                >
                  <span aria-hidden>{s.icon}</span>
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-w-0 space-y-6">
          {sections.map((s) => (
            <section
              key={s.id}
              id={s.id}
              aria-labelledby={`${s.id}-title`}
              className="scroll-mt-6 space-y-4 rounded-2xl bg-white p-5 shadow-sm sm:p-6"
            >
              <h2
                id={`${s.id}-title`}
                className="flex items-center gap-3 text-xl font-bold text-stone-900"
              >
                {s.icon && (
                  <span
                    className="grid size-10 place-items-center rounded-xl bg-brand-50 text-xl"
                    aria-hidden
                  >
                    {s.icon}
                  </span>
                )}
                {s.title}
              </h2>
              <div className="space-y-4 text-stone-700">
                <Markdown components={components}>{s.body}</Markdown>
              </div>
            </section>
          ))}
          {footer && <p className="text-center text-xs text-stone-400">{footer}</p>}
        </div>
      </div>
    </div>
  )
}
