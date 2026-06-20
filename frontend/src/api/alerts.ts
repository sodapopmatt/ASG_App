import { apiFetch } from './client'
import type { Alert } from '../types'

export type AlertSeverity = 'info' | 'warning' | 'critical'

export function getActiveAlerts(): Promise<Alert[]> {
  return apiFetch<Alert[]>('/alerts/active')
}

export function getAllAlerts(): Promise<Alert[]> {
  return apiFetch<Alert[]>('/alerts/')
}

export function createAlert(input: {
  message: string
  severity: AlertSeverity
  expires_at?: string | null
}): Promise<Alert> {
  return apiFetch<Alert>('/alerts/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function updateAlert(
  id: string,
  input: Partial<{ message: string; severity: AlertSeverity; active: boolean; expires_at: string | null }>,
): Promise<Alert> {
  return apiFetch<Alert>(`/alerts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function deleteAlert(id: string): Promise<void> {
  return apiFetch<void>(`/alerts/${id}`, { method: 'DELETE' })
}
