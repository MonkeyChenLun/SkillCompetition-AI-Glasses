import { useEffect, useRef, useState } from 'react'
import { Activity, ArrowDownRight, ArrowRight, BrainCircuit, CircleDashed, ClipboardCheck, Clock3, Glasses, Grid2X2, Monitor, Pause, Video, Wifi } from 'lucide-react'
import GlassSegmentedControl from '../../components/common/GlassSegmentedControl'
import { Badge, DeviceStatus, EventStatus, MetricCard, PageHeader, Panel } from '../../components/common/ui'
import CameraFeed from '../../components/monitoring/CameraFeed'
import { WorkspaceLink, useWindow } from '../../components/workspace/workspaceContext'
import { useAuth } from '../../services/auth'
import { devices, features, formatTime, totalCalls, useDemoAnalytics, useDemoEvents, useDemoReviews, useDemoSettings, useSimulationStatus } from '../../services/demo'
import './monitor-optics.css'

const videoLayouts = [
  { value: 'single', label: '单画面', icon: <Monitor size={15} aria-hidden="true" /> },
  { value: 'grid', label: '四宫格', icon: <Grid2X2 size={15} aria-hidden="true" /> },
] as const

const simulationLabels = {
  idle: { icon: CircleDashed, text: '模拟未启动' },
  running: { icon: Activity, text: '模拟事件更新中' },
  paused: { icon: Pause, text: '模拟已暂停' },
}

function SimulationStatus({ showEventTime }: { showEventTime: boolean }) {
  const { simulation, latestSimulatedAt } = useSimulationStatus()
  const { icon: Icon, text } = simulationLabels[simulation]
  return (
    <div className={`monitor-live monitor-live--${simulation}`} role="status">
      <Icon size={14} aria-hidden="true" />
      <span>{text}{simulation === 'paused' && (
        latestSimulatedAt ? showEventTime && <> · 数据停在 <time dateTime={latestSimulatedAt} title="最后一条模拟事件的时间（北京时间）">{formatTime(latestSimulatedAt).slice(0, 5)}</time></> : ' · 尚未产生新事件'
      )}</span>
    </div>
  )
}

function useLiveResultHighlight(deviceId: string, resultId: string | undefined, incomingId: string | undefined, running: boolean) {
  const { scrollRef, visible } = useWindow()
  const edge = useRef<HTMLDivElement>(null)
  const previous = useRef({ deviceId, resultId })

  useEffect(() => {
    const last = previous.current
    previous.current = { deviceId, resultId }
    // The latest global event must also be new to this unchanged selection.
    if (!running || !visible || !resultId || resultId !== incomingId || deviceId !== last.deviceId || resultId === last.resultId) return

    const element = edge.current
    const motionAllowed = window.matchMedia('(prefers-reduced-motion: no-preference) and (forced-colors: none)')
    if (!element || document.hidden || !motionAllowed.matches) return

    function onVisibilityChange() { if (document.hidden) stop() }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting || document.hidden || !motionAllowed.matches) stop()
      else element.classList.add('is-arriving')
    }, { root: scrollRef.current })
    function stop() {
      observer.disconnect()
      element?.classList.remove('is-arriving')
      element?.removeEventListener('animationend', stop)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      motionAllowed.removeEventListener('change', stop)
    }

    element.addEventListener('animationend', stop, { once: true })
    document.addEventListener('visibilitychange', onVisibilityChange)
    motionAllowed.addEventListener('change', stop)
    observer.observe(element)
    return stop
  }, [deviceId, resultId, incomingId, running, visible, scrollRef])

  return edge
}

