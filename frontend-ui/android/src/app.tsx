import { App as AndroidApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import {
  ArrowLeft, AudioLines, Captions, ChevronRight, Eye, Glasses, MapPin,
  MessageCircle, ScanText, Volume2, VolumeX,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { FormEvent } from 'react'
import { useAccessibility } from './accessibility'
import { BottomNav, tabs } from './bottom-nav'
import type { Tab } from './bottom-nav'
import { demoQuestions, featureIds, featureInfo } from './glasses'
import type { FeatureId, GlassesResult } from './glasses'
import { historyLimit, useGlassPreference, useLocalData } from './local-data'
import type { GlassChoice, ThemeChoice } from './local-data'
import { deviceLabels, useDemo } from './use-demo'

const native = Capacitor.getPlatform() === 'android'
const assets = import.meta.env.BASE_URL
const quickActions = ['speech', 'sound', 'environment', 'ocr', 'navigation', 'qa'] as const
const features = {
  speech: { icon: Captions, tone: 'teal', label: '语音字幕', action: '开始字幕演示', resultLabel: '最新字幕', startNote: '字幕示例完成。' },
  sound: { icon: AudioLines, tone: 'teal', label: '声音提醒', action: '开始声音演示', resultLabel: '最新声音提示', startNote: '声音提示示例完成。' },
  environment: { icon: Eye, tone: 'blue', label: '环境识别', action: '识别示例场景', resultLabel: '场景描述' },
  ocr: { icon: ScanText, tone: 'blue', label: '文字识别', action: '识别示例文字', resultLabel: '识别文字' },
  navigation: { icon: MapPin, tone: 'blue', label: '路线演示', action: '查看示例路线', resultLabel: '路线示例' },
  qa: { icon: MessageCircle, tone: 'purple', label: 'AI 问答', action: '提交问题', resultLabel: '回答' },
} as const
const themeOptions: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: '跟随系统' }, { value: 'light', label: '浅色' }, { value: 'dark', label: '深色' },
]
const glassOptions: { value: GlassChoice; label: string }[] = [
  { value: 'system', label: '跟随系统' }, { value: 'on', label: '开启' }, { value: 'off', label: '关闭' },
]
const sourceLabels = { mock: '模拟数据', hardware: '眼镜数据' } as const
type Route = Tab | FeatureId
type Demo = ReturnType<typeof useDemo>
type Speech = ReturnType<typeof useAccessibility>

function hash(route: Route) {
  return `#/${route}`
}

function readRoute(): Route {
  const value = window.location.hash.slice(2)
  return featureIds.find((id) => id === value) ?? tabs.find((tab) => tab.route === value)?.route ?? 'home'
}

function subscribeRoute(listener: () => void) {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

function useTheme(choice: ThemeChoice) {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    function applyTheme() {
      const theme = choice === 'system' ? (media.matches ? 'dark' : 'light') : choice
      document.documentElement.dataset.theme = theme
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#182925' : '#f4f7f5')
    }
    applyTheme()
    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [choice])
}

function Heading({ title, back = false }: { title: string; back?: boolean }) {
  return <header className="page-heading compact-page-heading">
    {back && <a className="compact-back" href={hash('home')} aria-label="返回首页"><ArrowLeft size={20} aria-hidden="true" /></a>}
    <h1 tabIndex={-1}>{title}</h1>
  </header>
}

function Status({ status }: { status: Demo['device'] }) {
  return <span className="device-status" data-status={status} role="status">
    <span className="status-dot" aria-hidden="true" />{deviceLabels[status]}
  </span>
}

function connectLabel(device: Demo['device']) {
  if (device === 'connecting') return '正在连接…'
  return device === 'error' ? '重试连接' : '连接模拟眼镜'
}

