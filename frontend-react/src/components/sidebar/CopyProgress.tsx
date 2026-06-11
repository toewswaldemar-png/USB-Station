import { useEffect, useState } from 'react'
import { Copy, Trash2 } from 'lucide-react'
import type { UsbDrive } from '@/types'
import { useSelectionStore } from '@/stores/selectionStore'

interface Props {
  sseMsg: { data: string }
  selectedDrive: UsbDrive | null
}

export default function CopyProgress({ sseMsg, selectedDrive }: Props) {
  const [progress, setProgress] = useState<number | null>(null)
  const [status, setStatus] = useState('')
  const effectivePaths = useSelectionStore(s => s.effectivePaths)
  const clearAll = useSelectionStore(s => s.clearAll)

  useEffect(() => {
    const msg = sseMsg.data
    if (msg === 'connected') {
      setProgress(null)
      setStatus('')
    } else if (msg.startsWith('copy_progress:')) {
      const [, pct] = msg.split(':')
      setProgress(Number(pct))
      setStatus('')
    } else if (msg.startsWith('copy_done:')) {
      const n = msg.split(':')[1]
      setProgress(null)
      setStatus(`${n} Datei${Number(n) !== 1 ? 'en' : ''} kopiert`)
      clearAll()
      setTimeout(() => setStatus(''), 4000)
    } else if (msg.startsWith('copy_error:')) {
      setProgress(null)
      setStatus('Fehler beim Kopieren')
      setTimeout(() => setStatus(''), 4000)
    }
  }, [sseMsg])

  function handleCopy() {
    const paths = effectivePaths()
    if (!selectedDrive || paths.length === 0) return
    fetch('/api/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths, target: selectedDrive.path }),
    })
    setProgress(0)
  }

  const paths = effectivePaths()

  return (
    <div className="px-3 py-2.5 space-y-2 border-b border-gray-50">
      <div className="flex gap-2">
        <button
          onClick={handleCopy}
          disabled={!selectedDrive || progress !== null || paths.length === 0}
          className="flex-1 py-1.5 rounded-lg text-sm text-white font-semibold disabled:opacity-40 flex items-center justify-center gap-1.5 active:scale-[0.96] active:opacity-80 transition-all duration-100"
          style={{ background: 'var(--accent)' }}
        >
          <Copy size={14} />
          Kopieren
        </button>
        <button
          onClick={clearAll}
          disabled={paths.length === 0}
          className="w-9 flex items-center justify-center rounded-lg text-sm border border-red-200 text-red-400 hover:text-red-600 hover:border-red-300 active:scale-[0.96] active:bg-red-50 transition-all duration-100 disabled:opacity-30 disabled:pointer-events-none"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {progress !== null && (
        <div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${progress}%`, background: 'var(--accent)' }}
            />
          </div>
          <div className="text-[11px] text-gray-400 mt-1">{progress}%</div>
        </div>
      )}

      {status && (
        <div className="text-[11px] text-center text-gray-500">{status}</div>
      )}
    </div>
  )
}
