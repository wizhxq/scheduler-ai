import { useState, useEffect } from 'react'
import { getWorkOrders, createWorkOrder, getMachines, getOperations, createOperation, deleteOperation } from '../api'

const PRIORITY_CONFIG: Record<number, { label: string; color: string; dot: string }> = {
  1: { label: 'Critical', color: 'bg-red-500/20 text-red-400 border border-red-500/30', dot: 'bg-red-500' },
  2: { label: 'High', color: 'bg-orange-500/20 text-orange-400 border border-orange-500/30', dot: 'bg-orange-500' },
  3: { label: 'Medium', color: 'bg-blue-500/20 text-blue-400 border border-blue-500/30', dot: 'bg-blue-500' },
  4: { label: 'Low', color: 'bg-gray-500/20 text-gray-400 border border-gray-500/30', dot: 'bg-gray-500' },
}

export default function WorkOrdersPage() {
  const [workOrders, setWorkOrders] = useState<any[]>([])
  const [machines, setMachines] = useState<any[]>([])
  const [operations, setOperations] = useState<Record<number, any[]>>({})
  const [expanded, setExpanded] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)
  
  // New WO form state
  const [code, setCode] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState(3)

  // New Operation form state
  const [opMachine, setOpMachine] = useState<number>(0)
  const [opDuration, setOpDuration] = useState(60)

  const load = async () => {
    const [wo, m] = await Promise.all([getWorkOrders(), getMachines()])
    setWorkOrders(wo)
    setMachines(m)
    if (m.length > 0 && opMachine === 0) setOpMachine(m[0].id)
  }

  useEffect(() => { load() }, [])

  const loadOps = async (woId: number) => {
    const ops = await getOperations(woId)
    setOperations(prev => ({ ...prev, [woId]: ops }))
  }

  const handleExpand = (id: number) => {
    if (expanded === id) {
      setExpanded(null)
    } else {
      setExpanded(id)
      loadOps(id)
    }
  }

  const handleAddWO = async () => {
    if (!code.trim()) return
    await createWorkOrder({
      code,
      customer_name: customerName || null,
      due_date: dueDate ? new Date(dueDate).toISOString() : new Date(Date.now() + 7 * 86400000).toISOString(),
      priority
    })
    setCode('')
    setCustomerName('')
    setDueDate('')
    setPriority(3)
    setShowForm(false)
    await load()
  }

  const handleAddOp = async (woId: number) => {
    const currentOps = operations[woId] || []
    await createOperation({
      work_order_id: woId,
      machine_id: opMachine,
      sequence_no: currentOps.length + 1,
      processing_minutes: opDuration
    })
    await loadOps(woId)
  }

  const handleDeleteOp = async (woId: number, opId: number) => {
    await deleteOperation(opId)
    await loadOps(woId)
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Work Orders</h1>
          <p className="text-gray-400 text-sm mt-1">{workOrders.length} orders total</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          <span className="text-lg leading-none">+</span> New Order
        </button>
      </div>

      {showForm && (
        <div className="bg-[#1a1f2e] border border-white/5 rounded-2xl p-6">
          <h2 className="text-white font-semibold mb-4 text-lg">New Work Order</h2>
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="block text-gray-500 text-xs mb-1.5 uppercase tracking-wider font-semibold">Order Code *</label>
              <input
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="e.g. WO-001"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:border-blue-500/50 outline-none"
              />
            </div>
            <div>
              <label className="block text-gray-500 text-xs mb-1.5 uppercase tracking-wider font-semibold">Customer Name</label>
              <input
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                placeholder="e.g. Acme Corp"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:border-blue-500/50 outline-none"
              />
            </div>
            <div>
              <label className="block text-gray-500 text-xs mb-1.5 uppercase tracking-wider font-semibold">Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:border-blue-500/50 outline-none [color-scheme:dark]"
              />
            </div>
            <div>
              <label className="block text-gray-500 text-xs mb-1.5 uppercase tracking-wider font-semibold">Priority</label>
              <select
                value={priority}
                onChange={e => setPriority(Number(e.target.value))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:border-blue-500/50 outline-none"
              >
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

      <div className="space-y-3">
        {workOrders.map((wo: any) => {
          const config = PRIORITY_CONFIG[wo.priority as keyof typeof PRIORITY_CONFIG] || PRIORITY_CONFIG[3]
          const isExpanded = expanded === wo.id
          const ops = operations[wo.id] || []

          return (
            <div key={wo.id} className={`bg-[#1a1f2e] border border-white/5 rounded-2xl overflow-hidden transition-all ${isExpanded ? 'ring-1 ring-blue-500/30' : 'hover:border-white/10'}`}>
              <div 
                className="p-5 flex items-center justify-between cursor-pointer"
                onClick={() => handleExpand(wo.id)}
              >
                <div className="flex items-center gap-4">
                  <div className={`w-2 h-2 rounded-full ${config.dot}`} />
                  <div>
                    <h3 className="text-white font-bold flex items-center gap-2">
                      {wo.code}
                      <span className="text-gray-500 font-normal text-sm">| {wo.customer_name || 'Generic'}</span>
                    </h3>
                    <p className="text-gray-500 text-xs mt-1">Due: {new Date(wo.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-tighter ${config.color}`}>
                    {config.label}
                  </span>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <p className="text-white text-xs font-semibold">{ops.length} steps</p>
                    <p className="text-gray-500 text-[10px]">Operations</p>
                  </div>
                  <span className={`text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-white/5 bg-[#141824] p-5 space-y-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-white font-semibold text-sm">Routing Steps</h4>
                    <p className="text-gray-500 text-[10px] uppercase">Process Flow</p>
                  </div>
                  
                  {ops.length > 0 ? (
                    <div className="space-y-2">
                      {ops.slice().sort((a,b) => a.sequence_no - b.sequence_no).map((op) => {
                        const m = machines.find(mach => mach.id === op.machine_id)
                        return (
                          <div key={op.id} className="flex items-center gap-3 bg-white/5 border border-white/5 rounded-xl p-3">
                            <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-[10px] font-bold">
                              {op.sequence_no}
                            </div>
                            <div className="flex-1">
                              <p className="text-white text-sm font-medium">{m?.name || 'Unknown Machine'}</p>
                              <p className="text-gray-500 text-[10px] font-mono">{m?.code}</p>
                            </div>
                            <div className="text-right mr-4">
                              <p className="text-gray-300 text-xs font-semibold">{op.processing_minutes} min</p>
                              <p className="text-gray-500 text-[10px]">Duration</p>
                            </div>
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleDeleteOp(wo.id, op.id) }}
                              className="p-2 text-gray-600 hover:text-red-400 transition-colors"
                            >
                              ✕
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="py-8 text-center border-2 border-dashed border-white/5 rounded-2xl">
                      <p className="text-gray-500 text-xs italic">No operations defined. Add the first production step below.</p>
                    </div>
                  )}

                  <div className="mt-6 pt-4 border-t border-white/5">
                    <h4 className="text-gray-400 text-[10px] font-bold uppercase tracking-widest mb-3">Add Production Step</h4>
                    <div className="flex items-end gap-3">
                      <div className="flex-1">
                        <label className="block text-gray-500 text-[10px] mb-1">Select Machine</label>
                        <select 
                          value={opMachine} 
                          onChange={e => setOpMachine(Number(e.target.value))}
                          className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-white text-xs outline-none focus:border-blue-500/50"
                        >
                          {machines.map(m => <option key={m.id} value={m.id}>{m.name} ({m.code})</option>)}
                        </select>
                      </div>
                      <div className="w-24">
                        <label className="block text-gray-500 text-[10px] mb-1">Mins</label>
                        <input 
                          type="number" 
                          value={opDuration} 
                          onChange={e => setOpDuration(Number(e.target.value))}
                          className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-white text-xs outline-none focus:border-blue-500/50"
                        />
                      </div>
                      <button 
                        onClick={() => handleAddOp(wo.id)}
                        className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-lg transition-all"
                      >
                        + Add Step
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
