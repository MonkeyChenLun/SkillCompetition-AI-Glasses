import { useId, useMemo, useState } from 'react'
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart,
  PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ReferenceLine,
  ResponsiveContainer, Sector, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { PieSectorShapeProps } from 'recharts'
import { Activity, ChartNoAxesCombined, Gauge, PieChart as PieChartIcon, Radar as RadarIcon } from 'lucide-react'
import { Badge, Panel } from '../../components/common/ui'
import GlassSegmentedControl from '../../components/common/GlassSegmentedControl'
import { moduleAnalytics, moduleTrends } from '../../mocks/modules'
import { assistKinds, features, totalCalls } from '../../services/demo'
import { chartAnimationMs } from '../../services/motion'
import type { AssistKind, FeatureId } from '../../types'

const number = new Intl.NumberFormat('zh-CN')
const baselineTotals = totalCalls(moduleAnalytics)

export const featureChartColors: Record<FeatureId, string> = {
  environment: 'var(--chart-c1)',
  speech: 'var(--chart-c2)',
  ocr: 'var(--chart-c3)',
  qa: 'var(--chart-c4)',
  sound: 'var(--chart-c5)',
  navigation: 'var(--chart-c6)',
}

const shortLabels: Record<FeatureId, string> = {
  environment: '环境识别',
  speech: '语音转写',
  sound: '声音识别',
  ocr: 'OCR 识字',
  navigation: '导航定位',
  qa: '智能问答',
}

