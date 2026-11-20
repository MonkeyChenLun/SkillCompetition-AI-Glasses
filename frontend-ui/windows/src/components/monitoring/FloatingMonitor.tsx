import { useEffect, useId, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2, X } from 'lucide-react'
import type { Device } from '../../types'
import CameraFeed from './CameraFeed'
import './floating-monitor.css'

type Position = { x: number; y: number }
type Drag = { pointerId: number; offsetX: number; offsetY: number; width: number; height: number }

const viewportGap = 8

function clampPosition(position: Position, width: number, height: number): Position {
  const viewport = document.documentElement
  return {
    x: Math.max(viewportGap, Math.min(position.x, viewport.clientWidth - width - viewportGap)),
    y: Math.max(viewportGap, Math.min(position.y, viewport.clientHeight - height - viewportGap)),
  }
}

export default function FloatingMonitor({ device, caption, onClose, onRestore }: {
  device: Device
  caption?: string
  onClose: () => void
  onRestore: () => void
}) {
  const title = useId()
  const panel = useRef<HTMLElement>(null)
  const restore = useRef<HTMLButtonElement>(null)
  const drag = useRef<Drag | null>(null)
  const [position, setPosition] = useState<Position | null>(null)

  useEffect(() => {
    restore.current?.focus({ preventScroll: true })
    function keepInViewport() {
      const bounds = panel.current?.getBoundingClientRect()
      if (!bounds) return
      if (drag.current) {
        drag.current.width = bounds.width
        drag.current.height = bounds.height
      }
      setPosition(current => current ? clampPosition(current, bounds.width, bounds.height) : null)
    }
    window.addEventListener('resize', keepInViewport)
    return () => window.removeEventListener('resize', keepInViewport)
  }, [])

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !event.isPrimary || drag.current) return
    const bounds = panel.current?.getBoundingClientRect()
    if (!bounds) return

    drag.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
      width: bounds.width,
      height: bounds.height,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current || event.pointerId !== current.pointerId) return
    setPosition(clampPosition({
      x: event.clientX - current.offsetX,
      y: event.clientY - current.offsetY,
    }, current.width, current.height))
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerId === drag.current?.pointerId) drag.current = null
  }

  return createPortal(
    <section ref={panel} className="floating-monitor" aria-labelledby={title}
      style={position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }
      }}>
      <div className="floating-monitor-bar">
        <div className="floating-monitor-grip" title="拖动小窗"
          onPointerDown={startDrag} onPointerMove={moveDrag}
          onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}>
          <h2 id={title}>监控小窗</h2>
        </div>
        <button ref={restore} type="button" aria-label="返回实时监控" title="返回实时监控" onClick={onRestore}>
          <Maximize2 size={15} aria-hidden="true" />
        </button>
        <button type="button" aria-label="关闭监控小窗" title="关闭监控小窗" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <CameraFeed device={device} compact overlay={caption && (
        <span className="camera-ai-caption camera-ai-caption--compact floating-monitor-caption" title={caption}>
          <span>模拟 AI</span>{caption}
        </span>
      )} />
    </section>,
    document.body,
  )
}
