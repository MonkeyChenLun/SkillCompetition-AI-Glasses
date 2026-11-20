import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useThemePreference } from '../../services/theme'
import './brand-intro.css'

const introKey = 'aig-ui-brand-intro-v4'
const firstFrameDeadline = 1000
const introDeadline = 12000
const reducedMotionQuery = '(prefers-reduced-motion: reduce)'
const branding = import.meta.env.BASE_URL + 'branding/'

function shouldPlayIntro() {
  if (window.matchMedia(reducedMotionQuery).matches || document.visibilityState === 'hidden') return false
  try {
    return sessionStorage.getItem(introKey) !== 'seen'
  } catch {
    return true
  }
}

export default function BrandIntro({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useThemePreference()
  const [introTheme] = useState(resolvedTheme)
  const [active, setActive] = useState(shouldPlayIntro)
  const [playing, setPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const finish = useCallback(() => setActive(false), [])

  useEffect(() => {
    const video = videoRef.current
    if (!active || !video) return
    try {
      sessionStorage.setItem(introKey, 'seen')
    } catch {
      // The intro can still complete if browser storage is unavailable.
    }

    let disposed = false
    const motionPreference = window.matchMedia(reducedMotionQuery)
    const frameTimeout = window.setTimeout(finish, firstFrameDeadline)
    const playbackTimeout = window.setTimeout(finish, introDeadline)
    function handlePlaying() {
      window.clearTimeout(frameTimeout)
      setPlaying(true)
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') finish()
    }
    function handleReducedMotion() {
      if (motionPreference.matches) finish()
    }

    video.addEventListener('playing', handlePlaying)
    window.addEventListener('keydown', handleKey)
    motionPreference.addEventListener('change', handleReducedMotion)
    video.play()?.catch(() => { if (!disposed) finish() })

    return () => {
      disposed = true
      window.clearTimeout(frameTimeout)
      window.clearTimeout(playbackTimeout)
      video.removeEventListener('playing', handlePlaying)
      window.removeEventListener('keydown', handleKey)
      motionPreference.removeEventListener('change', handleReducedMotion)
    }
  }, [active, finish])

  if (!active) return children

  return (
    <main className="brand-intro" data-intro-theme={introTheme} aria-label="正在打开 AI Glasses">
      <div className="brand-intro-media">
        {!playing && <img className="brand-intro-still" src={branding + 'noah-vision-lockup-' + introTheme + '.jpg'} alt="NOAH VISION" />}
        <video
          className={playing ? 'brand-intro-video brand-intro-video--playing' : 'brand-intro-video'}
          ref={videoRef}
          src={branding + 'noah-vision-intro-' + introTheme + '.mp4'}
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
          onEnded={finish}
          onError={finish}
        />
      </div>
    </main>
  )
}
