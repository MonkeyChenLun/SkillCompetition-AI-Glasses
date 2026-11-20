import { createContext, useContext, useLayoutEffect, useState } from 'react'
import type { ReactNode } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'

const ThemeContext = createContext<{
  preference: ThemePreference
  setPreference: (preference: ThemePreference) => void
} | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(() => {
    const initial = document.documentElement.dataset.themePreference
    return initial === 'dark' || initial === 'system' ? initial : 'light'
  })

  useLayoutEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      root.dataset.theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference
      root.dataset.themePreference = preference
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(root).getPropertyValue('--canvas').trim())
    }
    apply()
    try { localStorage.setItem('aig-ui-theme', preference) } catch { /* The current session still works. */ }
    if (preference !== 'system') return
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [preference])

  return <ThemeContext.Provider value={{ preference, setPreference }}>{children}</ThemeContext.Provider>
}

export function useThemePreference() {
  const theme = useContext(ThemeContext)
  if (!theme) throw new Error('ThemeProvider is missing')
  return theme
}
