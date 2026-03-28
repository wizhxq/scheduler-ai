import { useState, useEffect } from 'react'
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

type View = 'month' | 'week' | 'day'

// ─── date helpers ────────────────────────────────────────────────────────────
function addDays(d: Date, n: number): Date {
  const c = new Date(d); c.setDate(c.getDate() + n); return c
}
function startOfWeek(d: Date): Date {
  const c = new Date(d)
  const diff = c.getDay() === 0 ? -6 : 1 - c.getDay()
  c.setDate(c.getDate() + diff); c.setHours(0, 0, 0, 0); return c
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}
function fmtShort(d: Date): string {
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}
function fmtMonthYear(d: Date): string {
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

/** Build the 6-week grid for a month view (always 42 cells, Mon-start) */
function buildMonthGrid(anchor: Date): Date[] {
  const first = startOfMonth(anchor)
  const gridStart = startOfWeek(first)
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function CalendarPage() {
  const [workOrders, setWorkOrders] = useState<any[]>([])
  const [machines, setMachines]     = useState<any[]>([])
  const [view, setView]             = useState<View>('month')

  // anchors per view
  const [monthAnchor, setMonthAnchor] = useState(() => new Date())
  const [weekAnchor,  setWeekAnchor]  = useState(() => startOfWeek(new Date()))
  const [dayAnchor,   setDayAnchor]   = useState(() => new Date())

  // drag
  const [dragging, setDragging]   = useState<any | null>(null)
  const [dragOver, setDragOver]   = useState<string | null>(null)
  const [saving,   setSaving]     = useState<number | null>(null)

  // edit modal
  const [editWO,   setEditWO]   = useState<any | null>(null)
  const [editDate, setEditDate] = useState('')
  const [editTime, setEditTime] = useState('17:00')

  const [toast, setToast] = useState<string | null>(null)

  const load = async () => {
    const [wos, macs] = await Promise.all([getWorkOrders(), getMachines()])
    setWorkOrders(wos); setMachines(macs)
  }
  useEffect(() => { load() }, [])

  const showToast = (msg: string) => {
    setToast(msg); setTimeout(() => setToast(null), 3500)
  }

  // ── navigation ──────────────────────────────────────────────────────────────
  const goBack = () => {
    if (view === 'month') setMonthAnchor(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))
    if (view === 'week')  setWeekAnchor(d => addDays(d, -7))
    if (view === 'day')   setDayAnchor(d => addDays(d, -1))
  }
  const goForward = () => {
    if (view === 'month') setMonthAnchor(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))
    if (view === 'week')  setWeekAnchor(d => addDays(d, 7))
    if (view === 'day')   setDayAnchor(d => addDays(d, 1))
  }
  const goToday = () => {
    const now = new Date()
    setMonthAnchor(now); setWeekAnchor(startOfWeek(now)); setDayAnchor(now)
  }

  const navLabel = () => {
    if (view === 'month') return fmtMonthYear(monthAnchor)
    if (view === 'week')  return `${fmtShort(weekAnchor)} – ${fmtShort(addDays(weekAnchor, 6))}`
    return fmtShort(dayAnchor)
  }

  // ── drag & drop ──────────────────────────────────────────────────────────────
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
    if (dragging.due_date) {
      const orig = new Date(dragging.due_date)
      newDate.setHours(orig.getHours(), orig.getMinutes(), 0, 0)
    } else {
      newDate.setHours(17, 0, 0, 0)
    }
    setSaving(dragging.id)
    try {
      await updateWorkOrder(dragging.id, { due_date: newDate.toISOString() })
      showToast(`✅ ${dragging.code} moved to ${fmtShort(newDate)}`)
      // If dropped into adjacent month in month view, jump there
      if (view === 'month' && newDate.getMonth() !== monthAnchor.getMonth()) {
        setMonthAnchor(new Date(newDate.getFullYear(), newDate.getMonth(), 1))
      }
      await load()
    } catch {
      showToast('❌ Failed to update. Please try again.')
    } finally {
      setSaving(null); setDragging(null)
    }
  }

  // ── edit modal ───────────────────────────────────────────────────────────────
  const openEdit = (wo: any) => {
    setEditWO(wo)
    if (wo.due_date) {
      const d = new Date(wo.due_date)
      setEditDate(d.toISOString().split('T')[0])
      setEditTime(d.toTimeString().slice(0, 5))
    } else { setEditDate(''); setEditTime('17:00') }
  }

  const saveEdit = async () => {
    if (!editWO || !editDate) return
    const dt = new Date(`${editDate}T${editTime}:00`)
    setSaving(editWO.id)
    try {
      await updateWorkOrder(editWO.id, { due_date: dt.toISOString() })
      showToast(`✅ ${editWO.code} scheduled for ${fmtShort(dt)}`)
      setEditWO(null); await load()
    } catch { showToast('❌ Failed to save.') }
    finally { setSaving(null) }
  }

  // ── data helpers ─────────────────────────────────────────────────────────────
  const woOnDay = (day: Date) =>
    workOrders.filter(wo => wo.due_date && isSameDay(new Date(wo.due_date), day))

  const unscheduled = workOrders.filter(wo => !wo.due_date && wo.status === 'pending')
  const machinesInMaintenance = machines.filter(m => m.status === 'maintenance')

  // ── shared DayCell renderer ──────────────────────────────────────────────────
  const DayCell = ({
    day, compact = false, dimmed = false,
  }: { day: Date; compact?: boolean; dimmed?: boolean }) => {
    const key      = day.toISOString()
    const isToday  = isSameDay(day, new Date())
    const orders   = woOnDay(day)
    const isTarget = dragOver === key

    return (
      <div
        key={key}
        onDragOver={e => handleDragOver(e, key)}
        onDragLeave={() => setDragOver(null)}
        onDrop={e => handleDrop(e, day)}
        className={`border border-white/5 flex flex-col transition-colors ${
          isTarget ? 'bg-blue-900/25 border-blue-500/40' : dimmed ? 'bg-[#0c0f18]' : 'bg-[#0f1117]'
        } ${compact ? 'min-h-[100px]' : 'min-h-[120px]'}`}
      >
        {/* date number */}
        <div className={`px-2 pt-2 pb-1 flex items-center justify-between ${
          isToday ? 'bg-blue-600/20' : ''
        }`}>
          <span className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${
            isToday
              ? 'bg-blue-500 text-white'
              : dimmed ? 'text-gray-600' : 'text-gray-300'
          }`}>
            {day.getDate()}
          </span>
          {/* show month label on 1st of month */}
          {day.getDate() === 1 && (
            <span className={`text-[9px] font-semibold uppercase tracking-wider ${
              dimmed ? 'text-gray-700' : 'text-gray-500'
            }`}>
              {day.toLocaleDateString('en-GB', { month: 'short' })}
            </span>
          )}
        </div>

        {/* work order chips */}
        <div className="flex-1 px-1.5 pb-1.5 space-y-0.5 overflow-hidden">
          {orders.slice(0, compact ? 2 : 4).map(wo => (
            <div
              key={wo.id}
              draggable
              onDragStart={e => { e.stopPropagation(); handleDragStart(wo) }}
              onClick={() => openEdit(wo)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold cursor-grab active:cursor-grabbing select-none truncate border ${
                PRIORITY_COLORS[wo.priority] || PRIORITY_COLORS[3]
              } text-white ${saving === wo.id ? 'opacity-40' : 'hover:opacity-80'}`}
            >
              {wo.code}{wo.customer_name ? ` · ${wo.customer_name}` : ''}
            </div>
          ))}
          {orders.length > (compact ? 2 : 4) && (
            <div className="text-[9px] text-gray-500 pl-1">
              +{orders.length - (compact ? 2 : 4)} more
            </div>
          )}
          {isTarget && (
            <div className="border border-dashed border-blue-400/50 rounded text-[10px] text-blue-400 text-center py-0.5">
              Drop
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── build day lists per view ─────────────────────────────────────────────────
  const monthDays = buildMonthGrid(monthAnchor)
  const weekDays  = Array.from({ length: 7 }, (_, i) => addDays(weekAnchor, i))
  const dayDays   = [dayAnchor]

  const WEEK_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  return (
    <div className="flex h-screen overflow-hidden">

      {/* ── Sidebar ── */}
      <div className="w-52 bg-[#0c0f18] border-r border-white/5 flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-white/5">
          <h2 className="text-white font-semibold text-sm">Unscheduled</h2>
          <p className="text-gray-500 text-xs mt-0.5">{unscheduled.length} pending</p>
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
              className={`p-2.5 rounded-lg border text-xs cursor-grab active:cursor-grabbing select-none ${
                PRIORITY_COLORS[wo.priority] || PRIORITY_COLORS[3]
              } text-white hover:opacity-90`}
            >
              <div className="font-semibold">{wo.code}</div>
              <div className="opacity-75 truncate">{wo.customer_name || 'No customer'}</div>
              <div className="opacity-60 mt-0.5">{PRIORITY_LABEL[wo.priority]}</div>
            </div>
          ))}
        </div>
        {machinesInMaintenance.length > 0 && (
          <div className="p-3 border-t border-white/5">
            <p className="text-amber-400 text-xs font-semibold mb-1">🔧 Maintenance</p>
            {machinesInMaintenance.map(m => (
              <p key={m.id} className="text-gray-500 text-xs truncate">{m.name}</p>
            ))}
          </div>
        )}
      </div>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* toolbar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/5 bg-[#0c0f18] flex-shrink-0">
          <div className="flex items-center gap-2">
            <button onClick={goBack}
              className="w-8 h-8 flex items-center justify-center bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg transition-colors text-sm">←</button>
            <button onClick={goToday}
              className="px-3 h-8 bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold rounded-lg transition-colors">Today</button>
            <button onClick={goForward}
              className="w-8 h-8 flex items-center justify-center bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg transition-colors text-sm">→</button>
            <span className="text-white font-semibold text-sm ml-2">{navLabel()}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {(['month', 'week', 'day'] as View[]).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 h-8 text-xs font-semibold rounded-lg capitalize transition-colors ${
                  view === v ? 'bg-blue-600 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                }`}>{v}</button>
            ))}
          </div>
        </div>

        {/* ── Month view ── */}
        {view === 'month' && (
          <div className="flex-1 overflow-auto flex flex-col">
            {/* weekday headers */}
            <div className="grid grid-cols-7 border-b border-white/5 flex-shrink-0">
              {WEEK_HEADERS.map(h => (
                <div key={h} className="py-2 text-center text-[10px] font-bold uppercase tracking-widest text-gray-600">{h}</div>
              ))}
            </div>
            {/* 6-week grid */}
            <div className="flex-1 grid grid-cols-7" style={{ gridAutoRows: 'minmax(110px, 1fr)' }}>
              {monthDays.map(day => {
                const inCurrentMonth = day.getMonth() === monthAnchor.getMonth()
                return (
                  <DayCell key={day.toISOString()} day={day} compact dimmed={!inCurrentMonth} />
                )
              })}
            </div>
          </div>
        )}

        {/* ── Week view ── */}
        {view === 'week' && (
          <div className="flex-1 overflow-auto flex flex-col">
            <div className="grid grid-cols-7 border-b border-white/5 flex-shrink-0">
              {WEEK_HEADERS.map(h => (
                <div key={h} className="py-2 text-center text-[10px] font-bold uppercase tracking-widest text-gray-600">{h}</div>
              ))}
            </div>
            <div className="flex-1 grid grid-cols-7">
              {weekDays.map(day => (
                <DayCell key={day.toISOString()} day={day} />
              ))}
            </div>
          </div>
        )}

        {/* ── Day view ── */}
        {view === 'day' && (
          <div className="flex-1 overflow-auto p-6">
            <div className="max-w-lg mx-auto">
              <div className="mb-4">
                <p className={`text-sm font-semibold ${
                  isSameDay(dayAnchor, new Date()) ? 'text-blue-400' : 'text-gray-400'
                }`}>{dayAnchor.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
              </div>
              <div
                onDragOver={e => handleDragOver(e, dayAnchor.toISOString())}
                onDragLeave={() => setDragOver(null)}
                onDrop={e => handleDrop(e, dayAnchor)}
                className={`min-h-64 border-2 border-dashed rounded-2xl p-4 space-y-2 transition-colors ${
                  dragOver === dayAnchor.toISOString()
                    ? 'border-blue-500/60 bg-blue-900/10'
                    : 'border-white/10 bg-[#0f1117]'
                }`}
              >
                {woOnDay(dayAnchor).length === 0 && (
                  <p className="text-gray-600 text-sm text-center py-8">No orders scheduled — drag one here</p>
                )}
                {woOnDay(dayAnchor).map(wo => (
                  <div
                    key={wo.id}
                    draggable
                    onDragStart={() => handleDragStart(wo)}
                    onClick={() => openEdit(wo)}
                    className={`p-3 rounded-xl border text-sm cursor-grab active:cursor-grabbing select-none ${
                      PRIORITY_COLORS[wo.priority] || PRIORITY_COLORS[3]
                    } text-white flex items-center justify-between`}
                  >
                    <div>
                      <div className="font-bold">{wo.code}</div>
                      <div className="opacity-70 text-xs">{wo.customer_name || 'No customer'} · {PRIORITY_LABEL[wo.priority]}</div>
                    </div>
                    {wo.due_date && (
                      <div className="text-xs opacity-60">
                        {new Date(wo.due_date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Edit modal ── */}
      {editWO && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => setEditWO(null)}>
          <div className="bg-[#1a1f2e] border border-white/10 rounded-2xl p-6 w-96 shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <h3 className="text-white font-bold text-lg mb-1">{editWO.code}</h3>
            <p className="text-gray-400 text-sm mb-5">
              {editWO.customer_name || 'No customer'} · {PRIORITY_LABEL[editWO.priority]} priority
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-gray-400 text-xs mb-1.5 font-semibold uppercase tracking-wider">Due Date</label>
                <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
                  className="w-full bg-[#0f1117] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500/50 [color-scheme:dark]" />
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-1.5 font-semibold uppercase tracking-wider">Due Time</label>
                <input type="time" value={editTime} onChange={e => setEditTime(e.target.value)}
                  className="w-full bg-[#0f1117] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500/50" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={saveEdit} disabled={!editDate || saving === editWO.id}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition-colors">
                {saving === editWO.id ? 'Saving...' : 'Save Schedule'}
              </button>
              <button onClick={() => setEditWO(null)}
                className="px-4 py-2.5 bg-white/5 hover:bg-white/10 text-gray-300 text-sm rounded-xl transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 border border-white/10 text-white text-sm px-5 py-3 rounded-xl shadow-2xl z-50">
          {toast}
        </div>
      )}
    </div>
  )
}
