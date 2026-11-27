import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { buttonClass, PageHero } from '../components/ui'
import { useI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'

export const Route = createFileRoute('/')({ component: Home })

const features: {
  to: '/guide' | '/gallery' | '/community'
  icon: string
  title: MessageKey
  desc: MessageKey
  tint: string
}[] = [
  {
    to: '/guide',
    icon: '📖',
    title: 'nav.guide',
    desc: 'home.featureGuide',
    tint: 'from-amber-100 to-orange-50',
  },
  {
    to: '/gallery',
    icon: '🐈',
    title: 'nav.gallery',
    desc: 'home.featureGallery',
    tint: 'from-rose-100 to-orange-50',
  },
  {
    to: '/community',
    icon: '💬',
    title: 'nav.community',
    desc: 'home.featureCommunity',
    tint: 'from-lime-100 to-amber-50',
  },
]

function Home() {
  const { t } = useI18n()
  return (
    <div className="space-y-10">
      <PageHero icon="🐱" title={t('home.welcome')} subtitle={t('home.tagline')} size="lg">
        <div className="flex flex-wrap gap-3">
          <Link to="/community" className={`${buttonClass.primary} px-5 py-2.5`}>
            {t('home.cta')}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
          <Link to="/guide" className={`${buttonClass.secondary} px-5 py-2.5`}>
            {t('home.ctaGuide')}
          </Link>
        </div>
      </PageHero>

      <ul className="grid gap-4 sm:grid-cols-3">
        {features.map((f) => (
          <li key={f.to}>
            <Link
              to={f.to}
              className="group flex h-full flex-col gap-3 rounded-2xl bg-white p-5 shadow-card ring-1 ring-stone-100 transition hover:-translate-y-0.5 hover:shadow-lift"
            >
              <span
                className={`grid size-12 place-items-center rounded-2xl bg-gradient-to-br ${f.tint} text-2xl`}
                aria-hidden
              >
                {f.icon}
              </span>
              <span className="flex items-center gap-1 text-lg font-semibold text-stone-900">
                {t(f.title)}
                <ArrowRight
                  className="size-4 text-brand-500 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </span>
              <span className="text-sm leading-relaxed text-stone-600">{t(f.desc)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
