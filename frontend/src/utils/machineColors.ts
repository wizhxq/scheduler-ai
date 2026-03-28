/**
 * Shared machine colour palette — 12 distinct hues, assigned by (machine_id % 12).
 * Used by both CalendarPage (event chips) and SchedulePage (table row bars).
 */
export const MACHINE_COLORS = [
  { bg: 'bg-violet-600',  border: 'border-violet-400',  label: 'bg-violet-800',  dot: 'bg-violet-500',  hex: '#7c3aed' },
  { bg: 'bg-cyan-600',    border: 'border-cyan-400',    label: 'bg-cyan-800',    dot: 'bg-cyan-500',    hex: '#0891b2' },
  { bg: 'bg-emerald-600', border: 'border-emerald-400', label: 'bg-emerald-800', dot: 'bg-emerald-500', hex: '#059669' },
  { bg: 'bg-amber-500',   border: 'border-amber-400',   label: 'bg-amber-700',   dot: 'bg-amber-400',   hex: '#f59e0b' },
  { bg: 'bg-rose-600',    border: 'border-rose-400',    label: 'bg-rose-800',    dot: 'bg-rose-500',    hex: '#e11d48' },
  { bg: 'bg-sky-500',     border: 'border-sky-400',     label: 'bg-sky-700',     dot: 'bg-sky-400',     hex: '#0ea5e9' },
  { bg: 'bg-pink-600',    border: 'border-pink-400',    label: 'bg-pink-800',    dot: 'bg-pink-500',    hex: '#db2777' },
  { bg: 'bg-lime-600',    border: 'border-lime-400',    label: 'bg-lime-800',    dot: 'bg-lime-500',    hex: '#65a30d' },
  { bg: 'bg-orange-600',  border: 'border-orange-400',  label: 'bg-orange-800',  dot: 'bg-orange-500',  hex: '#ea580c' },
  { bg: 'bg-indigo-500',  border: 'border-indigo-400',  label: 'bg-indigo-700',  dot: 'bg-indigo-400',  hex: '#6366f1' },
  { bg: 'bg-teal-600',    border: 'border-teal-400',    label: 'bg-teal-800',    dot: 'bg-teal-500',    hex: '#0d9488' },
  { bg: 'bg-fuchsia-600', border: 'border-fuchsia-400', label: 'bg-fuchsia-800', dot: 'bg-fuchsia-500', hex: '#a21caf' },
]

export const machineColor = (machineId: number) =>
  MACHINE_COLORS[machineId % MACHINE_COLORS.length]
