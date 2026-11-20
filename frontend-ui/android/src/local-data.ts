import { useEffect, useLayoutEffect, useState } from 'react'
import { featureIds } from './glasses'
import type { GlassesResult } from './glasses'

const keyPrefix = 'ai-glasses-user:v1:'
export const historyLimit = 120
export type ThemeChoice = 'system' | 'light' | 'dark'
export type GlassChoice = 'system' | 'on' | 'off'

function load(key: string): unknown {
  try {
    const value = window.localStorage.getItem(keyPrefix + key)
    return value === null ? undefined : JSON.parse(value)
  } catch {
    return undefined
  }
}

function readTheme(value: unknown): ThemeChoice {
  return value === 'dark' || value === 'light' ? value : 'system'
}

function readGlass(value: unknown): GlassChoice {
  return value === 'on' || value === 'off' ? value : 'system'
}

export function useGlassPreference(choice: GlassChoice) {
  useLayoutEffect(() => {
    const media = window.matchMedia('(prefers-reduced-transparency: reduce)')
    const applyGlass = () => {
      document.documentElement.dataset.glass = choice === 'system' ? (media.matches ? 'off' : 'on') : choice
    }
    applyGlass()
    if (choice !== 'system') return
    media.addEventListener('change', applyGlass)
    return () => media.removeEventListener('change', applyGlass)
  }, [choice])
}

function readHistory(value: unknown): GlassesResult[] {
  if (!Array.isArray(value)) return []
  return value.filter((row): row is GlassesResult =>
    row && featureIds.some((id) => id === row.id) && row.source === 'mock' &&
    typeof row.text === 'string' && row.text.length <= 500 &&
    typeof row.timestamp === 'string' && Number.isFinite(Date.parse(row.timestamp)),
  ).slice(0, historyLimit)
}

export function useLocalData() {
  const [theme, setTheme] = useState(() => readTheme(load('theme')))
  const [glass, setGlass] = useState(() => readGlass(load('glass')))
  const [autoRead, setAutoRead] = useState(() => load('autoRead') !== false)
  const [history, setHistory] = useState(() => readHistory(load('history')))
  const [storageAvailable, setStorageAvailable] = useState(true)
  useEffect(() => {
    try {
      window.localStorage.setItem(keyPrefix + 'theme', JSON.stringify(theme))
      window.localStorage.setItem(keyPrefix + 'glass', JSON.stringify(glass))
      window.localStorage.setItem(keyPrefix + 'autoRead', JSON.stringify(autoRead))
      if (history.length) window.localStorage.setItem(keyPrefix + 'history', JSON.stringify(history))
      else window.localStorage.removeItem(keyPrefix + 'history')
      setStorageAvailable(true)
    } catch {
      setStorageAvailable(false)
    }
  }, [theme, glass, autoRead, history])
  return { theme, setTheme, glass, setGlass, autoRead, setAutoRead, history, setHistory, storageAvailable }
}