function DeviceCard({ demo, showDetails = false }: { demo: Demo; showDetails?: boolean }) {
  const isConnected = demo.device === 'connected'
  const isConnecting = demo.device === 'connecting'
  return <section className="panel device-card" aria-labelledby="device-name">
    <div className="device-summary">
      <span className="device-symbol"><Glasses size={26} aria-hidden="true" /></span>
      <div className="device-copy">
        <h2 id="device-name">演示眼镜</h2>
        <Status status={demo.device} />
      </div>
      {showDetails && <a className="device-details" href={hash('device')} aria-label="设备详情"><ChevronRight size={20} aria-hidden="true" /></a>}
    </div>
    <button
      className="button device-primary"
      data-kind={isConnected ? 'secondary' : 'primary'}
      type="button"
      aria-disabled={isConnecting || undefined}
      onClick={() => {
        if (isConnected) demo.disconnect()
        else if (!isConnecting) demo.connect()
      }}
    >
      {isConnected ? '断开连接' : connectLabel(demo.device)}
    </button>
    {demo.connectionError && <p className="notice" data-tone="error" role="alert">{demo.connectionError}</p>}
  </section>
}

function Home({ demo }: { demo: Demo }) {
  return <div className="page page--home">
    <header className="home-intro"><h1 tabIndex={-1}>我的眼镜</h1></header>
    <DeviceCard demo={demo} showDetails />
    <section className="quick-actions" aria-labelledby="quick-heading">
      <div className="section-top quick-heading"><h2 id="quick-heading">快捷功能</h2></div>
      <div className="quick-grid">
        {quickActions.map((id) => {
          const { icon: Icon, label, tone } = features[id]
          return <a className="quick-tile" data-tone={tone} href={hash(id)} key={id}>
            <span className="quick-icon"><Icon size={21} aria-hidden="true" /></span>
            <span className="quick-label">{label}</span>
          </a>
        })}
      </div>
    </section>
  </div>
}

function Device({ demo }: { demo: Demo }) {
  return <div className="page">
    <Heading title="设备" />
    <DeviceCard demo={demo} />
    <details className="panel secondary-options">
      <summary>演示选项</summary>
      <p className="inline-note">当前仅支持模拟连接。</p>
      <button className="button" data-kind="secondary" type="button" disabled={demo.device !== 'idle'} onClick={() => demo.connect(true)}>
        演示连接失败
      </button>
    </details>
  </div>
}

const formatTime = new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

function Result({ item, showFeature = false }: { item: GlassesResult; showFeature?: boolean }) {
  return <article className="result">
    <div className="result-meta"><span>{showFeature ? featureInfo[item.id].label : '识别结果'}</span>
      <span className="demo-pill">{sourceLabels[item.source]}</span><time dateTime={item.timestamp}>{formatTime.format(new Date(item.timestamp))}</time>
    </div>
    <p className="result-text">{item.text}</p>
  </article>
}

