export const featureIds = ['environment', 'speech', 'sound', 'ocr', 'navigation', 'qa'] as const

export type FeatureId = typeof featureIds[number]
export type StreamId = 'speech' | 'sound'
export type OneShotId = Exclude<FeatureId, StreamId>

export const featureInfo = {
  environment: { label: '环境识别', description: '了解示例场景中的物品和布置。', mode: 'one-shot' },
  speech: { label: '语音转文字', description: '查看示例对话的文字转写。', mode: 'stream' },
  sound: { label: '环境声音识别', description: '查看示例门铃和广播的识别结果。', mode: 'stream' },
  ocr: { label: 'OCR 文字识别', description: '读取演示展签上的文字。', mode: 'one-shot' },
  navigation: { label: '导航定位', description: '查看虚构位置示例，不提供真实指路。', mode: 'one-shot' },
  qa: { label: 'AI 智能问答', description: '询问这个内置场景、展签或模拟位置。', mode: 'one-shot' },
} as const satisfies Record<FeatureId, { label: string; description: string; mode: 'one-shot' | 'stream' }>

export interface GlassesResult {
  id: FeatureId
  text: string
  timestamp: string
  source: 'mock' | 'hardware'
}

export interface GlassesClient {
  connect(): Promise<void>
  disconnect(): Promise<void>
  run(id: OneShotId, input?: string): Promise<GlassesResult>
  subscribe(id: StreamId, onResult: (result: GlassesResult) => void, onError: (error: Error) => void): () => void
}

export const demoQuestions = ['桌上有什么？', '展签上写了什么？', '我现在的位置在哪里？'] as const

const scene = {
  environment: '示例场景中有一张展示台，台面上有一个水杯和一块展签。',
  ocr: '样机演示区\n请勿触碰展品',
  navigation: '虚构路线：展台 A → 中央咨询台 → 展台 B。没有读取你的真实位置，不能用于实际导航。',
} as const

const streamLines = {
  speech: ['您好，这里是智能眼镜展示区。', '如需了解功能，可以查看桌面上的展签。'],
  sound: ['识别到门铃声（示例）。', '识别到室内广播声（示例）。'],
} as const satisfies Record<StreamId, readonly [string, string]>

export const demoStreamLineCount = streamLines.speech.length

const streamDelayMs = [450, 1450] as const
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function makeResult(id: FeatureId, text: string): GlassesResult {
  return { id, text, timestamp: new Date().toISOString(), source: 'mock' }
}

function answerQuestion(input: string = '') {
  const question = input.trim()
  if (!question) throw new Error('请输入一个关于演示场景的问题。')
  if (/怎么(?:走|去)|在哪|位置|路线|指路|导航/u.test(question)) return scene.navigation
  if (/展签|牌子|标牌|写了什么|写着什么|文字|OCR/iu.test(question)) return `演示展签写着「${scene.ocr.replace('\n', '；')}」。`
  if (/桌上|台面|展示台|水杯|眼前|环境|场景/u.test(question)) return scene.environment
  return '离线演示只回答内置场景的问题。可以问桌上有什么、展签写了什么，或查看模拟位置。'
}

export interface DemoGlassesOptions {
  failConnect?: boolean
}

export class DemoGlassesClient implements GlassesClient {
  private connected = false
  private generation = 0
  private readonly failConnect: boolean
  private readonly subscriptions = new Set<() => void>()

  constructor({ failConnect = false }: DemoGlassesOptions = {}) {
    this.failConnect = failConnect
  }

  async connect() {
    if (this.connected) return
    const generation = this.generation
    await delay(380)
    if (generation !== this.generation) throw new Error('演示连接已取消。')
    if (this.failConnect) throw new Error('模拟连接失败：演示眼镜未响应。请重试正常连接。')
    this.connected = true
  }

  async disconnect() {
    this.connected = false
    this.generation += 1
    for (const stop of this.subscriptions) stop()
  }

  async run(id: OneShotId, input?: string) {
    if (!this.connected) throw new Error('请先连接演示眼镜。')
    const generation = this.generation
    const text = id === 'qa' ? answerQuestion(input) : scene[id]
    await delay(280)
    if (!this.connected || generation !== this.generation) throw new Error('演示眼镜已断开，请重新连接后重试。')
    return makeResult(id, text)
  }

  subscribe(id: StreamId, onResult: (result: GlassesResult) => void, onError: (error: Error) => void) {
    if (!this.connected) {
      onError(new Error('请先连接演示眼镜。'))
      return () => {}
    }

    let active = true
    const timers = streamLines[id].map((text, index) => setTimeout(() => {
      if (!active || !this.connected) return
      if (index === demoStreamLineCount - 1) stop()
      onResult(makeResult(id, text))
    }, streamDelayMs[index]))

    const stop = () => {
      if (!active) return
      active = false
      for (const timer of timers) clearTimeout(timer)
      this.subscriptions.delete(stop)
    }

    this.subscriptions.add(stop)
    return stop
  }
}
