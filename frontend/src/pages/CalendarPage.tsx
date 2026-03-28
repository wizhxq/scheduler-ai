import { useState, useRef, useCallback } from 'react'
import { updateWorkOrder, updateScheduleItem } from '../api'
import { useSchedule } from '../context/ScheduleContext'
import { machineColor } from '../utils/machineColors'

const P_COLOR: Record<number, { bg: string; border: string; text: string }> = {
  1: { bg: 'bg-red-600/80',    border: 'border-red-500',    text: 'text-white' },
  2: { bg: 'bg-orange-500/80', border: 'border-orange-400', text: 'text-white' },
  3: { bg: 'bg-blue-600/80',   border: 'border-blue-500',   text: 'text-white' },
  4: { bg: 'bg-gray-600/70',   border: 'border-gray-500',   text: 'text-white' },
}
const P_LABEL: Record<number, string> = { 1:'Critical', 2:'High', 3:'Medium', 4:'Low' }

type View = 'month' | 'week' | 'day'
type DragPayload =
  | { type: 'wo';          data: any }
  | { type: 'sched_group'; woId: number; items: any[]; anchorItem: any; anchorOffsetMs: number }
  | null

const addDays      = (d: Date, n: number) => { const c = new Date(d); c.setDate(c.getDate()+n); return c }
const startOfWeek  = (d: Date) => {
  const c = new Date(d); const diff = c.getDay()===0 ? -6 : 1-c.getDay()
  c.setDate(c.getDate()+diff); c.setHours(0,0,0,0); return c
}
const isSameDay    = (a: Date, b: Date) =>
  a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate()
const fmtTime      = (d: Date) => d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})
const fmtDate      = (d: Date) => d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})
const fmtMonthYear = (d: Date) => d.toLocaleDateString('en-GB',{month:'long',year:'numeric'})
const fmtShort     = (d: Date) => d.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})

function buildMonthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const gs = startOfWeek(first)
  return Array.from({length:42},(_,i)=>addDays(gs,i))
}

const HOUR_START  = 7
const HOUR_END    = 22
const TOTAL_HOURS = HOUR_END - HOUR_START
const ROW_PX      = 80

function timeToTopPx(d: Date, dayDate: Date): number {
  const startOfDay = new Date(dayDate)
  startOfDay.setHours(HOUR_START, 0, 0, 0)
  const mins = (d.getTime() - startOfDay.getTime()) / 60000
  return (mins / 60) * ROW_PX
}

function groupByWO(items: any[]): Map<number, any[]> {
  const m = new Map<number, any[]>()
  for (const it of items) {
    const arr = m.get(it.work_order_id) ?? []
    arr.push(it)
    m.set(it.work_order_id, arr)
  }
  return m
}