function Feature({ id, demo, speech, autoRead }: { id: FeatureId; demo: Demo; speech: Speech; autoRead: boolean }) {
  const [question, setQuestion] = useState('')
  const [questionError, setQuestionError] = useState(false)
  const visual = features[id]
  const words = featureInfo[id]
  const stream = id === 'speech' || id === 'sound'
  const hasAudio = id === 'environment' || id === 'ocr' || id === 'navigation'
  const pending = demo.pending?.id === id
  const rows = demo.results[id] ?? []
  const latest = rows[rows.length - 1]
  const earlier = rows.slice(0, -1)
  const isConnected = demo.device === 'connected'
  const isConnecting = demo.device === 'connecting'
  const stopping = stream && pending
  const actionDisabled = isConnecting || (pending && !stream)
  const actionLabel = !isConnected ? connectLabel(demo.device) : stopping ? '停止演示' : pending ? '处理中…' : visual.action
  const status = pending
    ? stream ? '正在播放模拟结果。' : '正在生成模拟结果。'
    : id === 'speech' || id === 'sound'
      ? demo.completed === id ? features[id].startNote : ''
      : ''

  function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (actionDisabled) return
    if (!isConnected) {
      demo.connect()
      return
    }
    if (stopping) {
      demo.stop()
      return
    }
    if (id === 'qa' && !question.trim()) {
      setQuestionError(true)
      return
    }
    speech.stop()
    if (id === 'speech' || id === 'sound') demo.start(id)
    else demo.run(id, id === 'qa' ? question.trim() : undefined)
  }

  const announceText = latest && !(hasAudio && autoRead && speech.canSpeak) ? latest.text : ''
  return <div className="page page--detail">
    <Heading title={words.label} back />
    {id === 'navigation' && <p className="inline-note">仅供演示，请勿用于实际出行。</p>}
    <section className="feature-controls" aria-label={`${words.label}操作`}>
      <form onSubmit={start}>
        {isConnected && id === 'qa' && <>
          <div className="field"><label htmlFor="question">你的问题</label>
            <input id="question" value={question} maxLength={120} autoComplete="off" placeholder="例如：桌上有什么？"
              aria-invalid={questionError || undefined} aria-describedby={questionError ? 'question-error' : undefined}
              onChange={(event) => { setQuestion(event.target.value); setQuestionError(false) }} />
            {questionError && <p id="question-error" role="alert">请输入问题或选择一个示例。</p>}
          </div>
          <details className="secondary-options">
            <summary>示例问题</summary>
            <div className="suggestions">{demoQuestions.map((prompt) =>
              <button className="chip" type="button" key={prompt} onClick={() => { setQuestion(prompt); setQuestionError(false) }}>{prompt}</button>)}</div>
          </details>
        </>}
        <button className="button" data-kind={stopping ? 'secondary' : 'primary'} type="submit" aria-disabled={actionDisabled || undefined}>
          {actionLabel}
        </button>
      </form>
      <p className="sr-only" role="status">{isConnecting ? '正在连接模拟眼镜。' : status}</p>
      <div className="sr-only" role="status" aria-live="polite">{announceText}</div>
      {!isConnected && demo.connectionError && <p className="notice" data-tone="error" role="alert">{demo.connectionError}</p>}
      {(latest || pending) && <section className="live-result" data-state={latest ? 'ready' : 'pending'} aria-labelledby="live-result-heading">
        <div className="live-result-head">
          <h2 id="live-result-heading" className="live-result-label">{visual.resultLabel}</h2>
          {latest && <time dateTime={latest.timestamp}>{formatTime.format(new Date(latest.timestamp))}</time>}
        </div>
        <p className="live-result-text">{latest?.text ?? '等待结果…'}</p>
        {latest && <div className="live-result-meta">
          <span>{sourceLabels[latest.source]}</span>
          {stream && pending && <span>接收中</span>}
        </div>}
        {hasAudio && latest && <div className="live-result-actions">
          {speech.speaking
            ? <button className="button" data-kind="secondary" type="button" onClick={speech.stop}><VolumeX size={18} aria-hidden="true" /> 停止朗读</button>
            : <button className="button" data-kind="secondary" type="button" disabled={!speech.canSpeak} onClick={() => speech.speak(latest.text)}>
              <Volume2 size={18} aria-hidden="true" /> 朗读结果
            </button>}
          {speech.speechNote && <p className="inline-note">{speech.speechNote}</p>}
          {speech.speechError && <p className="inline-note" role="status">未能朗读。你仍可阅读文字或稍后重试。</p>}
        </div>}
      </section>}
      {demo.failure?.id === id && <p className="notice" data-tone="error" role="alert">{demo.failure.message}</p>}
    </section>
    {earlier.length > 0 && <details className="earlier-results">
      <summary>本次较早结果（{earlier.length}）</summary>
      <div className="result-list">{earlier.map((row, index) => <Result item={row} key={row.timestamp + index} />)}</div>
    </details>}
  </div>
}

