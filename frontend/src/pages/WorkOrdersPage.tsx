import { useState, useEffect } from 'react'
import { getWorkOrders, createWorkOrder, getMachines, getOperations, createOperation, deleteOperation } from '../api'

export default function WorkOrdersPage() {
  const [workOrders, setWorkOrders] = useState<any[]>([])
  const [machines, setMachines] = useState<any[]>([])
  const [operations, setOperations] = useState<Record<number, any[]>>({})
  const [expanded, setExpanded] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [deadline, setDeadline] = useState('')
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
    setExpanded(expanded === id ? null : id)
    loadOps(id)
  }

  const handleAddWO = async () => {
    if (!name.trim()) return
    await createWorkOrder({ name, deadline: deadline || null })
    setName('')
    setDeadline('')
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
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Work Orders</h1>

      <div className="card flex gap-4 items-end">
        <div className="flex-1">
          <label className="block text-sm font-medium mb-1">Work Order Name</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. WO-001" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Deadline (optional)</label>
          <input className="input" type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} />
        </div>
        <button className="btn-primary" onClick={handleAddWO}>Add Work Order</button>
      </div>

      <div className="space-y-3">
        {workOrders.map((wo: any) => (
          <div key={wo.id} className="card">
            <div className="flex justify-between items-center cursor-pointer" onClick={() => handleExpand(wo.id)}>
              <div>
                <span className="font-semibold">{wo.name}</span>
                {wo.deadline && <span className="ml-3 text-sm text-orange-500">Due: {new Date(wo.deadline).toLocaleString()}</span>}
              </div>
              <span className="text-gray-400">{expanded === wo.id ? '▲' : '▼'}</span>
            </div>

            {expanded === wo.id && (
              <div className="mt-4 border-t pt-4 space-y-3">
                <h3 className="text-sm font-semibold text-gray-600">Operations (in order)</h3>
                {(operations[wo.id] || []).sort((a: any, b: any) => a.sequence - b.sequence).map((op: any) => (
                  <div key={op.id} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
                    <span className="w-6 h-6 bg-blue-100 text-blue-700 rounded-full text-xs flex items-center justify-center font-bold">{op.sequence}</span>
                    <span className="flex-1 text-sm">{machines.find((m: any) => m.id === op.machine_id)?.name || `Machine ${op.machine_id}`}</span>
                    <span className="text-sm text-gray-500">{op.duration_minutes} min</span>
                    <button className="text-red-400 text-xs hover:text-red-600" onClick={() => handleDeleteOp(op.id, wo.id)}>✕</button>
                  </div>
                ))}
                <div className="flex gap-3 items-end mt-2">
                  <select className="input flex-1" value={opMachine} onChange={e => setOpMachine(Number(e.target.value))}>
                    {machines.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <input className="input w-24" type="number" value={opDuration} onChange={e => setOpDuration(Number(e.target.value))} placeholder="mins" />
                  <button className="btn-secondary text-sm" onClick={() => handleAddOp(wo.id, (operations[wo.id]?.length || 0) + 1)}>+ Add Step</button>
                </div>
              </div>
            )}
          </div>
        ))}
        {workOrders.length === 0 && <div className="text-center text-gray-400 py-12">No work orders yet.</div>}
      </div>
    </div>
  )
}
