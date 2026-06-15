import type { AudioFile } from '@/types'

const SIZE_TEXT: Record<string, string> = { sm: 'text-[10px]', md: 'text-xs', lg: 'text-sm' }

interface Props {
  label: string
  files?: AudioFile[]
  status?: 'none' | 'partial' | 'full'
  size: 'sm' | 'md' | 'lg'
  compact: boolean
  bold: boolean
  ghost?: boolean
  chipStyle?: 'bar' | 'flat'
  onClick?: () => void
}

export default function CalendarEntry({ label, files, status = 'none', size, bold, ghost, chipStyle = 'bar', onClick }: Props) {
  const DATE_RE = /^(\d{4}-\d{2}-\d{2}|\d{8}|\d{1,2}\.\d{1,2}\.\d{4})\s*/
  const displayLabel = label.replace(DATE_RE, '').replace(DATE_RE, '').trim() || label

  const flatStyle: Record<string, React.CSSProperties> = {
    none:    { background: 'var(--accent-l)', color: '#374151' },
    partial: { background: 'var(--accent-l)', color: 'color-mix(in srgb, var(--accent) 85%, #000)', outline: '1.5px solid var(--accent)', outlineOffset: '-1.5px' },
    full:    { background: 'var(--accent)', color: '#fff' },
  }

  const barStyle: Record<string, React.CSSProperties> = {
    none:    { background: 'var(--accent-xl)', borderLeft: '3px solid color-mix(in srgb, var(--accent) 50%, transparent)', borderRadius: '0 6px 6px 0', color: '#6b7280' },
    partial: { background: 'var(--accent-l)',  borderLeft: '3px solid var(--accent)', borderRadius: '0 6px 6px 0', color: 'color-mix(in srgb, var(--accent) 85%, #000)' },
    full:    { background: 'var(--accent)',    borderLeft: '3px solid color-mix(in srgb, var(--accent) 80%, #000)', borderRadius: '0 6px 6px 0', color: '#fff' },
  }

  const ghostStyle: React.CSSProperties = {
    background: 'transparent',
    border: '1.5px dashed color-mix(in srgb, var(--accent) 55%, transparent)',
    borderRadius: '6px',
    color: 'color-mix(in srgb, var(--accent) 60%, #6b7280)',
  }

  const activeStyle = ghost ? ghostStyle : (chipStyle === 'bar' ? barStyle[status] : flatStyle[status])

  return (
    <button
      className={`
        w-full h-full px-2 text-left leading-tight
        flex items-center
        ${chipStyle === 'bar' ? '' : 'rounded-md'}
        ${SIZE_TEXT[size]}
        ${bold ? 'font-semibold' : 'font-medium'}
        ${ghost ? 'cursor-default' : 'cursor-pointer transition-colors'}
      `}
      style={activeStyle}
      title={ghost ? displayLabel : `${displayLabel} (${files?.length ?? 0})`}
      onClick={ghost ? undefined : onClick}
    >
      <span className="truncate block">{displayLabel}</span>
    </button>
  )
}
