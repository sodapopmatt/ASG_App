import { apiFetch } from './client'
import type { Company } from '../types'

export const getCompanies = () => apiFetch<Company[]>('/companies')

export const updateCompany = (id: string, body: { name?: string; logo_url?: string | null }) =>
  apiFetch<Company>(`/companies/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
