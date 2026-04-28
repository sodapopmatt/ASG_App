import { apiFetch } from './client'
import type { Company } from '../types'

export const getCompanies = () => apiFetch<Company[]>('/companies')
