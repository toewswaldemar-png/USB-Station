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
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col"
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
          <div className="px-6 py-8 flex justify-center">
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
          <div className="p-4 flex items-center justify-center bg-gray-50" style={{ maxHeight: '80vh' }}>
            <img
              src={streamUrl}
              alt={name}
              className="max-w-full object-contain rounded-lg"
              style={{ maxHeight: 'calc(80vh - 60px)' }}
            />
          </div>
        )}

        {type === 'pdf' && (
          <embed
            src={streamUrl}
            type="application/pdf"
            className="w-full"
            style={{ height: '80vh' }}
          />
        )}
      </div>
    </div>
  )
}
