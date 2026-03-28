import { useState, useEffect, useRef, useCallback } from 'react'
import { getWorkOrders, updateWorkOrder, getMachines, getLatestSchedule, updateScheduleItem } from '../api'

// ─── colours ────────────────────────────────────────────────────────────────
const P_COLOR: Record<number, { bg: string; border: string; text: string }> = {
  1: { bg: 'bg-red-600/80',    border: 'border-red-500',    text: 'text-white' },
  2: { bg: 'bg-orange-500/80', border: 'border-orange-400', text: 'text-white' },
  3: { bg: 'bg-blue-600/80',   border: 'border-blue-500',   text: 'text-white' },
  4: { bg: 'bg-gray-600/70',   border: 'border-gray-500',   text: 'text-white' },
}
const P_LABEL: Record<number, string> = { 1:'Critical', 2:'High', 3:'Medium', 4:'Low' }

// Schedule item colour (distinct from WO priority chips)
const SCHED_COLOR = 'bg-violet-600/80 border-violet-500'

type View = 'month' | 'week' | 'day'

// ─── date helpers ───────────────────────────────────────────────────────────
const addDays  = (d: Date, n: number) => { const c = new Date(d); c.setDate(c.getDate()+n); return c }
const addMins  = (d: Date, n: number) => new Date(d.getTime() + n * 60000)
const startOfWeek = (d: Date) => {
  const c = new Date(d); const diff = c.getDay()===0 ? -6 : 1-c.getDay()
  c.setDate(c.getDate()+diff); c.setHours(0,0,0,0); return c
}
const isSameDay = (a: Date, b: Date) =>
  a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate()
const fmtTime = (d: Date) => d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})
const fmtDate = (d: Date) => d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})
const fmtMonthYear = (d: Date) => d.toLocaleDateString('en-GB',{month:'long',year:'numeric'})
const fmtShort = (d: Date) => d.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})

function buildMonthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const gs = startOfWeek(first)
  return Array.from({length:42},(_,i)=>addDays(gs,i))
}

// ─── HOURS shown in day / week timeline (06:00–22:00) ──────────────────────
const HOUR_START = 6
const HOUR_END   = 22
const TOTAL_HOURS = HOUR_END - HOUR_START   // 16
const ROW_PX = 56  // px per hour row

