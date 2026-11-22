import { useState } from 'react'
import {
  ArrowRight, CircleHelp, Glasses, Radio,
  SearchX, WifiOff,
} from 'lucide-react'
import { DeviceStatus, EmptyState, MetricCard, PageHeader, Panel, deviceSourceLabels } from '../../components/common/ui'
import SearchInput from '../../components/common/SearchInput'
import { WorkspaceLink } from '../../components/workspace/workspaceContext'
import { devices, formatTime } from '../../services/demo'
import type { Device } from '../../types'
import './devices.css'

type StatusFilter = Device['connection'] | 'all'

const statusOptions: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: '全部状态' },
  { value: 'online', label: '模拟在线' },
  { value: 'offline', label: '模拟离线' },
  { value: 'unknown', label: '连接未判定' },
]

function BatteryReading({ value }: { value: number | null }) {
  if (value === null) return <span className="muted" aria-label="无电量数据">—</span>

  return (
    <span className={`device-battery${value < 20 ? ' device-battery--low' : ''}`}>
      <span className="device-battery__track" aria-hidden="true">
        <span style={{ width: `${value}%` }} />
      </span>
      <span>{value}%</span>
    </span>
  )
}

export default function Devices() {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const searchTerm = query.trim().toLowerCase()
  const matches = devices.filter((device) => (
    (status === 'all' || device.connection === status) &&
    (!searchTerm || [device.id, device.name].some((field) => field.toLowerCase().includes(searchTerm)))
  ))
  const count = (value: Device['connection']) => devices.filter((device) => device.connection === value).length

  function resetFilters() {
    setQuery('')
    setStatus('all')
  }

  return (
    <div className="page-stack device-page">
      <PageHeader title="设备管理" description="查看设备资产、连接状态与运行信息。" />

      <section className="metrics-grid metrics-strip" aria-label="设备概览">
        <MetricCard label="设备总数" value={devices.length} icon={Glasses} tone="blue" caption="当前演示设备" />
        <MetricCard label="模拟在线" value={count('online')} icon={Radio} tone="green" caption="演示可连接状态" />
        <MetricCard label="模拟离线" value={count('offline')} icon={WifiOff} tone="slate" caption="演示不可连接状态" />
        <MetricCard label="连接未判定" value={count('unknown')} icon={CircleHelp} tone="violet" caption="没有明确连接结论" />
      </section>

      <Panel title="设备列表" subtitle="所有设备与状态均为演示数据" icon={Glasses}>
        <div className="device-filters">
          <SearchInput className="device-search" label="搜索设备编号或名称" value={query} onChange={setQuery} />
          <select
            aria-label="筛选设备状态"
            className="field-select device-filters__status"
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
          >
            {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <span className="device-filters__count muted" role="status">共 {matches.length} 台设备</span>
        </div>

        {matches.length ? (
          <div className="table-wrap">
            <table className="data-table device-table" aria-label="模拟设备列表">
              <thead>
                <tr>
                  <th scope="col">设备编号</th>
                  <th scope="col">连接状态</th>
                  <th scope="col">电量</th>
                  <th scope="col">网络</th>
                  <th scope="col">数据来源</th>
                  <th scope="col">最近通信</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((device) => (
                  <tr key={device.id}>
                    <th scope="row">
                      <span className="device-table__identity">
                        <span className="device-table__icon" aria-hidden="true"><Glasses size={17} /></span>
                        <span>
                          <span className="device-table__id mono">{device.id}</span>
                          <span className="device-table__name muted">{device.name}</span>
                        </span>
                      </span>
                    </th>
                    <td><DeviceStatus connection={device.connection} source={device.source} /></td>
                    <td><BatteryReading value={device.battery} /></td>
                    <td>{device.network}</td>
                    <td className="muted">{deviceSourceLabels[device.source]}</td>
                    <td className="mono muted">{device.lastSeen && device.lastSeen !== '—' ? formatTime(device.lastSeen) : '—'}</td>
                    <td>
                      <WorkspaceLink className="device-detail-link" to={`/devices/${encodeURIComponent(device.id)}`} aria-label={`查看 ${device.id} 详情`}>
                        查看详情 <ArrowRight size={15} aria-hidden="true" />
                      </WorkspaceLink>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="没有匹配的设备"
            description="请尝试其他设备编号、名称或连接状态。"
            icon={SearchX}
            action={<button type="button" className="button button--quiet" onClick={resetFilters}>清除筛选</button>}
          />
        )}
      </Panel>
    </div>
  )
}
