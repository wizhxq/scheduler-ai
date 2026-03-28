import { useState, useEffect } from 'react'
import { getMachines, createMachine, deleteMachine } from '../api'

const STATUS_COLORS: Record<string, string> = {
  idle: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
  busy: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  maintenance: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  offline: 'bg-red-500/20 text-red-400 border border-red-500/30',
  available: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
}

const STATUS_ICONS: Record<string, string> = {
  idle: '✅',
  busy: '⏳',
  maintenance: '🔧',
  offline: '❌',
  available: '✅',
}

export default function MachinesPage() {
  const [machines, setMachines] = useState<any[]>([])
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

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
    setDeleteConfirm(null)
    await load()
  }

  const availableCount = machines.filter(m => (m.status || 'available') === 'available' || (m.status || 'available') === 'idle').length
  const busyCount = machines.filter(m => m.status === 'busy').length
  const maintenanceCount = machines.filter(m => m.status === 'maintenance').length

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

      {/* Stats bar */}
      {machines.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-[#1a1f2e] border border-white/5 rounded-2xl p-4">
            <div className="text-gray-400 text-xs mb-1">✅ Available / Idle</div>
            <div className="text-2xl font-bold text-white">{availableCount}</div>
          </div>
          <div className="bg-[#1a1f2e] border border-white/5 rounded-2xl p-4">
            <div className="text-gray-400 text-xs mb-1">⏳ Busy</div>
            <div className="text-2xl font-bold text-white">{busyCount}</div>
          </div>
          <div className="bg-[#1a1f2e] border border-white/5 rounded-2xl p-4">
            <div className="text-gray-400 text-xs mb-1">🔧 Maintenance</div>
            <div className="text-2xl font-bold text-white">{maintenanceCount}</div>
          </div>
        </div>
      )}

      {/* Add Machine Form */}
      {showForm && (
        <div className="bg-[#1a1f2e] border border-white/5 rounded-2xl p-6">
          <h2 className="text-white font-semibold mb-4">New Machine</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-gray-400 text-xs mb-1.5">Machine Code *</label>
              <input
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="e.g. CNC-01"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500/50"
              />
            </div>
            <div>
              <label className="block text-gray-400 text-xs mb-1.5">Machine Name *</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. CNC Machine A"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500/50"
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
              />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button
              onClick={handleAdd}
              disabled={adding || !name.trim() || !code.trim()}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              {adding ? 'Creating...' : 'Create Machine'}
            </button>
            <button
              onClick={() => { setShowForm(false); setName(''); setCode('') }}
              className="px-5 py-2 bg-white/5 hover:bg-white/10 text-gray-300 text-sm rounded-xl transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Machine Grid */}
      {machines.length === 0 ? (
        <div className="bg-[#1a1f2e] border border-white/5 rounded-2xl p-12 text-center">
          <div className="text-5xl mb-4">⚙️</div>
          <h3 className="text-white font-semibold text-lg mb-2">No Machines Yet</h3>
          <p className="text-gray-500 text-sm mb-6">Add your first machine to get started with scheduling.</p>
          <button
            onClick={() => setShowForm(true)}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            Add First Machine
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {machines.map((machine: any) => {
            const status = machine.status || 'available'
            const statusClass = STATUS_COLORS[status] || STATUS_COLORS.available
            const statusIcon = STATUS_ICONS[status] || '✅'
            return (
              <div key={machine.id} className="bg-[#1a1f2e] border border-white/5 rounded-2xl p-5 space-y-3 hover:border-white/10 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-white font-semibold truncate">{machine.name}</h3>
                    <p className="text-gray-500 text-xs mt-0.5 font-mono">{machine.code}</p>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0 ml-2 ${statusClass}`}>
                    {statusIcon} {status}
                  </span>
                </div>

                <div className="border-t border-white/5 pt-3 flex items-center justify-between">
                  <span className="text-gray-500 text-xs">ID #{machine.id}</span>
                  {deleteConfirm === machine.id ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDelete(machine.id)}
                        className="text-xs px-3 py-1 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        className="text-xs px-3 py-1 bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirm(machine.id)}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
