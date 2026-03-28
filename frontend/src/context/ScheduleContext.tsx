/**
 * ScheduleContext
 * ---------------
 * Single source of truth for the latest schedule run.
 * Both SchedulePage and CalendarPage read from here, so:
 *   - A drag-drop reschedule on CalendarPage is immediately visible on SchedulePage.
 *   - Clicking "Compute Schedule" on SchedulePage is immediately visible on CalendarPage.
 */
import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react'
import { getLatestSchedule } from '../api'

interface ScheduleCtx {
  schedule: any | null
  loading: boolean
  load: () => Promise<void>
  setSchedule: (s: any) => void
}

const Ctx = createContext<ScheduleCtx>({
  schedule: null,
  loading: false,
  load: async () => {},
  setSchedule: () => {},
})

export function ScheduleProvider({ children }: { children: ReactNode }) {
  const [schedule, setSchedule] = useState<any | null>(null)
  const [loading,  setLoading]  = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getLatestSchedule()
      setSchedule(data)
    } catch (err: any) {
      if (err?.response?.status === 404) setSchedule(null)
      // else: silently keep stale data
    } finally {
      setLoading(false)
    }
  }, [])

  // Load once on app start
  useEffect(() => { load() }, [load])

  return (
    <Ctx.Provider value={{ schedule, loading, load, setSchedule }}>
      {children}
    </Ctx.Provider>
  )
}

export const useSchedule = () => useContext(Ctx)