function timeToTopPct(d: Date, dayDate: Date): number {
  const startOfDay = new Date(dayDate)
  startOfDay.setHours(HOUR_START, 0, 0, 0)
  const mins = (d.getTime() - startOfDay.getTime()) / 60000
  return mins / (TOTAL_HOURS * 60)  // 0..1
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function CalendarPage() {
  const [workOrders,    setWorkOrders]    = useState<any[]>([])
  const [machines,      setMachines]      = useState<any[]>([])
  const [schedule,      setSchedule]      = useState<any | null>(null)
  const [view,          setView]          = useState<View>('month')
  const [monthAnchor,   setMonthAnchor]   = useState(() => new Date())
  const [weekAnchor,    setWeekAnchor]    = useState(() => startOfWeek(new Date()))
  const [dayAnchor,     setDayAnchor]     = useState(() => new Date())
  const [dragging,      setDragging]      = useState<{type:'wo'|'sched'; data:any}|null>(null)
  const [dragOver,      setDragOver]      = useState<string|null>(null)
  const [saving,        setSaving]        = useState<number|null>(null)
  const [editWO,        setEditWO]        = useState<any|null>(null)
  const [editDate,      setEditDate]      = useState('')
  const [editTime,      setEditTime]      = useState('17:00')
  const [toast,         setToast]         = useState<string|null>(null)

  const load = useCallback(async () => {
    const [wos, macs] = await Promise.all([getWorkOrders(), getMachines()])
    setWorkOrders(wos); setMachines(macs)
    try { const s = await getLatestSchedule(); setSchedule(s) }
    catch { setSchedule(null) }
  }, [])

  useEffect(() => { load() }, [load])

  const showToast = (msg: string) => { setToast(msg); setTimeout(()=>setToast(null),3500) }

  // ── navigation ──────────────────────────────────────────────────────────
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

  // ── drag & drop for WO cards (due-date move) ────────────────────────────
  const handleWODrop = async (day: Date) => {
    if (!dragging || dragging.type!=='wo') return
    const wo = dragging.data
    const newDate = new Date(day)
    if (wo.due_date) { const o=new Date(wo.due_date); newDate.setHours(o.getHours(),o.getMinutes(),0,0) }
    else newDate.setHours(17,0,0,0)
    setSaving(wo.id)
    try {
      await updateWorkOrder(wo.id, { due_date: newDate.toISOString() })
      showToast(`✅ ${wo.code} moved to ${fmtDate(newDate)}`)
      if (view==='month' && newDate.getMonth()!==monthAnchor.getMonth())
        setMonthAnchor(new Date(newDate.getFullYear(),newDate.getMonth(),1))
      await load()
    } catch { showToast('❌ Failed to update.') }
    finally { setSaving(null); setDragging(null) }
  }

  // ── drag & drop for schedule items (time block move) ───────────────────
  const handleSchedDrop = async (newStart: Date, item: any) => {
    const durationMs = new Date(item.end_time).getTime() - new Date(item.start_time).getTime()
    const newEnd = new Date(newStart.getTime() + durationMs)
    setSaving(item.id)
    try {
      await updateScheduleItem(item.id, {
        start_time: newStart.toISOString(),
        end_time:   newEnd.toISOString(),
      })
      showToast(`✅ ${item.work_order_name} rescheduled to ${fmtTime(newStart)}`)
      await load()
    } catch { showToast('❌ Failed to reschedule.') }
    finally { setSaving(null); setDragging(null) }
  }

  // ── generic drop handler for day cells (month/week) ────────────────────
  const handleCellDrop = async (e: React.DragEvent, day: Date) => {
    e.preventDefault(); setDragOver(null)
    if (!dragging) return
    if (dragging.type==='wo') return handleWODrop(day)
    // schedule items in month/week just move to start of that day at same time
    const item = dragging.data
    const orig = new Date(item.start_time)
    const newStart = new Date(day)
    newStart.setHours(orig.getHours(), orig.getMinutes(), 0, 0)
    return handleSchedDrop(newStart, item)
  }

  // ── edit modal ──────────────────────────────────────────────────────────
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
      await updateWorkOrder(editWO.id,{due_date:dt.toISOString()})
      showToast(`✅ ${editWO.code} scheduled for ${fmtDate(dt)}`)
      setEditWO(null); await load()
    } catch { showToast('❌ Failed.') }
    finally { setSaving(null) }
  }

  // ── data helpers ────────────────────────────────────────────────────────
  const woOnDay = (day: Date) =>
    workOrders.filter(wo => wo.due_date && isSameDay(new Date(wo.due_date), day))

  const schedItemsOnDay = (day: Date) =>
    (schedule?.items || []).filter((it: any) =>
      isSameDay(new Date(it.start_time), day)
    )

  const unscheduled = workOrders.filter(wo => !wo.due_date && wo.status==='pending')
  const machMaintenance = machines.filter(m => m.status==='maintenance')

  // ── month / week day cell ───────────────────────────────────────────────
  const DayCell = ({ day, compact=false, dimmed=false }: { day:Date; compact?:boolean; dimmed?:boolean }) => {
    const key     = day.toISOString()
    const isToday = isSameDay(day, new Date())
    const wos     = woOnDay(day)
    const sitems  = schedItemsOnDay(day)
    const isTarget= dragOver===key
    return (
      <div
        onDragOver={e=>{e.preventDefault();setDragOver(key)}}
        onDragLeave={()=>setDragOver(null)}
        onDrop={e=>handleCellDrop(e,day)}
        className={`border border-white/5 flex flex-col transition-colors ${
          isTarget?'bg-blue-900/25 border-blue-500/40':dimmed?'bg-[#0b0e17]':'bg-[#0f1117]'
        } ${compact?'min-h-[100px]':'min-h-[120px]'}`}
      >
        {/* date number */}
        <div className={`px-2 pt-2 pb-1 flex items-center justify-between ${isToday?'bg-blue-600/20':''}`}>
          <span className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${
            isToday?'bg-blue-500 text-white':dimmed?'text-gray-700':'text-gray-300'
          }`}>{day.getDate()}</span>
          {day.getDate()===1 && (
            <span className={`text-[9px] font-semibold uppercase tracking-wider ${dimmed?'text-gray-700':'text-gray-500'}`}>
              {day.toLocaleDateString('en-GB',{month:'short'})}
            </span>
          )}
        </div>
        {/* chips */}
        <div className="flex-1 px-1.5 pb-1.5 space-y-0.5 overflow-hidden">
          {/* schedule items first (violet) */}
          {sitems.slice(0, compact?1:2).map((it:any) => (
            <div key={`si-${it.id}`}
              draggable
              onDragStart={e=>{e.stopPropagation();setDragging({type:'sched',data:it})}}
              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold cursor-grab select-none truncate border ${SCHED_COLOR} text-white hover:opacity-80`}
            >
              ⚙ {it.work_order_name} {fmtTime(new Date(it.start_time))}
            </div>
          ))}
          {/* WO due-date chips */}
          {wos.slice(0,compact?1:2).map(wo=>{
            const c=P_COLOR[wo.priority]||P_COLOR[3]
            return (
              <div key={wo.id} draggable
                onDragStart={e=>{e.stopPropagation();setDragging({type:'wo',data:wo})}}
                onClick={()=>openEdit(wo)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold cursor-grab select-none truncate border ${c.bg} ${c.border} ${c.text} hover:opacity-80 ${saving===wo.id?'opacity-40':''}`}
              >
                {wo.code}{wo.customer_name?` · ${wo.customer_name}`:''}
              </div>
            )
          })}
          {(sitems.length+wos.length) > (compact?2:4) && (
            <div className="text-[9px] text-gray-500 pl-1">+{(sitems.length+wos.length)-(compact?2:4)} more</div>
          )}
          {isTarget && <div className="border border-dashed border-blue-400/40 rounded text-[10px] text-blue-400 text-center py-0.5">Drop</div>}
        </div>
      </div>
    )
  }

  // ── day timeline view ───────────────────────────────────────────────────
  const DayTimeline = ({ day }: { day: Date }) => {
    const timelineRef = useRef<HTMLDivElement>(null)
    const hours = Array.from({length: TOTAL_HOURS}, (_,i) => HOUR_START + i)
    const sitems = schedItemsOnDay(day)
    const wos    = woOnDay(day)
    const totalPx = TOTAL_HOURS * ROW_PX

    const handleTimelineDrop = async (e: React.DragEvent) => {
      e.preventDefault()
      if (!dragging || !timelineRef.current) return
      const rect = timelineRef.current.getBoundingClientRect()
      const relY = e.clientY - rect.top
      const fracY = Math.max(0, Math.min(relY / totalPx, 1))
      const totalMins = fracY * TOTAL_HOURS * 60
      const snappedMins = Math.round(totalMins / 15) * 15  // snap to 15-min slots
      const newStart = new Date(day)
      newStart.setHours(HOUR_START, 0, 0, 0)
      newStart.setMinutes(newStart.getMinutes() + snappedMins)

      if (dragging.type==='sched') return handleSchedDrop(newStart, dragging.data)
      // WO drop on timeline sets due_date
      const wo = dragging.data
      setSaving(wo.id)
      try {
        await updateWorkOrder(wo.id, { due_date: newStart.toISOString() })
        showToast(`✅ ${wo.code} due at ${fmtTime(newStart)}`)
        await load()
      } catch { showToast('❌ Failed.') }
      finally { setSaving(null); setDragging(null) }
    }

    const nowLine = (() => {
      if (!isSameDay(day, new Date())) return null
      const now = new Date()
      const top = timeToTopPct(now, day) * totalPx
      return <div className="absolute left-0 right-0 z-20 flex items-center" style={{top}}>
        <div className="w-2 h-2 rounded-full bg-red-500 -ml-1 flex-shrink-0" />
        <div className="flex-1 border-t border-red-500 border-dashed opacity-70" />
      </div>
    })()

    return (
      <div className="flex h-full">
        {/* hour labels */}
        <div className="w-14 flex-shrink-0 border-r border-white/5 select-none">
          {hours.map(h=>(
            <div key={h} style={{height:ROW_PX}} className="flex items-start pt-1 pr-2 justify-end">
              <span className="text-[10px] text-gray-600 font-mono">{String(h).padStart(2,'0')}:00</span>
            </div>
          ))}
        </div>
        {/* timeline grid */}
        <div ref={timelineRef} className="flex-1 relative"
          style={{height:totalPx, minHeight:totalPx}}
          onDragOver={e=>e.preventDefault()}
          onDrop={handleTimelineDrop}
        >
          {/* hour rows */}
          {hours.map(h=>(
            <div key={h} style={{top:(h-HOUR_START)*ROW_PX,height:ROW_PX}}
              className="absolute inset-x-0 border-b border-white/5" />
          ))}
          {/* half-hour faint lines */}
          {hours.map(h=>(
            <div key={`h-${h}`} style={{top:(h-HOUR_START)*ROW_PX+ROW_PX/2,height:1}}
              className="absolute inset-x-0 border-b border-white/[0.03]" />
          ))}

          {/* current time */}
          {nowLine}

          {/* schedule item blocks */}
          {sitems.map((it:any)=>{
            const st = new Date(it.start_time)
            const en = new Date(it.end_time)
            const top  = timeToTopPct(st, day) * totalPx
            const durMins = (en.getTime()-st.getTime())/60000
            const ht = Math.max(20, (durMins/60)*ROW_PX)
            return (
              <div key={it.id}
                draggable
                onDragStart={()=>setDragging({type:'sched',data:it})}
                style={{top,height:ht,left:'2px',right:'2px'}}
                className={`absolute rounded-lg border text-white text-[10px] p-1.5 cursor-grab select-none overflow-hidden ${
                  SCHED_COLOR
                } ${saving===it.id?'opacity-40':''} hover:brightness-110 z-10`}
              >
                <div className="font-bold truncate">⚙ {it.work_order_name}</div>
                <div className="opacity-70">{it.machine_name}</div>
                <div className="opacity-60">{fmtTime(st)} – {fmtTime(en)}</div>
                {it.is_late && <div className="text-red-300 text-[9px]">⚠ Late +{it.delay_minutes}m</div>}
              </div>
            )
          })}

          {/* WO due-date markers */}
          {wos.map(wo=>{
            const due = new Date(wo.due_date)
            const top = timeToTopPct(due, day) * totalPx
            const c = P_COLOR[wo.priority]||P_COLOR[3]
            return (
              <div key={wo.id}
                draggable
                onDragStart={()=>setDragging({type:'wo',data:wo})}
                onClick={()=>openEdit(wo)}
                style={{top, left:'2px', right:'2px'}}
                className={`absolute border-l-4 ${c.border} bg-white/5 rounded-r-lg px-2 py-0.5 text-[10px] cursor-grab select-none hover:bg-white/10 z-10`}
              >
                <span className="text-white font-semibold">{wo.code}</span>
                <span className="text-gray-400 ml-1">due {fmtTime(due)}</span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── builds ──────────────────────────────────────────────────────────────
  const monthDays = buildMonthGrid(monthAnchor)
  const weekDays  = Array.from({length:7},(_,i)=>addDays(weekAnchor,i))
  const WEEK_H    = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

  return (
    <div className="flex h-screen overflow-hidden">

      {/* sidebar */}
      <div className="w-52 bg-[#0b0e17] border-r border-white/5 flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-white/5">
          <h2 className="text-white font-semibold text-sm">Unscheduled</h2>
          <p className="text-gray-500 text-xs mt-0.5">{unscheduled.length} pending</p>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {unscheduled.length===0 && <p className="text-gray-600 text-xs text-center mt-8">All orders scheduled ✅</p>}
          {unscheduled.map(wo=>{
            const c=P_COLOR[wo.priority]||P_COLOR[3]
            return (
              <div key={wo.id} draggable
                onDragStart={()=>setDragging({type:'wo',data:wo})}
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
        {schedule && (
          <div className="px-3 pt-2 border-t border-white/5">
            <p className="text-gray-500 text-[10px] font-semibold uppercase tracking-wider mb-1">⚙ Schedule</p>
            <p className="text-gray-500 text-[10px]">{schedule.algorithm} · {schedule.total_operations} ops</p>
            <p className="text-gray-600 text-[10px]">{new Date(schedule.created_at).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</p>
          </div>
        )}
        {machMaintenance.length>0 && (
          <div className="p-3 border-t border-white/5">
            <p className="text-amber-400 text-xs font-semibold mb-1">🔧 Maintenance</p>
            {machMaintenance.map(m=><p key={m.id} className="text-gray-500 text-xs truncate">{m.name}</p>)}
          </div>
        )}
      </div>

      {/* main */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* toolbar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/5 bg-[#0b0e17] flex-shrink-0">
          <div className="flex items-center gap-2">
            <button onClick={goBack} className="w-8 h-8 flex items-center justify-center bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg text-sm">←</button>
            <button onClick={goToday} className="px-3 h-8 bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold rounded-lg">Today</button>
            <button onClick={goForward} className="w-8 h-8 flex items-center justify-center bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg text-sm">→</button>
            <span className="text-white font-semibold text-sm ml-2">{navLabel()}</span>
          </div>
          <div className="flex items-center gap-1">
            {(['month','week','day'] as View[]).map(v=>(
              <button key={v} onClick={()=>setView(v)}
                className={`px-3 h-8 text-xs font-semibold rounded-lg capitalize transition-colors ${
                  view===v?'bg-blue-600 text-white':'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                }`}>{v}</button>
            ))}
          </div>
        </div>

        {/* ── Month ── */}
        {view==='month' && (
          <div className="flex-1 overflow-auto flex flex-col">
            <div className="grid grid-cols-7 border-b border-white/5 flex-shrink-0">
              {WEEK_H.map(h=><div key={h} className="py-2 text-center text-[10px] font-bold uppercase tracking-widest text-gray-600">{h}</div>)}
            </div>
            <div className="flex-1 grid grid-cols-7" style={{gridAutoRows:'minmax(110px,1fr)'}}>
              {monthDays.map(day=>(
                <DayCell key={day.toISOString()} day={day} compact dimmed={day.getMonth()!==monthAnchor.getMonth()} />
              ))}
            </div>
          </div>
        )}

        {/* ── Week ── */}
        {view==='week' && (
          <div className="flex-1 overflow-auto flex flex-col">
            {/* day headers with date */}
            <div className="grid grid-cols-7 border-b border-white/5 flex-shrink-0 pl-14">
              {weekDays.map(day=>{
                const isToday=isSameDay(day,new Date())
                return (
                  <div key={day.toISOString()} className={`py-2 text-center ${isToday?'bg-blue-600/10':''}`}>
                    <p className={`text-[10px] font-bold uppercase tracking-widest ${isToday?'text-blue-400':'text-gray-600'}`}>
                      {day.toLocaleDateString('en-GB',{weekday:'short'})}
                    </p>
                    <p className={`text-sm font-bold ${isToday?'text-blue-300':'text-gray-400'}`}>{day.getDate()}</p>
                  </div>
                )
              })}
            </div>
            {/* timeline rows */}
            <div className="flex-1 overflow-auto">
              <div className="flex" style={{minHeight: TOTAL_HOURS*ROW_PX}}>
                {/* hour labels */}
                <div className="w-14 flex-shrink-0 border-r border-white/5">
                  {Array.from({length:TOTAL_HOURS},(_,i)=>HOUR_START+i).map(h=>(
                    <div key={h} style={{height:ROW_PX}} className="flex items-start pt-1 pr-2 justify-end">
                      <span className="text-[10px] text-gray-600 font-mono">{String(h).padStart(2,'0')}:00</span>
                    </div>
                  ))}
                </div>
                {/* day columns */}
                <div className="flex-1 grid grid-cols-7">
                  {weekDays.map(day=>(
                    <div key={day.toISOString()} className="border-r border-white/5 relative" style={{height:TOTAL_HOURS*ROW_PX}}>
                      {/* hour lines */}
                      {Array.from({length:TOTAL_HOURS},(_,i)=>(
                        <div key={i} style={{top:i*ROW_PX,height:ROW_PX}} className="absolute inset-x-0 border-b border-white/5" />
                      ))}
                      {/* schedule blocks */}
                      {schedItemsOnDay(day).map((it:any)=>{
                        const st=new Date(it.start_time); const en=new Date(it.end_time)
                        const top=timeToTopPct(st,day)*(TOTAL_HOURS*ROW_PX)
                        const ht=Math.max(18,(en.getTime()-st.getTime())/60000/60*ROW_PX)
                        return (
                          <div key={it.id} draggable onDragStart={()=>setDragging({type:'sched',data:it})}
                            style={{top,height:ht,left:1,right:1}}
                            className={`absolute rounded text-[9px] p-1 cursor-grab ${SCHED_COLOR} text-white overflow-hidden z-10 hover:brightness-110 ${saving===it.id?'opacity-40':''}`}
                          >
                            <div className="font-bold truncate">{it.work_order_name}</div>
                            <div className="opacity-60">{fmtTime(st)}</div>
                          </div>
                        )
                      })}
                      {/* WO due markers */}
                      {woOnDay(day).map(wo=>{
                        const due=new Date(wo.due_date)
                        const top=timeToTopPct(due,day)*(TOTAL_HOURS*ROW_PX)
                        const c=P_COLOR[wo.priority]||P_COLOR[3]
                        return (
                          <div key={wo.id} draggable onDragStart={()=>setDragging({type:'wo',data:wo})}
                            style={{top,left:1,right:1}}
                            className={`absolute border-l-2 ${c.border} bg-white/5 rounded-r px-1 text-[9px] cursor-grab z-10`}
                          >
                            <span className="text-white font-semibold truncate">{wo.code}</span>
                          </div>
                        )
                      })}
                      {/* drop target */}
                      <div className="absolute inset-0 z-0"
                        onDragOver={e=>{e.preventDefault();setDragOver(day.toISOString()+'week')}}
                        onDragLeave={()=>setDragOver(null)}
                        onDrop={async e=>{
                          e.preventDefault(); setDragOver(null)
                          if (!dragging||!e.currentTarget) return
                          const rect=(e.currentTarget as HTMLElement).getBoundingClientRect()
                          const relY=e.clientY-rect.top
                          const frac=Math.max(0,Math.min(relY/(TOTAL_HOURS*ROW_PX),1))
                          const mins=Math.round(frac*TOTAL_HOURS*60/15)*15
                          const ns=new Date(day); ns.setHours(HOUR_START,0,0,0); ns.setMinutes(ns.getMinutes()+mins)
                          if (dragging.type==='sched') return handleSchedDrop(ns,dragging.data)
                          await updateWorkOrder(dragging.data.id,{due_date:ns.toISOString()})
                          showToast(`✅ ${dragging.data.code} → ${fmtTime(ns)}`)
                          setDragging(null); await load()
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Day ── */}
        {view==='day' && (
          <div className="flex-1 overflow-auto">
            <div className="px-5 pt-4 pb-2 flex-shrink-0">
              <p className={`font-semibold text-sm ${ isSameDay(dayAnchor,new Date())?'text-blue-400':'text-gray-400' }`}>
                {dayAnchor.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}
              </p>
            </div>
            <div style={{height:TOTAL_HOURS*ROW_PX}} className="mx-5 mb-5">
              <DayTimeline day={dayAnchor} />
            </div>
          </div>
        )}
      </div>

      {/* edit modal */}
      {editWO && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={()=>setEditWO(null)}>
          <div className="bg-[#1a1f2e] border border-white/10 rounded-2xl p-6 w-96 shadow-2xl" onClick={e=>e.stopPropagation()}>
            <h3 className="text-white font-bold text-lg mb-1">{editWO.code}</h3>
            <p className="text-gray-400 text-sm mb-5">{editWO.customer_name||'No customer'} · {P_LABEL[editWO.priority]} priority</p>
            <div className="space-y-4">
              <div>
                <label className="block text-gray-400 text-xs mb-1.5">Due Date</label>
                <input type="date" value={editDate} onChange={e=>setEditDate(e.target.value)}
                  className="w-full bg-[#0f1117] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none [color-scheme:dark]" />
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-1.5">Due Time</label>
                <input type="time" value={editTime} onChange={e=>setEditTime(e.target.value)}
                  className="w-full bg-[#0f1117] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={saveEdit} disabled={!editDate||saving===editWO.id}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold rounded-xl">
                {saving===editWO.id?'Saving...':'Save Schedule'}
              </button>
              <button onClick={()=>setEditWO(null)} className="px-4 py-2.5 bg-white/5 hover:bg-white/10 text-gray-300 text-sm rounded-xl">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 border border-white/10 text-white text-sm px-5 py-3 rounded-xl shadow-2xl z-50">{toast}</div>
      )}
    </div>
  )
}
