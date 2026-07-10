import { apiFetch } from './client'
import type { ScheduleBlock } from '../types'

export function getScheduleBlocks(): Promise<ScheduleBlock[]> {
  return apiFetch<ScheduleBlock[]>('/schedule-blocks/')
}

export function createScheduleBlock(input: {
  label: string
  start_time: string
  end_time: string
}): Promise<ScheduleBlock> {
  return apiFetch<ScheduleBlock>('/schedule-blocks/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function updateScheduleBlock(
  id: string,
  input: Partial<{ label: string; start_time: string; end_time: string }>,
): Promise<ScheduleBlock> {
  return apiFetch<ScheduleBlock>(`/schedule-blocks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function deleteScheduleBlock(id: string): Promise<void> {
  return apiFetch<void>(`/schedule-blocks/${id}`, { method: 'DELETE' })
}
