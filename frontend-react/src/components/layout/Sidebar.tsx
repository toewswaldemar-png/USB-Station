import { Calendar, FolderOpen } from 'lucide-react'
import { useSelectionStore } from '@/stores/selectionStore'
import UsbDriveList from '@/components/sidebar/UsbDriveList'
import SelectionPanel from '@/components/sidebar/SelectionPanel'
import CopyProgress from '@/components/sidebar/CopyProgress'
import { useUsbDrives } from '@/hooks/useUsbDrives'

interface Props {
  activeTab: 'calendar' | 'explorer'
  onTabChange: (tab: 'calendar' | 'explorer') => void
  sseMsg: { data: string }
}

export default function Sidebar({ activeTab, onTabChange, sseMsg }: Props) {
  const selectedCount = useSelectionStore(s => s.selectedFiles.size)
  const clearAll = useSelectionStore(s => s.clearAll)
  const { drives, selected, setSelected } = useUsbDrives(sseMsg)

  return (
    <aside className="w-64 shrink-0 flex flex-col bg-gray-50 overflow-hidden shadow-[2px_0_12px_rgba(0,0,0,0.06)] z-10">

      {/* Tabs */}
      <div className="flex bg-white border-b border-gray-100 shrink-0">
        <button
          onClick={() => onTabChange('calendar')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm transition-colors
            ${activeTab === 'calendar' ? 'border-b-2 font-semibold' : 'text-gray-400 hover:text-gray-700'}`}
          style={activeTab === 'calendar' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}}
        >
          <Calendar size={15} /> Kalender
        </button>
        <button
          onClick={() => onTabChange('explorer')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm transition-colors
            ${activeTab === 'explorer' ? 'border-b-2 font-semibold' : 'text-gray-400 hover:text-gray-700'}`}
          style={activeTab === 'explorer' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}}
        >
          <FolderOpen size={15} /> Explorer
        </button>
      </div>

      {/* Karten */}
      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3">

        {/* USB-Laufwerk-Karte */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <p className="px-3 pt-2.5 pb-0.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            Laufwerk
          </p>
          <UsbDriveList drives={drives} selected={selected} onSelect={setSelected} />
        </div>

        {/* Auswahl-Karte */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          {/* Header – immer sichtbar */}
          <p className="px-3 pt-2.5 pb-0.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            {selectedCount === 0 ? 'Auswahl' : `${selectedCount} ausgewählt`}
          </p>

          {/* Body */}
          <CopyProgress sseMsg={sseMsg} selectedDrive={selected} />
          {selectedCount === 0 ? (
            <p className="px-3 py-3 text-[12px] text-gray-400 text-center">
              Einträge im Kalender auswählen
            </p>
          ) : (
            <div className="overflow-y-auto max-h-[50vh]">
              <SelectionPanel />
            </div>
          )}
        </div>

      </div>
    </aside>
  )
}
