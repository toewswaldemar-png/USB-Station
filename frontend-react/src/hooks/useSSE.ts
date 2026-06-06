import { useEffect } from 'react'

export function useSSE(onMessage: (data: string) => void) {
  useEffect(() => {
    let es: EventSource
    let retryTimer: ReturnType<typeof setTimeout>

    function connect() {
      es = new EventSource('/api/events')
      es.onmessage = (e) => onMessage(e.data)
      es.onerror = () => {
        es.close()
        retryTimer = setTimeout(connect, 3000)
      }
    }

    connect()
    return () => {
      es?.close()
      clearTimeout(retryTimer)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
