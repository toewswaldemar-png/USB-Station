import { useState, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useSelectionStore } from '@/stores/selectionStore'
import { useFilesStore } from '@/stores/filesStore'
import { groupKey } from '@/lib/groupKey'
import { stripDate, splitChipLabel } from '@/lib/chipLabel'
import type { AudioFile } from '@/types'

export default function SelectionPanel({ emptyLabel }: { emptyLabel?: string }) {
  const { selectedFiles, selectedFilesMeta, toggleFile } = useSelectionStore()
  const allFiles = useFilesStore(s => s.allFiles)

  const localByPath = new Map(allFiles.map(f => [f.path, f]))

  // Aktive Gruppen-Keys (haben ≥1 ausgewählte Datei)
  const activeKeys = new Set<string>()
  for (const f of allFiles) {
    if (selectedFiles.has(f.path)) activeKeys.add(groupKey(f))
  }
  for (const [path, file] of selectedFilesMeta) {
    if (selectedFiles.has(path) && !localByPath.has(path)) activeKeys.add(groupKey(file))
  }

  // pinnedKeys als Ref: synchron aktuell, kein Batch-Delay gegenüber Zustand-Updates
  const pinnedKeys = useRef(new Set<string>())
  const [visibleKeys, setVisibleKeys] = useState<string[]>([])
  const [openKey, setOpenKey] = useState<string | null>(null)

  useEffect(() => {
    setVisibleKeys(prev => {
      const toAdd = [...activeKeys].filter(k => !prev.includes(k))
      const toRemove = prev.filter(k => !activeKeys.has(k) && !pinnedKeys.current.has(k))
      if (toAdd.length === 0 && toRemove.length === 0) return prev
      return [...prev.filter(k => !toRemove.includes(k)), ...toAdd]
    })
  })

  // Akkordeon schließen wenn offene Gruppe via X entfernt wurde
  useEffect(() => {
    if (openKey !== null && !visibleKeys.includes(openKey)) setOpenKey(null)
  }, [visibleKeys, openKey])

  function getFilesForKey(k: string): AudioFile[] {
    const local = allFiles.filter(f => groupKey(f) === k)
    const cloud: AudioFile[] = []
    for (const [path, file] of selectedFilesMeta) {
      if (!localByPath.has(path) && groupKey(file) === k) cloud.push(file)
    }
    return [...local, ...cloud].sort((a, b) => a.date.localeCompare(b.date))
  }

  if (visibleKeys.length === 0) return emptyLabel
    ? <p className="px-3 py-3 text-[12px] text-gray-400 text-center">{emptyLabel}</p>
    : null

  return (
    <div className="divide-y divide-gray-50">
      {visibleKeys.map(key => {
        const files = getFilesForKey(key)
        const selCount = files.filter(f => selectedFiles.has(f.path)).length
        const allSel = files.length > 0 && selCount === files.length
        const someSel = selCount > 0 && !allSel
        const isOpen = openKey === key

        return (
          <div key={key}>

            {/* Gruppenheader */}
            <div
              className="flex items-center gap-2 pr-2 py-2.5 select-none cursor-pointer transition-all"
              style={{
                borderLeft: `3px solid ${allSel ? 'var(--accent)' : someSel ? 'var(--accent-l)' : '#e5e7eb'}`,
                paddingLeft: '9px',
              }}
              onClick={() => setOpenKey(isOpen ? null : key)}
            >
              <span className={`flex-1 min-w-0 leading-tight transition-colors ${allSel ? '' : 'text-gray-800'}`}
                style={allSel ? { color: 'var(--accent)' } : {}}>
                {(() => {
                  const { title, subtitle } = splitChipLabel(key)
                  return (
                    <>
                      <span className="block text-sm font-semibold truncate">{title}</span>
                      {subtitle && <span className="block text-[0.85em] font-normal opacity-70 truncate">{subtitle}</span>}
                    </>
                  )
                })()}
              </span>
              <span
                className="text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 cursor-pointer active:scale-90 transition-all text-white"
                style={{ background: selCount > 0 ? 'var(--accent)' : '#d1d5db' }}
                onClick={e => {
                  e.stopPropagation()
                  files.forEach(f => { if (!selectedFiles.has(f.path)) toggleFile(f.path, f) })
                }}
              >
                {selCount}
              </span>

              <button
                className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-colors"
                onClick={e => {
                  e.stopPropagation()
                  pinnedKeys.current.delete(key)
                  setVisibleKeys(prev => prev.filter(k => k !== key))
                  files.forEach(f => { if (selectedFiles.has(f.path)) toggleFile(f.path, f) })
                }}
              >
                <X size={11} strokeWidth={2.5} />
              </button>
            </div>

            {/* Dateiliste */}
            {isOpen && (
              <div className="bg-gray-50 border-t border-gray-100">
                {files.map(f => {
                  const sel = selectedFiles.has(f.path)
                  return (
                    <div
                      key={f.path}
                      className="flex items-center gap-2.5 pr-3 py-2 cursor-pointer select-none transition-colors hover:bg-gray-100/60"
                      style={{ paddingLeft: '18px' }}
                      onClick={() => toggleFile(f.path, f)}
                    >
                      <div className="w-1.5 h-1.5 rounded-full shrink-0 transition-colors"
                        style={{ background: sel ? 'var(--accent)' : '#d1d5db' }} />
                      <span className={`flex-1 text-[13px] truncate transition-colors ${sel ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>
                        {stripDate(f.title || f.path.split('/').pop() || '')}
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
