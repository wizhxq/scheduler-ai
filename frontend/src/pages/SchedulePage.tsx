
import { useState, useEffect } from 'react'
import { getLatestSchedule, computeSchedule } from '../api'

export default function SchedulePage() {
  const [schedule, setSchedule] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [computing, setComputing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getLatestSchedule()
      setSchedule(data)
    } catch (err: any) {
      if (err.response?.status === 404) {
        setSchedule(null)
      } else {
        setError('Failed to load schedule')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleCompute = async () => {
    setComputing(true)
    setError(null)
    try {
      const data = await computeSchedule()
      setSchedule(data)
    } catch (err) {
      setError('Failed to compute schedule')
    } finally {
      setComputing(false)
    }
  }

  if (loading && !schedule) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="text-gray-400 animate-pulse">Loading schedule...</div>
      </div>
    )
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Production Schedule</h1>
          <p className="text-gray-400 text-sm mt-1">
            {schedule ? `Last computed: ${new Date(schedule.computed_at).toLocaleString()}` : 'No schedule computed yet'}
          </p>
        </div>
        <button
          onClick={handleCompute}
          disabled={computing}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          {computing ? 'Computing...' : 'Compute Schedule'}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {schedule ? (
        <>
          {/* KPI Stats */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-[#1a1f2e] border border-white/5 rounded-2xl p-4">
              <div className="text-gray-400 text-xs mb-1">Utilization</div>
              <div className="text-2xl font-bold text-white">{schedule.machine_utilization_pct}%</div>
            </div>
            <div className="bg-[#1a1f2e] border border-white/5 rounded-2xl p-4">
              <div className="text-gray-400 text-xs mb-1">On-Time Ops</div>
              <div className="text-2xl font-bold text-white">{schedule.on_time_count} / {schedule.total_operations}</div>
            </div>
            <div className="bg-[#1a1f2e] border border-white/5 rounded-2xl p-4">
              <div className="text-gray-400 text-xs mb-1">Late Ops</div>
              <div className="text-2xl font-bold text-red-400">{schedule.late_count}</div>
            </div>
            <div className="bg-[#1a1f2e] border border-white/5 rounded-2xl p-4">
              <div className="text-gray-400 text-xs mb-1">Conflicts</div>
              <div className={`text-2xl font-bold ${schedule.has_conflicts ? 'text-amber-400' : 'text-emerald-400'}`}>
                {schedule.has_conflicts ? 'Detected' : 'None'}
              </div>
            </div>
          </div>

          {/* Schedule Table */}
          <div className="bg-[#1a1f2e] border border-white/5 rounded-2xl overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/5 bg-white/5">
                  <th className="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Machine</th>
                  <th className="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Work Order</th>
                  <th className="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Start</th>
                  <th className="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">End</th>
                  <th className="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {schedule.items.map((item: any) => (
                  <tr key={item.id} className="hover:bg-white/5 transition-colors">
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-white">{item.machine_name}</div>
                      <div className="text-xs text-gray-500">ID: {item.machine_id}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-white">{item.work_order_name}</div>
                      <div className="text-xs text-gray-500">Op: {item.operation_id}</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-300">
                      {new Date(item.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-300">
                      {new Date(item.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-6 py-4">
                      {item.is_late ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                          Late ({item.delay_minutes}m)
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          On Time
                        </span>
                      )}
                      {item.is_conflict && (
                        <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          Conflict
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="bg-[#1a1f2e] border border-white/5 rounded-2xl p-12 text-center">
          <div className="text-5xl mb-4">📅</div>
          <h3 className="text-white font-semibold text-lg mb-2">No Schedule Generated</h3>
          <p className="text-gray-500 text-sm mb-6">Compute a new schedule to see machine assignments and timelines.</p>
          <button
            onClick={handleCompute}
            disabled={computing}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {computing ? 'Computing...' : 'Generate First Schedule'}
          </button>
        </div>
      )}
    </div>
  )
}
