import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL || ''

const api = axios.create({ baseURL: BASE })

// Machines
export const getMachines = () => api.get('/api/machines').then(r => r.data)
export const createMachine = (data: any) => api.post('/api/machines', data).then(r => r.data)
export const deleteMachine = (id: number) => api.delete(`/api/machines/${id}`)
export const setMachineMaintenance = (id: number, data: { start: string; end: string; notes?: string }) =>
  api.post(`/api/machines/${id}/maintenance`, data).then(r => r.data)
export const clearMachineMaintenance = (id: number) =>
  api.delete(`/api/machines/${id}/maintenance`).then(r => r.data)

// Work Orders
export const getWorkOrders = () => api.get('/api/work-orders').then(r => r.data)
export const createWorkOrder = (data: any) => api.post('/api/work-orders', data).then(r => r.data)
export const deleteWorkOrder = (id: number) => api.delete(`/api/work-orders/${id}`)
export const updateWorkOrder = (id: number, data: any) => api.patch(`/api/work-orders/${id}`, data).then(r => r.data)

// Operations
export const getOperations = (workOrderId?: number) => {
  const params = workOrderId ? { work_order_id: workOrderId } : {}
  return api.get('/api/operations', { params }).then(r => r.data)
}
export const createOperation = (data: any) => api.post('/api/operations', data).then(r => r.data)
export const deleteOperation = (id: number) => api.delete(`/api/operations/${id}`)

// Schedule
export const computeSchedule = (algorithm: string = 'EDD') =>
  api.post('/api/schedule/compute', null, { params: { algorithm } }).then(r => r.data)
export const getLatestSchedule = () => api.get('/api/schedule/latest').then(r => r.data)
export const getScheduleHistory = (limit = 10) =>
  api.get('/api/schedule/history', { params: { limit } }).then(r => r.data)
export const getKPIs = () => api.get('/api/schedule/kpis').then(r => r.data)

// Chat
export const sendChat = (message: string) =>
  api.post('/api/chat', { message }).then(r => r.data)
