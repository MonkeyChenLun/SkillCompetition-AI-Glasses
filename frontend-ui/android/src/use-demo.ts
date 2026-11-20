import { useCallback, useEffect, useRef, useState } from 'react'
import { DemoGlassesClient, demoStreamLineCount } from './glasses'
import type { FeatureId, GlassesClient, GlassesResult, OneShotId, StreamId } from './glasses'

type DeviceStatus = 'idle' | 'connecting' | 'connected' | 'error'
type Work = { id: FeatureId; stream: boolean; ticket: number }

export const deviceLabels: Record<DeviceStatus, string> = {
  idle: '未连接',
  connecting: '正在连接',
  connected: '已连接',
  error: '模拟连接失败',
}

export function useDemo(onResult: (result: GlassesResult) => void) {
  const client = useRef<GlassesClient>(new DemoGlassesClient())
  const [device, setDevice] = useState<DeviceStatus>('idle')
  const [connectionError, setConnectionError] = useState('')
  const [pending, setPending] = useState<Work | null>(null)
  const [results, setResults] = useState<Partial<Record<FeatureId, GlassesResult[]>>>({})
  const [completed, setCompleted] = useState<StreamId | null>(null)
  const [failure, setFailure] = useState<{ id: FeatureId; message: string } | null>(null)
  const active = useRef<Work | null>(null)
  const cancel = useRef<(() => void) | null>(null)
  const connectionTicket = useRef(0)
  const workTicket = useRef(0)
  const deliver = useRef(onResult)
  useEffect(() => { deliver.current = onResult }, [onResult])

  const stop = useCallback(() => {
    active.current = null
    cancel.current?.()
    cancel.current = null
    setPending(null)
  }, [])

  const clear = useCallback(() => {
    stop()
    setResults({})
    setCompleted(null)
    setFailure(null)
  }, [stop])

  const disconnect = useCallback(() => {
    connectionTicket.current++
    clear()
    void client.current.disconnect().catch(() => {})
    setConnectionError('')
    setDevice('idle')
  }, [clear])

  const connect = useCallback((failConnect = false) => {
    const ticket = ++connectionTicket.current
    clear()
    void client.current.disconnect().catch(() => {})
    const next = new DemoGlassesClient({ failConnect })
    client.current = next
    setConnectionError('')
    setDevice('connecting')
    void next.connect().then(() => {
      if (ticket === connectionTicket.current) setDevice('connected')
      else void next.disconnect().catch(() => {})
    }).catch(() => {
      if (ticket !== connectionTicket.current) return
      setConnectionError('这是一次模拟连接失败，没有扫描蓝牙设备。你可以重试。')
      setDevice('error')
    })
  }, [clear])

  function prepare(id: FeatureId, stream: boolean) {
    if (device !== 'connected' || active.current) return null
    const work = { id, stream, ticket: ++workTicket.current }
    active.current = work
    setPending(work)
    setFailure(null)
    setCompleted(null)
    setResults((previous) => ({ ...previous, [id]: [] }))
    return work
  }

  function put(work: Work, result: GlassesResult) {
    if (work.ticket !== active.current?.ticket) return false
    setResults((previous) => ({ ...previous, [result.id]: [...(previous[result.id] ?? []), result] }))
    deliver.current(result)
    return true
  }

  function fail(work: Work) {
    if (work.ticket !== active.current?.ticket) return
    stop()
    setFailure({ id: work.id, message: '这次没有得到结果。请检查模拟眼镜的连接状态，再试一次。' })
  }

  function run(id: OneShotId, input?: string) {
    const work = prepare(id, false)
    if (!work) return
    void client.current.run(id, input).then((result) => {
      if (put(work, result)) stop()
    }).catch(() => fail(work))
  }

  function start(id: StreamId) {
    const work = prepare(id, true)
    if (!work) return
    let lines = 0
    const unsubscribe = client.current.subscribe(id, (result) => {
      if (!put(work, result)) return
      if (++lines >= demoStreamLineCount) {
        stop()
        setCompleted(id)
      }
    }, () => fail(work))
    if (active.current?.ticket === work.ticket) cancel.current = unsubscribe
    else unsubscribe()
  }

  return { device, connectionError, pending, results, completed, failure, connect, disconnect, run, start, stop, clear }
}
