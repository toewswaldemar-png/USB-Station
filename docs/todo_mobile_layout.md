---
name: todo_mobile_layout
description: "Mobile-Layout für Smartphone — umgesetzt 2026-06-12"
metadata: 
  node_type: memory
  type: todo
  originSessionId: d0bdebe3-c094-4169-acc7-02818ab6914f
---

## Mobile-Layout (umgesetzt 2026-06-12)

`useMediaQuery('(max-width: 768px)')` → `MobileLayout` / Desktop-Layout in `App.tsx`.

**Umgesetzt:**
- `hooks/useMediaQuery.ts`
- `stores/playerStore.ts` — Track, folderTracks, playMode (default: repeat-all)
- `components/mobile/MobileLayout.tsx` — Header mit StopCircle-Button, kein Sidebar/Kalender
- `components/mobile/MobilePlayerBar.tsx` — Play/Pause, Prev/Next (iOS-Stil), Progress, Playback-Mode
- `ExplorerView` isMobile-Prop — 48px Zeilen, keine Checkboxen, keine Datum/Größe-Spalten,
  vereinfachte Breadcrumb (⌂ ← Ordnername), Audio-Klick → playerStore statt FileViewer

**Offene Mobile-Ideen (diskutiert, nicht bestätigt):**
- Play-Button auf Ordner-Zeilen
- Swipe-Geste auf Player-Bar für Track-Wechsel
- Landscape-Layout (Split-View)
- PWA / Offline-fähig
