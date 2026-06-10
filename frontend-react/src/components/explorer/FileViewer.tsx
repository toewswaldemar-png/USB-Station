import { useEffect, useState } from 'react'
import { X, ArrowLeft } from 'lucide-react'

interface Props {
  path: string
  name: string
  type: 'audio' | 'image' | 'pdf' | 'text'
  onClose: () => void
}

export default function FileViewer({ path, name, type, onClose }: Props) {
  const streamUrl = `/api/stream?path=${encodeURIComponent(path)}`
  const [textContent, setTextContent] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    if (type !== 'text') return
    setTextContent(null)
    fetch(streamUrl)
      .then(r => r.ok ? r.text() : Promise.reject(r.status))
      .then(setTextContent)
      .catch(err => setTextContent(`Fehler beim Laden (${err})`))
  }, [streamUrl, type])

  return (
    <div
      className="absolute inset-0 bg-black/60 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white w-full h-full overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header — gleiche Höhe/Padding wie Breadcrumb-Leiste im Explorer */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-gray-50 shrink-0">
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white transition-colors text-gray-500 hover:text-[var(--accent)] shrink-0"
            title="Zurück (Esc)"
          >
            <ArrowLeft size={19} />
          </button>
          <span className="flex-1 text-sm font-semibold text-gray-700 truncate">{name}</span>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white transition-colors text-gray-500 hover:text-[var(--accent)] shrink-0"
            title="Schließen (Esc)"
          >
            <X size={19} />
          </button>
        </div>

        {/* Body */}
        {type === 'audio' && (
          <div className="flex-1 flex items-center justify-center px-6">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio
              controls
              autoPlay
              src={streamUrl}
              className="w-full max-w-xl"
              style={{ accentColor: 'var(--accent)' }}
            />
          </div>
        )}

        {type === 'image' && (
          <div className="flex-1 flex items-center justify-center bg-gray-50 p-4 overflow-hidden">
            <img
              src={streamUrl}
              alt={name}
              className="max-w-full max-h-full object-contain"
            />
          </div>
        )}

        {type === 'pdf' && (
          <embed
            src={streamUrl}
            type="application/pdf"
            className="w-full flex-1"
            style={{ minHeight: 0 }}
          />
        )}

        {type === 'text' && (
          <div className="flex-1 overflow-auto bg-gray-50 p-4">
            {textContent === null
              ? <div className="text-sm text-gray-400 animate-pulse">Lade…</div>
              : <pre className="text-xs text-gray-700 font-mono whitespace-pre-wrap break-words leading-relaxed">{textContent}</pre>
            }
          </div>
        )}
      </div>
    </div>
  )
}