function History({ history, onClear }: { history: GlassesResult[]; onClear: () => void }) {
  const [filter, setFilter] = useState<FeatureId | 'all'>('all')
  const [confirm, setConfirm] = useState(false)
  const [cleared, setCleared] = useState(false)
  const confirmHeading = useRef<HTMLHeadingElement>(null)
  const clearButton = useRef<HTMLButtonElement>(null)
  const emptyMessage = useRef<HTMLParagraphElement>(null)
  const wasConfirming = useRef(false)
  const rows = filter === 'all' ? history : history.filter((row) => row.id === filter)
  useEffect(() => {
    if (confirm) confirmHeading.current?.focus()
    else if (wasConfirming.current) (cleared ? emptyMessage.current : clearButton.current)?.focus()
    wasConfirming.current = confirm
  }, [confirm, cleared])
  return <div className="page">
    <Heading title="记录" />
    {history.length > 0 && <div className="history-filter">
      <div className="field"><label htmlFor="history-filter">按功能筛选</label><select id="history-filter" value={filter}
        onChange={(event) => setFilter(event.target.value as FeatureId | 'all')}>
        <option value="all">全部功能</option>{featureIds.map((id) => <option value={id} key={id}>{featureInfo[id].label}</option>)}
      </select></div>
      {!confirm && history.length > 0 && <button ref={clearButton} className="button" data-kind="quiet" type="button" onClick={() => { setCleared(false); setConfirm(true) }}>清空记录</button>}
    </div>}
    {confirm && <section className="notice" data-tone="warning" aria-labelledby="clear-history">
      <h2 id="clear-history" tabIndex={-1} ref={confirmHeading}>清空这台手机上的所有记录？</h2>
      <p>已保存的结果摘要会被删除，无论当前是否使用了筛选。</p>
      <div className="actions">
        <button className="button" data-kind="secondary" type="button" onClick={() => setConfirm(false)}>取消</button>
        <button className="button" data-kind="danger" type="button" onClick={() => { onClear(); setConfirm(false); setCleared(true) }}>确认清空</button>
      </div>
    </section>}
    <p className="sr-only" role="status">{cleared ? '使用记录已清空。' : ''}</p>
    {rows.length ? <div className="result-list">{rows.map((row, index) => <Result item={row} key={row.timestamp + row.id + index} showFeature />)}</div>
      : <p className="empty-state" ref={emptyMessage} tabIndex={-1}>{history.length ? '此功能暂无记录。' : '暂无记录。可以从首页体验一项辅助功能。'}</p>}
  </div>
}

function Settings({ theme, onTheme, glass, onGlass, autoRead, onAutoRead, speech }: {
  theme: ThemeChoice
  onTheme: (theme: ThemeChoice) => void
  glass: GlassChoice
  onGlass: (glass: GlassChoice) => void
  autoRead: boolean
  onAutoRead: () => void
  speech: Speech
}) {
  return <div className="page">
    <Heading title="设置" />
    <section className="panel" aria-label="外观和朗读">
      <div className="appearance-setting">
        <div className="setting-copy"><h2 id="theme-heading">主题</h2></div>
        <div className="option-group" aria-labelledby="theme-heading" role="group">{themeOptions.map(({ value, label }) =>
          <button className="option" aria-pressed={theme === value} type="button" key={value} onClick={() => onTheme(value)}>{label}</button>)}</div>
      </div>
      <div className="appearance-setting">
        <div className="setting-copy"><h2 id="glass-heading">透明效果</h2></div>
        <div className="option-group" aria-labelledby="glass-heading" role="group">{glassOptions.map(({ value, label }) =>
          <button className="option" aria-pressed={glass === value} type="button" key={value} onClick={() => onGlass(value)}>{label}</button>)}</div>
      </div>
      <div className="appearance-setting">
        <div className="setting-row">
          <div className="setting-copy"><h2 id="speech-heading">结果自动朗读</h2></div>
          <div className="toggle"><button type="button" role="switch" aria-labelledby="speech-heading"
            aria-checked={autoRead} onClick={onAutoRead}><span aria-hidden="true" /></button></div>
        </div>
        {speech.speechNote && <p className="inline-note">{speech.speechNote}</p>}
      </div>
    </section>
    <details className="panel secondary-options">
      <summary>本机数据</summary>
      <p className="inline-note">结果只保存在本机，可在「记录」页清空。演示无需登录或设备权限。</p>
    </details>
  </div>
}

