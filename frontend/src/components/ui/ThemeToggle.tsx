import { useThemeStore } from '../../store/themeStore'

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggle } = useThemeStore()
  const dark = theme === 'dark'
  return (
    <button
      onClick={toggle}
      aria-label={dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      title={dark ? 'Modo claro' : 'Modo oscuro'}
      className={`w-9 h-9 rounded-full flex items-center justify-center text-base
                  bg-slate-800 border border-slate-700 hover:bg-slate-700
                  active:scale-95 transition ${className}`}>
      {dark ? '☀️' : '🌙'}
    </button>
  )
}