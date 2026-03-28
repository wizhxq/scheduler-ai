/**
 * ScheduleContext — single source of truth for schedule, work orders, and machines.
 *
 * All pages (Calendar, Schedule, Chat) read from here so a drag-drop, a
 * "Compute Schedule" click, or a chat tool call is immediately reflected
 * everywhere without independent local fetches going stale.
 */
import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react'
import { getLatestSchedule, getWorkOrders, getMachines } from '../api'

interface ScheduleCtx {
  schedule:     any | null
  workOrders:   any[]
  machines:     any[]
  loading:      boolean
  load:         () => Promise<void>   // reload schedule only
  refresh:      () => Promise<void>   // reload schedule + WOs + machines
  setSchedule:  (s: any) => void
}

const Ctx = createContext<ScheduleCtx>({
  schedule:    null,
  workOrders:  [],
  machines:    [],
  loading:     false,
  load:        async () => {},
  refresh:     async () => {},
  setSchedule: () => {},
})

export function ScheduleProvider({ children }: { children: ReactNode }) {
  const [schedule,   setSchedule]   = useState<any | null>(null)
  const [workOrders, setWorkOrders] = useState<any[]>([])
  const [machines,   setMachines]   = useState<any[]>([])
  const [loading,    setLoading]    = useState(false)

  /** Reload only the latest schedule run (lightweight). */
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getLatestSchedule()
      setSchedule(data)
    } catch (err: any) {
      if (err?.response?.status === 404) setSchedule(null)
    } finally {
      setLoading(false)
    }
  }, [])

  /** Reload schedule + work orders + machines (called after any mutation). */
  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [sched, wos, macs] = await Promise.all([
        getLatestSchedule().catch(() => null),
        getWorkOrders().catch(() => []),
        getMachines().catch(() => []),
      ])
      if (sched !== null) setSchedule(sched)
      setWorkOrders(wos)
      setMachines(macs)
    } finally {
      setLoading(false)
    }
  }, [])

  // Bootstrap on app start
  useEffect(() => { refresh() }, [refresh])

  return (
    <Ctx.Provider value={{ schedule, workOrders, machines, loading, load, refresh, setSchedule }}>
      {children}
    </Ctx.Provider>
  )
}

export const useSchedule = () => useContext(Ctx)
