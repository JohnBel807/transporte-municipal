import { useRef, useState, ReactNode } from 'react'

export type SheetSnap = 'peek' | 'half' | 'full'
const RATIO: Record<SheetSnap, number> = { peek: 0.3, half: 0.58, full: 0.94 }
const ORDER: SheetSnap[] = ['peek', 'half', 'full']

/**
 * Tarjeta flotante inferior sobre el mapa. Se arrastra desde la barra superior (handle)
 * y encaja en tres alturas. Debe estar dentro de un contenedor `relative` con altura.
 */
export function BottomSheet({
  snap, onSnapChange, children,
}: { snap: SheetSnap; onSnapChange: (s: SheetSnap) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const start = useRef<{ y: number; h: number; moved: boolean } | null>(null)
  const [dragH, setDragH] = useState<number | null>(null)

  const parentH = () => ref.current?.parentElement?.clientHeight ?? 600

  const onDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { y: e.clientY, h: ref.current?.offsetHeight ?? 0, moved: false }
  }
  const onMove = (e: React.PointerEvent) => {
    const s = start.current
    if (!s) return
    const dy = s.y - e.clientY
    if (Math.abs(dy) > 4) s.moved = true
    const max = parentH() * RATIO.full
    const min = parentH() * 0.18
    setDragH(Math.max(min, Math.min(max, s.h + dy)))
  }
  const onUp = () => {
    const s = start.current
    start.current = null
    if (!s) return
    if (!s.moved) {                       // toque: alterna entre alturas
      onSnapChange(ORDER[(ORDER.indexOf(snap) + 1) % ORDER.length])
    } else if (dragH !== null) {
      const ratio = dragH / parentH()
      const nearest = ORDER.reduce((a, b) =>
        Math.abs(RATIO[b] - ratio) < Math.abs(RATIO[a] - ratio) ? b : a)
      onSnapChange(nearest)
    }
    setDragH(null)
  }

  return (
    <div
      ref={ref}
      className={`absolute inset-x-0 bottom-0 z-10 flex flex-col bg-slate-900
                  rounded-t-3xl sheet-shadow border-t border-slate-800
                  ${dragH === null ? 'transition-[height] duration-300 ease-out' : ''}`}
      style={{ height: dragH ?? `${RATIO[snap] * 100}%` }}
    >
      <div
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        className="shrink-0 pt-2.5 pb-2 flex justify-center cursor-grab active:cursor-grabbing"
        style={{ touchAction: 'none' }}
        role="button" aria-label="Arrastra para cambiar el tamaño del panel"
      >
        <span className="w-10 h-1.5 rounded-full bg-slate-600" />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{children}</div>
    </div>
  )
}