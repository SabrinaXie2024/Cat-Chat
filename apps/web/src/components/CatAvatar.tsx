import { useId } from 'react'
import type {
  Avatar,
  AvatarBreed,
  AvatarCoat,
  AvatarEyes,
  AvatarPattern,
} from '../api/generated/model'

/*
 * Cat faces assembled from preset parts: breed (head/ear shape), coat
 * colour, pattern and eyes. Users can't upload pictures; every combination
 * of these parts is a valid avatar (the API and the DB CHECK agree).
 */

export const BREEDS: AvatarBreed[] = ['shorthair', 'fold', 'longhair', 'maine']
export const COATS: AvatarCoat[] = ['orange', 'cream', 'brown', 'gray', 'silver', 'black', 'white']
export const PATTERNS: AvatarPattern[] = [
  'solid',
  'tabby',
  'mackerel',
  'bicolor',
  'patches',
  'pointed',
]
export const EYES: AvatarEyes[] = ['green', 'yellow', 'blue', 'amber', 'odd']

const look = (
  coat: AvatarCoat,
  pattern: AvatarPattern,
  eyes: AvatarEyes,
  breed: AvatarBreed = 'shorthair',
): Avatar => ({ breed, coat, pattern, eyes })

/** The classic one-click looks (names: `avatar.<key>` in i18n). */
export const AVATAR_PRESETS = {
  orange: look('orange', 'tabby', 'green'),
  black: look('black', 'solid', 'yellow'),
  white: look('white', 'solid', 'blue'),
  gray: look('gray', 'solid', 'green'),
  calico: look('white', 'patches', 'amber'),
  siamese: look('cream', 'pointed', 'blue'),
  tuxedo: look('black', 'bicolor', 'green'),
  tabby: look('brown', 'tabby', 'green'),
  silver: look('silver', 'tabby', 'green'),
  tortie: look('black', 'patches', 'yellow'),
  cream: look('cream', 'tabby', 'amber'),
  'orange-white': look('orange', 'bicolor', 'green'),
  lihua: look('brown', 'mackerel', 'green'),
} satisfies Record<string, Avatar>

export type PresetName = keyof typeof AVATAR_PRESETS
export const PRESET_NAMES = Object.keys(AVATAR_PRESETS) as PresetName[]
export const DEFAULT_AVATAR: Avatar = AVATAR_PRESETS.orange

export const sameAvatar = (a: Avatar, b: Avatar) =>
  a.breed === b.breed && a.coat === b.coat && a.pattern === b.pattern && a.eyes === b.eyes

type Palette = {
  bg: string
  fur: string
  mark: string
  ear: string
  nose: string
  outline?: string
}

const COAT: Record<AvatarCoat, Palette> = {
  orange: { bg: '#fff1e0', fur: '#f59e42', mark: '#d9741c', ear: '#fbcfa0', nose: '#e86a6a' },
  cream: { bg: '#fff7e6', fur: '#f3dcb3', mark: '#d9b27a', ear: '#f7ccb4', nose: '#e08a8a' },
  brown: { bg: '#f5ecdf', fur: '#a8875f', mark: '#5e4630', ear: '#e7c9a9', nose: '#c2566a' },
  gray: { bg: '#f1f5f9', fur: '#9ca3af', mark: '#6b7280', ear: '#e5c4cf', nose: '#db7093' },
  silver: { bg: '#eef2f6', fur: '#cbd2da', mark: '#7b8490', ear: '#ead0d6', nose: '#d97b8f' },
  black: { bg: '#ede9fe', fur: '#2e2a33', mark: '#4a4450', ear: '#5b4f63', nose: '#8b6f7d' },
  white: {
    bg: '#e0f2fe',
    fur: '#fdfcfa',
    mark: '#e7e5e4',
    ear: '#fbcfe8',
    nose: '#f472b6',
    outline: '#d6d3d1',
  },
}

const EYE: Record<AvatarEyes, [left: string, right: string]> = {
  green: ['#4d7c0f', '#4d7c0f'],
  yellow: ['#eab308', '#eab308'],
  blue: ['#38bdf8', '#38bdf8'],
  amber: ['#d97706', '#d97706'],
  odd: ['#38bdf8', '#eab308'],
}

