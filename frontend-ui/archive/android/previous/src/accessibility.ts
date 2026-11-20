import { Capacitor, registerPlugin } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { useCallback, useEffect, useRef, useState } from 'react'

type AccessibilityState = {
  ttsStatus: 'initializing' | 'available' | 'unavailable'
  touchExplorationEnabled: boolean
  fontScale: number
}

type SpeechEvent = {
  phase: 'started' | 'completed' | 'stopped' | 'error'
  utteranceId: string
}

interface AccessibilityPlugin {
  getState(): Promise<AccessibilityState>
  speak(options: { text: string }): Promise<{ utteranceId: string }>
  stop(): Promise<void>
  addListener(event: 'accessibilityStateChange', callback: (state: AccessibilityState) => void): Promise<PluginListenerHandle>
  addListener(event: 'speechStateChange', callback: (event: SpeechEvent) => void): Promise<PluginListenerHandle>
}

const native = Capacitor.getPlatform() === 'android'
const bridge = registerPlugin<AccessibilityPlugin>('GlassesAccessibility')
const fallback: AccessibilityState = {
  ttsStatus: native ? 'initializing' : 'unavailable',
  touchExplorationEnabled: false,
  fontScale: 1,
}

export function useAccessibility() {
  const [state, setState] = useState(fallback)
  const [speaking, setSpeaking] = useState(false)
  const [speechError, setSpeechError] = useState(false)
  const request = useRef(0)
  const utterance = useRef<string | null>(null)
  const earlyCompletion = useRef<string | null>(null)

  useEffect(() => {
    if (!native) return
    let disposed = false
    let receivedChange = false
    const listeners: PluginListenerHandle[] = []
    function keep(handle: PluginListenerHandle) {
      if (disposed) void handle.remove()
      else listeners.push(handle)
    }
    void bridge.addListener('accessibilityStateChange', (next) => {
      receivedChange = true
      if (!disposed) setState(next)
    }).then(keep).catch(() => {})
    void bridge.addListener('speechStateChange', (event) => {
      if (disposed || event.phase === 'started') return
      earlyCompletion.current = event.utteranceId
      if (event.utteranceId === utterance.current) {
        utterance.current = null
        setSpeaking(false)
        if (event.phase === 'error') setSpeechError(true)
      }
    }).then(keep).catch(() => {})
    void bridge.getState().then((initial) => {
      if (!disposed && !receivedChange) setState(initial)
    }).catch(() => {
      if (!disposed && !receivedChange) setState({ ...fallback, ttsStatus: 'unavailable' })
    })
    return () => {
      disposed = true
      for (const listener of listeners) void listener.remove()
    }
  }, [])

  const stop = useCallback(() => {
    request.current++
    utterance.current = null
    setSpeaking(false)
    setSpeechError(false)
    if (native) void bridge.stop().catch(() => {})
  }, [])

  const canSpeak = state.ttsStatus === 'available' && !state.touchExplorationEnabled
  const speak = useCallback((text: string) => {
    if (!canSpeak || document.visibilityState !== 'visible' || !text.trim()) return
    const ticket = ++request.current
    utterance.current = null
    earlyCompletion.current = null
    setSpeaking(true)
    setSpeechError(false)
    void bridge.speak({ text }).then(({ utteranceId }) => {
      if (ticket !== request.current) return
      if (utteranceId === earlyCompletion.current) setSpeaking(false)
      else utterance.current = utteranceId
    }).catch(() => {
      if (ticket !== request.current) return
      setSpeaking(false)
      setSpeechError(true)
    })
  }, [canSpeak])

  useEffect(() => {
    if (!canSpeak) stop()
  }, [canSpeak, stop])

  const speechNote = state.touchExplorationEnabled
    ? '已由系统屏幕朗读接管。'
    : !native ? '独立朗读请在 Android App 中体验。'
      : state.ttsStatus === 'initializing' ? '正在检查系统语音。'
        : !canSpeak ? '系统未提供离线中文语音，识别结果仍可阅读。' : ''

  return { ...state, canSpeak, speaking, speechError, speak, stop, speechNote }
}
