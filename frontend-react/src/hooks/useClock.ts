import { useState, useEffect } from 'react'

function fmt(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  const days = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
  return {
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    date: `${days[d.getDay()]}, ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`,
  }
}

export function useClock() {
  const [clock, setClock] = useState(() => fmt(new Date()))
  useEffect(() => {
    const id = setInterval(() => setClock(fmt(new Date())), 60_000)
    return () => clearInterval(id)
  }, [])
  return clock
}
