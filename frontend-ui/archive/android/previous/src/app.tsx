import { App as AndroidApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import {
  ArrowLeft, ArrowRight, AudioLines, Bluetooth, Captions, ChevronRight, Clock3, Ear, Eye,
  Glasses, House, MapPin, MessageCircle, ScanText, Settings2, Volume2, VolumeX,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { FormEvent } from 'react'
import { useAccessibility } from './accessibility'
import { demoQuestions, featureIds, featureInfo } from './glasses'
import type { FeatureId, GlassesResult } from './glasses'
import { historyLimit, useLocalData } from './local-data'
import type { ThemeChoice } from './local-data'
import { deviceLabels, useDemo } from './use-demo'

const native = Capacitor.getPlatform() === 'android'
const assets = import.meta.env.BASE_URL
const tabs = [
  { route: 'home', label: '首页', icon: House },
  { route: 'device', label: '设备', icon: Glasses },
  { route: 'history', label: '记录', icon: Clock3 },
  { route: 'settings', label: '设置', icon: Settings2 },
] as const
const groups = [
  { title: '听觉辅助', description: '把说话和声音变成文字', icon: Ear, tone: 'teal', entries: ['speech', 'sound'] },
  { title: '视觉辅助', description: '看清环境、文字和路线', icon: Eye, tone: 'blue', entries: ['environment', 'ocr', 'navigation'] },
  { title: '通用功能', description: '有问题，随时问', icon: MessageCircle, tone: 'purple', entries: ['qa'] },
] as const
const features = {
  speech: { icon: Captions, tone: 'teal', caption: '把对话变成字幕', action: '开始字幕演示', startNote: '字幕示例完成。' },
  sound: { icon: AudioLines, tone: 'teal', caption: '看见附近的声音', action: '开始声音演示', startNote: '声音提示示例完成。' },
  environment: { icon: Eye, tone: 'blue', caption: '了解眼前的场景', action: '识别示例场景' },
  ocr: { icon: ScanText, tone: 'blue', caption: '读出画面中的文字', action: '识别示例文字' },
  navigation: { icon: MapPin, tone: 'blue', caption: '查看示例路线', action: '查看示例路线' },
  qa: { icon: MessageCircle, tone: 'purple', caption: '向眼镜提出问题', action: '提交问题' },
} as const
const themeOptions: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: '跟随系统' }, { value: 'light', label: '浅色' }, { value: 'dark', label: '深色' },
]
type Tab = typeof tabs[number]['route']
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
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#121620' : '#edf1f7')
    }
    applyTheme()
    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [choice])
}

function Heading({ title, copy, eyebrow, icon: Icon }: {
  title: string; copy: string; eyebrow: string; icon?: typeof Eye
}) {
  return <header className="page-heading">
    <p className="eyebrow">{Icon && <Icon size={15} aria-hidden="true" />}{eyebrow}</p>
    <h1 tabIndex={-1}>{title}</h1><p>{copy}</p>
  </header>
}

function Status({ status }: { status: Demo['device'] }) {
  return <span className="device-status" data-status={status} role="status">
    <span className="status-dot" aria-hidden="true" />{deviceLabels[status]}
  </span>
}

function Home({ device }: { device: Demo['device'] }) {
  return <div className="page page--home">
    <section className="hero" aria-labelledby="home-title">
      <div className="hero-content">
        <p className="hero-eyebrow"><Glasses size={16} aria-hidden="true" /> AI 眼镜助手</p>
        <h1 id="home-title" tabIndex={-1}>我的智能眼镜</h1>
        <p>听觉与视觉辅助，随手可用。</p>
      </div>
      <img className="hero-art" src={assets + 'glasses-hero.svg'} alt="" />
      <div className="hero-bottom">
        <Status status={device} />
        <a className="hero-link" href={hash('device')}>管理设备 <ArrowRight size={15} aria-hidden="true" /></a>
      </div>
    </section>
    <div className="section-top"><h2>辅助功能</h2><span>6 项功能</span></div>
    {groups.map(({ title, description, icon: Icon, tone, entries }, index) => (
      <section className="feature-group" key={title} aria-labelledby={`group-${index}`}>
        <div className="feature-group-heading" data-tone={tone}>
          <Icon size={16} aria-hidden="true" /><h3 id={`group-${index}`}>{title}</h3><p>{description}</p>
        </div>
        <div className="feature-grid">
          {entries.map((id) => {
            const { icon: FeatureIcon, caption } = features[id]
            return <a className="feature-card" data-tone={tone} href={hash(id)} key={id}>
              <span className="feature-icon"><FeatureIcon size={21} aria-hidden="true" /></span>
              <span className="feature-copy"><strong>{featureInfo[id].label}</strong><span>{caption}</span></span>
              <ChevronRight size={16} className="feature-arrow" aria-hidden="true" />
            </a>
          })}
        </div>
      </section>
    ))}
    <p className="inline-note">当前为离线演示，所有识别结果均来自模拟数据。</p>
  </div>
}

