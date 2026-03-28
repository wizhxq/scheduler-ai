import { useState } from 'react'
import { computeSchedule } from '../api'
import { useSchedule } from '../context/ScheduleContext'

const ALGORITHMS = [
  { value: 'EDD',            label: 'EDD — Earliest Due Date' },
  { value: 'SPT',            label: 'SPT — Shortest Processing Time' },
  { value: 'FIFO',           label: 'FIFO — First In First Out' },
  { value: 'CRITICAL_RATIO', label: 'Critical Ratio' },
]

export default function SchedulePage() {
  // Read schedule from shared context — updated by CalendarPage drag-drops too
  const { schedule, loading, setSchedule } = useSchedule()
  const [computing, setComputing] = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [algorithm, setAlgorithm] = useState('EDD')

  const handleCompute = async () => {
    setComputing(true)
    setError(null)
    try {
      const data = await computeSchedule(algorithm)
      // Push result into shared context — CalendarPage will re-render immediately
      setSchedule(data)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to compute schedule')
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
            {schedule
              ? `Last computed: ${new Date(schedule.created_at).toLocaleString()}`
              : 'No schedule computed yet'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={algorithm}
            onChange={e => setAlgorithm(e.target.value)}
            className="bg-[#1a1f2e] border border-white/10 text-white text-sm rounded-xl px-3 py-2.5 outline-none focus:border-blue-500/50"
          >
            {ALGORITHMS.map(a => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
          <button
            onClick={handleCompute}
            disabled={computing}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {computing ? (
              <><span className="animate-spin">⟳</span> Computing...</>
            ) : (
              '⚡ Compute Schedule'
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm">{error}</div>
      )}

      {schedule ? (
        <>
          {/* KPI bar */}
          <div className="grid grid-cols-5 gap-4">
            {[
              { label: 'Algorithm',    val: schedule.algorithm,              color: 'text-white' },
              { label: 'Utilization',  val: `${schedule.machine_utilization_pct}%`, color: 'text-white' },
              { label: 'On-Time Ops',  val: `${schedule.on_time_count} / ${schedule.total_operations}`, color: 'text-emerald-400' },
              { label: 'Late Ops',     val: schedule.late_count,             color: schedule.late_count > 0 ? 'text-red-400' : 'text-emerald-400' },
              { label: 'Conflicts',    val: schedule.has_conflicts ? '⚠ Yes' : '✓ None', color: schedule.has_conflicts ? 'text-amber-400' : 'text-emerald-400' },
            ].map(k => (
              <div key={k.label} className="bg-[#1a1f2e] border border-white/5 rounded-2xl p-4">
                <div className="text-gray-400 text-xs mb-1">{k.label}</div>
                <div className={`text-xl font-bold ${k.color}`}>{k.val}</div>
              </div>
            ))}
          </div>

          {/* Schedule table */}
          {schedule.items?.length > 0 ? (
            <div className="bg-[#1a1f2e] border border-white/5 rounded-2xl overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 bg-white/5">
                    {['Machine', 'Work Order', 'Start', 'End', 'Status'].map(h => (
                      <th key={h} className="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {schedule.items.map((item: any) => (
                    <tr key={item.id} className="hover:bg-white/5 transition-colors">
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-white">{item.machine_name}</div>
                        <div className="text-xs text-gray-500 font-mono">ID #{item.machine_id}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-white">{item.work_order_name}</div>
                        <div className="text-xs text-gray-500">Op #{item.operation_id}</div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-300">
                        {new Date(item.start_time).toLocaleString([],{
                          month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'
                        })}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-300">
                        {new Date(item.end_time).toLocaleString([],{
                          month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'
                        })}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          {item.is_late ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                              Late +{item.delay_minutes}m
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              On Time
                            </span>
                          )}
                          {item.is_conflict && (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                              ⚠ Conflict
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="bg-[#1a1f2e] border border-white/5 rounded-2xl p-8 text-center">
              <p className="text-gray-500 text-sm">No operations scheduled yet. Add work orders with operations first.</p>
            </div>
          )}
        </>
      ) : (
        <div className="bg-[#1a1f2e] border border-white/5 rounded-2xl p-12 text-center">
          <div className="text-5xl mb-4">📅</div>
          <h3 className="text-white font-semibold text-lg mb-2">No Schedule Generated</h3>
          <p className="text-gray-500 text-sm mb-6">Compute a new schedule to see machine assignments and timelines.</p>
          <button onClick={handleCompute} disabled={computing}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl transition-colors">
            {computing ? 'Computing...' : 'Generate First Schedule'}
          </button>
        </div>
      )}
    </div>
  )
}
