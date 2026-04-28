import { apiFetch } from './client'
import type { LeaderboardEntry } from '../types'

export const getLeaderboard = () => apiFetch<LeaderboardEntry[]>('/leaderboard')