function Device({ demo }: { demo: Demo }) {
  const isConnected = demo.device === 'connected'
  const isConnecting = demo.device === 'connecting'
  return <div className="page">
    <Heading title="我的设备" copy="管理当前用于演示的眼镜连接。" eyebrow="设备连接" icon={Bluetooth} />
    <section className="panel" aria-labelledby="device-name">
      <div className="panel-title"><h2 id="device-name">演示眼镜</h2><span className="demo-pill">模拟设备</span></div>
      <Status status={demo.device} />
      <p className="panel-copy">连接后可体验六项辅助功能。演示不扫描附近设备，也不需要蓝牙权限。</p>
      {demo.connectionError && <div className="notice" data-tone="error" role="alert">{demo.connectionError}</div>}
      <div className="actions">
        {isConnected
          ? <button className="button" data-kind="secondary" type="button" onClick={demo.disconnect}>断开模拟连接</button>
          : <button className="button" data-kind="primary" type="button" disabled={isConnecting} onClick={() => demo.connect()}>
            {isConnecting ? '正在连接…' : demo.device === 'error' ? '重试连接' : '连接模拟眼镜'}
          </button>}
        {demo.device === 'idle' && <button className="button" data-kind="quiet" type="button" onClick={() => demo.connect(true)}>演示连接失败</button>}
        {isConnected && <a className="button" data-kind="primary" href={hash('home')}>打开辅助功能 <ArrowRight size={17} aria-hidden="true" /></a>}
      </div>
    </section>
    <aside className="notice" data-tone="neutral"><strong>真实眼镜尚未接入</strong><p>需要样机的配对和服务协议。此版本没有连接真实硬件，也不会自动扫描设备。</p></aside>
  </div>
}

const formatTime = new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

