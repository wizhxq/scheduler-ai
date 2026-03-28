import { useState, useEffect, useRef } from 'react'
import { getWorkOrders, updateWorkOrder, getMachines } from '../api'

const PRIORITY_COLORS: Record<number, string> = {
  1: 'bg-red-600 border-red-500',
  2: 'bg-orange-500 border-orange-400',
  3: 'bg-blue-600 border-blue-500',
  4: 'bg-gray-600 border-gray-500',
}
const PRIORITY_LABEL: Record<number, string> = {
  1: 'Critical', 2: 'High', 3: 'Medium', 4: 'Low',
}

function startOfWeek(d: Date) {
  const c = new Date(d)
  const day = c.getDay()
  const diff = day === 0 ? -6 : 1 - day
  c.setDate(c.getDate() + diff)
  c.setHours(0, 0, 0, 0)
  return c
}

function addDays(d: Date, n: number) {
  const c = new Date(d)
  c.setDate(c.getDate() + n)
  return c
}

function fmt(d: Date) {
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

export default function CalendarPage() {
  const [workOrders, setWorkOrders] = useState<any[]>([])
  const [machines, setMachines] = useState<any[]>([])
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [view, setView] = useState<'week' | 'day'>('week')
  const [dayView, setDayView] = useState(() => new Date())
  const [dragging, setDragging] = useState<any | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [saving, setSaving] = useState<number | null>(null)
  const [editWO, setEditWO] = useState<any | null>(null)
  const [editDate, setEditDate] = useState('')
  const [editTime, setEditTime] = useState('08:00')
  const [toast, setToast] = useState<string | null>(null)

  const load = async () => {
    const [wos, macs] = await Promise.all([getWorkOrders(), getMachines()])
    setWorkOrders(wos)
    setMachines(macs)
  }

  useEffect(() => { load() }, [])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const days = view === 'week'
    ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    : [dayView]

  const woOnDay = (day: Date) =>
    workOrders.filter(wo => {
      if (!wo.due_date) return false
      return isSameDay(new Date(wo.due_date), day)
    })

  // Maintenance windows — machines with status=maintenance
  const machinesInMaintenance = machines.filter(m => m.status === 'maintenance')

  const handleDragStart = (wo: any) => setDragging(wo)
  const handleDragOver = (e: React.DragEvent, key: string) => {
    e.preventDefault()
    setDragOver(key)
  }
  const handleDrop = async (e: React.DragEvent, day: Date) => {
    e.preventDefault()
    setDragOver(null)
    if (!dragging) return
    const newDate = new Date(day)
    // Preserve original time if available
    if (dragging.due_date) {
      const orig = new Date(dragging.due_date)
      newDate.setHours(orig.getHours(), orig.getMinutes(), 0, 0)
    } else {
      newDate.setHours(17, 0, 0, 0)
    }
    setSaving(dragging.id)
    try {
      await updateWorkOrder(dragging.id, { due_date: newDate.toISOString() })
      showToast(`✅ ${dragging.code} moved to ${fmt(newDate)}`)
      await load()
    } catch {
      showToast('❌ Failed to update. Please try again.')
    } finally {
      setSaving(null)
      setDragging(null)
    }
  }

  const openEdit = (wo: any) => {
    setEditWO(wo)
    if (wo.due_date) {
      const d = new Date(wo.due_date)
      setEditDate(d.toISOString().split('T')[0])
      setEditTime(d.toTimeString().slice(0, 5))
    } else {
      setEditDate('')
      setEditTime('08:00')
    }
  }

  const saveEdit = async () => {
    if (!editWO || !editDate) return
    const dt = new Date(`${editDate}T${editTime}:00`)
    setSaving(editWO.id)
    try {
      await updateWorkOrder(editWO.id, { due_date: dt.toISOString() })
      showToast(`✅ ${editWO.code} scheduled for ${fmt(dt)}`)
      setEditWO(null)
      await load()
    } catch {
      showToast('❌ Failed to save.')
    } finally {
      setSaving(null)
    }
  }

  const unscheduled = workOrders.filter(wo => !wo.due_date && wo.status === 'pending')

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left sidebar — unscheduled orders */}
      <div className="w-56 bg-[#0f1117] border-r border-white/5 flex flex-col">
        <div className="p-4 border-b border-white/5">
          <h2 className="text-white font-semibold text-sm">Unscheduled</h2>
          <p className="text-gray-500 text-xs mt-0.5">{unscheduled.length} order{unscheduled.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {unscheduled.length === 0 && (
            <p className="text-gray-600 text-xs text-center mt-8">All orders scheduled ✅</p>
          )}
          {unscheduled.map(wo => (
            <div
              key={wo.id}
              draggable
              onDragStart={() => handleDragStart(wo)}
              onClick={() => openEdit(wo)}
              className={`p-2.5 rounded-lg border text-xs cursor-grab active:cursor-grabbing select-none ${PRIORITY_COLORS[wo.priority] || PRIORITY_COLORS[3]} text-white`}
            >
              <div className="font-semibold">{wo.code}</div>
              <div className="opacity-75 truncate">{wo.customer_name || 'No customer'}</div>
              <div className="opacity-60 mt-0.5">{PRIORITY_LABEL[wo.priority]}</div>
            </div>
          ))}
        </div>
        {machinesInMaintenance.length > 0 && (
          <div className="p-3 border-t border-white/5">
            <p className="text-amber-400 text-xs font-semibold mb-1">🔧 In Maintenance</p>
            {machinesInMaintenance.map(m => (
              <p key={m.id} className="text-gray-400 text-xs">{m.name}</p>
            ))}
          </div>
        )}
      </div>

      {/* Main calendar */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-[#0f1117]">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (view === 'week') setWeekStart(d => addDays(d, -7))
                else setDayView(d => addDays(d, -1))
              }}
              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-gray-300 text-sm rounded-lg transition-colors"
            >←</button>
            <button
              onClick={() => {
                if (view === 'week') setWeekStart(startOfWeek(new Date()))
                else setDayView(new Date())
              }}
              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-gray-300 text-sm rounded-lg transition-colors"
            >Today</button>
            <button
              onClick={() => {
                if (view === 'week') setWeekStart(d => addDays(d, 7))
                else setDayView(d => addDays(d, 1))
              }}
              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-gray-300 text-sm rounded-lg transition-colors"
            >→</button>
            <span className="text-white font-semibold text-sm ml-2">
              {view === 'week'
                ? `${fmt(weekStart)} – ${fmt(addDays(weekStart, 6))}`
                : fmt(dayView)
              }
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setView('week')}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${view === 'week' ? 'bg-blue-600 text-white' : 'bg-white/5 text-gray-300 hover:bg-white/10'}`}
            >Week</button>
            <button
              onClick={() => setView('day')}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${view === 'day' ? 'bg-blue-600 text-white' : 'bg-white/5 text-gray-300 hover:bg-white/10'}`}
            >Day</button>
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-auto">
          <div className={`grid h-full min-h-0`} style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
            {days.map(day => {
              const key = day.toISOString()
              const isToday = isSameDay(day, new Date())
              const orders = woOnDay(day)
              const isDragTarget = dragOver === key
              return (
                <div
                  key={key}
                  onDragOver={e => handleDragOver(e, key)}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={e => handleDrop(e, day)}
                  className={`border-r border-white/5 flex flex-col transition-colors ${
                    isDragTarget ? 'bg-blue-900/20' : 'bg-[#0f1117] hover:bg-white/[0.02]'
                  }`}
                >
                  {/* Day header */}
                  <div className={`px-3 py-3 border-b border-white/5 text-center ${
                    isToday ? 'bg-blue-600/20' : ''
                  }`}>
                    <p className={`text-xs font-semibold ${
                      isToday ? 'text-blue-400' : 'text-gray-400'
                    }`}>{day.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase()}</p>
                    <p className={`text-lg font-bold mt-0.5 ${
                      isToday ? 'text-blue-300' : 'text-white'
                    }`}>{day.getDate()}</p>
                    <p className="text-gray-600 text-xs">{day.toLocaleDateString('en-GB', { month: 'short' })}</p>
                  </div>

                  {/* Orders on this day */}
                  <div className="flex-1 p-2 space-y-1.5 overflow-y-auto">
                    {orders.map(wo => (
                      <div
                        key={wo.id}
                        draggable
                        onDragStart={() => handleDragStart(wo)}
                        onClick={() => openEdit(wo)}
                        className={`p-2 rounded-lg border text-xs cursor-grab active:cursor-grabbing select-none ${
                          PRIORITY_COLORS[wo.priority] || PRIORITY_COLORS[3]
                        } text-white ${saving === wo.id ? 'opacity-50' : 'hover:opacity-90'}`}
                      >
                        <div className="font-semibold truncate">{wo.code}</div>
                        {wo.customer_name && <div className="opacity-70 truncate">{wo.customer_name}</div>}
                        {wo.due_date && (
                          <div className="opacity-60 mt-0.5">
                            {new Date(wo.due_date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        )}
                      </div>
                    ))}
                    {isDragTarget && (
                      <div className="border-2 border-dashed border-blue-400/50 rounded-lg p-2 text-blue-400 text-xs text-center">
                        Drop here
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Edit modal */}
      {editWO && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setEditWO(null)}>
          <div className="bg-[#1a1f2e] border border-white/10 rounded-2xl p-6 w-96 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-white font-bold text-lg mb-1">{editWO.code}</h3>
            <p className="text-gray-400 text-sm mb-5">{editWO.customer_name || 'No customer'} · {PRIORITY_LABEL[editWO.priority]} priority</p>
            <div className="space-y-4">
              <div>
                <label className="block text-gray-400 text-xs mb-1.5">Due Date</label>
                <input
                  type="date"
                  value={editDate}
                  onChange={e => setEditDate(e.target.value)}
                  className="w-full bg-[#0f1117] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500/50"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-1.5">Due Time</label>
                <input
                  type="time"
                  value={editTime}
                  onChange={e => setEditTime(e.target.value)}
                  className="w-full bg-[#0f1117] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500/50"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={saveEdit}
                disabled={!editDate || saving === editWO.id}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {saving === editWO.id ? 'Saving...' : 'Save Schedule'}
              </button>
              <button
                onClick={() => setEditWO(null)}
                className="px-4 py-2.5 bg-white/5 hover:bg-white/10 text-gray-300 text-sm rounded-xl transition-colors"
              >Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 border border-white/10 text-white text-sm px-5 py-3 rounded-xl shadow-2xl z-50">
          {toast}
        </div>
      )}
    </div>
  )
}
