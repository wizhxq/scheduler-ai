import { useState, useEffect } from 'react'
import { getWorkOrders, createWorkOrder, getMachines, getOperations, createOperation, deleteOperation } from '../api'

const PRIORITY_CONFIG: Record<number, { label: string; color: string; dot: string }> = {
  1: { label: 'Critical', color: 'bg-red-500/20 text-red-400 border border-red-500/30', dot: 'bg-red-500' },
  2: { label: 'High', color: 'bg-orange-500/20 text-orange-400 border border-orange-500/30', dot: 'bg-orange-500' },
  3: { label: 'Medium', color: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30', dot: 'bg-yellow-500' },
  4: { label: 'Low', color: 'bg-gray-500/20 text-gray-400 border border-gray-600', dot: 'bg-gray-500' },
}

export default function WorkOrdersPage() {
  const [workOrders, setWorkOrders] = useState<any[]>([])
  const [machines, setMachines] = useState<any[]>([])
  const [operations, setOperations] = useState<Record<number, any[]>>({})
  const [expanded, setExpanded] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [deadline, setDeadline] = useState('')
  const [priority, setPriority] = useState(3)
  const [opMachine, setOpMachine] = useState<number>(0)
  const [opDuration, setOpDuration] = useState(60)
  const [opSeq, setOpSeq] = useState(1)

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
    setExpanded(expanded === id ? null : id)
    loadOps(id)
  }

  const handleAddWO = async () => {
    if (!name.trim()) return
    await createWorkOrder({ name, deadline: deadline || null, priority })
    setName('')
    setDeadline('')
    setPriority(3)
    setShowForm(false)
    await load()
  }

  const handleAddOp = async (woId: number, seq: number) => {
    await createOperation({ work_order_id: woId, machine_id: opMachine, sequence: seq, duration_minutes: opDuration })
    await loadOps(woId)
  }

  const handleDeleteOp = async (opId: number, woId: number) => {
    await deleteOperation(opId)
    await loadOps(woId)
  }

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Work Orders</h1>
          <p className="text-gray-500 text-sm mt-1">{workOrders.length} order{workOrders.length !== 1 ? 's' : ''} total</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          <span className="text-lg leading-none">+</span> New Order
        </button>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <h2 className="text-white font-semibold mb-4">New Work Order</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Order Name</label>
              <input
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-600"
                value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. Batch #1042"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Deadline</label>
              <input
                type="date"
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={deadline} onChange={e => setDeadline(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Priority</label>
              <select
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={priority} onChange={e => setPriority(Number(e.target.value))}
              >
                <option value={1}>1 - Critical</option>
                <option value={2}>2 - High</option>
                <option value={3}>3 - Medium</option>
                <option value={4}>4 - Low</option>
              </select>
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={handleAddWO} disabled={!name.trim()}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
            >Create Order</button>
            <button onClick={() => setShowForm(false)}
              className="px-5 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium rounded-xl transition-colors"
            >Cancel</button>
          </div>
        </div>
      )}

      {/* Work Orders List */}
      {workOrders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="text-5xl mb-4">📋</div>
          <p className="text-gray-400 font-medium">No work orders yet</p>
          <p className="text-gray-600 text-sm mt-1">Create your first work order to start scheduling</p>
        </div>
      ) : (
        <div className="space-y-3">
          {workOrders.sort((a, b) => (a.priority || 3) - (b.priority || 3)).map((wo) => {
            const pConfig = PRIORITY_CONFIG[wo.priority || 3] || PRIORITY_CONFIG[3]
            const isExpanded = expanded === wo.id
            const ops = operations[wo.id] || []
            return (
              <div key={wo.id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden hover:border-gray-700 transition-colors">
                {/* Order Row */}
                <div
                  className="flex items-center gap-4 px-5 py-4 cursor-pointer"
                  onClick={() => handleExpand(wo.id)}
                >
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${pConfig.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <h3 className="text-white font-semibold text-sm">{wo.name}</h3>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${pConfig.color}`}>
                        {pConfig.label}
                      </span>
                    </div>
                    {wo.deadline && (
                      <p className="text-gray-500 text-xs mt-0.5">
                        Due: {new Date(wo.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Order #{wo.id}</p>
                  </div>
                  <span className={`text-gray-500 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>▾</span>
                </div>

                {/* Expanded Operations */}
                {isExpanded && (
                  <div className="border-t border-gray-800 px-5 py-4 space-y-3">
                    <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Operations</p>
                    {ops.length === 0 ? (
                      <p className="text-gray-600 text-sm">No operations yet</p>
                    ) : (
                      <div className="space-y-2">
                        {ops.map((op: any) => (
                          <div key={op.id} className="flex items-center justify-between bg-gray-800 rounded-xl px-4 py-3">
                            <div className="flex items-center gap-3">
                              <span className="w-6 h-6 rounded-full bg-blue-600/20 text-blue-400 text-xs font-bold flex items-center justify-center">{op.sequence}</span>
                              <div>
                                <p className="text-white text-sm font-medium">{machines.find(m => m.id === op.machine_id)?.name || `Machine #${op.machine_id}`}</p>
                                <p className="text-gray-500 text-xs">{op.duration_minutes} min</p>
                              </div>
                            </div>
                            <button onClick={() => handleDeleteOp(op.id, wo.id)}
                              className="text-red-500 hover:text-red-400 text-xs transition-colors"
                            >Remove</button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add Operation */}
                    {machines.length > 0 && (
                      <div className="flex gap-2 mt-3">
                        <select
                          className="flex-1 bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                          value={opMachine} onChange={e => setOpMachine(Number(e.target.value))}
                        >
                          {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                        <input
                          type="number" min={1} placeholder="min"
                          className="w-20 bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                          value={opDuration} onChange={e => setOpDuration(Number(e.target.value))}
                        />
                        <button
                          onClick={() => handleAddOp(wo.id, ops.length + 1)}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl transition-colors"
                        >+ Op</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
