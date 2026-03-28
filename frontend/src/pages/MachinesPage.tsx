import { useState, useEffect } from 'react'
import { getMachines, createMachine, deleteMachine } from '../api'

export default function MachinesPage() {
  const [machines, setMachines] = useState<any[]>([])
  const [name, setName] = useState('')
  const [capacity, setCapacity] = useState(1)
  const [loading, setLoading] = useState(false)

  const load = () => getMachines().then(setMachines)

  useEffect(() => { load() }, [])

  const handleAdd = async () => {
    if (!name.trim()) return
    setLoading(true)
    await createMachine({ name, capacity_per_hour: capacity })
    setName('')
    setCapacity(1)
    await load()
    setLoading(false)
  }

  const handleDelete = async (id: number) => {
    await deleteMachine(id)
    await load()
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Machines</h1>

      <div className="card flex gap-4 items-end">
        <div className="flex-1">
          <label className="block text-sm font-medium mb-1">Machine Name</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. CNC Machine A" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Capacity/hr</label>
          <input className="input w-24" type="number" min={1} value={capacity} onChange={e => setCapacity(Number(e.target.value))} />
        </div>
        <button className="btn-primary" onClick={handleAdd} disabled={loading}>Add Machine</button>
      </div>

      <div className="card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 px-3">ID</th>
              <th className="text-left py-2 px-3">Name</th>
              <th className="text-left py-2 px-3">Capacity/hr</th>
              <th className="py-2 px-3"></th>
            </tr>
          </thead>
          <tbody>
            {machines.map((m: any) => (
              <tr key={m.id} className="border-b hover:bg-gray-50">
                <td className="py-2 px-3 text-gray-500">{m.id}</td>
                <td className="py-2 px-3 font-medium">{m.name}</td>
                <td className="py-2 px-3">{m.capacity_per_hour}</td>
                <td className="py-2 px-3 text-right">
                  <button className="text-red-500 hover:text-red-700 text-xs" onClick={() => handleDelete(m.id)}>Remove</button>
                </td>
              </tr>
            ))}
            {machines.length === 0 && (
              <tr><td colSpan={4} className="py-8 text-center text-gray-400">No machines yet. Add one above.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