/** Darker "point" colour for pointed (Siamese-style) cats. */
const POINT: Record<AvatarCoat, string> = {
  orange: '#b4541a',
  cream: '#6b4f3a',
  brown: '#3b2a1f',
  gray: '#4b5563',
  silver: '#5b6470',
  black: '#17141a',
  white: '#a8a29e',
}

const WHITE = '#fdfcfa'

const HEAD = 'M32 18c11 0 20 7 20 19s-9 19-20 19-20-7-20-19 9-19 20-19Z'

function Ears({
  breed,
  fur,
  inner,
  stroke,
}: {
  breed: AvatarBreed
  fur: string
  inner: string
  stroke: string
}) {
  const common = { stroke, strokeLinejoin: 'round' as const }
  switch (breed) {
    case 'fold':
      // Drawn over the head instead (FoldEars), so nothing behind it.
      return null
    case 'maine':
      // Tall ears with lynx tufts.
      return (
        <>
          <path d="M13 32 14 5l17 15Z" fill={fur} {...common} />
          <path d="M51 32 50 5 33 20Z" fill={fur} {...common} />
          <path d="M17 25 17.5 12l8 8Z" fill={inner} />
          <path d="M47 25 46.5 12l-8 8Z" fill={inner} />
          <g stroke={fur} strokeWidth="1.6" strokeLinecap="round">
            <path d="M14 5l-1-3M14 5l1.5-3M50 5l1-3M50 5l-1.5-3" />
          </g>
        </>
      )
    case 'longhair':
      // Smaller, rounder ears half hidden in the fur.
      return (
        <>
          <path d="M14 30 17 13l13 10Z" fill={fur} {...common} />
          <path d="M50 30 47 13 34 23Z" fill={fur} {...common} />
          <path d="M18 25 19.5 17l6 5Z" fill={inner} />
          <path d="M46 25 44.5 17l-6 5Z" fill={inner} />
        </>
      )
    default:
      return (
        <>
          <path d="M13 32 15 9l16 12Z" fill={fur} {...common} />
          <path d="M51 32 49 9 33 21Z" fill={fur} {...common} />
          <path d="M17 26 18 15l8 7Z" fill={inner} />
          <path d="M47 26 46 15l-8 7Z" fill={inner} />
        </>
      )
  }
}

/** Scottish-fold ears: small flaps folded forward on top of the head. */
function FoldEars({ fur, line }: { fur: string; line: string }) {
  const common = { fill: fur, stroke: line, strokeWidth: 1.4, strokeLinejoin: 'round' as const }
  return (
    <>
      <path d="M15 27c1-6 5-9 12-9-1 4-5 8-12 9Z" {...common} />
      <path d="M49 27c-1-6-5-9-12-9 1 4 5 8 12 9Z" {...common} />
    </>
  )
}

/** Fluffy ruff behind the head for long-haired breeds. */
function Ruff({ fur, stroke }: { fur: string; stroke: string }) {
  return (
    <path
      d="M32 20 37 17 41 21 46 19 48 25 53 26 52 32 57 36 53 40 56 46 50 48 50 54 44 54 41 59 36 56 32 60 28 56 23 59 20 54 14 54 14 48 8 46 11 40 7 36 12 32 11 26 16 25 18 19 23 21 27 17Z"
      fill={fur}
      stroke={stroke}
      strokeLinejoin="round"
    />
  )
}

