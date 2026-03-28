import { useState, useEffect } from 'react'
import { getMachines, createMachine, deleteMachine } from '../api'

const STATUS_COLORS: Record<string, string> = {
  idle: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
  busy: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  maintenance: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  offline: 'bg-red-500/20 text-red-400 border border-red-500/30',
  available: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
}

export default function MachinesPage() {
  const [machines, setMachines] = useState<any[]>([])
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const load = () => getMachines().then(setMachines)
  useEffect(() => { load() }, [])

  const handleAdd = async () => {
    if (!name.trim() || !code.trim()) return
    setAdding(true)
    await createMachine({ code, name })
    setName('')
    setCode('')
    setShowForm(false)
    await load()
    setAdding(false)
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
          <p className="text-gray-400 text-sm mt-1">{machines.length} machine{machines.length !== 1 ? 's' : ''} registered</p>
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
        <div className="bg-[#1a2235] rounded-2xl border border-white/10 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">New Machine</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Machine Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. CNC Machine A"
                className="w-full bg-[#0d1526] border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Machine Code</label>
              <input
                type="text"
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="e.g. CNC-01"
                className="w-full bg-[#0d1526] border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button
              onClick={handleAdd}
              disabled={adding}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              {adding ? 'Adding...' : 'Add Machine'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-5 py-2 bg-white/10 hover:bg-white/20 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Machines Grid */}
      {machines.length === 0 && !showForm ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="text-5xl mb-4">⚙️</div>
          <h3 className="text-xl font-semibold text-white mb-2">No machines yet</h3>
          <p className="text-gray-400">Add your first machine to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {machines.map(machine => (
            <div key={machine.id} className="bg-[#1a2235] rounded-2xl border border-white/10 p-5 flex flex-col gap-3 hover:border-white/20 transition-colors">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-white font-semibold text-base">{machine.name}</p>
                  <p className="text-gray-400 text-sm font-mono mt-0.5">{machine.code}</p>
                </div>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_COLORS[machine.status] || STATUS_COLORS.offline}`}>
                  {machine.status}
                </span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-white/10">
                <span className="text-gray-500 text-xs">ID #{machine.id}</span>
                <button
                  onClick={() => handleDelete(machine.id)}
                  className="text-red-400 hover:text-red-300 text-sm font-medium transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
