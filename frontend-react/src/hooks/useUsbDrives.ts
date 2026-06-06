import { useState, useEffect } from 'react'
import type { UsbDrive } from '@/types'

export function useUsbDrives(sseMessage: { data: string }) {
  const [drives, setDrives] = useState<UsbDrive[]>([])
  const [selected, setSelected] = useState<UsbDrive | null>(null)

  useEffect(() => {
    fetch('/api/usb')
      .then(r => r.json())
      .then((d: UsbDrive[] | null) => setDrives(d ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const msg = sseMessage.data
    if (!msg.startsWith('usb:')) return
    try {
      const d = JSON.parse(msg.slice(4)) as UsbDrive[]
      setDrives(d)
      if (selected && !d.find(x => x.path === selected.path)) setSelected(null)
    } catch {}
  }, [sseMessage, selected])

  return { drives, selected, setSelected }
}
