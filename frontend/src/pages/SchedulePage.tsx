import { useState, useEffect, useRef } from 'react'
import { computeSchedule, getLatestSchedule } from '../api'

const PALETTE = [
  '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b',
  '#ef4444', '#06b6d4', '#ec4899', '#84cc16',
  '#f97316', '#a855f7',
]

export default function SchedulePage() {
  const [schedule, setSchedule] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tooltip, setTooltip] = useState<any>(null)
  const chartRef = useRef<HTMLDivElement>(null)

  const loadLatest = async () => {
    try {
      const s = await getLatestSchedule()
      setSchedule(s)
    } catch {
      setSchedule(null)
    }
  }

  useEffect(() => { loadLatest() }, [])

  const handleCompute = async () => {
    setLoading(true)
    setError('')
    try {
      const s = await computeSchedule()
      setSchedule(s)
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Failed to compute schedule')
    } finally {
      setLoading(false)
    }
  }

  const items = schedule?.items || []
  const machines = [...new Set(items.map((i: any) => i.machine_name))]
  const workOrderNames = [...new Set(items.map((i: any) => i.work_order_name))]
  const colorMap: Record<string, string> = {}
  workOrderNames.forEach((name: any, idx) => { colorMap[name] = PALETTE[idx % PALETTE.length] })

  const minTime = items.length ? new Date(Math.min(...items.map((i: any) => new Date(i.start_time).getTime()))) : null
  const maxTime = items.length ? new Date(Math.max(...items.map((i: any) => new Date(i.end_time).getTime()))) : null
  const totalMs = minTime && maxTime ? maxTime.getTime() - minTime.getTime() + 1 : 1

  const totalOps = items.length
  const totalHours = totalMs > 1 ? Math.round(totalMs / 1000 / 60 / 60 * 10) / 10 : 0
  const machineCount = machines.length
  const woCount = workOrderNames.length

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }

  const getMachineUtil = (machineName: string) => {
    const machineItems = items.filter((i: any) => i.machine_name === machineName)
    const busyMs = machineItems.reduce((acc: number, i: any) => {
      return acc + (new Date(i.end_time).getTime() - new Date(i.start_time).getTime())
    }, 0)
    return totalMs > 1 ? Math.round(busyMs / totalMs * 100) : 0
  }

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Schedule</h1>
          <p className="text-gray-500 text-sm mt-1">
            {schedule ? `Last computed: ${new Date(schedule.computed_at || Date.now()).toLocaleString('en-GB')}` : 'No schedule computed yet'}
          </p>
        </div>
        <button
          onClick={handleCompute}
          disabled={loading}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          {loading ? (
            <><span className="animate-spin inline-block">◠</span> Computing...</>
          ) : (
            <>&#128202; Optimize Schedule</>
          )}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { icon: '⚡', label: 'Operations', value: totalOps },
          { icon: '📋', label: 'Work Orders', value: woCount },
          { icon: '⚙️', label: 'Machines Used', value: machineCount },
          { icon: '⏱️', label: 'Total Span', value: totalHours > 0 ? `${totalHours}h` : '—' },
        ].map(stat => (
          <div key={stat.label} className="bg-[#1a1f2e] border border-white/5 rounded-2xl p-5">
            <div className="flex items-center gap-2 text-gray-400 text-xs font-medium mb-2">
              <span>{stat.icon}</span> {stat.label}
            </div>
            <div className="text-2xl font-bold text-white">{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Gantt Chart */}
      {items.length > 0 ? (
        <div className="bg-[#1a1f2e] border border-white/5 rounded-2xl p-6 space-y-4">
          <div>
            <h2 className="text-white font-semibold text-lg">Gantt Chart</h2>
            <p className="text-gray-500 text-sm">Timeline view of scheduled operations per machine</p>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-3">
            {workOrderNames.map((name: any) => (
              <div key={name} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: colorMap[name] }} />
                <span className="text-gray-300 text-xs">{name}</span>
              </div>
            ))}
          </div>

          {/* Chart rows */}
          <div className="space-y-2" ref={chartRef}>
            {machines.map((machine: any) => {
              const machineItems = items.filter((i: any) => i.machine_name === machine)
              const util = getMachineUtil(machine)
              return (
                <div key={machine} className="flex items-center gap-3">
                  {/* Machine label */}
                  <div className="w-36 flex-shrink-0 text-right">
                    <div className="text-gray-200 text-sm font-medium truncate">{machine}</div>
                    <div className="text-gray-500 text-xs">{util}% util</div>
                  </div>
                  {/* Timeline bar */}
                  <div className="flex-1 relative h-10 bg-white/5 rounded-lg overflow-hidden">
                    {machineItems.map((item: any, idx: number) => {
                      const startMs = new Date(item.start_time).getTime() - minTime!.getTime()
                      const durationMs = new Date(item.end_time).getTime() - new Date(item.start_time).getTime()
                      const left = (startMs / totalMs) * 100
                      const width = (durationMs / totalMs) * 100
                      return (
                        <div
                          key={idx}
                          className="absolute top-1 bottom-1 rounded flex items-center justify-center cursor-pointer transition-opacity hover:opacity-80"
                          style={{
                            left: `${left}%`,
                            width: `${Math.max(width, 0.5)}%`,
                            backgroundColor: colorMap[item.work_order_name],
                          }}
                          onMouseEnter={(e) => setTooltip({
                            item,
                            x: (e.target as HTMLElement).getBoundingClientRect().left,
                            y: (e.target as HTMLElement).getBoundingClientRect().top,
                          })}
                          onMouseLeave={() => setTooltip(null)}
                        >
                          {width > 8 && (
                            <span className="text-white text-xs font-semibold px-1 truncate">
                              {item.work_order_name}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Time axis */}
          <div className="flex justify-between text-gray-500 text-xs pl-[156px]">
            <span>{minTime ? formatTime(minTime.toISOString()) : ''}</span>
            <span>{maxTime ? formatTime(maxTime.toISOString()) : ''}</span>
          </div>
        </div>
      ) : (
        <div className="bg-[#1a1f2e] border border-white/5 rounded-2xl p-12 text-center">
          <div className="text-5xl mb-4">📊</div>
          <h3 className="text-white font-semibold text-lg mb-2">No Schedule Yet</h3>
          <p className="text-gray-500 text-sm mb-6">Add machines and work orders, then click Optimize Schedule to generate a Gantt chart.</p>
          <button
            onClick={handleCompute}
            disabled={loading}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {loading ? 'Computing...' : 'Optimize Schedule'}
          </button>
        </div>
      )}

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-[#0f1117] border border-white/10 rounded-xl p-3 shadow-xl pointer-events-none"
          style={{ left: tooltip.x + 10, top: tooltip.y - 80 }}
        >
          <p className="text-white font-semibold text-sm">{tooltip.item.work_order_name}</p>
          <p className="text-gray-400 text-xs mt-0.5">Machine: {tooltip.item.machine_name}</p>
          <p className="text-gray-400 text-xs">Start: {formatTime(tooltip.item.start_time)}</p>
          <p className="text-gray-400 text-xs">End: {formatTime(tooltip.item.end_time)}</p>
          {tooltip.item.sequence_no && <p className="text-gray-400 text-xs">Step: {tooltip.item.sequence_no}</p>}
        </div>
      )}
    </div>
  )
}
