import { useEffect } from 'react'
import { X } from 'lucide-react'

interface Props {
  path: string
  name: string
  type: 'audio' | 'image' | 'pdf'
  onClose: () => void
}

export default function FileViewer({ path, name, type, onClose }: Props) {
  const streamUrl = `/api/stream?path=${encodeURIComponent(path)}`

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="absolute inset-0 bg-black/60 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white w-full h-full overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 shrink-0">
          <span className="flex-1 text-sm font-semibold text-gray-700 truncate">{name}</span>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-700 shrink-0"
          >
            <X size={18} />
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
      </div>
    </div>
  )
}