export function App() {
  const route = useSyncExternalStore(subscribeRoute, readRoute)
  const featureId = featureIds.find((id) => id === route)
  const { theme, setTheme, glass, setGlass, autoRead, setAutoRead, history, setHistory, storageAvailable } = useLocalData()
  const speech = useAccessibility()
  const foreground = useRef(document.visibilityState === 'visible')
  const { speak, stop: stopSpeech, fontScale } = speech
  const demo = useDemo((result) => {
    setHistory((current) => [result, ...current].slice(0, historyLimit))
    if (foreground.current && autoRead && (result.id === 'environment' || result.id === 'ocr' || result.id === 'navigation')) speak(result.text)
  })
  const { stop: stopWork, clear: clearDemo } = demo
  const mainRef = useRef<HTMLElement>(null)
  const previous = useRef(route)
  useTheme(theme)
  useGlassPreference(glass)

  useEffect(() => {
    document.documentElement.style.setProperty('--app-font-scale', String(Math.max(.85, Math.min(fontScale, 2))))
  }, [fontScale])

  useEffect(() => {
    if (previous.current === route) return
    previous.current = route
    stopWork()
    stopSpeech()
    window.scrollTo(0, 0)
    if (mainRef.current) mainRef.current.scrollTop = 0
    mainRef.current?.querySelector('h1')?.focus({ preventScroll: true })
  }, [route, stopWork, stopSpeech])

  useEffect(() => {
    const pause = () => { stopWork(); stopSpeech() }
    const handleVisibility = () => {
      foreground.current = document.visibilityState === 'visible'
      if (!foreground.current) pause()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    let disposed = false
    const listeners = native ? [
      AndroidApp.addListener('appStateChange', ({ isActive }) => {
        if (disposed) return
        foreground.current = isActive
        if (!isActive) pause()
      }),
      AndroidApp.addListener('backButton', () => {
        if (disposed) return
        pause()
        if (readRoute() === 'home') void AndroidApp.minimizeApp().catch(() => {})
        else window.location.hash = hash('home')
      }),
    ] : []
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', handleVisibility)
      for (const listener of listeners) void listener.then((handle) => handle.remove()).catch(() => {})
    }
  }, [stopWork, stopSpeech])

  const clearHistory = useCallback(() => { clearDemo(); stopSpeech(); setHistory([]) }, [clearDemo, stopSpeech, setHistory])
  const toggleAutoRead = () => {
    if (autoRead) stopSpeech()
    setAutoRead(!autoRead)
  }

  return <div className="mobile-app">
    <div className="app-shell">
      <header className="app-header">
        <div className="header-brand">
          <span className="brand-mark"><img src={assets + 'glasses.svg'} alt="" /></span>
          <div className="brand-copy"><strong>AI Glasses</strong></div>
        </div>
        <span className="demo-pill">演示模式</span>
      </header>
      <main className="app-main" ref={mainRef}>
        {!storageAvailable && <p className="notice" data-tone="warning" role="status">无法写入本机存储。退出后部分设置和记录可能不会保留。</p>}
        {featureId ? <Feature key={featureId} id={featureId} demo={demo} speech={speech} autoRead={autoRead} /> :
          route === 'device' ? <Device demo={demo} /> :
            route === 'history' ? <History history={history} onClear={clearHistory} /> :
              route === 'settings' ? <Settings theme={theme} onTheme={setTheme} glass={glass} onGlass={setGlass} autoRead={autoRead} onAutoRead={toggleAutoRead} speech={speech} /> :
                <Home demo={demo} />}
      </main>
      <BottomNav currentTab={tabs.find((tab) => tab.route === route)?.route ?? 'home'} />
    </div>
  </div>
}
