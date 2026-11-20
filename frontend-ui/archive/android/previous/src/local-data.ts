import { useEffect, useState } from 'react'
import { featureIds } from './glasses'
import type { GlassesResult } from './glasses'

const keyPrefix = 'ai-glasses-user:v1:'
export const historyLimit = 120
export type ThemeChoice = 'system' | 'light' | 'dark'

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
  const [autoRead, setAutoRead] = useState(() => load('autoRead') !== false)
  const [history, setHistory] = useState(() => readHistory(load('history')))
  const [storageAvailable, setStorageAvailable] = useState(true)
  useEffect(() => {
    try {
      window.localStorage.setItem(keyPrefix + 'theme', JSON.stringify(theme))
      window.localStorage.setItem(keyPrefix + 'autoRead', JSON.stringify(autoRead))
      if (history.length) window.localStorage.setItem(keyPrefix + 'history', JSON.stringify(history))
      else window.localStorage.removeItem(keyPrefix + 'history')
      setStorageAvailable(true)
    } catch {
      setStorageAvailable(false)
    }
  }, [theme, autoRead, history])
  return { theme, setTheme, autoRead, setAutoRead, history, setHistory, storageAvailable }
}
