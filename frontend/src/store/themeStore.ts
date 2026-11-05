import { create } from 'zustand'

export type Theme = 'light' | 'dark'
const KEY = 'veri_theme'

function read(): Theme {
  try {
    const t = localStorage.getItem(KEY)
    if (t === 'light' || t === 'dark') return t
  } catch {}
  return 'dark'
}

function apply(t: Theme) {
  const root = document.documentElement
  root.classList.toggle('dark', t === 'dark')
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', t === 'dark' ? '#0f172a' : '#ffffff')
}

interface ThemeState {
  theme: Theme
  setTheme: (t: Theme) => void
  toggle: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const initial = read()
  if (typeof document !== 'undefined') apply(initial)
  return {
    theme: initial,
    setTheme: (t) => {
      try { localStorage.setItem(KEY, t) } catch {}
      apply(t)
      set({ theme: t })
    },
    toggle: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
  }
})