export interface FeatureMetricRow {
  id: FeatureId
  name: string
  shortName: string
  assist: AssistKind
  color: string
  calls: number
  failures: number
  successRate: number
  avgMs: number
  avgSec: number
  share: number
  reliabilityScore: number
  speedScore: number
  activityScore: number
  healthScore: number
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export function buildFeatureRows(analytics: typeof moduleAnalytics): FeatureMetricRow[] {
  const totals = totalCalls(analytics)
  const maxCalls = Math.max(1, ...features.map(({ id }) => analytics[id].calls))
  return features.map(({ id, name, assist }) => {
    const item = analytics[id]
    const calls = Math.max(1, item.calls)
    const successRate = (1 - item.failures / calls) * 100
    const avgMs = item.elapsedMs / calls
    const avgSec = avgMs / 1000
    const share = totals.calls > 0 ? (item.calls / totals.calls) * 100 : 0
    // Map 90%–100% reliability onto 0–100 scale so subtle stability gaps are clear on the radar.
    const reliabilityScore = Math.round(clamp((successRate - 90) * 10, 20, 100))
    // Map 300ms (100pt) -> 2100ms (25pt) latency cleanly onto a speed score.
    const speedScore = Math.round(clamp(100 - ((avgMs - 300) / 1800) * 75, 25, 100))
    const activityScore = Math.round(clamp((item.calls / maxCalls) * 100, 18, 100))
    const healthScore = Math.round(reliabilityScore * 0.55 + speedScore * 0.35 + activityScore * 0.10)
    return {
      id,
      name,
      shortName: shortLabels[id],
      assist,
      color: featureChartColors[id],
      calls: item.calls,
      failures: item.failures,
      successRate: Number(successRate.toFixed(1)),
      avgMs: Math.round(avgMs),
      avgSec: Number(avgSec.toFixed(2)),
      share: Number(share.toFixed(1)),
      reliabilityScore,
      speedScore,
      activityScore,
      healthScore,
    }
  })
}

const trendModeOptions = [
  { value: 'combined', label: '双轴总览' },
  { value: 'calls', label: '请求量' },
  { value: 'latency', label: '平均耗时' },
] as const

type TrendMode = (typeof trendModeOptions)[number]['value']

interface TrendPoint {
  time: string
  calls: number
  latency: number
  successRate: number
  isLive?: boolean
}

function TrendTooltip({ active, payload, label }: {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: TrendPoint }>
  label?: string | number
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  return (
    <div className="analytics-tooltip">
      <div className="analytics-tooltip-title">
        <span>{point.isLive ? '本轮实时抽样' : `${label} 时段`}</span>
        {point.isLive && <span className="analytics-tooltip-live">LIVE</span>}
      </div>
      <div className="analytics-tooltip-row">
        <span className="analytics-dot" style={{ background: 'var(--chart-line)' }} />
        <span>AI 请求量</span>
        <strong>{number.format(point.calls)} 次</strong>
      </div>
      <div className="analytics-tooltip-row">
        <span className="analytics-dot" style={{ background: 'var(--chart-latency)' }} />
        <span>平均响应耗时</span>
        <strong>{number.format(point.latency)} ms</strong>
      </div>
      <div className="analytics-tooltip-row">
        <span className="analytics-dot" style={{ background: 'var(--chart-c2)' }} />
        <span>时段成功率</span>
        <strong>{point.successRate.toFixed(1)}%</strong>
      </div>
    </div>
  )
}

export function DualTrendChart({
  analytics,
  isSimulating,
}: {
  analytics: typeof moduleAnalytics
  isSimulating: boolean
}) {
  const [mode, setMode] = useState<TrendMode>('combined')
  const uid = useId().replace(/:/g, '')
  const barGradId = `analytics-bar-${uid}`
  const callsAreaId = `analytics-calls-area-${uid}`
  const latencyAreaId = `analytics-latency-area-${uid}`

  const data = useMemo<TrendPoint[]>(() => {
    const totals = totalCalls(analytics)
    const deltaCalls = totals.calls - baselineTotals.calls
    const base: TrendPoint[] = moduleTrends.map((point) => ({ ...point }))
    if (deltaCalls > 0) {
      const deltaElapsed = Math.max(0, totals.elapsedMs - baselineTotals.elapsedMs)
      const deltaFailures = Math.max(0, totals.failures - baselineTotals.failures)
      const liveLatency = Math.round(deltaElapsed / deltaCalls)
      const liveSuccess = Number((((deltaCalls - deltaFailures) / deltaCalls) * 100).toFixed(1))
      base.push({
        time: '实时',
        calls: 68 + deltaCalls * 4,
        latency: clamp(liveLatency, 220, 1450),
        successRate: liveSuccess,
        isLive: true,
      })
    }
    return base
  }, [analytics])

  const peakCalls = Math.max(...data.map((item) => item.calls))
  const peakLatency = Math.max(...data.map((item) => item.latency))
  const callsDomainMax = Math.ceil((peakCalls + 14) / 20) * 20
  const latencyDomainMax = Math.max(1400, Math.ceil((peakLatency + 120) / 200) * 200)

  const subtitle = mode === 'combined'
    ? '柱状呈现时段请求量，曲线叠加平均响应耗时，直观定位高峰瓶颈'
    : mode === 'calls'
      ? '历史演示日的小时请求量变化（开启模拟刷新后自动追加实时采样）'
      : '小时级平均响应耗时走势，虚线标注 1000 ms 响应基线'

  return (
    <Panel
      title="AI 请求量 × 响应耗时趋势"
      subtitle={subtitle}
      icon={ChartNoAxesCombined}
      action={
        <div className="analytics-panel-controls">
          <Badge tone={isSimulating ? 'green' : 'slate'} dot={isSimulating}>
            {isSimulating ? '实时推演中' : '模拟基线'}
          </Badge>
          <GlassSegmentedControl
            label="切换趋势图展示模式"
            options={trendModeOptions}
            value={mode}
            onChange={setMode}
          />
        </div>
      }
    >
      <div className="analytics-chart-tall" role="group" aria-label="AI 请求量与响应耗时动态趋势图">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 680, height: 270 }}>
          <ComposedChart data={data} margin={{ top: 14, right: mode === 'combined' ? 12 : 20, left: 0, bottom: 2 }}>
            <defs>
              <linearGradient id={barGradId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-line)" stopOpacity={0.78} />
                <stop offset="100%" stopColor="var(--chart-line)" stopOpacity={0.18} />
              </linearGradient>
              <linearGradient id={callsAreaId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-line)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--chart-line)" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id={latencyAreaId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-latency)" stopOpacity={0.24} />
                <stop offset="100%" stopColor="var(--chart-latency)" stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <CartesianGrid stroke="var(--chart-grid)" vertical={false} strokeDasharray="4 4" />
            <XAxis
              dataKey="time"
              tickLine={false}
              axisLine={false}
              tickMargin={10}
              tick={{ fill: 'var(--chart-tick)', fontSize: 12 }}
            />

            {mode !== 'latency' && (
              <YAxis
                yAxisId="calls"
                width={42}
                domain={[0, callsDomainMax]}
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--chart-tick)', fontSize: 12 }}
              />
            )}

            {mode !== 'calls' && (
              <YAxis
                yAxisId="latency"
                orientation={mode === 'combined' ? 'right' : 'left'}
                width={58}
                domain={[400, latencyDomainMax]}
                tickFormatter={(value: number) => `${value}ms`}
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--chart-tick)', fontSize: 12 }}
              />
            )}

            <Tooltip content={<TrendTooltip />} cursor={{ fill: 'var(--accent-soft)', fillOpacity: 0.45 }} />

            {mode !== 'calls' && (
              <ReferenceLine
                yAxisId="latency"
                y={1000}
                stroke="var(--tone-amber-fg)"
                strokeDasharray="5 5"
                strokeOpacity={0.65}
                label={{
                  value: '1000ms 基线',
                  position: 'insideTopLeft',
                  dy: -4,
                  fill: 'var(--tone-amber-fg)',
                  fontSize: 11,
                  fontWeight: 600,
                }}
              />
            )}

            {mode === 'combined' && (
              <Bar
                yAxisId="calls"
                dataKey="calls"
                name="AI 请求量"
                fill={`url(#${barGradId})`}
                radius={[7, 7, 2, 2]}
                maxBarSize={34}
                animationDuration={chartAnimationMs}
                isAnimationActive="auto"
              />
            )}

            {mode === 'calls' && (
              <>
                <Area
                  yAxisId="calls"
                  type="monotone"
                  dataKey="calls"
                  stroke="none"
                  fill={`url(#${callsAreaId})`}
                  tooltipType="none"
                  isAnimationActive={false}
                  activeDot={false}
                />
                <Line
                  yAxisId="calls"
                  type="monotone"
                  dataKey="calls"
                  name="AI 请求量"
                  stroke="var(--chart-line)"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: 'var(--chart-line)', stroke: 'var(--surface)', strokeWidth: 2 }}
                  activeDot={{ r: 6 }}
                  animationDuration={chartAnimationMs}
                  isAnimationActive="auto"
                />
              </>
            )}

            {mode !== 'calls' && (
              <>
                <Area
                  yAxisId="latency"
                  type="monotone"
                  dataKey="latency"
                  baseValue={400}
                  stroke="none"
                  fill={`url(#${latencyAreaId})`}
                  tooltipType="none"
                  isAnimationActive={false}
                  activeDot={false}
                />
                <Line
                  yAxisId="latency"
                  type="monotone"
                  dataKey="latency"
                  name="平均响应耗时"
                  stroke="var(--chart-latency)"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: 'var(--chart-latency)', stroke: 'var(--surface)', strokeWidth: 2 }}
                  activeDot={{ r: 6 }}
                  animationDuration={chartAnimationMs}
                  isAnimationActive="auto"
                />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="analytics-legend-bar">
        {mode !== 'latency' && (
          <span className="analytics-legend-chip">
            <span className="analytics-dot" style={{ background: 'var(--chart-line)' }} />
            AI 请求量（次）
          </span>
        )}
        {mode !== 'calls' && (
          <span className="analytics-legend-chip">
            <span className="analytics-dot" style={{ background: 'var(--chart-latency)' }} />
            平均响应耗时（ms）
          </span>
        )}
        <span className="analytics-legend-hint">
          {mode === 'combined' ? '左轴请求量 · 右轴响应耗时' : '悬停任意节点查看时段明细'}
        </span>
      </div>
    </Panel>
  )
}

