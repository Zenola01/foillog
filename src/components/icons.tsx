import type { SVGProps } from 'react'

const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...props,
})

export const IconList = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 17c3-4 5-4 8 0s5 4 8 0" />
    <path d="M4 10c3-4 5-4 8 0s5 4 8 0" />
  </svg>
)
export const IconCompare = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 19c4-1 5-7 8-9s6-2 8-6" />
    <path d="M4 14c3 0 5-3 8-3s5 3 8 3" />
  </svg>
)
export const IconSettings = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
)
export const IconPaste = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="8" y="3" width="8" height="4" rx="1" />
    <path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
  </svg>
)
export const IconUpload = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 15V4" />
    <path d="m7 9 5-5 5 5" />
    <path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
  </svg>
)
export const IconPlay = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ ...p, fill: 'currentColor', stroke: 'none' })}>
    <path d="M8 5.5v13l11-6.5z" />
  </svg>
)
export const IconPause = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ ...p, fill: 'currentColor', stroke: 'none' })}>
    <rect x="6.5" y="5" width="4" height="14" rx="1" />
    <rect x="13.5" y="5" width="4" height="14" rx="1" />
  </svg>
)
export const IconBack = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="m15 18-6-6 6-6" />
  </svg>
)
export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
)
export const IconX = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)
export const IconTrash = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </svg>
)
export const IconEdit = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />
  </svg>
)
export const IconWind = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3 8h11a3 3 0 1 0-3-3" />
    <path d="M3 12h16a3 3 0 1 1-3 3" />
    <path d="M3 16h7" />
  </svg>
)

export const IconCrew = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 19c.6-3.4 3-5 6-5s5.4 1.6 6 5" />
    <circle cx="17" cy="9" r="2.6" />
    <path d="M16 14.2c2.6.2 4.4 1.8 5 4.8" />
  </svg>
)
export const IconTrophy = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M8 4h8v5a4 4 0 0 1-8 0z" />
    <path d="M8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M12 13v4M8 20h8M9.5 17h5" />
  </svg>
)
export const IconShare = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" />
    <path d="M6 12H5a1 1 0 0 0-1 1v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a1 1 0 0 0-1-1h-1" />
  </svg>
)
export const IconComment = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M5 18.5V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8.5z" />
  </svg>
)

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden="true">
      <rect width="512" height="512" rx="112" fill="#0d3b52" />
      <path d="M92 396c50-6 86-30 116-66" fill="none" stroke="#2a78d6" strokeWidth="26" strokeLinecap="round" opacity=".55" />
      <path d="M96 318c46-86 118-112 168-62s108 52 152-58" fill="none" stroke="#86b6ef" strokeWidth="34" strokeLinecap="round" />
      <circle cx="416" cy="198" r="34" fill="#ffffff" />
    </svg>
  )
}
