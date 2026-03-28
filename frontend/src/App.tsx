import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import MachinesPage from './pages/MachinesPage'
import WorkOrdersPage from './pages/WorkOrdersPage'
import SchedulePage from './pages/SchedulePage'
import ChatPage from './pages/ChatPage'
import CalendarPage from './pages/CalendarPage'
import clsx from 'clsx'

const NAV = [
  { to: '/', label: 'Schedule', icon: '📅' },
  { to: '/calendar', label: 'Calendar', icon: '🗓️' },
  { to: '/machines', label: 'Machines', icon: '⚙️' },
  { to: '/work-orders', label: 'Work Orders', icon: '📋' },
  { to: '/chat', label: 'AI Assistant', icon: '🤖' },
]

function Sidebar() {
  return (
    <aside className="w-64 min-h-screen bg-gray-900 border-r border-gray-800 flex flex-col">
      <div className="px-6 py-6 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold text-lg">S</div>
          <div>
            <p className="text-white font-bold text-sm leading-tight">Scheduler AI</p>
            <p className="text-gray-500 text-xs">Machine Ops Dashboard</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-150',
                isActive
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              )
            }
          >
            <span className="text-base">{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="px-6 py-4 border-t border-gray-800">
        <p className="text-gray-600 text-xs">Powered by Groq + LLaMA 3</p>
        <p className="text-gray-700 text-xs mt-0.5">Free AI · No API cost</p>
      </div>
    </aside>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex min-h-screen bg-gray-950 text-white">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<SchedulePage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/machines" element={<MachinesPage />} />
            <Route path="/work-orders" element={<WorkOrdersPage />} />
            <Route path="/chat" element={<ChatPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