const donutGroupOptions = [
  { value: 'feature', label: '按功能' },
  { value: 'assist', label: '按模态' },
] as const

type DonutGroup = (typeof donutGroupOptions)[number]['value']

interface DonutSlice {
  key: string
  featureId?: FeatureId
  name: string
  subtitle: string
  value: number
  share: number
  color: string
}

function DonutTooltip({ active, payload }: {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: DonutSlice }>
}) {
  const slice = payload?.[0]?.payload
  if (!active || !slice) return null
  return (
    <div className="analytics-tooltip">
      <div className="analytics-tooltip-title">
        <span className="analytics-dot" style={{ background: slice.color }} />
        <span>{slice.name}</span>
      </div>
      <div className="analytics-tooltip-row">
        <span>调用总量</span>
        <strong>{number.format(slice.value)} 次</strong>
      </div>
      <div className="analytics-tooltip-row">
        <span>占比</span>
        <strong>{slice.share.toFixed(1)}%</strong>
      </div>
    </div>
  )
}

export function DistributionDonutChart({
  rows,
  selectedFeatureId,
  onSelectFeature,
}: {
  rows: FeatureMetricRow[]
  selectedFeatureId: FeatureId | null
  onSelectFeature: (id: FeatureId | null) => void
}) {
  const [group, setGroup] = useState<DonutGroup>('feature')
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const total = rows.reduce((sum, item) => sum + item.calls, 0)

  const slices = useMemo<DonutSlice[]>(() => {
    if (group === 'feature') {
      return [...rows]
        .sort((a, b) => b.calls - a.calls)
        .map((row) => ({
          key: row.id,
          featureId: row.id,
          name: row.name,
          subtitle: assistKinds[row.assist].label,
          value: row.calls,
          share: row.share,
          color: row.color,
        }))
    }
    const visionRows = rows.filter((row) => row.assist === 'vision')
    const hearingRows = rows.filter((row) => row.assist === 'hearing')
    const visionCalls = visionRows.reduce((sum, item) => sum + item.calls, 0)
    const hearingCalls = hearingRows.reduce((sum, item) => sum + item.calls, 0)
    return [
      {
        key: 'vision',
        name: assistKinds.vision.label,
        subtitle: `${visionRows.length} 项能力 · ${assistKinds.vision.audience}`,
        value: visionCalls,
        share: total > 0 ? Number(((visionCalls / total) * 100).toFixed(1)) : 0,
        color: 'var(--chart-c1)',
      },
      {
        key: 'hearing',
        name: assistKinds.hearing.label,
        subtitle: `${hearingRows.length} 项能力 · ${assistKinds.hearing.audience}`,
        value: hearingCalls,
        share: total > 0 ? Number(((hearingCalls / total) * 100).toFixed(1)) : 0,
        color: 'var(--chart-c2)',
      },
    ]
  }, [group, rows, total])

  const activeKey = hoveredKey ?? (group === 'feature' ? selectedFeatureId : null)
  const activeSlice = slices.find((slice) => slice.key === activeKey) ?? null

  function renderSector(props: PieSectorShapeProps) {
    const slice = slices[props.index]
    const isHighlighted = Boolean(slice && (props.isActive || slice.key === activeKey))
    const isDimmed = Boolean(activeKey && slice && slice.key !== activeKey)
    const baseOuter = Number(props.outerRadius ?? 0)
    const outerRadius = isHighlighted ? baseOuter + 6 : baseOuter
    return (
      <g>
        <Sector
          {...props}
          outerRadius={outerRadius}
          fill={slice?.color ?? props.fill}
          fillOpacity={isDimmed ? 0.36 : 0.94}
          stroke="var(--surface)"
          strokeWidth={2}
        />
        {isHighlighted && (
          <Sector
            cx={props.cx}
            cy={props.cy}
            innerRadius={outerRadius + 3}
            outerRadius={outerRadius + 5.5}
            startAngle={props.startAngle}
            endAngle={props.endAngle}
            fill={slice?.color ?? props.fill}
            fillOpacity={0.32}
          />
        )}
      </g>
    )
  }

  return (
    <Panel
      title="AI 调用分布占比"
      subtitle={group === 'feature' ? '点击任意扇区或图例，联动聚焦雷达图、排行图与明细表' : '按视障视觉辅助与听障听觉辅助双模态统计'}
      icon={PieChartIcon}
      action={
        <GlassSegmentedControl
          label="切换占比分组方式"
          options={donutGroupOptions}
          value={group}
          onChange={(next) => {
            setGroup(next)
            setHoveredKey(null)
          }}
        />
      }
    >
      <div className="analytics-donut-layout">
        <div className="analytics-donut-stage" role="group" aria-label="AI 调用占比动态环形图">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 260, height: 240 }}>
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius="58%"
                outerRadius="80%"
                paddingAngle={3}
                cornerRadius={6}
                shape={renderSector}
                animationDuration={chartAnimationMs}
                isAnimationActive="auto"
                onMouseEnter={(_, index) => setHoveredKey(slices[index]?.key ?? null)}
                onMouseLeave={() => setHoveredKey(null)}
                onClick={(_, index) => {
                  const featureId = slices[index]?.featureId
                  if (featureId) onSelectFeature(selectedFeatureId === featureId ? null : featureId)
                }}
              >
                {slices.map((slice) => (
                  <Cell key={slice.key} fill={slice.color} cursor={slice.featureId ? 'pointer' : 'default'} />
                ))}
              </Pie>
              <Tooltip content={<DonutTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="analytics-donut-center" aria-live="polite">
            <span className="analytics-donut-label">{activeSlice ? activeSlice.name : 'AI 总调用'}</span>
            <strong className="analytics-donut-value">
              {activeSlice ? `${activeSlice.share.toFixed(1)}%` : number.format(total)}
            </strong>
            <span className="analytics-donut-sub">
              {activeSlice ? `${number.format(activeSlice.value)} 次` : '6 项能力合计'}
            </span>
          </div>
        </div>

        <div className="analytics-donut-list" role="list" aria-label="调用占比明细">
          {slices.map((slice) => {
            const selected = Boolean(slice.featureId && selectedFeatureId === slice.featureId)
            const hovered = hoveredKey === slice.key
            return (
              <button
                key={slice.key}
                type="button"
                className={`analytics-donut-item${selected ? ' is-selected' : ''}${hovered ? ' is-hovered' : ''}`}
                onMouseEnter={() => setHoveredKey(slice.key)}
                onMouseLeave={() => setHoveredKey(null)}
                onClick={() => {
                  if (slice.featureId) onSelectFeature(selected ? null : slice.featureId)
                }}
                disabled={!slice.featureId}
              >
                <span className="analytics-dot" style={{ background: slice.color }} />
                <span className="analytics-donut-item-main">
                  <strong>{slice.name}</strong>
                  <small>{slice.subtitle}</small>
                </span>
                <span className="analytics-donut-item-stat">
                  <strong>{slice.share.toFixed(1)}%</strong>
                  <small>{number.format(slice.value)} 次</small>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </Panel>
  )
}

const radarModeOptions = [
  { value: 'composite', label: '综合健康' },
  { value: 'reliability', label: '稳定性' },
  { value: 'speed', label: '响应速度' },
] as const

type RadarMode = (typeof radarModeOptions)[number]['value']

function RadarTooltip({ active, payload }: {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: FeatureMetricRow }>
}) {
  const row = payload?.[0]?.payload
  if (!active || !row) return null
  return (
    <div className="analytics-tooltip">
      <div className="analytics-tooltip-title">
        <span className="analytics-dot" style={{ background: row.color }} />
        <span>{row.name}</span>
      </div>
      <div className="analytics-tooltip-row">
        <span>综合健康分</span>
        <strong>{row.healthScore} 分</strong>
      </div>
      <div className="analytics-tooltip-row">
        <span>任务成功率</span>
        <strong>{row.successRate.toFixed(1)}%（失败 {row.failures}）</strong>
      </div>
      <div className="analytics-tooltip-row">
        <span>平均处理耗时</span>
        <strong>{row.avgSec.toFixed(2)} s（速度 {row.speedScore} 分）</strong>
      </div>
    </div>
  )
}

export function HealthRadarChart({
  rows,
  selectedFeatureId,
}: {
  rows: FeatureMetricRow[]
  selectedFeatureId: FeatureId | null
}) {
  const [mode, setMode] = useState<RadarMode>('composite')
  const uid = useId().replace(/:/g, '')
  const primaryGradId = `analytics-radar-a-${uid}`
  const secondaryGradId = `analytics-radar-b-${uid}`

  const avgHealth = Math.round(rows.reduce((sum, item) => sum + item.healthScore, 0) / Math.max(1, rows.length))
  const topFeature = [...rows].sort((a, b) => b.healthScore - a.healthScore)[0]
  const watchFeature = [...rows].sort((a, b) => a.healthScore - b.healthScore)[0]
  const focused = rows.find((item) => item.id === selectedFeatureId)

  const primaryKey = mode === 'composite' ? 'healthScore' : mode === 'reliability' ? 'reliabilityScore' : 'speedScore'
  const primaryLabel = mode === 'composite' ? '综合健康分' : mode === 'reliability' ? '稳定性得分' : '响应速度得分'
  const primaryColor = mode === 'speed' ? 'var(--chart-c2)' : 'var(--chart-line)'

  return (
    <Panel
      title="六维 AI 健康度雷达"
      subtitle="综合成功率、响应速度与活跃度实时评估六项能力均衡性"
      icon={RadarIcon}
      action={
        <GlassSegmentedControl
          label="切换雷达图评估维度"
          options={radarModeOptions}
          value={mode}
          onChange={setMode}
        />
      }
    >
      <div className="analytics-radar-stage" role="group" aria-label="六项 AI 功能健康度雷达图">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 320, height: 248 }}>
          <RadarChart data={rows} outerRadius="72%">
            <defs>
              <linearGradient id={primaryGradId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={primaryColor} stopOpacity={0.40} />
                <stop offset="100%" stopColor={primaryColor} stopOpacity={0.08} />
              </linearGradient>
              <linearGradient id={secondaryGradId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-c2)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--chart-c2)" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <PolarGrid stroke="var(--chart-grid)" gridType="polygon" />
            <PolarAngleAxis
              dataKey="shortName"
              tick={{ fill: 'var(--chart-tick)', fontSize: 12 }}
            />
            <PolarRadiusAxis
              angle={30}
              domain={[0, 100]}
              tickCount={5}
              tick={{ fill: 'var(--chart-tick)', fontSize: 10 }}
              axisLine={false}
            />
            {mode === 'composite' && (
              <Radar
                name="稳定性得分"
                dataKey="reliabilityScore"
                stroke="var(--chart-c2)"
                strokeWidth={1.6}
                strokeDasharray="4 4"
                fill={`url(#${secondaryGradId})`}
                animationDuration={chartAnimationMs}
                isAnimationActive="auto"
              />
            )}
            <Radar
              name={primaryLabel}
              dataKey={primaryKey}
              stroke={primaryColor}
              strokeWidth={2.4}
              fill={`url(#${primaryGradId})`}
              dot={{ r: 3.5, fill: primaryColor, stroke: 'var(--surface)', strokeWidth: 1.5 }}
              activeDot={{ r: 5.5 }}
              animationDuration={chartAnimationMs}
              isAnimationActive="auto"
            />
            <Tooltip content={<RadarTooltip />} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <div className="analytics-radar-footer">
        {focused ? (
          <div className="analytics-radar-pill is-focus">
            <span className="analytics-dot" style={{ background: focused.color }} />
            <span>已选中 <strong>{focused.name}</strong>：健康 {focused.healthScore} 分 · 成功率 {focused.successRate.toFixed(1)}% · 耗时 {focused.avgSec.toFixed(2)}s</span>
          </div>
        ) : (
          <>
            <div className="analytics-radar-pill">
              <Activity size={13} aria-hidden="true" />
              <span>均值 <strong>{avgHealth} 分</strong></span>
            </div>
            {topFeature && (
              <div className="analytics-radar-pill">
                <span>最优 <strong>{topFeature.shortName}</strong> ({topFeature.healthScore})</span>
              </div>
            )}
            {watchFeature && (
              <div className="analytics-radar-pill">
                <span>待优化 <strong>{watchFeature.shortName}</strong> ({watchFeature.healthScore})</span>
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  )
}

const barMetricOptions = [
  { value: 'latency', label: '平均耗时' },
  { value: 'successRate', label: '成功率' },
  { value: 'calls', label: '调用量' },
] as const

type BarMetric = (typeof barMetricOptions)[number]['value']

function PerformanceTooltip({ active, payload }: {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: FeatureMetricRow }>
}) {
  const row = payload?.[0]?.payload
  if (!active || !row) return null
  return (
    <div className="analytics-tooltip">
      <div className="analytics-tooltip-title">
        <span className="analytics-dot" style={{ background: row.color }} />
        <span>{row.name}</span>
      </div>
      <div className="analytics-tooltip-row">
        <span>平均处理耗时</span>
        <strong>{row.avgSec.toFixed(2)} s（{row.avgMs} ms）</strong>
      </div>
      <div className="analytics-tooltip-row">
        <span>任务成功率</span>
        <strong>{row.successRate.toFixed(1)}%</strong>
      </div>
      <div className="analytics-tooltip-row">
        <span>调用量 / 失败</span>
        <strong>{number.format(row.calls)} 次 / {row.failures} 失败</strong>
      </div>
    </div>
  )
}

export function PerformanceBarChart({
  rows,
  selectedFeatureId,
  onSelectFeature,
}: {
  rows: FeatureMetricRow[]
  selectedFeatureId: FeatureId | null
  onSelectFeature: (id: FeatureId | null) => void
}) {
  const [metric, setMetric] = useState<BarMetric>('latency')

  const sorted = useMemo(() => {
    const copy = [...rows]
    if (metric === 'latency') return copy.sort((a, b) => b.avgSec - a.avgSec)
    if (metric === 'successRate') return copy.sort((a, b) => a.successRate - b.successRate)
    return copy.sort((a, b) => b.calls - a.calls)
  }, [rows, metric])

  const avgCalls = Math.round(rows.reduce((sum, item) => sum + item.calls, 0) / Math.max(1, rows.length))
  const dataKey = metric === 'latency' ? 'avgSec' : metric === 'successRate' ? 'successRate' : 'calls'
  const domain: [number, number] =
    metric === 'latency'
      ? [0, Math.max(2.2, Math.ceil((Math.max(...rows.map((r) => r.avgSec)) + 0.25) * 5) / 5)]
      : metric === 'successRate'
        ? [92, 100]
        : [0, Math.ceil((Math.max(...rows.map((r) => r.calls)) + 40) / 50) * 50]

  const reference =
    metric === 'latency'
      ? { value: 1.0, label: '1.0s 目标线', color: 'var(--tone-amber-fg)' }
      : metric === 'successRate'
        ? { value: 96, label: '96% 警戒线', color: 'var(--tone-amber-fg)' }
        : { value: avgCalls, label: `均值 ${avgCalls} 次`, color: 'var(--chart-line)' }

  const subtitle =
    metric === 'latency'
      ? '按耗时降序排列，超过 1.0 s 虚线的能力需重点优化端云推理链路'
      : metric === 'successRate'
        ? '按成功率升序排列，快速暴露低于 96% 基线的波动功能'
        : '按累计调用量降序对比，点击柱条可联动高亮下方明细表'

  return (
    <Panel
      title="六项功能性能动态排行"
      subtitle={subtitle}
      icon={Gauge}
      action={
        <GlassSegmentedControl
          label="切换性能排行指标"
          options={barMetricOptions}
          value={metric}
          onChange={setMetric}
        />
      }
    >
      <div className="analytics-bar-stage" role="group" aria-label="六项 AI 功能性能动态条形图">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 680, height: 268 }}>
          <BarChart data={sorted} layout="vertical" margin={{ top: 24, right: 28, left: 6, bottom: 4 }}>
            <CartesianGrid stroke="var(--chart-grid)" horizontal={false} strokeDasharray="4 4" />
            <XAxis
              type="number"
              domain={domain}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value: number) =>
                metric === 'latency' ? `${value}s` : metric === 'successRate' ? `${value}%` : String(value)
              }
              tick={{ fill: 'var(--chart-tick)', fontSize: 12 }}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={94}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--ink)', fontSize: 12 }}
            />
            <Tooltip content={<PerformanceTooltip />} cursor={{ fill: 'var(--accent-soft)', fillOpacity: 0.45 }} />
            <ReferenceLine
              x={reference.value}
              stroke={reference.color}
              strokeDasharray="5 5"
              strokeOpacity={0.75}
              label={{
                value: reference.label,
                position: 'top',
                dy: -4,
                fill: reference.color,
                fontSize: 11,
                fontWeight: 600,
              }}
            />
            <Bar
              dataKey={dataKey}
              barSize={20}
              radius={[0, 7, 7, 0]}
              animationDuration={chartAnimationMs}
              isAnimationActive="auto"
              onClick={(entry) => {
                const id = (entry as { id?: FeatureId } | undefined)?.id
                if (id) onSelectFeature(selectedFeatureId === id ? null : id)
              }}
            >
              {sorted.map((row) => {
                const isSelected = selectedFeatureId === row.id
                const isDimmed = Boolean(selectedFeatureId && !isSelected)
                return (
                  <Cell
                    key={row.id}
                    fill={row.color}
                    fillOpacity={isDimmed ? 0.32 : 0.88}
                    stroke={isSelected ? 'var(--ink)' : 'none'}
                    strokeWidth={isSelected ? 1.5 : 0}
                    cursor="pointer"
                  />
                )
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  )
}
