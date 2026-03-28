import { useState, useEffect } from 'react'
import { computeSchedule, getLatestSchedule } from '../api'

const COLORS = ['bg-blue-400', 'bg-green-400', 'bg-purple-400', 'bg-orange-400', 'bg-pink-400', 'bg-teal-400', 'bg-red-400', 'bg-yellow-400']

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
  const minTime = items.length ? new Date(Math.min(...items.map((i: any) => new Date(i.start_time).getTime()))) : null
  const maxTime = items.length ? new Date(Math.max(...items.map((i: any) => new Date(i.end_time).getTime()))) : null
  const totalMs = minTime && maxTime ? maxTime.getTime() - minTime.getTime() : 1

  const workOrderNames = [...new Set(items.map((i: any) => i.work_order_name))]

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Schedule</h1>
        <button className="btn-primary" onClick={handleCompute} disabled={loading}>
          {loading ? 'Computing...' : 'Compute Optimal Schedule'}
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4">{error}</div>}

      {schedule && (
        <div className="card">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h2 className="font-semibold">Run #{schedule.schedule_run_id}</h2>
              <p className="text-sm text-gray-500">Created: {new Date(schedule.created_at).toLocaleString()}</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {workOrderNames.map((name: any, i: number) => (
                <span key={name} className={`text-xs px-2 py-1 rounded text-white ${COLORS[i % COLORS.length]}`}>{name}</span>
              ))}
            </div>
          </div>

          {/* Gantt Chart */}
          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              {machines.map((machine: any) => {
                const machineItems = items.filter((i: any) => i.machine_name === machine)
                return (
                  <div key={machine} className="flex items-center gap-2 mb-2">
                    <div className="w-32 text-sm font-medium truncate shrink-0 text-right pr-2">{machine}</div>
                    <div className="flex-1 h-10 bg-gray-100 rounded relative">
                      {machineItems.map((item: any, idx: number) => {
                        const start = new Date(item.start_time).getTime() - minTime!.getTime()
                        const duration = new Date(item.end_time).getTime() - new Date(item.start_time).getTime()
                        const left = (start / totalMs) * 100
                        const width = (duration / totalMs) * 100
                        const colorIdx = workOrderNames.indexOf(item.work_order_name)
                        return (
                          <div
                            key={idx}
                            className={`absolute h-full rounded text-white text-xs flex items-center justify-center overflow-hidden ${COLORS[colorIdx % COLORS.length]}`}
                            style={{ left: `${left}%`, width: `${Math.max(width, 1)}%` }}
                            title={`${item.work_order_name} - Op ${item.sequence}`}
                          >
                            <span className="truncate px-1">{item.work_order_name}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Detail Table */}
          <table className="w-full text-sm mt-6">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-3">Work Order</th>
                <th className="text-left py-2 px-3">Machine</th>
                <th className="text-left py-2 px-3">Seq</th>
                <th className="text-left py-2 px-3">Start</th>
                <th className="text-left py-2 px-3">End</th>
              </tr>
            </thead>
            <tbody>
              {items.sort((a: any, b: any) => a.work_order_name.localeCompare(b.work_order_name) || a.sequence - b.sequence).map((item: any, i: number) => (
                <tr key={i} className="border-b hover:bg-gray-50">
                  <td className="py-2 px-3 font-medium">{item.work_order_name}</td>
                  <td className="py-2 px-3">{item.machine_name}</td>
                  <td className="py-2 px-3">{item.sequence}</td>
                  <td className="py-2 px-3 text-gray-600">{new Date(item.start_time).toLocaleTimeString()}</td>
                  <td className="py-2 px-3 text-gray-600">{new Date(item.end_time).toLocaleTimeString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!schedule && !loading && (
        <div className="text-center text-gray-400 py-20 card">
          <p className="text-lg mb-2">No schedule computed yet</p>
          <p className="text-sm">Add machines and work orders, then click "Compute Optimal Schedule"</p>
        </div>
      )}
    </div>
  )
}
