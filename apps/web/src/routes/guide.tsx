import { createFileRoute } from '@tanstack/react-router'
import { AlertTriangle, ArrowUp, BookOpen, Check, Lightbulb, Siren } from 'lucide-react'
import {
  Children,
  isValidElement,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import Markdown, { type Components } from 'react-markdown'
import { PageHero } from '../components/ui'
import { useScrollSpy } from '../features/guide/useScrollSpy'
import { useI18n } from '../i18n/I18nProvider'

export const Route = createFileRoute('/guide')({ component: Guide })

// One guide per UI language: content/guide.<lang>.md. Missing languages fall
// back to English.
// Lazy: each language is its own chunk, fetched only when shown.
const guides = import.meta.glob<string>('../content/guide.*.md', {
  query: '?raw',
  import: 'default',
})
const loadGuide = (lang: string) =>
  (guides[`../content/guide.${lang}.md`] ?? guides['../content/guide.en.md'])?.() ??
  Promise.resolve('')

/**
 * Markdown conventions (see content/guide*.md):
 * - `# Title` + first paragraph → page header
 * - `## Section` → a numbered card and a table-of-contents entry (plain
 *   text title, no icon)
 * - `> 💡 …` tip, `> ⚠️ …` warning, `> 🚨 …` emergency → coloured callouts
 */
type Section = { id: string; title: string; body: string }

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
    return { id: sectionId(i), title: heading, body }
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
  const { lang, t } = useI18n()
  const [markdown, setMarkdown] = useState<{ lang: string; text: string }>()
  useEffect(() => {
    let live = true
    void loadGuide(lang).then((text) => live && setMarkdown({ lang, text }))
    return () => {
      live = false
    }
  }, [lang])
  const { title, intro, sections, footer } = useMemo(
    () => parseGuide(markdown?.text ?? ''),
    [markdown],
  )
  const ids = useMemo(() => sections.map((s) => s.id), [sections])
  // Line just below the sticky header (+ mobile chip bar).
  const { active, progress } = useScrollSpy(ids, 140)
  const activeIndex = Math.max(0, ids.indexOf(active ?? ''))
  const percent = Math.round(progress * 100)

  // Keep the active chip visible in the horizontal (mobile) TOC without
  // moving the page itself.
  const chipsRef = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const list = chipsRef.current
    const chip = list?.querySelector<HTMLElement>(`[data-id="${active}"]`)
    if (!list || !chip || list.scrollWidth <= list.clientWidth) return
    list.scrollTo?.({ left: chip.offsetLeft - (list.clientWidth - chip.offsetWidth) / 2 })
  }, [active])

  return (
    <div className="space-y-8">
      {/* Reading progress across the top of the viewport. */}
      <div
        role="progressbar"
        aria-label={t('guide.progress', { percent })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="fixed inset-x-0 top-0 z-50 h-1 bg-transparent"
      >
        <div
          className="h-full bg-brand-500 transition-[width] duration-150"
          style={{ width: `${percent}%` }}
        />
      </div>

      <PageHero
        icon={BookOpen}
        title={title}
        subtitle={<Markdown components={components}>{intro}</Markdown>}
      />

      <div className="lg:grid lg:grid-cols-[15rem_1fr] lg:gap-10">
        <nav aria-label={t('guide.contents')} className="relative">
          {/* Mobile: sticky horizontal chips. */}
          <div className="sticky top-[var(--header-h)] z-20 -mx-4 mb-6 bg-cream/90 px-4 py-2 backdrop-blur lg:hidden">
            <ol ref={chipsRef} className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
              {sections.map((s, i) => {
                const current = i === activeIndex
                return (
                  <li key={s.id} data-id={s.id} className="shrink-0">
                    <a
                      href={`#${s.id}`}
                      aria-current={current ? 'location' : undefined}
                      className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm shadow-sm transition-colors ${
                        current
                          ? 'bg-brand-500 font-medium text-white'
                          : 'bg-white text-stone-600 hover:text-brand-700'
                      }`}
                    >
                      {s.title}
                    </a>
                  </li>
                )
              })}
            </ol>
          </div>

          {/* Desktop: sticky sidebar with progress. */}
          <div className="sticky top-[calc(var(--header-h)+1.5rem)] hidden rounded-2xl bg-white p-4 shadow-card ring-1 ring-stone-100 lg:block">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold tracking-wide text-stone-500 uppercase">
                {t('guide.contents')}
              </h2>
              <span className="text-xs text-stone-400">{t('guide.progress', { percent })}</span>
            </div>
            <div className="mb-3 h-1 overflow-hidden rounded-full bg-stone-100" aria-hidden>
              <div
                className="h-full rounded-full bg-brand-500 transition-[width] duration-150"
                style={{ width: `${percent}%` }}
              />
            </div>
            <ol className="space-y-0.5">
              {sections.map((s, i) => {
                const current = i === activeIndex
                const read = i < activeIndex
                return (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      aria-current={current ? 'location' : undefined}
                      className={`group relative flex items-center gap-2.5 rounded-lg py-1.5 pr-2 pl-3 text-sm transition-colors ${
                        current
                          ? 'bg-brand-50 font-medium text-brand-700'
                          : read
                            ? 'text-stone-500 hover:bg-stone-50 hover:text-stone-800'
                            : 'text-stone-600 hover:bg-stone-50 hover:text-stone-900'
                      }`}
                    >
                      <span
                        className={`absolute top-1.5 bottom-1.5 left-0 w-1 rounded-full transition-colors ${
                          current ? 'bg-brand-500' : 'bg-transparent'
                        }`}
                        aria-hidden
                      />
                      <span
                        className={`grid size-6 shrink-0 place-items-center rounded-full text-xs ${
                          current
                            ? 'bg-brand-500 text-white'
                            : read
                              ? 'bg-brand-50 text-brand-700'
                              : 'bg-stone-100 text-stone-500'
                        }`}
                        aria-hidden
                      >
                        {read ? <Check className="size-3.5" /> : i + 1}
                      </span>
                      <span className="truncate">{s.title}</span>
                    </a>
                  </li>
                )
              })}
            </ol>
          </div>
        </nav>

        <div className="min-w-0 space-y-6">
          {sections.map((s, i) => (
            <section
              key={s.id}
              id={s.id}
              aria-labelledby={`${s.id}-title`}
              className="scroll-mt-[calc(var(--header-h)+4rem)] space-y-4 rounded-2xl bg-white p-5 shadow-card ring-1 ring-stone-100 sm:p-7 lg:scroll-mt-[calc(var(--header-h)+1.5rem)]"
            >
              <div>
                <p className="text-xs font-medium tracking-wide text-brand-700/70">
                  {t('guide.section', { n: String(i + 1).padStart(2, '0') })}
                </p>
                <h2 id={`${s.id}-title`} className="text-xl font-bold text-stone-900 sm:text-2xl">
                  {s.title}
                </h2>
              </div>
              <div className="space-y-4 text-[15px] text-stone-700 sm:text-base">
                <Markdown components={components}>{s.body}</Markdown>
              </div>
            </section>
          ))}
          {footer && <p className="pt-2 text-center text-xs text-stone-400">{footer}</p>}
        </div>
      </div>

      {progress > 0.08 && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0 })}
          aria-label={t('guide.backToTop')}
          title={t('guide.backToTop')}
          className="fixed right-5 bottom-5 z-30 grid size-11 place-items-center rounded-full bg-white text-brand-700 shadow-lg ring-1 ring-stone-200 transition hover:bg-brand-500 hover:text-white"
        >
          <ArrowUp className="size-5" aria-hidden />
        </button>
      )}
    </div>
  )
}
