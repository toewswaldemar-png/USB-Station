import { useRef, useState, useLayoutEffect } from 'react'
import { HardDrive, ChevronDown, Calendar, FolderOpen } from 'lucide-react'
import { useSelectionStore } from '@/stores/selectionStore'
import UsbDriveList from '@/components/sidebar/UsbDriveList'
import SelectionPanel from '@/components/sidebar/SelectionPanel'
import CopyProgress from '@/components/sidebar/CopyProgress'
import SidebarPlayer from '@/components/sidebar/SidebarPlayer'
import { useUsbDrives } from '@/hooks/useUsbDrives'

const isKiosk = new URLSearchParams(window.location.search).has('kiosk')

interface Props {
  sseMsg: { data: string }
  activeTab: 'calendar' | 'explorer'
  onTabChange: (tab: 'calendar' | 'explorer') => void
}

export default function Sidebar({ sseMsg, activeTab, onTabChange }: Props) {
  const selectedCount = useSelectionStore(s => s.selectedFiles.size)
  const { drives, selected, setSelected } = useUsbDrives(sseMsg)
  const innerRef = useRef<HTMLDivElement>(null)
  const [showArrow, setShowArrow] = useState(false)

  function checkScroll() {
    const el = innerRef.current
    if (!el) { setShowArrow(false); return }
    setShowArrow(el.scrollHeight > el.clientHeight && el.scrollTop + el.clientHeight < el.scrollHeight - 4)
  }

  useLayoutEffect(() => {
    const el = innerRef.current
    if (!el) return
    checkScroll()
    const ro = new ResizeObserver(checkScroll)
    ro.observe(el)
    return () => ro.disconnect()
  })

  return (
    <aside className="w-64 shrink-0 flex flex-col bg-gray-50 overflow-hidden shadow-[2px_0_12px_rgba(0,0,0,0.06)] z-10">

      {/* Tab-Umschalter */}
      <div className="flex items-center justify-center gap-1 px-3 py-2 shrink-0 border-b border-gray-200 bg-white">
        <button
          onClick={() => onTabChange('calendar')}
          className={`flex items-center gap-1.5 px-3 h-9 rounded-full text-sm font-semibold transition-colors
            ${activeTab === 'calendar' ? 'text-white' : 'text-gray-500 hover:bg-gray-100'}`}
          style={activeTab === 'calendar' ? { background: 'var(--accent)' } : undefined}
        >
          <Calendar size={13} /> Kalender
        </button>
        <button
          onClick={() => onTabChange('explorer')}
          className={`flex items-center gap-1.5 px-3 h-9 rounded-full text-sm font-semibold transition-colors
            ${activeTab === 'explorer' ? 'text-white' : 'text-gray-500 hover:bg-gray-100'}`}
          style={activeTab === 'explorer' ? { background: 'var(--accent)' } : undefined}
        >
          <FolderOpen size={13} /> Explorer
        </button>
      </div>

      {/* USB-Laufwerk-Karte */}
      <div className="mx-3 mt-3 bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden shrink-0">
        <p className="px-3 pt-2.5 pb-0.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
          <HardDrive size={11} />
          Laufwerk
        </p>
        <UsbDriveList drives={drives} selected={selected} onSelect={setSelected} />
      </div>

      {/* Auswahl-Karte — füllt restliche Höhe */}
      <div className="mx-3 mt-3 mb-3 flex-1 bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden flex flex-col min-h-0">
        <p className="px-3 pt-2.5 pb-0.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider shrink-0">
          {selectedCount === 0 ? 'Auswahl' : `${selectedCount} ausgewählt`}
        </p>
        <CopyProgress sseMsg={sseMsg} selectedDrive={selected} />
        {selectedCount === 0 ? (
          <p className="px-3 py-3 text-[12px] text-gray-400 text-center">
            Einträge im Kalender auswählen
          </p>
        ) : (
          <div className="relative flex-1 min-h-0">
            <div ref={innerRef} onScroll={checkScroll} className="overflow-y-auto no-scrollbar h-full">
              <SelectionPanel />
            </div>
            {showArrow && (
              <div className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none flex items-end justify-center pb-1"
                style={{ background: 'linear-gradient(to bottom, transparent, rgba(255,255,255,0.95))' }}>
                <ChevronDown size={16} className="text-gray-400" />
              </div>
            )}
          </div>
        )}
      </div>

      {!isKiosk && <SidebarPlayer />}

    </aside>
  )
}
