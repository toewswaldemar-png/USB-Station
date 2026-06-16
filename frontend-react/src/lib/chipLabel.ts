const DATE_RE = /^(\d{4}-\d{2}-\d{2}|\d{8}|\d{1,2}\.\d{1,2}\.\d{4})\s*/
const DAYPART_RE = /\b(vormittag|nachmittag)\b/i

export function stripDate(s: string): string {
  return s.replace(DATE_RE, '').replace(DATE_RE, '').trim() || s
}

// Titel (erstes Wort) + Untertitel (Rest), ohne Datum und ohne "Vormittag"/"Nachmittag"
// (dient nur der Platzierung im Kalender, siehe CalendarDay.tsx).
export function splitChipLabel(raw: string): { title: string; subtitle: string } {
  const withoutDate = stripDate(raw)
  const cleaned = withoutDate.replace(DAYPART_RE, '').replace(/\s+/g, ' ').trim() || withoutDate
  const [title, ...rest] = cleaned.split(' ')
  return { title, subtitle: rest.join(' ') }
}
