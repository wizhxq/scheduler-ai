import { useState, useEffect } from 'react'
import { getWorkOrders, createWorkOrder, deleteWorkOrder, updateWorkOrder, getMachines, getOperations, createOperation, deleteOperation } from '../api'

const PRIORITY_CONFIG: Record<number, { label: string; color: string; dot: string }> = {
  1: { label: 'Critical', color: 'bg-red-500/20 text-red-400 border border-red-500/30', dot: 'bg-red-500' },
  2: { label: 'High', color: 'bg-orange-500/20 text-orange-400 border border-orange-500/30', dot: 'bg-orange-500' },
  3: { label: 'Medium', color: 'bg-blue-500/20 text-blue-400 border border-blue-500/30', dot: 'bg-blue-500' },
  4: { label: 'Low', color: 'bg-gray-500/20 text-gray-400 border border-gray-500/30', dot: 'bg-gray-500' },
}

const STATUS_OPTIONS = [
  { value: 'pending',     label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'paused',      label: 'Paused' },
  { value: 'completed',   label: 'Completed' },
  { value: 'on_hold',     label: 'On Hold' },
  { value: 'cancelled',   label: 'Cancelled' },
]

// Duration stored per WO as { h: hours, m: minutes }
type HM = { h: number; m: number }
const hmToMins = (hm: HM) => hm.h * 60 + hm.m
const DEFAULT_HM: HM = { h: 1, m: 0 }

