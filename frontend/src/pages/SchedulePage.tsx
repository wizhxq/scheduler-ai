import { useState, useEffect } from 'react'
import { computeSchedule, getLatestSchedule } from '../api'

const PALETTE = [
  '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b',
  '#ef4444', '#06b6d4', '#ec4899', '#84cc16',
]

export default function SchedulePage() {
  const [schedule, setSchedule] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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

  // Stats
  const totalOps = items.length
  const totalHours = totalMs > 1 ? Math.round(totalMs / 1000 / 60 / 60 * 10) / 10 : 0
  const machineCount = machines.length
  const woCount = workOrderNames.length

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
            <><span className="animate-spin">&#9696;</span> Computing...</>
          ) : (
            <>📊 Optimize Schedule</>
          )}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Stats Row */}
      {schedule && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Operations', value: totalOps, icon: '⚡' },
            { label: 'Work Orders', value: woCount, icon: '📋' },
            { label: 'Machines Used', value: machineCount, icon: '⚙️' },
            { label: 'Total Span', value: `${totalHours}h`, icon: '⏱' },
          ].map(stat => (
            <div key={stat.label} className="bg-gray-900 border border-gray-800 rounded-2xl px-5 py-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{stat.icon}</span>
                <p className="text-gray-500 text-xs font-medium">{stat.label}</p>
              </div>
              <p className="text-white text-2xl font-bold">{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Gantt Chart */}
      {items.length > 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <h2 className="text-white font-semibold mb-1">Gantt Chart</h2>
          <p className="text-gray-500 text-xs mb-6">Timeline view of scheduled operations per machine</p>

          {/* Legend */}
          <div className="flex flex-wrap gap-3 mb-6">
            {workOrderNames.map((name: any) => (
              <div key={name} className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: colorMap[name] }} />
                <span className="text-gray-400 text-xs">{name}</span>
              </div>
            ))}
          </div>

          {/* Gantt Rows */}
          <div className="space-y-3">
            {machines.map((machineName: any) => {
              const machineItems = items.filter((i: any) => i.machine_name === machineName)
              return (
                <div key={machineName}>
                  <div className="flex items-center gap-4">
                    <div className="w-36 flex-shrink-0 text-right">
                      <p className="text-gray-400 text-xs font-medium truncate">{machineName}</p>
                    </div>
                    <div className="flex-1 relative h-10 bg-gray-800 rounded-xl overflow-hidden">
                      {machineItems.map((item: any) => {
                        const startMs = new Date(item.start_time).getTime() - minTime!.getTime()
                        const endMs = new Date(item.end_time).getTime() - minTime!.getTime()
                        const left = (startMs / totalMs) * 100
                        const width = Math.max(((endMs - startMs) / totalMs) * 100, 0.5)
                        return (
                          <div
                            key={item.operation_id}
                            className="absolute top-1 bottom-1 rounded-lg flex items-center px-2 overflow-hidden group"
                            style={{
                              left: `${left}%`,
                              width: `${width}%`,
                              backgroundColor: colorMap[item.work_order_name],
                              opacity: 0.85,
                            }}
                            title={`${item.work_order_name} | ${item.operation_sequence} | ${Math.round((new Date(item.end_time).getTime() - new Date(item.start_time).getTime()) / 60000)} min`}
                          >
                            <span className="text-white text-xs font-semibold truncate leading-none">
                              {width > 5 ? item.work_order_name : ''}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Time axis */}
          {minTime && maxTime && (
            <div className="flex items-center gap-4 mt-4">
              <div className="w-36 flex-shrink-0" />
              <div className="flex-1 flex justify-between">
                <span className="text-gray-600 text-xs">{minTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                <span className="text-gray-600 text-xs">{maxTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="text-6xl mb-4">📅</div>
          <p className="text-gray-400 font-medium text-lg">No schedule computed yet</p>
          <p className="text-gray-600 text-sm mt-2 max-w-sm">
            Add machines and work orders, then click "Optimize Schedule" to generate your Gantt chart.
          </p>
          <button
            onClick={handleCompute}
            disabled={loading}
            className="mt-6 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-colors"
          >
            {loading ? 'Computing...' : 'Optimize Schedule'}
          </button>
        </div>
      )}
    </div>
  )
}
