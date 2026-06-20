import { useQuery } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { getAlertLog } from '../api/alerts'
import type { Alert } from '../types'

const SEEN_KEY = 'asg.seenAlertIds'

function loadSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown
    return new Set(Array.isArray(arr) ? arr.map(String) : [])
  } catch {
    return new Set()
  }
}

function saveSeen(ids: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(ids)))
  } catch {
    // ignore quota / disabled storage
  }
}

// Tiny store so badge updates immediately after the log page marks alerts seen,
// without waiting for the next storage event or refetch.
type Listener = () => void
const listeners = new Set<Listener>()
let snapshot = loadSeen()

function emit() {
  snapshot = loadSeen()
  listeners.forEach(l => l())
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key === SEEN_KEY) emit()
  })
}

function subscribe(l: Listener) {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function markAlertsSeen(ids: string[]) {
  if (ids.length === 0) return
  const next = new Set(snapshot)
  let changed = false
  for (const id of ids) {
    if (!next.has(id)) { next.add(id); changed = true }
  }
  if (!changed) return
  saveSeen(next)
  emit()
}

export function useSeenAlertIds(): Set<string> {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot)
}

export function useAlertLog() {
  return useQuery<Alert[]>({
    queryKey: ['alerts', 'log'],
    queryFn: getAlertLog,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  })
}

export function useUnseenAlertCount(): number {
  const { data: alerts = [] } = useAlertLog()
  const seen = useSeenAlertIds()
  return alerts.reduce((n, a) => (seen.has(a.id) ? n : n + 1), 0)
}