export default function CalendarPage() {
  // All data comes from shared context — never goes stale after mutations
  const { schedule, workOrders, machines, load: reloadSchedule, refresh, setSchedule } = useSchedule()

  const [view,        setView]        = useState<View>('month')
  const [monthAnchor, setMonthAnchor] = useState(() => new Date())
  const [weekAnchor,  setWeekAnchor]  = useState(() => startOfWeek(new Date()))
  const [dayAnchor,   setDayAnchor]   = useState(() => new Date())
  const [dragOver,    setDragOver]    = useState<string|null>(null)
  const [saving,      setSaving]      = useState<number|null>(null)
  const [editWO,      setEditWO]      = useState<any|null>(null)
  const [editDate,    setEditDate]    = useState('')
  const [editTime,    setEditTime]    = useState('17:00')
  const [toast,       setToast]       = useState<string|null>(null)

  const dragRef = useRef<DragPayload>(null)

  const showToast = (msg: string) => { setToast(msg); setTimeout(()=>setToast(null),3500) }

  const goBack = () => {
    if (view==='month') setMonthAnchor(d=>new Date(d.getFullYear(),d.getMonth()-1,1))
    if (view==='week')  setWeekAnchor(d=>addDays(d,-7))
    if (view==='day')   setDayAnchor(d=>addDays(d,-1))
  }
  const goForward = () => {
    if (view==='month') setMonthAnchor(d=>new Date(d.getFullYear(),d.getMonth()+1,1))
    if (view==='week')  setWeekAnchor(d=>addDays(d,7))
    if (view==='day')   setDayAnchor(d=>addDays(d,1))
  }
  const goToday = () => {
    const n=new Date(); setMonthAnchor(n); setWeekAnchor(startOfWeek(n)); setDayAnchor(n)
  }
  const navLabel = () => {
    if (view==='month') return fmtMonthYear(monthAnchor)
    if (view==='week')  return `${fmtShort(weekAnchor)} – ${fmtShort(addDays(weekAnchor,6))}`
    return fmtShort(dayAnchor)
  }

  // Drop handler — move entire WO group, then sync shared context
  const dropSchedGroup = async (newAnchorStart: Date) => {
    const payload = dragRef.current
    if (!payload || payload.type !== 'sched_group') return
    const { woId, items, anchorItem, anchorOffsetMs } = payload
    dragRef.current = null

    const anchorNewStart = new Date(newAnchorStart.getTime() - anchorOffsetMs)
    const deltaMs = anchorNewStart.getTime() - new Date(anchorItem.start_time).getTime()

    setSaving(woId)
    try {
      const updated = await Promise.all(items.map(it => {
        const newStart = new Date(new Date(it.start_time).getTime() + deltaMs)
        const newEnd   = new Date(new Date(it.end_time).getTime()   + deltaMs)
        return updateScheduleItem(it.id, {
          start_time: newStart.toISOString(),
          end_time:   newEnd.toISOString(),
        })
      }))

      // Optimistic patch of shared context — SchedulePage updates instantly
      if (schedule) {
        const updatedIds = new Set(updated.map((u: any) => u.id))
        const newItems = schedule.items.map((it: any) =>
          updatedIds.has(it.id) ? updated.find((u: any) => u.id === it.id) : it
        )
        setSchedule({ ...schedule, items: newItems })
      }

      showToast(`Rescheduled: ${anchorItem.work_order_name}`)
      // Background re-fetch so every page is consistent
      reloadSchedule()
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || 'Unknown error'
      showToast(`Reschedule failed: ${msg}`)
    } finally {
      setSaving(null)
    }
  }

  const dropWOOnDay = async (day: Date) => {
    const payload = dragRef.current
    if (!payload || payload.type !== 'wo') return
    const wo = payload.data
    dragRef.current = null
    const newDate = new Date(day)
    if (wo.due_date) { const o=new Date(wo.due_date); newDate.setHours(o.getHours(),o.getMinutes(),0,0) }
    else newDate.setHours(17,0,0,0)
    setSaving(wo.id)
    try {
      await updateWorkOrder(wo.id, { due_date: newDate.toISOString() })
      showToast(`${wo.code} moved to ${fmtDate(newDate)}`)
      // Refresh all data so calendar and schedule table are both current
      await refresh()
    } catch { showToast('Failed to update.') }
    finally { setSaving(null) }
  }

  const handleCellDrop = async (e: React.DragEvent, day: Date) => {
    e.preventDefault(); setDragOver(null)
    const payload = dragRef.current
    if (!payload) return
    if (payload.type === 'wo') return dropWOOnDay(day)
    if (payload.type === 'sched_group') {
      const orig = new Date(payload.anchorItem.start_time)
      const ns   = new Date(day)
      ns.setHours(orig.getHours(), orig.getMinutes(), 0, 0)
      return dropSchedGroup(ns)
    }
  }

  const openEdit = (wo: any) => {
    setEditWO(wo)
    if (wo.due_date) {
      const d=new Date(wo.due_date)
      setEditDate(d.toISOString().split('T')[0])
      setEditTime(d.toTimeString().slice(0,5))
    } else { setEditDate(''); setEditTime('17:00') }
  }
  const saveEdit = async () => {
    if (!editWO||!editDate) return
    const dt=new Date(`${editDate}T${editTime}:00`)
    setSaving(editWO.id)
    try {
      await updateWorkOrder(editWO.id, { due_date: dt.toISOString() })
      showToast(`${editWO.code} updated to ${fmtDate(dt)}`)
      setEditWO(null)
      await refresh()
    } catch { showToast('Failed.') }
    finally { setSaving(null) }
  }

  const woOnDay         = (day: Date) => workOrders.filter(wo => wo.due_date && isSameDay(new Date(wo.due_date), day))
  const schedItemsOnDay = (day: Date) => (schedule?.items || []).filter((it: any) => isSameDay(new Date(it.start_time), day))
  const unscheduled     = workOrders.filter(wo => !wo.due_date && wo.status==='pending')
  const machMaintenance = machines.filter(m => m.status==='maintenance')

  const woGroupsOnDay = useCallback((day: Date) => {
    const items = schedItemsOnDay(day)
    const grouped = groupByWO(items)
    return Array.from(grouped.entries()).map(([woId, its]) => ({
      woId,
      items: its.sort((a,b)=>new Date(a.start_time).getTime()-new Date(b.start_time).getTime()),
      color: machineColor(its[0].machine_id),
      woName: its[0].work_order_name,
    }))
  }, [schedule])

  const DayCell = ({ day, compact=false, dimmed=false }: { day:Date; compact?:boolean; dimmed?:boolean }) => {
    const key     = day.toISOString()
    const isToday = isSameDay(day, new Date())
    const wos     = woOnDay(day)
    const groups  = woGroupsOnDay(day)
    const isTarget= dragOver===key
    return (
      <div
        onDragOver={e  => { e.preventDefault(); setDragOver(key) }}
        onDragLeave={() => setDragOver(null)}
        onDrop={e      => handleCellDrop(e, day)}
        className={`border border-white/5 flex flex-col transition-colors ${
          isTarget ? 'bg-blue-900/25 border-blue-500/40' : dimmed ? 'bg-[#0b0e17]' : 'bg-[#0f1117]'
        } ${compact ? 'min-h-[110px]' : 'min-h-[130px]'}`}
      >
        <div className={`px-2 pt-2 pb-1 flex items-center justify-between ${isToday?'bg-blue-600/20':''}`}>
          <span className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${
            isToday ? 'bg-blue-500 text-white' : dimmed ? 'text-gray-700' : 'text-gray-300'
          }`}>{day.getDate()}</span>
          {day.getDate()===1 && (
            <span className={`text-[9px] font-semibold uppercase tracking-wider ${dimmed?'text-gray-700':'text-gray-500'}`}>
              {day.toLocaleDateString('en-GB',{month:'short'})}
            </span>
          )}
        </div>
        <div className="flex-1 px-1.5 pb-1.5 space-y-0.5 overflow-hidden">
          {groups.slice(0,compact?1:3).map(g => (
            <div key={`sg-${g.woId}`} draggable
              onDragStart={e => {
                e.stopPropagation()
                const anchor = g.items[0]
                dragRef.current = { type:'sched_group', woId:g.woId, items:g.items, anchorItem:anchor, anchorOffsetMs:0 }
              }}
              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold cursor-grab select-none truncate border-l-2 ${g.color.border} ${g.color.bg}/70 text-white hover:opacity-80`}
            >
              {g.woName}
            </div>
          ))}
          {wos.slice(0,compact?1:2).map(wo => {
            const c = P_COLOR[wo.priority]||P_COLOR[3]
            return (
              <div key={wo.id} draggable
                onDragStart={e => { e.stopPropagation(); dragRef.current = { type:'wo', data:wo } }}
                onClick={() => openEdit(wo)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold cursor-grab select-none truncate border ${c.bg} ${c.border} ${c.text} hover:opacity-80 ${saving===wo.id?'opacity-40':''}`}
              >
                {wo.code}{wo.customer_name ? ` · ${wo.customer_name}` : ''}
              </div>
            )
          })}
          {(groups.length+wos.length)>(compact?2:5) && (
            <div className="text-[9px] text-gray-500 pl-1">+{(groups.length+wos.length)-(compact?2:5)} more</div>
          )}
          {isTarget && <div className="border border-dashed border-blue-400/40 rounded text-[10px] text-blue-400 text-center py-0.5">Drop here</div>}
        </div>
      </div>
    )
  }

  const TimelineWOGroup = ({
    group, day, isWeek=false
  }: {
    group: { woId:number; items:any[]; color:ReturnType<typeof machineColor>; woName:string },
    day: Date, isWeek?: boolean,
  }) => {
    const { items, color, woName, woId } = group
    const earliest = new Date(Math.min(...items.map(it=>new Date(it.start_time).getTime())))
    const latest   = new Date(Math.max(...items.map(it=>new Date(it.end_time).getTime())))
    const top      = timeToTopPx(earliest, day)
    const ht       = Math.max(40, timeToTopPx(latest, day) - top)
    const isSav    = saving === woId
    const anchor   = items[0]
    return (
      <div draggable
        onDragStart={e => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          const offsetMs = ((e.clientY - rect.top) / ROW_PX) * 3600000
          dragRef.current = { type:'sched_group', woId, items, anchorItem:anchor, anchorOffsetMs:offsetMs }
        }}
        style={{ top, height:ht, left:isWeek?2:6, right:isWeek?2:6 }}
        className={`absolute rounded-xl border-2 text-white text-xs cursor-grab select-none overflow-hidden z-10 shadow-lg
          ${color.bg} ${color.border} ${isSav?'opacity-40':''} hover:brightness-110`}
      >
        <div className={`px-2 py-1 ${color.label} flex items-center gap-1.5 border-b border-white/20`}>
          <span className="font-bold text-[12px] truncate">{woName}</span>
          {items.length>1 && <span className="ml-auto text-[9px] opacity-70 flex-shrink-0">{items.length} ops</span>}
        </div>
        <div className="px-2 py-1 space-y-0.5 overflow-hidden">
          {items.map(it=>(
            <div key={it.id} className="flex items-center gap-1.5 text-[10px] opacity-90">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${machineColor(it.machine_id).dot}`} />
              <span className="opacity-60 truncate flex-1">{it.machine_name}</span>
              <span className="opacity-70 flex-shrink-0 font-mono tabular-nums">
                {fmtTime(new Date(it.start_time))}-{fmtTime(new Date(it.end_time))}
              </span>
              {it.is_late && <span className="text-red-300 flex-shrink-0">!</span>}
            </div>
          ))}
        </div>
      </div>
    )
  }

  const DayTimeline = ({ day }: { day: Date }) => {
    const timelineRef = useRef<HTMLDivElement>(null)
    const hours   = Array.from({length:TOTAL_HOURS},(_,i)=>HOUR_START+i)
    const groups  = woGroupsOnDay(day)
    const wos     = woOnDay(day)
    const totalPx = TOTAL_HOURS * ROW_PX

    const handleTimelineDrop = async (e: React.DragEvent) => {
      e.preventDefault()
      const payload = dragRef.current
      if (!payload || !timelineRef.current) return
      const rect    = timelineRef.current.getBoundingClientRect()
      const relY    = Math.max(0, e.clientY - rect.top)
      const fracY   = Math.min(relY / totalPx, 1)
      const snapped = Math.round((fracY * TOTAL_HOURS * 60) / 15) * 15
      const newStart = new Date(day)
      newStart.setHours(HOUR_START,0,0,0)
      newStart.setMinutes(newStart.getMinutes() + snapped)
      if (payload.type==='sched_group') return dropSchedGroup(newStart)
      dragRef.current = null
      const wo = payload.data
      setSaving(wo.id)
      try {
        await updateWorkOrder(wo.id, { due_date: newStart.toISOString() })
        showToast(`${wo.code} due at ${fmtTime(newStart)}`)
        await refresh()
      } catch { showToast('Failed.') }
      finally { setSaving(null) }
    }

    const nowLine = isSameDay(day, new Date()) ? (() => {
      const top = timeToTopPx(new Date(), day)
      return (
        <div className="absolute left-0 right-0 z-20 flex items-center pointer-events-none" style={{top}}>
          <div className="w-2.5 h-2.5 rounded-full bg-red-500 -ml-1.5 flex-shrink-0 shadow-lg shadow-red-500/50" />
          <div className="flex-1 border-t-2 border-red-500 opacity-80" />
        </div>
      )
    })() : null

    return (
      <div className="flex" style={{height:totalPx}}>
        <div className="w-16 flex-shrink-0 border-r border-white/5 select-none bg-[#0b0e17]">
          {hours.map(h=>(
            <div key={h} style={{height:ROW_PX}} className="flex items-start pt-2 pr-3 justify-end border-b border-white/[0.04]">
              <span className="text-xs text-gray-500 font-mono tabular-nums">{String(h).padStart(2,'0')}:00</span>
            </div>
          ))}
        </div>
        <div ref={timelineRef} className="flex-1 relative bg-[#0f1117]" style={{height:totalPx}}
          onDragOver={e=>e.preventDefault()} onDrop={handleTimelineDrop}>
          {hours.map(h=>(
            <div key={h} style={{top:(h-HOUR_START)*ROW_PX, height:ROW_PX}} className="absolute inset-x-0 border-b border-white/[0.06]" />
          ))}
          {hours.map(h=>(
            <div key={`hh-${h}`} style={{top:(h-HOUR_START)*ROW_PX+ROW_PX/2, height:1}} className="absolute inset-x-0 border-b border-white/[0.03]" />
          ))}
          {nowLine}
          {groups.map(g=><TimelineWOGroup key={g.woId} group={g} day={day} />)}
          {wos.map(wo=>{
            const due=new Date(wo.due_date)
            const top=timeToTopPx(due,day)
            const c=P_COLOR[wo.priority]||P_COLOR[3]
            return (
              <div key={wo.id} draggable
                onDragStart={()=>{ dragRef.current={type:'wo',data:wo} }}
                onClick={()=>openEdit(wo)}
                style={{top,left:6,right:6}}
                className={`absolute border-l-4 ${c.border} bg-white/5 rounded-r-xl px-3 py-1 text-xs cursor-grab select-none hover:bg-white/10 z-10`}
              >
                <span className="text-white font-bold">{wo.code}</span>
                <span className="text-gray-400 ml-2">due {fmtTime(due)}</span>
                {wo.customer_name&&<span className="text-gray-500 ml-2">- {wo.customer_name}</span>}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const monthDays = buildMonthGrid(monthAnchor)
  const weekDays  = Array.from({length:7},(_,i)=>addDays(weekAnchor,i))
  const WEEK_H    = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
  const totalTimelinePx = TOTAL_HOURS * ROW_PX

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <div className="w-52 bg-[#0b0e17] border-r border-white/5 flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-white/5">
          <h2 className="text-white font-semibold text-sm">Unscheduled</h2>
          <p className="text-gray-500 text-xs mt-0.5">{unscheduled.length} pending</p>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {unscheduled.length===0&&<p className="text-gray-600 text-xs text-center mt-8">All orders scheduled</p>}
          {unscheduled.map(wo=>{
            const c=P_COLOR[wo.priority]||P_COLOR[3]
            return (
              <div key={wo.id} draggable
                onDragStart={()=>{ dragRef.current={type:'wo',data:wo} }}
                onClick={()=>openEdit(wo)}
                className={`p-2.5 rounded-lg border text-xs cursor-grab select-none ${c.bg} ${c.border} text-white hover:opacity-90`}
              >
                <div className="font-semibold">{wo.code}</div>
                <div className="opacity-75 truncate">{wo.customer_name||'No customer'}</div>
                <div className="opacity-60 mt-0.5">{P_LABEL[wo.priority]}</div>
              </div>
            )
          })}
        </div>

        {/* Machine colour legend */}
        {machines.length > 0 && (
          <div className="px-3 pt-2 pb-3 border-t border-white/5">
            <p className="text-gray-500 text-[10px] font-semibold uppercase tracking-wider mb-2">Machine Colours</p>
            {machines.map(m => {
              const c = machineColor(m.id)
              return (
                <div key={m.id} className="flex items-center gap-1.5 mb-1">
                  <div className={`w-2.5 h-2.5 rounded-sm flex-shrink-0 ${c.bg}`} />
                  <span className="text-gray-400 text-[10px] truncate">{m.name}</span>
                </div>
              )
            })}
          </div>
        )}

        {machMaintenance.length > 0 && (
          <div className="p-3 border-t border-white/5">
            <p className="text-amber-400 text-xs font-semibold mb-1">Maintenance</p>
            {machMaintenance.map(m=><p key={m.id} className="text-gray-500 text-xs truncate">{m.name}</p>)}
          </div>
        )}
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/5 bg-[#0b0e17] flex-shrink-0">
          <div className="flex items-center gap-2">
            <button onClick={goBack}    className="w-8 h-8 flex items-center justify-center bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg">←</button>
            <button onClick={goToday}   className="px-3 h-8 bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold rounded-lg">Today</button>
            <button onClick={goForward} className="w-8 h-8 flex items-center justify-center bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg">→</button>
            <span className="text-white font-semibold text-sm ml-2">{navLabel()}</span>
          </div>
          <div className="flex items-center gap-1">
            {(['month','week','day'] as View[]).map(v=>(
              <button key={v} onClick={()=>setView(v)}
                className={`px-3 h-8 text-xs font-semibold rounded-lg capitalize ${
                  view===v?'bg-blue-600 text-white':'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                }`}>{v}</button>
            ))}
          </div>
        </div>

        {view==='month'&&(
          <div className="flex-1 overflow-auto flex flex-col">
            <div className="grid grid-cols-7 border-b border-white/5 flex-shrink-0">
              {WEEK_H.map(h=><div key={h} className="py-2 text-center text-[10px] font-bold uppercase tracking-widest text-gray-600">{h}</div>)}
            </div>
            <div className="flex-1 grid grid-cols-7" style={{gridAutoRows:'minmax(130px,1fr)'}}>
              {monthDays.map(day=>(
                <DayCell key={day.toISOString()} day={day} compact dimmed={day.getMonth()!==monthAnchor.getMonth()} />
              ))}
            </div>
          </div>
        )}

        {view==='week'&&(
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="grid grid-cols-7 border-b border-white/5 flex-shrink-0" style={{marginLeft:64}}>
              {weekDays.map(day=>{
                const isToday=isSameDay(day,new Date())
                return (
                  <div key={day.toISOString()} className={`py-2 text-center border-r border-white/5 ${isToday?'bg-blue-600/10':''}`}>
                    <p className={`text-[10px] font-bold uppercase tracking-widest ${isToday?'text-blue-400':'text-gray-600'}`}>
                      {day.toLocaleDateString('en-GB',{weekday:'short'})}
                    </p>
                    <p className={`text-sm font-bold ${isToday?'text-blue-300':'text-gray-400'}`}>{day.getDate()}</p>
                  </div>
                )
              })}
            </div>
            <div className="flex-1 overflow-y-auto overflow-x-auto">
              <div className="flex" style={{height:totalTimelinePx,minWidth:700}}>
                <div className="w-16 flex-shrink-0 border-r border-white/5 bg-[#0b0e17]">
                  {Array.from({length:TOTAL_HOURS},(_,i)=>HOUR_START+i).map(h=>(
                    <div key={h} style={{height:ROW_PX}} className="flex items-start pt-2 pr-3 justify-end border-b border-white/[0.04]">
                      <span className="text-xs text-gray-500 font-mono">{String(h).padStart(2,'0')}:00</span>
                    </div>
                  ))}
                </div>
                <div className="flex-1 grid grid-cols-7">
                  {weekDays.map(day=>{
                    const groups=woGroupsOnDay(day)
                    const woDue=woOnDay(day)
                    return (
                      <div key={day.toISOString()} className="border-r border-white/5 relative bg-[#0f1117]" style={{height:totalTimelinePx}}>
                        {Array.from({length:TOTAL_HOURS},(_,i)=>(
                          <div key={i} style={{top:i*ROW_PX,height:ROW_PX}} className="absolute inset-x-0 border-b border-white/[0.06]"/>
                        ))}
                        {Array.from({length:TOTAL_HOURS},(_,i)=>(
                          <div key={`hh-${i}`} style={{top:i*ROW_PX+ROW_PX/2,height:1}} className="absolute inset-x-0 border-b border-white/[0.03]"/>
                        ))}
                        {groups.map(g=><TimelineWOGroup key={g.woId} group={g} day={day} isWeek />)}
                        {woDue.map(wo=>{
                          const due=new Date(wo.due_date)
                          const top=timeToTopPx(due,day)
                          const c=P_COLOR[wo.priority]||P_COLOR[3]
                          return (
                            <div key={wo.id} draggable
                              onDragStart={()=>{ dragRef.current={type:'wo',data:wo} }}
                              style={{top,left:2,right:2}}
                              className={`absolute border-l-2 ${c.border} bg-white/5 rounded-r px-1 py-0.5 text-[10px] cursor-grab z-10`}
                            >
                              <span className="text-white font-semibold">{wo.code}</span>
                              <span className="text-gray-400 ml-1">{fmtTime(due)}</span>
                            </div>
                          )
                        })}
                        <div className="absolute inset-0 z-0"
                          onDragOver={e=>{e.preventDefault();setDragOver(day.toISOString()+'w')}}
                          onDragLeave={()=>setDragOver(null)}
                          onDrop={async e=>{
                            e.preventDefault();setDragOver(null)
                            const payload=dragRef.current
                            if(!payload)return
                            const rect=(e.currentTarget as HTMLElement).getBoundingClientRect()
                            const relY=Math.max(0,e.clientY-rect.top)
                            const frac=Math.min(relY/totalTimelinePx,1)
                            const mins=Math.round(frac*TOTAL_HOURS*60/15)*15
                            const ns=new Date(day);ns.setHours(HOUR_START,0,0,0);ns.setMinutes(ns.getMinutes()+mins)
                            if(payload.type==='sched_group')return dropSchedGroup(ns)
                            dragRef.current=null
                            setSaving(payload.data.id)
                            try{
                              await updateWorkOrder(payload.data.id,{due_date:ns.toISOString()})
                              showToast(`${payload.data.code} moved`)
                              await refresh()
                            }catch{showToast('Failed.')}
                            finally{setSaving(null)}
                          }}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {view==='day'&&(
          <div className="flex-1 overflow-y-auto">
            <div className="px-5 pt-4 pb-2">
              <p className={`font-semibold text-sm ${isSameDay(dayAnchor,new Date())?'text-blue-400':'text-gray-400'}`}>
                {dayAnchor.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}
              </p>
            </div>
            <div className="mx-5 mb-8" style={{height:totalTimelinePx}}>
              <DayTimeline day={dayAnchor}/>
            </div>
          </div>
        )}
      </div>

      {editWO&&(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={()=>setEditWO(null)}>
          <div className="bg-[#1a1f2e] border border-white/10 rounded-2xl p-6 w-96 shadow-2xl" onClick={e=>e.stopPropagation()}>
            <h3 className="text-white font-bold text-lg mb-1">{editWO.code}</h3>
            <p className="text-gray-400 text-sm mb-5">{editWO.customer_name||'No customer'} · {P_LABEL[editWO.priority]} priority</p>
            <div className="space-y-4">
              <div>
                <label className="block text-gray-400 text-xs mb-1.5">Due Date</label>
                <input type="date" value={editDate} onChange={e=>setEditDate(e.target.value)}
                  className="w-full bg-[#0f1117] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none [color-scheme:dark]"/>
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-1.5">Due Time</label>
                <input type="time" value={editTime} onChange={e=>setEditTime(e.target.value)}
                  className="w-full bg-[#0f1117] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none"/>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={saveEdit} disabled={!editDate||saving===editWO.id}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold rounded-xl">
                {saving===editWO.id?'Saving...':'Save'}
              </button>
              <button onClick={()=>setEditWO(null)} className="px-4 py-2.5 bg-white/5 hover:bg-white/10 text-gray-300 text-sm rounded-xl">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {toast&&(
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 border border-white/10 text-white text-sm px-5 py-3 rounded-xl shadow-2xl z-50 max-w-sm text-center">{toast}</div>
      )}
    </div>
  )
}