export default function WorkOrdersPage() {
  const [workOrders, setWorkOrders] = useState<any[]>([])
  const [machines,   setMachines]   = useState<any[]>([])
  const [operations, setOperations] = useState<Record<number, any[]>>({})
  const [expanded,   setExpanded]   = useState<number | null>(null)
  const [showForm,   setShowForm]   = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

  // New WO form
  const [code,         setCode]         = useState('')
  const [customerName, setCustomerName] = useState('')
  const [dueDate,      setDueDate]      = useState('')
  const [priority,     setPriority]     = useState(3)

  // Per-WO operation form: machine id + hours/minutes
  const [opMachineByWo,  setOpMachineByWo]  = useState<Record<number, number>>({})
  const [opDurationByWo, setOpDurationByWo] = useState<Record<number, HM>>({})

  // Edit modal
  const [editWO,       setEditWO]       = useState<any | null>(null)
  const [editCustomer, setEditCustomer] = useState('')
  const [editDate,     setEditDate]     = useState('')
  const [editTime,     setEditTime]     = useState('17:00')
  const [editPriority, setEditPriority] = useState(3)
  const [editStatus,   setEditStatus]   = useState('pending')
  const [editRush,     setEditRush]     = useState(false)
  const [editNotes,    setEditNotes]    = useState('')
  const [editSaving,   setEditSaving]   = useState(false)
  const [toast,        setToast]        = useState<string | null>(null)

  // ── load all work orders + machines ─────────────────────────────────────
  const load = async () => {
    const [wo, m] = await Promise.all([getWorkOrders(), getMachines()])
    setWorkOrders(wo)
    setMachines(m)
    if (m.length > 0) {
      setOpMachineByWo(prev => {
        const next = { ...prev }
        wo.forEach((w: any) => { if (!(w.id in next)) next[w.id] = m[0].id })
        return next
      })
      setOpDurationByWo(prev => {
        const next = { ...prev }
        wo.forEach((w: any) => { if (!(w.id in next)) next[w.id] = DEFAULT_HM })
        return next
      })
    }
  }

  useEffect(() => { load() }, [])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  // reload the operations for one expanded WO
  const loadOps = async (woId: number) => {
    const ops = await getOperations(woId)
    setOperations(prev => ({ ...prev, [woId]: ops }))
  }

  const handleExpand = (id: number) => {
    if (expanded === id) { setExpanded(null) }
    else { setExpanded(id); loadOps(id) }
  }

  // ── create work order ────────────────────────────────────────────────────
  const handleAddWO = async () => {
    if (!code.trim()) return
    await createWorkOrder({
      code,
      customer_name: customerName || null,
      due_date: dueDate
        ? new Date(dueDate).toISOString()
        : new Date(Date.now() + 7 * 86400000).toISOString(),
      priority,
    })
    setCode(''); setCustomerName(''); setDueDate(''); setPriority(3); setShowForm(false)
    await load()
  }

  // ── delete whole work order ──────────────────────────────────────────────
  const handleDeleteWO = async (id: number) => {
    await deleteWorkOrder(id)
    setDeleteConfirm(null)
    if (expanded === id) setExpanded(null)
    await load()
  }

  // ── add a routing step ───────────────────────────────────────────────────
  const handleAddOp = async (woId: number) => {
    const machineId = opMachineByWo[woId] || (machines[0]?.id ?? 0)
    const hm        = opDurationByWo[woId] || DEFAULT_HM
    const totalMins = Math.max(1, hmToMins(hm))
    const currentOps = operations[woId] || []
    await createOperation({
      work_order_id:      woId,
      machine_id:         machineId,
      sequence_no:        currentOps.length + 1,
      processing_minutes: totalMins,
    })
    await loadOps(woId)
    // also refresh the top-level list so the step count badge updates
    await load()
  }

  // ── delete a routing step ────────────────────────────────────────────────
  // FIX: also call load() so the "N steps" count in the header row refreshes
  const handleDeleteOp = async (e: React.MouseEvent, woId: number, opId: number) => {
    e.stopPropagation()   // prevent the row expand toggle from firing
    await deleteOperation(opId)
    await loadOps(woId)   // refresh the step list inside the expanded panel
    await load()          // refresh the header badge that says "N steps"
  }

  // ── edit modal helpers ───────────────────────────────────────────────────
  const openEdit = (e: React.MouseEvent, wo: any) => {
    e.stopPropagation()
    setEditWO(wo)
    setEditCustomer(wo.customer_name || '')
    setEditPriority(wo.priority || 3)
    setEditStatus(wo.status || 'pending')
    setEditRush(wo.is_rush || false)
    setEditNotes(wo.notes || '')
    if (wo.due_date) {
      const d = new Date(wo.due_date)
      setEditDate(d.toISOString().split('T')[0])
      setEditTime(d.toTimeString().slice(0, 5))
    } else {
      setEditDate('')
      setEditTime('17:00')
    }
  }

  const saveEdit = async () => {
    if (!editWO) return
    setEditSaving(true)
    try {
      const due_date = editDate
        ? new Date(`${editDate}T${editTime}:00`).toISOString()
        : null
      await updateWorkOrder(editWO.id, {
        due_date,
        priority:      editPriority,
        status:        editStatus,
        customer_name: editCustomer || null,
        is_rush:       editRush,
        notes:         editNotes,
      })
      showToast(`✅ ${editWO.code} updated`)
      setEditWO(null)
      await load()
    } catch {
      showToast('❌ Failed to save changes.')
    } finally {
      setEditSaving(false)
    }
  }

  // ── helpers for hours/minutes inputs ────────────────────────────────────
  const setHours = (woId: number, val: string) => {
    const h = Math.max(0, parseInt(val) || 0)
    setOpDurationByWo(prev => ({ ...prev, [woId]: { ...(prev[woId] || DEFAULT_HM), h } }))
  }
  const setMins = (woId: number, val: string) => {
    const m = Math.min(59, Math.max(0, parseInt(val) || 0))
    setOpDurationByWo(prev => ({ ...prev, [woId]: { ...(prev[woId] || DEFAULT_HM), m } }))
  }

  // ── render ───────────────────────────────────────────────────────────────
  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Work Orders</h1>
          <p className="text-gray-400 text-sm mt-1">{workOrders.length} orders total</p>
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl transition-colors">
          <span className="text-lg leading-none">+</span> New Order
        </button>
      </div>

      {/* ── New WO form ── */}
      {showForm && (
        <div className="bg-[#1a1f2e] border border-white/5 rounded-2xl p-6">
          <h2 className="text-white font-semibold mb-4 text-lg">New Work Order</h2>
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="block text-gray-500 text-xs mb-1.5 uppercase tracking-wider font-semibold">Order Code *</label>
              <input value={code} onChange={e => setCode(e.target.value)} placeholder="e.g. WO-001"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:border-blue-500/50 outline-none placeholder-gray-600" />
            </div>
            <div>
              <label className="block text-gray-500 text-xs mb-1.5 uppercase tracking-wider font-semibold">Customer Name</label>
              <input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="e.g. Acme Corp"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:border-blue-500/50 outline-none placeholder-gray-600" />
            </div>
            <div>
              <label className="block text-gray-500 text-xs mb-1.5 uppercase tracking-wider font-semibold">Due Date</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:border-blue-500/50 outline-none [color-scheme:dark]" />
            </div>
            <div>
              <label className="block text-gray-500 text-xs mb-1.5 uppercase tracking-wider font-semibold">Priority</label>
              <select value={priority} onChange={e => setPriority(Number(e.target.value))}
                className="w-full bg-[#0f1117] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:border-blue-500/50 outline-none">
                <option value={1}>1 - Critical</option>
                <option value={2}>2 - High</option>
                <option value={3}>3 - Medium</option>
                <option value={4}>4 - Low</option>
              </select>
            </div>
          </div>
          <div className="flex gap-3 mt-6">
            <button onClick={handleAddWO} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl transition-colors">Create Order</button>
            <button onClick={() => setShowForm(false)} className="px-6 py-2 bg-white/5 hover:bg-white/10 text-gray-300 text-sm rounded-xl transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {/* ── Work order list ── */}
      <div className="space-y-3">
        {workOrders.map((wo: any) => {
          const config    = PRIORITY_CONFIG[wo.priority] || PRIORITY_CONFIG[3]
          const isExpanded = expanded === wo.id
          const ops        = operations[wo.id] || []
          const opMachine  = opMachineByWo[wo.id] || (machines[0]?.id ?? 0)
          const hm         = opDurationByWo[wo.id] || DEFAULT_HM

          return (
            <div key={wo.id} className={`bg-[#1a1f2e] border border-white/5 rounded-2xl overflow-hidden transition-all ${isExpanded ? 'ring-1 ring-blue-500/30' : 'hover:border-white/10'}`}>

              {/* ── Header row ── */}
              <div className="p-5 flex items-center justify-between">
                <div className="flex items-center gap-4 flex-1 cursor-pointer" onClick={() => handleExpand(wo.id)}>
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${config.dot}`} />
                  <div>
                    <h3 className="text-white font-bold flex items-center gap-2">
                      {wo.code}
                      {wo.is_rush && <span className="text-[9px] bg-red-500/20 text-red-400 border border-red-500/30 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide">⚡ Rush</span>}
                      <span className="text-gray-500 font-normal text-sm">| {wo.customer_name || 'Generic'}</span>
                    </h3>
                    <p className="text-gray-500 text-xs mt-1">
                      Due: {wo.due_date
                        ? new Date(wo.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                        : <span className="text-amber-500/70">Not scheduled</span>}
                      {wo.notes && <span className="ml-3 text-gray-600">· {wo.notes}</span>}
                    </p>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-tighter ${config.color}`}>
                    {config.label}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right cursor-pointer" onClick={() => handleExpand(wo.id)}>
                    <p className="text-white text-xs font-semibold">{wo.operation_count ?? ops.length} steps</p>
                    <p className="text-gray-500 text-[10px]">Operations</p>
                  </div>

                  <button onClick={e => openEdit(e, wo)} title="Edit work order"
                    className="p-2 text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors">✏️</button>

                  {deleteConfirm === wo.id ? (
                    <div className="flex gap-2">
                      <button onClick={e => { e.stopPropagation(); handleDeleteWO(wo.id) }}
                        className="text-xs px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg font-semibold">Confirm</button>
                      <button onClick={e => { e.stopPropagation(); setDeleteConfirm(null) }}
                        className="text-xs px-3 py-1.5 bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={e => { e.stopPropagation(); setDeleteConfirm(wo.id) }}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors px-2 py-1">Delete</button>
                  )}

                  <span className={`text-gray-500 transition-transform cursor-pointer ${isExpanded ? 'rotate-180' : ''}`}
                    onClick={() => handleExpand(wo.id)}>▼</span>
                </div>
              </div>

              {/* ── Expanded panel ── */}
              {isExpanded && (
                <div className="border-t border-white/5 bg-[#141824] p-5 space-y-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-white font-semibold text-sm">Routing Steps</h4>
                    <p className="text-gray-500 text-[10px] uppercase">Process Flow</p>
                  </div>

                  {ops.length > 0 ? (
                    <div className="space-y-2">
                      {ops.slice().sort((a, b) => a.sequence_no - b.sequence_no).map((op) => {
                        const m = machines.find(mach => mach.id === op.machine_id)
                        const hrs  = Math.floor(op.processing_minutes / 60)
                        const mins = op.processing_minutes % 60
                        const dur  = hrs > 0
                          ? `${hrs}h ${mins > 0 ? mins + 'm' : ''}`.trim()
                          : `${mins}m`
                        return (
                          <div key={op.id} className="flex items-center gap-3 bg-white/5 border border-white/5 rounded-xl p-3">
                            <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-[10px] font-bold">{op.sequence_no}</div>
                            <div className="flex-1">
                              <p className="text-white text-sm font-medium">{m?.name || 'Unknown Machine'}</p>
                              <p className="text-gray-500 text-[10px] font-mono">{m?.code}</p>
                            </div>
                            <div className="text-right mr-4">
                              {/* Show duration as Xh Ym or Ym */}
                              <p className="text-gray-300 text-xs font-semibold">{dur}</p>
                              <p className="text-gray-500 text-[10px]">{op.processing_minutes} min</p>
                            </div>
                            {/* FIX: pass the event so we can stopPropagation properly */}
                            <button
                              onClick={e => handleDeleteOp(e, wo.id, op.id)}
                              className="p-2 text-gray-600 hover:text-red-400 transition-colors"
                              title="Delete this step"
                            >✕</button>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="py-8 text-center border-2 border-dashed border-white/5 rounded-2xl">
                      <p className="text-gray-500 text-xs italic">No operations defined. Add the first production step below.</p>
                    </div>
                  )}

                  {/* ── Add step form ── */}
                  <div className="mt-6 pt-4 border-t border-white/5">
                    <h4 className="text-gray-400 text-[10px] font-bold uppercase tracking-widest mb-3">Add Production Step</h4>
                    <div className="flex items-end gap-3">
                      {/* Machine select */}
                      <div className="flex-1">
                        <label className="block text-gray-500 text-[10px] mb-1">Select Machine</label>
                        <select value={opMachine}
                          onChange={e => setOpMachineByWo(prev => ({ ...prev, [wo.id]: Number(e.target.value) }))}
                          className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white text-xs outline-none focus:border-blue-500/50">
                          {machines.map(m => (
                            <option key={m.id} value={m.id} className="bg-[#0f1117] text-white">{m.name} ({m.code})</option>
                          ))}
                        </select>
                      </div>

                      {/* Hours input */}
                      <div className="w-20">
                        <label className="block text-gray-500 text-[10px] mb-1">Hours</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={hm.h === 0 ? '' : hm.h}
                          placeholder="0"
                          onChange={e => setHours(wo.id, e.target.value)}
                          className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white text-xs outline-none focus:border-blue-500/50"
                        />
                      </div>

                      {/* Minutes input (0–59) */}
                      <div className="w-20">
                        <label className="block text-gray-500 text-[10px] mb-1">Minutes</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={hm.m === 0 ? '' : hm.m}
                          placeholder="0"
                          onChange={e => setMins(wo.id, e.target.value)}
                          className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white text-xs outline-none focus:border-blue-500/50"
                        />
                      </div>

                      {/* Total preview */}
                      <div className="text-gray-600 text-[10px] pb-2 whitespace-nowrap">
                        = {hmToMins(hm) || 0} min
                      </div>

                      <button onClick={() => handleAddOp(wo.id)}
                        className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-lg transition-all">+ Add Step</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Edit Modal ── */}
      {editWO && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setEditWO(null)}>
          <div className="bg-[#1a1f2e] border border-white/10 rounded-2xl p-6 w-[480px] shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-white font-bold text-lg">{editWO.code}</h3>
                <p className="text-gray-500 text-xs mt-0.5">Edit work order details</p>
              </div>
              <button onClick={() => setEditWO(null)} className="text-gray-600 hover:text-gray-400 text-xl leading-none">×</button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-gray-400 text-xs mb-1.5 font-semibold uppercase tracking-wider">Customer Name</label>
                <input value={editCustomer} onChange={e => setEditCustomer(e.target.value)}
                  placeholder="e.g. Acme Corp"
                  className="w-full bg-[#0f1117] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500/50" />
              </div>
              <div className="grid grid-cols-2 gap-3">
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
              <div>
                <label className="block text-gray-400 text-xs mb-1.5 font-semibold uppercase tracking-wider">Priority</label>
                <div className="grid grid-cols-4 gap-2">
                  {[1,2,3,4].map(p => {
                    const cfg = PRIORITY_CONFIG[p]
                    return (
                      <button key={p} onClick={() => setEditPriority(p)}
                        className={`py-2 rounded-xl text-xs font-bold border transition-all ${
                          editPriority === p
                            ? cfg.color + ' ring-2 ring-offset-1 ring-offset-[#1a1f2e] ring-current'
                            : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                        }`}>{cfg.label}</button>
                    )
                  })}
                </div>
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-1.5 font-semibold uppercase tracking-wider">Status</label>
                <select value={editStatus} onChange={e => setEditStatus(e.target.value)}
                  className="w-full bg-[#0f1117] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500/50">
                  {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-1.5 font-semibold uppercase tracking-wider">Notes</label>
                <input value={editNotes} onChange={e => setEditNotes(e.target.value)}
                  placeholder="Any notes about this order"
                  className="w-full bg-[#0f1117] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500/50" />
              </div>
              <div className="flex items-center justify-between bg-[#0f1117] border border-white/10 rounded-xl px-4 py-3">
                <div>
                  <p className="text-white text-sm font-semibold">⚡ Rush Order</p>
                  <p className="text-gray-500 text-xs">Flags this as high-urgency for the scheduler</p>
                </div>
                <button onClick={() => setEditRush(r => !r)}
                  className={`w-12 h-6 rounded-full transition-colors relative ${editRush ? 'bg-red-500' : 'bg-white/10'}`}>
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${editRush ? 'left-7' : 'left-1'}`} />
                </button>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={saveEdit} disabled={editSaving}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition-colors">
                {editSaving ? 'Saving...' : 'Save Changes'}
              </button>
              <button onClick={() => setEditWO(null)}
                className="px-4 py-2.5 bg-white/5 hover:bg-white/10 text-gray-300 text-sm rounded-xl transition-colors">Cancel</button>
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
