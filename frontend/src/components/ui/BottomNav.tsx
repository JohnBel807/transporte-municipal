export type NavTab = 'taxi' | 'colectivos' | 'ajustes'

const ITEMS: { key: NavTab; icon: string; label: string }[] = [
  { key: 'taxi',       icon: '🚕', label: 'Taxis' },
  { key: 'colectivos', icon: '🚌', label: 'Colectivos' },
  { key: 'ajustes',    icon: '⚙️', label: 'Ajustes' },
]

export function BottomNav({ active, onChange }: { active: NavTab; onChange: (t: NavTab) => void }) {
  return (
    <nav className="safe-bottom bg-slate-900 border-t border-slate-800 shrink-0 z-20">
      <div className="h-16 grid grid-cols-3">
        {ITEMS.map(it => {
          const on = active === it.key
          return (
            <button key={it.key} onClick={() => onChange(it.key)}
              aria-current={on ? 'page' : undefined}
              className="relative flex flex-col items-center justify-center gap-0.5 active:scale-95 transition">
              {on && <span className="absolute top-0 h-0.5 w-10 rounded-full bg-teal-400" />}
              <span className={`text-xl leading-none transition ${on ? '' : 'grayscale opacity-60'}`}>{it.icon}</span>
              <span className={`text-[11px] font-semibold ${on ? 'text-teal-400' : 'text-slate-500'}`}>{it.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}