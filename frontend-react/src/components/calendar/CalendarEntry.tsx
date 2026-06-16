import type { AudioFile, ColorPreset } from '@/types'
import { splitChipLabel } from '@/lib/chipLabel'

// cqh = % der tatsächlichen Chip-Höhe (Container Query Units) statt Viewport-Höhe —
// dadurch füllt die Schrift den Chip proportional, ohne dass oben/unten ungenutzter
// Raum entsteht, wenn die Zelle wächst (z.B. Vollbild via F11). Container wird in
// CalendarDay.tsx per `containerType: 'size'` auf dem Chip-Wrapper-Div gesetzt.
const SIZE_TEXT: Record<string, string> = {
  sm: 'clamp(9px, 26cqh, 16px)',
  md: 'clamp(10px, 30cqh, 18px)',
  lg: 'clamp(11px, 34cqh, 20px)',
}

interface Props {
  label: string
  files?: AudioFile[]
  status?: 'none' | 'partial' | 'full'
  size: 'sm' | 'md' | 'lg'
  compact: boolean
  bold: boolean
  ghost?: boolean
  chipStyle?: 'bar' | 'flat'
  color?: ColorPreset
  onClick?: () => void
}

export default function CalendarEntry({ label, files, status = 'none', size, bold, ghost, chipStyle = 'bar', color, onClick }: Props) {
  const { title: chipTitle, subtitle: chipSubtitle } = splitChipLabel(label)
  const displayLabel = chipSubtitle ? `${chipTitle} ${chipSubtitle}` : chipTitle

  const accent = color?.accent ?? 'var(--accent)'
  const light = color?.light ?? 'var(--accent-l)'
  const xlight = color?.xlight ?? 'var(--accent-xl)'

  const flatStyle: Record<string, React.CSSProperties> = {
    none:    { background: light, color: '#374151' },
    partial: { background: light, color: `color-mix(in srgb, ${accent} 85%, #000)`, outline: `1.5px solid ${accent}`, outlineOffset: '-1.5px' },
    full:    { background: accent, color: '#fff' },
  }

  const barStyle: Record<string, React.CSSProperties> = {
    none:    { background: xlight, borderLeft: `3px solid color-mix(in srgb, ${accent} 50%, transparent)`, borderRadius: '0 6px 6px 0', color: '#6b7280' },
    partial: { background: light,  borderLeft: `3px solid ${accent}`, borderRadius: '0 6px 6px 0', color: `color-mix(in srgb, ${accent} 85%, #000)` },
    full:    { background: accent,    borderLeft: `3px solid color-mix(in srgb, ${accent} 80%, #000)`, borderRadius: '0 6px 6px 0', color: '#fff' },
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
        flex flex-col justify-center
        ${chipStyle === 'bar' ? '' : 'rounded-md'}
        ${bold ? 'font-semibold' : 'font-medium'}
        ${ghost ? 'cursor-default' : 'cursor-pointer transition-colors'}
      `}
      style={{ ...activeStyle, fontSize: SIZE_TEXT[size] }}
      title={ghost ? displayLabel : `${displayLabel} (${files?.length ?? 0})`}
      onClick={ghost ? undefined : onClick}
    >
      <span className="truncate block">{chipTitle}</span>
      {chipSubtitle && <span className="truncate block text-[0.85em] opacity-70 font-normal">{chipSubtitle}</span>}
    </button>
  )
}
