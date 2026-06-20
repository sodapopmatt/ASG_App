import { useQuery } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { getActiveAlerts } from '../api/alerts'
import type { Alert } from '../types'

const DISMISSED_KEY = 'asg.dismissedAlertIds'

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown
    return new Set(Array.isArray(arr) ? arr.map(String) : [])
  } catch {
    return new Set()
  }
}

function saveDismissed(ids: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(ids)))
  } catch {
    // ignore quota / disabled storage
  }
}

const SEVERITY_STYLES: Record<Alert['severity'], string> = {
  info: 'bg-blue-50 border-blue-200 text-blue-900',
  warning: 'bg-amber-50 border-amber-200 text-amber-900',
  critical: 'bg-red-50 border-red-300 text-red-900',
}

export default function AlertBanner() {
  const { data: alerts = [] } = useQuery<Alert[]>({
    queryKey: ['alerts', 'active'],
    queryFn: getActiveAlerts,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  })

  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed())

  // Prune dismissed IDs that no longer correspond to active alerts so storage doesn't grow unbounded.
  useEffect(() => {
    if (alerts.length === 0) return
    const activeIds = new Set(alerts.map(a => a.id))
    const pruned = new Set(Array.from(dismissed).filter(id => activeIds.has(id)))
    if (pruned.size !== dismissed.size) {
      setDismissed(pruned)
      saveDismissed(pruned)
    }
  }, [alerts, dismissed])

  const visible = alerts.filter(a => !dismissed.has(a.id))
  if (visible.length === 0) return null

  const dismiss = (id: string) => {
    const next = new Set(dismissed)
    next.add(id)
    setDismissed(next)
    saveDismissed(next)
  }

  return (
    <div className="space-y-1 px-3 pt-2">
      {visible.map(alert => (
        <div
          key={alert.id}
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-sm ${SEVERITY_STYLES[alert.severity]}`}
          role="alert"
        >
          <span className="flex-1 leading-snug whitespace-pre-wrap">{alert.message}</span>
          <button
            onClick={() => dismiss(alert.id)}
            aria-label="Dismiss alert"
            className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
