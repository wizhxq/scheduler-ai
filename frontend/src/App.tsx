import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import MachinesPage from './pages/MachinesPage'
import WorkOrdersPage from './pages/WorkOrdersPage'
import SchedulePage from './pages/SchedulePage'
import ChatPage from './pages/ChatPage'
import clsx from 'clsx'

const NAV = [
  { to: '/', label: 'Schedule' },
  { to: '/machines', label: 'Machines' },
  { to: '/work-orders', label: 'Work Orders' },
  { to: '/chat', label: 'AI Chat' },
]

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col">
        <nav className="bg-white border-b border-gray-200 px-6 py-4 flex gap-6 items-center shadow-sm">
          <span className="font-bold text-blue-600 text-lg mr-4">Scheduler AI</span>
          {NAV.map(n => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                clsx('text-sm font-medium transition-colors', isActive ? 'text-blue-600' : 'text-gray-600 hover:text-gray-900')
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <main className="flex-1 p-6 max-w-6xl mx-auto w-full">
          <Routes>
            <Route path="/" element={<SchedulePage />} />
            <Route path="/machines" element={<MachinesPage />} />
            <Route path="/work-orders" element={<WorkOrdersPage />} />
            <Route path="/chat" element={<ChatPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
