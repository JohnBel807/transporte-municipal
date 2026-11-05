import { ThemeToggle } from './ThemeToggle'

export function AppHeader({ badge, live }: { badge: string; live: boolean }) {
  return (
    <header className="safe-top bg-slate-900 border-b border-slate-800 shrink-0 z-20">
      <div className="h-12 px-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/logo-veri.png" alt="VERI" className="w-7 h-7 object-contain rounded-lg" />
          <span className="text-base font-bold tracking-wide text-white">VERI</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border
            ${live ? 'text-teal-400 bg-teal-400/10 border-teal-400/30'
                   : 'text-slate-500 bg-slate-800 border-slate-700'}`}>
            {badge}
          </span>
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}