function Marks({ pattern, coat, p }: { pattern: AvatarPattern; coat: AvatarCoat; p: Palette }) {
  switch (pattern) {
    case 'tabby':
      return (
        <g stroke={p.mark} strokeWidth="2.6" strokeLinecap="round" fill="none">
          <path d="M32 22v6M26 23l1.5 5M38 23l-1.5 5" />
          <path d="M12 38h6M12 43h5M52 38h-6M52 43h-5" />
        </g>
      )
    case 'mackerel': {
      // Bold dark stripes with the forehead "M" and a pale muzzle (狸花).
      const dark = coat === 'black' ? '#0c0a0e' : '#2b2622'
      return (
        <>
          <ellipse
            cx="32"
            cy="47"
            rx="10"
            ry="7"
            fill="#efe4d0"
            opacity={coat === 'black' ? 0.25 : 1}
          />
          <g
            stroke={dark}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          >
            <path d="M25 28l2.5-5 4.5 5 4.5-5 2.5 5" />
            <path d="M32 18v4M27 19l1 3M37 19l-1 3" />
            <path d="M12 35l7 1M12 40l6 0.5M13 45l5-1M52 35l-7 1M52 40l-6 0.5M51 45l-5-1" />
          </g>
        </>
      )
    }
    case 'bicolor': {
      const c = coat === 'white' ? '#57534e' : WHITE
      return (
        <>
          <path d="M32 26 L25 46 H39 Z" fill={c} />
          <ellipse cx="32" cy="48" rx="11" ry="8" fill={c} />
        </>
      )
    }
    case 'patches': {
      // White → calico (orange + black); dark → tortie (orange + cream);
      // light → white + darker patches.
      const [a, b] =
        coat === 'white'
          ? ['#f59e42', '#2e2a33']
          : coat === 'black' || coat === 'brown'
            ? ['#c26b2e', '#e3a15a']
            : [WHITE, p.mark]
      return (
        <>
          <ellipse cx="18" cy="27" rx="12" ry="10" fill={a} />
          <ellipse cx="47" cy="29" rx="9" ry="8" fill={b} />
          <ellipse cx="45" cy="49" rx="7" ry="6" fill={a} />
        </>
      )
    }
    case 'pointed':
      return <ellipse cx="32" cy="45" rx="11" ry="9" fill={POINT[coat]} opacity="0.85" />
    default:
      return null
  }
}

const SIZES = { sm: 'size-7', md: 'size-10', lg: 'size-20 sm:size-24' } as const

/**
 * A cat face drawn from an Avatar. Decorative by default (the name is shown
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
  const p = COAT[avatar.coat] ?? COAT.orange
  const stroke = p.outline ?? 'none'
  const pointed = avatar.pattern === 'pointed'
  const earFur = pointed ? POINT[avatar.coat] : p.fur
  const [eyeL, eyeR] = EYE[avatar.eyes] ?? EYE.green
  const long = avatar.breed === 'longhair' || avatar.breed === 'maine'
  return (
    <svg
      viewBox="0 0 64 64"
      className={`shrink-0 rounded-full ${SIZES[size]} ${className}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle cx="32" cy="32" r="32" fill={p.bg} />
      {long && avatar.breed === 'longhair' && <Ruff fur={p.fur} stroke={stroke} />}
      <Ears breed={avatar.breed} fur={earFur} inner={pointed ? earFur : p.ear} stroke={stroke} />
      {avatar.breed === 'maine' && (
        // Cheek tufts.
        <path d="M12 42 8 46l5 0-2 4 6-2M52 42l4 4-5 0 2 4-6-2" fill={p.fur} stroke={stroke} />
      )}
      <clipPath id={clip}>
        <path d={HEAD} />
      </clipPath>
      <path d={HEAD} fill={p.fur} stroke={stroke} />
      <g clipPath={`url(#${clip})`}>
        <Marks pattern={avatar.pattern} coat={avatar.coat} p={p} />
      </g>
      {avatar.breed === 'fold' && (
        <FoldEars fur={earFur} line={avatar.coat === 'black' ? '#6b6470' : (p.outline ?? p.mark)} />
      )}
      {/* eyes */}
      <ellipse cx="24.5" cy="37" rx="3.2" ry="4" fill={eyeL} />
      <ellipse cx="39.5" cy="37" rx="3.2" ry="4" fill={eyeR} />
      <ellipse cx="24.5" cy="37.5" rx="1.2" ry="3" fill="#1c1917" />
      <ellipse cx="39.5" cy="37.5" rx="1.2" ry="3" fill="#1c1917" />
      <circle cx="25.6" cy="35.4" r="0.9" fill="#fff" />
      <circle cx="40.6" cy="35.4" r="0.9" fill="#fff" />
      {/* nose + mouth */}
      <path d="M29.5 43h5L32 46Z" fill={pointed ? '#3b2a1f' : p.nose} />
      <path
        d="M32 46c0 2-1.5 3-3.5 3M32 46c0 2 1.5 3 3.5 3"
        stroke={avatar.coat === 'black' && !pointed ? '#a8a29e' : '#57534e'}
        strokeWidth="1.2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}