function Result({ item, showFeature = false }: { item: GlassesResult; showFeature?: boolean }) {
  return <article className="result">
    <div className="result-meta"><span>{showFeature ? featureInfo[item.id].label : '识别结果'}</span>
      <span className="demo-pill">{item.source === 'mock' ? '模拟数据' : '眼镜数据'}</span><time dateTime={item.timestamp}>{formatTime.format(new Date(item.timestamp))}</time>
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
  const isConnected = demo.device === 'connected'
  const status = pending
    ? stream ? '正在播放模拟结果。' : '正在生成模拟结果。'
    : id === 'speech' || id === 'sound'
      ? demo.completed === id ? features[id].startNote : ''
      : ''

  function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
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
    <a className="back-button" href={hash('home')}><ArrowLeft size={18} aria-hidden="true" /> 返回首页</a>
    <Heading title={words.label} copy={words.description} eyebrow={stream ? '听觉辅助' : id === 'qa' ? '通用功能' : '视觉辅助'} icon={visual.icon} />
    {id === 'navigation' && <aside className="notice" data-tone="warning">只展示模拟路线，不使用当前位置，也不能用于出行。</aside>}
    {!isConnected ? <section className="panel">
      <div className="panel-title"><h2>先连接模拟眼镜</h2></div><p className="panel-copy">连接后即可离线体验此功能。</p>
      <div className="actions"><a className="button" data-kind="primary" href={hash('device')}>前往设备页 <ArrowRight size={17} aria-hidden="true" /></a></div>
    </section> : <section className="panel" aria-labelledby="demo-action">
      <div className="panel-title"><h2 id="demo-action">功能演示</h2><span className="demo-pill">离线模拟</span></div>
      <form onSubmit={start}>
        {id === 'qa' && <>
          <div className="field"><label htmlFor="question">你的问题</label>
            <input id="question" value={question} maxLength={120} autoComplete="off" placeholder="例如：桌上有什么？"
              aria-invalid={questionError || undefined} aria-describedby={questionError ? 'question-error' : undefined}
              onChange={(event) => { setQuestion(event.target.value); setQuestionError(false) }} />
            {questionError && <p id="question-error" role="alert">请输入问题或选择一个示例。</p>}
          </div>
          <div className="suggestions" aria-label="示例问题">{demoQuestions.map((prompt) =>
            <button className="chip" type="button" key={prompt} onClick={() => { setQuestion(prompt); setQuestionError(false) }}>{prompt}</button>)}</div>
        </>}
        <div className="actions">
          {stream && pending
            ? <button className="button" data-kind="secondary" type="button" onClick={(event) => { event.preventDefault(); demo.stop() }}>停止演示</button>
            : <button className="button" data-kind="primary" type="submit" disabled={pending}>{pending ? '处理中…' : visual.action}</button>}
        </div>
      </form>
      <p className="inline-note" role="status">{status}</p>
      {demo.failure?.id === id && <p className="notice" data-tone="error" role="alert">{demo.failure.message}</p>}
    </section>}
    <section aria-labelledby="feature-results">
      <div className="section-top"><h2 id="feature-results">演示结果</h2>{rows.length > 0 && <span>{rows.length} 条</span>}</div>
      <div className="sr-only" role="status" aria-live="polite">{announceText}</div>
      {rows.length ? <div className="result-list">{rows.map((row, index) => <Result item={row} key={row.timestamp + index} />)}</div>
        : <p className="empty-state">暂无结果。运行一次功能演示后，结果会显示在这里。</p>}
      {hasAudio && latest && <div className="actions">
        {speech.speaking
          ? <button className="button" data-kind="secondary" type="button" onClick={speech.stop}><VolumeX size={18} aria-hidden="true" /> 停止朗读</button>
          : <button className="button" data-kind="secondary" type="button" disabled={!speech.canSpeak} onClick={() => speech.speak(latest.text)}>
            <Volume2 size={18} aria-hidden="true" /> 朗读结果
          </button>}
        {speech.speechNote && <p className="inline-note">{speech.speechNote}</p>}
        {speech.speechError && <p className="inline-note" role="status">未能朗读。你仍可阅读文字或稍后重试。</p>}
      </div>}
    </section>
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
    <Heading title="使用记录" copy="查看本机保存的识别结果摘要。" eyebrow="本机数据" icon={Clock3} />
    <div className="history-filter">
      <div className="field"><label htmlFor="history-filter">按功能筛选</label><select id="history-filter" value={filter}
        onChange={(event) => setFilter(event.target.value as FeatureId | 'all')}>
        <option value="all">全部功能</option>{featureIds.map((id) => <option value={id} key={id}>{featureInfo[id].label}</option>)}
      </select></div>
      {!confirm && history.length > 0 && <button ref={clearButton} className="button" data-kind="quiet" type="button" onClick={() => { setCleared(false); setConfirm(true) }}>清空记录</button>}
    </div>
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

function Settings({ theme, onTheme, autoRead, onAutoRead, speech }: {
  theme: ThemeChoice; onTheme: (theme: ThemeChoice) => void; autoRead: boolean; onAutoRead: () => void; speech: Speech
}) {
  return <div className="page">
    <Heading title="设置" copy="按你的习惯调整外观和朗读。" eyebrow="使用偏好" icon={Settings2} />
    <section className="panel" aria-labelledby="theme-heading">
      <div className="panel-title"><h2 id="theme-heading">外观</h2></div>
      <div className="option-group" aria-label="外观主题" role="group">{themeOptions.map(({ value, label }) =>
        <button className="option" aria-pressed={theme === value} type="button" key={value} onClick={() => onTheme(value)}>{label}</button>)}</div>
    </section>
    <section className="panel" aria-labelledby="speech-heading">
      <div className="setting-row">
        <div className="setting-copy"><h2 id="speech-heading">结果自动朗读</h2><p id="speech-description">在前台读出环境识别、OCR 和导航的新结果。</p></div>
        <div className="toggle"><button type="button" role="switch" aria-labelledby="speech-heading" aria-describedby="speech-description"
          aria-checked={autoRead} onClick={onAutoRead}><span aria-hidden="true" /></button></div>
      </div>
      {speech.speechNote && <p className="inline-note">{speech.speechNote}</p>}
    </section>
    <aside className="notice" data-tone="neutral"><strong>数据只在这台设备上</strong><p>无需登录，演示不上传数据，也不读取真实位置、相机或麦克风。可在「记录」页清空结果。</p></aside>
  </div>
}

export function App() {
  const route = useSyncExternalStore(subscribeRoute, readRoute)
  const featureId = featureIds.find((id) => id === route)
  const { theme, setTheme, autoRead, setAutoRead, history, setHistory, storageAvailable } = useLocalData()
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
          <div className="brand-copy"><strong>AI Glasses</strong><span>用户端</span></div>
        </div>
        <span className="demo-pill">演示模式</span>
      </header>
      <main className="app-main" ref={mainRef}>
        {!storageAvailable && <p className="notice" data-tone="warning" role="status">无法写入本机存储。退出后部分设置和记录可能不会保留。</p>}
        {featureId ? <Feature key={featureId} id={featureId} demo={demo} speech={speech} autoRead={autoRead} /> :
          route === 'device' ? <Device demo={demo} /> :
            route === 'history' ? <History history={history} onClear={clearHistory} /> :
              route === 'settings' ? <Settings theme={theme} onTheme={setTheme} autoRead={autoRead} onAutoRead={toggleAutoRead} speech={speech} /> :
                <Home device={demo.device} />}
      </main>
      <nav className="app-nav" aria-label="主导航">
        {tabs.map(({ route: tab, label, icon: Icon }) => <a className="nav-item" key={tab} href={hash(tab)}
          aria-current={route === tab || (tab === 'home' && Boolean(featureId)) ? 'page' : undefined}>
          <Icon size={20} aria-hidden="true" /><span>{label}</span>
        </a>)}
      </nav>
    </div>
  </div>
}
