import { useId } from 'react'
import { Avatar } from '../api/generated/model'

/** Every preset, in picker order (custom uploads aren't allowed). */
export const AVATARS = Object.values(Avatar)

type Look = {
  bg: string
  fur: string
  outline?: string
  ear: string
  eye: string
  nose: string
  /** Extra shapes drawn on the face, clipped to the head. */
  marks?: (dark: string) => React.ReactNode
  mark: string
}

const stripes = (c: string) => (
  <g stroke={c} strokeWidth="2.6" strokeLinecap="round" fill="none">
    <path d="M32 22v6M26 23l1.5 5M38 23l-1.5 5" />
    <path d="M12 38h6M12 43h5M52 38h-6M52 43h-5" />
  </g>
)

const LOOKS: Record<Avatar, Look> = {
  orange: {
    bg: '#fff1e0',
    fur: '#f59e42',
    ear: '#fbcfa0',
    eye: '#3f6212',
    nose: '#e86a6a',
    mark: '#d9741c',
    marks: stripes,
  },
  black: {
    bg: '#ede9fe',
    fur: '#2e2a33',
    ear: '#5b4f63',
    eye: '#facc15',
    nose: '#8b6f7d',
    mark: '',
  },
  white: {
    bg: '#e0f2fe',
    fur: '#fdfcfa',
    outline: '#d6d3d1',
    ear: '#fbcfe8',
    eye: '#38bdf8',
    nose: '#f472b6',
    mark: '',
  },
  gray: {
    bg: '#f1f5f9',
    fur: '#9ca3af',
    ear: '#e5c4cf',
    eye: '#65a30d',
    nose: '#db7093',
    mark: '',
  },
  calico: {
    bg: '#fef3c7',
    fur: '#fdfcfa',
    outline: '#e7e5e4',
    ear: '#fbcfe8',
    eye: '#a16207',
    nose: '#f472b6',
    mark: '',
    marks: () => (
      <>
        <ellipse cx="18" cy="26" rx="14" ry="12" fill="#f59e42" />
        <ellipse cx="48" cy="28" rx="11" ry="10" fill="#2e2a33" />
      </>
    ),
  },
  siamese: {
    bg: '#e0f2fe',
    fur: '#f3e5c8',
    ear: '#6b4f3a',
    eye: '#2563eb',
    nose: '#3b2a1f',
    mark: '#6b4f3a',
    marks: (c) => <ellipse cx="32" cy="45" rx="11" ry="9" fill={c} opacity="0.85" />,
  },
  tuxedo: {
    bg: '#dcfce7',
    fur: '#2e2a33',
    ear: '#5b4f63',
    eye: '#a3e635',
    nose: '#f9a8d4',
    mark: '#fdfcfa',
    marks: (c) => (
      <>
        <path d="M32 30 L24 56 H40 Z" fill={c} />
        <ellipse cx="32" cy="47" rx="10" ry="7" fill={c} />
      </>
    ),
  },
  tabby: {
    bg: '#f5ecdf',
    fur: '#a8875f',
    ear: '#e7c9a9',
    eye: '#4d7c0f',
    nose: '#c2566a',
    mark: '#6e5232',
    marks: stripes,
  },
  silver: {
    bg: '#eef2f6',
    fur: '#cbd2da',
    ear: '#ead0d6',
    eye: '#15803d',
    nose: '#d97b8f',
    mark: '#7b8490',
    marks: stripes,
  },
  tortie: {
    bg: '#f6e7da',
    fur: '#3a2e2a',
    ear: '#6b5248',
    eye: '#eab308',
    nose: '#a8606c',
    mark: '',
    marks: () => (
      <>
        <ellipse cx="18" cy="30" rx="10" ry="9" fill="#c26b2e" />
        <ellipse cx="45" cy="25" rx="7" ry="6" fill="#e3a15a" />
        <ellipse cx="47" cy="46" rx="8" ry="7" fill="#c26b2e" />
        <ellipse cx="24" cy="51" rx="6" ry="5" fill="#e3a15a" />
      </>
    ),
  },
  cream: {
    bg: '#fff7e6',
    fur: '#f3dcb3',
    ear: '#f7ccb4',
    eye: '#b45309',
    nose: '#e08a8a',
    mark: '#e0b981',
    marks: stripes,
  },
  'orange-white': {
    bg: '#fff1e0',
    fur: '#f59e42',
    ear: '#fbcfa0',
    eye: '#3f6212',
    nose: '#e86a6a',
    mark: '#fdfcfa',
    marks: (c) => (
      <>
        <path d="M32 24 L26 44 H38 Z" fill={c} />
        <ellipse cx="32" cy="48" rx="11" ry="8" fill={c} />
      </>
    ),
  },
  // 狸花 (Dragon Li): warm brown-grey coat, bold black mackerel stripes with
  // the forehead "M", pale muzzle, yellow-green eyes.
  lihua: {
    bg: '#eef3e2',
    fur: '#b09468',
    ear: '#d9b99a',
    eye: '#a3b81a',
    nose: '#a8606c',
    mark: '#2b2622',
    marks: (c) => (
      <>
        <ellipse cx="32" cy="47" rx="10" ry="7" fill="#efe4d0" />
        <g stroke={c} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d="M25 28l2.5-5 4.5 5 4.5-5 2.5 5" />
          <path d="M32 18v4M27 19l1 3M37 19l-1 3" />
          <path d="M12 35l7 1M12 40l6 0.5M13 45l5-1M52 35l-7 1M52 40l-6 0.5M51 45l-5-1" />
          <path d="M28.5 40.5l-2.5 2M35.5 40.5l2.5 2" strokeWidth="1.6" />
        </g>
      </>
    ),
  },
}

