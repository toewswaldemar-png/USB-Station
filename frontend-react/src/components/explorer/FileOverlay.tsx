import { useEffect, useState, useRef } from 'react'
import { X } from 'lucide-react'

interface Props {
  filePath: string
  onClose: () => void
}

type FileType = 'audio' | 'image' | 'video' | 'pdf' | 'text' | 'unknown'

function detectType(p: string): FileType {
  const ext = p.split('.').pop()?.toLowerCase() ?? ''
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) return 'audio'
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'image'
  if (['mp4', 'webm', 'mkv', 'mov'].includes(ext)) return 'video'
  if (ext === 'pdf') return 'pdf'
  if (['txt', 'md', 'log', 'json', 'xml', 'csv'].includes(ext)) return 'text'
  return 'unknown'
}

export default function FileOverlay({ filePath, onClose }: Props) {
  const [text, setText] = useState('')
  const [dirty, setDirty] = useState(false)
  const type = detectType(filePath)
  const streamUrl = `/api/stream?path=${encodeURIComponent(filePath)}`
  const textRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (type !== 'text') return
    fetch(`/api/open?path=${encodeURIComponent(filePath)}`)
      .then(r => r.text())
      .then(setText)
      .catch(() => {})
  }, [filePath, type])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.key === 's' && (e.ctrlKey || e.metaKey) && type === 'text') {
        e.preventDefault()
        saveText()
      }
      if (e.key === 'Tab' && type === 'text' && document.activeElement === textRef.current) {
        e.preventDefault()
        const el = textRef.current!
        const start = el.selectionStart
        el.value = el.value.slice(0, start) + '\t' + el.value.slice(el.selectionEnd)
        el.selectionStart = el.selectionEnd = start + 1
        setText(el.value)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  async function saveText() {
    await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content: text }),
    })
    setDirty(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="relative bg-white rounded-xl shadow-2xl overflow-hidden"
        style={{ width: '80vw', height: '80vh', maxWidth: 1100 }}
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-2 right-2 z-10 p-1.5 rounded-full bg-gray-100 hover:bg-gray-200"
        >
          <X size={16} />
        </button>

        {type === 'audio' && (
          <div className="flex items-center justify-center h-full p-8">
            <audio controls autoPlay src={streamUrl} className="w-full" />
          </div>
        )}
        {type === 'image' && (
          <img src={streamUrl} className="w-full h-full object-contain" alt={filePath} />
        )}
        {type === 'video' && (
          <video controls autoPlay src={streamUrl} className="w-full h-full object-contain" />
        )}
        {type === 'pdf' && (
          <iframe src={streamUrl} className="w-full h-full border-0" title={filePath} />
        )}
        {type === 'text' && (
          <div className="flex flex-col h-full">
            <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-gray-50 text-sm">
              <span className="font-medium truncate">{filePath.split('/').pop()}</span>
              {dirty && <span className="text-orange-500">●</span>}
              <button
                onClick={saveText}
                className="ml-auto px-3 py-0.5 rounded text-white text-sm"
                style={{ background: 'var(--accent)' }}
              >
                Speichern (Ctrl+S)
              </button>
            </div>
            <textarea
              ref={textRef}
              value={text}
              onChange={e => { setText(e.target.value); setDirty(true) }}
              className="flex-1 p-3 font-mono text-sm resize-none focus:outline-none"
              spellCheck={false}
            />
          </div>
        )}
        {type === 'unknown' && (
          <div className="flex items-center justify-center h-full text-gray-400">
            Keine Vorschau verfügbar
          </div>
        )}
      </div>
    </div>
  )
}
