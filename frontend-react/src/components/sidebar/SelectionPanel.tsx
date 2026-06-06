import { useState, useEffect } from 'react'
import { useSelectionStore } from '@/stores/selectionStore'
import { useFilesStore } from '@/stores/filesStore'
import { groupKey } from '@/lib/groupKey'
import type { AudioFile } from '@/types'

const DATE_RE = /^(\d{4}-\d{2}-\d{2}|\d{8}|\d{1,2}\.\d{1,2}\.\d{4})\s*/

function stripDate(s: string) {
  return s.replace(DATE_RE, '').replace(DATE_RE, '').trim() || s
}

export default function SelectionPanel() {
  const { selectedFiles, toggleFile } = useSelectionStore()
  const allFiles = useFilesStore(s => s.allFiles)

  const grouped = new Map<string, AudioFile[]>()
  for (const f of allFiles) {
    if (!selectedFiles.has(f.path)) continue
    const k = groupKey(f)
    if (!grouped.has(k)) grouped.set(k, [])
    grouped.get(k)!.push(f)
  }

  const keys = [...grouped.keys()]
  const [openKey, setOpenKey] = useState<string | null>(null)

  const openKeyPresent = openKey === null || keys.includes(openKey)
  useEffect(() => {
    if (!openKeyPresent) setOpenKey(null)
  }, [openKeyPresent])

  if (selectedFiles.size === 0) return null

  return (
    <div className="divide-y divide-gray-50">
      {keys.map(key => {
        const files = grouped.get(key)!
        const isOpen = openKey === key
        return (
          <div key={key}>

            {/* Gruppenheader */}
            <div
              className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none hover:bg-gray-50 transition-colors"
              onClick={() => setOpenKey(isOpen ? null : key)}
            >
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: 'var(--accent)' }} />
              <span className="flex-1 text-[12px] font-semibold text-gray-700 truncate">
                {stripDate(key)}
              </span>
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-white shrink-0"
                style={{ background: 'var(--accent)' }}
              >
                {files.length}
              </span>
              <button
                onClick={e => { e.stopPropagation(); files.forEach(f => toggleFile(f.path, f)) }}
                className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors text-[10px]"
                title="Gruppe entfernen"
              >
                ✕
              </button>
            </div>

            {/* Dateiliste */}
            {isOpen && (
              <div className="bg-gray-50/60 border-t border-gray-50">
                {files.map(f => (
                  <div
                    key={f.path}
                    className="flex items-center gap-2 pl-4 pr-3 py-1.5 hover:bg-gray-100/60 transition-colors"
                  >
                    <div className="w-1 h-1 rounded-full shrink-0 bg-gray-300" />
                    <span className="flex-1 text-[11px] text-gray-500 truncate">
                      {stripDate(f.title || f.path.split('/').pop() || '')}
                    </span>
                    <button
                      onClick={() => toggleFile(f.path, f)}
                      className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors text-[10px]"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

          </div>
        )
      })}
    </div>
  )
}
