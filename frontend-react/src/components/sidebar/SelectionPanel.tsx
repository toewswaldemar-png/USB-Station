import { useState, useEffect, useRef } from 'react'
import { Check, Minus } from 'lucide-react'
import { useSelectionStore } from '@/stores/selectionStore'
import { useFilesStore } from '@/stores/filesStore'
import { groupKey } from '@/lib/groupKey'
import type { AudioFile } from '@/types'

const DATE_RE = /^(\d{4}-\d{2}-\d{2}|\d{8}|\d{1,2}\.\d{1,2}\.\d{4})\s*/

function stripDate(s: string) {
  return s.replace(DATE_RE, '').replace(DATE_RE, '').trim() || s
}

export default function SelectionPanel() {
  const { selectedFiles, selectedFilesMeta, toggleFile } = useSelectionStore()
  const allFiles = useFilesStore(s => s.allFiles)

  // Schnell-Lookup: Pfad → AudioFile für lokale Dateien
  const localByPath = new Map(allFiles.map(f => [f.path, f]))

  // Aktive Gruppen-Keys aus allFiles (lokal) + selectedFilesMeta (Cloud)
  const activeKeys = new Set<string>()
  for (const f of allFiles) {
    if (selectedFiles.has(f.path)) activeKeys.add(groupKey(f))
  }
  for (const [path, file] of selectedFilesMeta) {
    if (selectedFiles.has(path) && !localByPath.has(path)) activeKeys.add(groupKey(file))
  }

  // Gruppen aufbauen: lokale Dateien aus allFiles, Cloud-Dateien aus selectedFilesMeta
  const grouped = new Map<string, AudioFile[]>()
  for (const f of allFiles) {
    const k = groupKey(f)
    if (!activeKeys.has(k)) continue
    if (!grouped.has(k)) grouped.set(k, [])
    grouped.get(k)!.push(f)
  }
  for (const [path, file] of selectedFilesMeta) {
    if (localByPath.has(path)) continue  // bereits via allFiles erfasst
    const k = groupKey(file)
    if (!activeKeys.has(k)) continue  // Gruppe nur zeigen wenn ≥1 Datei selektiert
    if (!grouped.has(k)) grouped.set(k, [])
    grouped.get(k)!.push(file)
  }

  const keys = [...grouped.keys()]
  const [openKey, setOpenKey] = useState<string | null>(null)
  const prevKeysRef = useRef<string[]>([])

  // Nur bei Gruppen-Änderung (neuer Chip / Gruppe weg) → zuklappen
  // Einzeldatei-Toggle innerhalb einer Gruppe lässt die Gruppe offen
  useEffect(() => {
    const prev = prevKeysRef.current
    const keysChanged = keys.length !== prev.length || keys.some(k => !prev.includes(k))
    if (keysChanged) setOpenKey(null)
    else if (openKey !== null && !keys.includes(openKey)) setOpenKey(null)
    prevKeysRef.current = keys
  })

  if (selectedFiles.size === 0) return null

  return (
    <div className="divide-y divide-gray-50">
      {keys.map(key => {
        const files = grouped.get(key)!
        const selCount = files.filter(f => selectedFiles.has(f.path)).length
        const allSel = selCount === files.length
        const someSel = selCount > 0 && !allSel
        const isOpen = openKey === key

        return (
          <div key={key}>

            {/* Gruppenheader */}
            <div
              className="flex items-center gap-2 px-3 py-1 cursor-pointer select-none hover:bg-gray-50 transition-colors"
              onClick={() => setOpenKey(isOpen ? null : key)}
            >
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: 'var(--accent)' }} />
              <span className="flex-1 text-[12px] font-semibold text-gray-900 truncate">
                {stripDate(key)}
              </span>
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-white shrink-0"
                style={{ background: 'var(--accent)' }}
              >
                {selCount}
              </span>

              {/* Checkbox ersetzt X — alle an/ab */}
              <label className="shrink-0 cursor-pointer" onClick={e => e.stopPropagation()}>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={allSel}
                  onChange={() => {
                    if (allSel) files.forEach(f => { if (selectedFiles.has(f.path)) toggleFile(f.path, f) })
                    else files.forEach(f => { if (!selectedFiles.has(f.path)) toggleFile(f.path, f) })
                  }}
                />
                <span className={`w-[15px] h-[15px] rounded-sm border flex items-center justify-center shrink-0
                  ${allSel ? 'bg-[var(--accent)] border-[var(--accent)]' : someSel ? 'bg-white border-[var(--accent)]' : 'bg-white border-gray-300'}`}>
                  {allSel && <Check size={10} className="text-white" strokeWidth={3} />}
                  {someSel && <Minus size={10} style={{ color: 'var(--accent)' }} strokeWidth={3} />}
                </span>
              </label>
            </div>

            {/* Dateiliste */}
            {isOpen && (
              <div className="bg-gray-50/60 border-t border-gray-50">
                {files.map(f => {
                  const sel = selectedFiles.has(f.path)
                  return (
                    <div
                      key={f.path}
                      className="flex items-center gap-2 pl-4 pr-3 py-0.5 hover:bg-gray-100/60 transition-colors cursor-pointer select-none"
                      onClick={() => toggleFile(f.path, f)}
                    >
                      <div className="w-1 h-1 rounded-full shrink-0 bg-gray-300" />
                      <span className={`flex-1 text-[11px] truncate transition-colors ${sel ? 'text-gray-500' : 'text-gray-300'}`}>
                        {stripDate(f.title || f.path.split('/').pop() || '')}
                      </span>
                      <span className={`w-[15px] h-[15px] rounded-sm border flex items-center justify-center shrink-0
                        ${sel ? 'bg-[var(--accent)] border-[var(--accent)]' : 'bg-white border-gray-300'}`}>
                        {sel && <Check size={10} className="text-white" strokeWidth={3} />}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

          </div>
        )
      })}
    </div>
  )
}
