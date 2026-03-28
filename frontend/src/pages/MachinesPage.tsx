import { useState, useEffect } from 'react'
import { getMachines, createMachine, deleteMachine } from '../api'

const STATUS_COLORS: Record<string, string> = {
  idle: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
  busy: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  maintenance: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  offline: 'bg-red-500/20 text-red-400 border border-red-500/30',
}

export default function MachinesPage() {
  const [machines, setMachines] = useState<any[]>([])
  const [name, setName] = useState('')
  const [capacity, setCapacity] = useState(1)
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const load = () => getMachines().then(setMachines)
  useEffect(() => { load() }, [])

  const handleAdd = async () => {
    if (!name.trim()) return
    setLoading(true)
    await createMachine({ name, capacity_per_hour: capacity })
    setName('')
    setCapacity(1)
    setShowForm(false)
    await load()
    setLoading(false)
  }

  const handleDelete = async (id: number) => {
    await deleteMachine(id)
    await load()
  }

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Machines</h1>
          <p className="text-gray-500 text-sm mt-1">{machines.length} machine{machines.length !== 1 ? 's' : ''} registered</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          <span className="text-lg leading-none">+</span> Add Machine
        </button>
      </div>

      {/* Add Machine Form */}
      {showForm && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <h2 className="text-white font-semibold mb-4">New Machine</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Machine Name</label>
              <input
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-600"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. CNC Machine A"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Capacity / hr</label>
              <input
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                type="number"
                min={1}
                value={capacity}
                onChange={e => setCapacity(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button
              onClick={handleAdd}
              disabled={loading || !name.trim()}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              {loading ? 'Adding...' : 'Add Machine'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-5 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium rounded-xl transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Machine Cards Grid */}
      {machines.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="text-5xl mb-4">⚙️</div>
          <p className="text-gray-400 font-medium">No machines yet</p>
          <p className="text-gray-600 text-sm mt-1">Add your first machine to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {machines.map((m) => {
            const status = m.status || 'idle'
            return (
              <div
                key={m.id}
                className="bg-gray-900 border border-gray-800 rounded-2xl p-5 hover:border-gray-700 transition-colors group"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center text-xl">
                    ⚙️
                  </div>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_COLORS[status] || STATUS_COLORS.idle}`}>
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </span>
                </div>
                <h3 className="text-white font-semibold text-sm">{m.name}</h3>
                <p className="text-gray-500 text-xs mt-1">ID #{m.id}</p>
                <div className="mt-4 pt-4 border-t border-gray-800 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500">Capacity</p>
                    <p className="text-white font-semibold text-sm">{m.capacity_per_hour} <span className="text-gray-500 font-normal">units/hr</span></p>
                  </div>
                  <button
                    onClick={() => handleDelete(m.id)}
                    className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400 text-xs font-medium transition-all"
                  >
                    Remove
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