const SIZES = { sm: 'size-7', md: 'size-10', lg: 'size-20 sm:size-24' } as const

/**
 * One of the preset cat faces. Decorative by default (the name is shown
 * next to it); pass `label` when the avatar stands alone.
 */
export function CatAvatar({
  avatar,
  size = 'md',
  label,
  className = '',
}: {
  avatar: Avatar
  size?: keyof typeof SIZES
  label?: string
  className?: string
}) {
  const clip = useId()
  const look = LOOKS[avatar] ?? LOOKS.orange
  const stroke = look.outline ?? 'none'
  const head = 'M32 18c11 0 20 7 20 19s-9 19-20 19-20-7-20-19 9-19 20-19Z'
  return (
    <svg
      viewBox="0 0 64 64"
      className={`shrink-0 rounded-full ${SIZES[size]} ${className}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle cx="32" cy="32" r="32" fill={look.bg} />
      {/* ears */}
      <path d="M13 32 15 9l16 12Z" fill={look.fur} stroke={stroke} strokeLinejoin="round" />
      <path d="M51 32 49 9 33 21Z" fill={look.fur} stroke={stroke} strokeLinejoin="round" />
      <path d="M17 26 18 15l8 7Z" fill={look.ear} />
      <path d="M47 26 46 15l-8 7Z" fill={look.ear} />
      <clipPath id={clip}>
        <path d={head} />
      </clipPath>
      <path d={head} fill={look.fur} stroke={stroke} />
      {look.marks && <g clipPath={`url(#${clip})`}>{look.marks(look.mark)}</g>}
      {/* eyes */}
      <ellipse cx="24.5" cy="37" rx="3.2" ry="4" fill={look.eye} />
      <ellipse cx="39.5" cy="37" rx="3.2" ry="4" fill={look.eye} />
      <ellipse cx="24.5" cy="37.5" rx="1.2" ry="3" fill="#1c1917" />
      <ellipse cx="39.5" cy="37.5" rx="1.2" ry="3" fill="#1c1917" />
      <circle cx="25.6" cy="35.4" r="0.9" fill="#fff" />
      <circle cx="40.6" cy="35.4" r="0.9" fill="#fff" />
      {/* nose + mouth */}
      <path d="M29.5 43h5L32 46Z" fill={look.nose} />
      <path
        d="M32 46c0 2-1.5 3-3.5 3M32 46c0 2 1.5 3 3.5 3"
        stroke="#57534e"
        strokeWidth="1.2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}
