import type { AudioFile } from '@/types'

const SIZE_TEXT: Record<string, string> = { sm: 'text-[10px]', md: 'text-xs', lg: 'text-sm' }

interface Props {
  label: string
  files: AudioFile[]
  status: 'none' | 'partial' | 'full'
  size: 'sm' | 'md' | 'lg'
  compact: boolean
  bold: boolean
  animClass: string
  animDur: string
  onClick: () => void
}

export default function CalendarEntry({ label, files, status, size, bold, animClass, animDur, onClick }: Props) {
  const DATE_RE = /^(\d{4}-\d{2}-\d{2}|\d{8}|\d{1,2}\.\d{1,2}\.\d{4})\s*/
  const displayLabel = label.replace(DATE_RE, '').replace(DATE_RE, '').trim() || label

  const entryStyle: Record<string, React.CSSProperties> = {
    none:    { background: 'var(--accent-l)', color: '#555' },
    partial: { background: 'color-mix(in srgb, var(--accent) 65%, transparent)', color: '#fff' },
    full:    { background: 'var(--accent)',   color: '#fff' },
  }

  return (
    <button
      className={`
        w-full h-full rounded-md px-2 text-left leading-tight cursor-pointer transition-colors
        flex items-center
        ${SIZE_TEXT[size]}
        ${bold ? 'font-semibold' : 'font-medium'}
        ${animClass}
      `}
      style={{ '--cal-dur': animDur, ...entryStyle[status] } as React.CSSProperties}
      title={`${displayLabel} (${files.length})`}
      onClick={onClick}
    >
      <span className="truncate block">{displayLabel}</span>
    </button>
  )
}