export default function MonitorPage() {
  const [deviceId, setDeviceId] = useState(devices[0].id)
  const [layout, setLayout] = useState<'single' | 'grid'>('single')
  const events = useDemoEvents()
  const { calls } = totalCalls(useDemoAnalytics())
  const { samples, reviewFor } = useDemoReviews()
  const canViewSamples = useAuth().can('viewSamples')
  const pendingSamples = canViewSamples ? samples.filter((sample) => ['pending', 'conflict'].includes(reviewFor(sample.eventId))).length : '—'
  const { refresh, showEventTime } = useDemoSettings()
  const selected = devices.find((device) => device.id === deviceId) ?? devices[0]
  const selectedEvents = events.filter((event) => event.deviceId === selected.id)
  const latest = selectedEvents[0]
  const resultHighlight = useLiveResultHighlight(selected.id, latest?.id, events[0]?.id, refresh)
  const currentFeature = features.find((feature) => feature.id === latest?.featureId)
  const LatestIcon = currentFeature?.icon ?? BrainCircuit

  return (
    <div className="page-stack monitor-page">
      <PageHeader title="实时监控" description="在同一工作台查看设备画面、AI 感知结果和运行记录。" actions={<SimulationStatus showEventTime={showEventTime} />} />
      <div className="metrics-grid" aria-label="模拟设备概览">
        <MetricCard label="设备总数" value={devices.length} icon={Glasses} caption="已录入演示设备" />
        <MetricCard label="模拟在线" value={devices.filter((device) => device.connection === 'online').length} icon={Wifi} tone="green" caption="当前处于模拟在线状态" />
        <MetricCard label="AI 总调用量" value={calls.toLocaleString('zh-CN')} icon={BrainCircuit} tone="violet" caption="模拟基线及本轮新增" highlightChanges />
        <MetricCard label="待审核样本" value={pendingSamples} icon={ClipboardCheck} tone="amber" caption={canViewSamples ? '来自候选样本库' : '当前账号无查看权限'} highlightChanges={canViewSamples} />
      </div>

      <Panel className="monitor-panel" title="实时视频监控" icon={Video} subtitle="选择一台设备，查看画面状态与对应的 AI 感知。" action={
        <GlassSegmentedControl label="视频布局" options={videoLayouts} value={layout} onChange={setLayout} />
      }>
        <div className="device-selector" role="group" aria-label="选择监控设备">
          {devices.map((device) => (
            <button className="device-choice" type="button" aria-pressed={device.id === selected.id} onClick={() => setDeviceId(device.id)} key={device.id}>
              <Glasses size={16} aria-hidden="true" /><span>{device.id}</span><DeviceStatus connection={device.connection} source={device.source} />
            </button>
          ))}
        </div>
        <div className="monitor-grid">
          <div className="monitor-main">
            {layout === 'single' ? <CameraFeed device={selected} /> : (
              <div className="camera-grid" aria-label="四宫格视频">
                {devices.map((device) => <button type="button" key={device.id} className="camera-tile" aria-pressed={device.id === selected.id} aria-label={`选择 ${device.id}`} onClick={() => setDeviceId(device.id)}><CameraFeed device={device} compact /></button>)}
                <CameraFeed compact />
              </div>
            )}
            <div className="camera-controls">
              <div><span className="mono">{selected.id}</span><span className="camera-controls-name">{selected.name}</span><DeviceStatus connection={selected.connection} source={selected.source} /></div>
              <WorkspaceLink className="button button--quiet" to={`/devices/${encodeURIComponent(selected.id)}`}>查看设备详情 <ArrowRight size={15} /></WorkspaceLink>
            </div>
          </div>
          <aside className="perception" aria-label="AI 感知速览">
            <div className="perception-heading"><span className="tone-icon tone-blue"><BrainCircuit size={17} /></span><h3>AI 感知速览</h3><Badge>模拟事件</Badge></div>
            <div className="focus-card monitor-focus-card">
              <div ref={resultHighlight} className="monitor-result-edge" aria-hidden="true" />
              <span className="focus-kicker"><LatestIcon size={14} /> 当前重点 · {currentFeature?.name ?? '暂无结果'}</span>
              <strong>{latest?.result ?? '等待模拟事件'}</strong>
              <span>{latest ? '自动展示所选设备的最新结果' : '该设备尚无事件记录'}</span>
            </div>
            <div className="perception-subtitle">最近 AI 事件</div>
            <div className="event-list">
              {selectedEvents.slice(0, 3).map((event) => {
                const feature = features.find((item) => item.id === event.featureId)
                const Icon = feature?.icon ?? Activity
                return <WorkspaceLink to={`/events?event=${encodeURIComponent(event.id)}`} key={event.id} className="event-peek"><span className={`tone-icon tone-${feature?.tone ?? 'slate'}`}><Icon size={14} /></span><span>{feature?.name}</span>{showEventTime && <time dateTime={event.occurredAt}>{formatTime(event.occurredAt).slice(0, 5)}</time>}<ArrowDownRight size={13} className="peek-arrow" /></WorkspaceLink>
              })}
            </div>
          </aside>
        </div>
      </Panel>

      <Panel className="records-panel" title="最近运行记录" icon={Clock3} subtitle="所有设备的近期 AI 调用记录。" action={<WorkspaceLink className="button button--quiet" to="/events">查看全部 <ArrowRight size={15} /></WorkspaceLink>}>
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th scope="col">设备</th><th scope="col">AI 功能</th><th scope="col">识别结果</th><th scope="col">请求状态</th>{showEventTime && <th scope="col">发生时间</th>}</tr></thead>
          <tbody>{events.slice(0, 5).map((event) => (
            <tr key={event.id}><td><WorkspaceLink className="table-link mono" to={`/devices/${encodeURIComponent(event.deviceId)}`}>{event.deviceId}</WorkspaceLink></td><td>{features.find((feature) => feature.id === event.featureId)?.name}</td><td><WorkspaceLink className="table-result" to={`/events?event=${encodeURIComponent(event.id)}`}>{event.result}</WorkspaceLink></td><td><EventStatus outcome={event.outcome} /></td>{showEventTime && <td className="mono muted">{formatTime(event.occurredAt)}</td>}</tr>
          ))}</tbody>
        </table></div>
      </Panel>
    </div>
  )
}
