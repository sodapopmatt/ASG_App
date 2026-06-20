import { useEffect } from 'react'
import BackLink from '../components/BackLink'
import { useAlertLog, markAlertsSeen, useSeenAlertIds } from '../lib/seenAlerts'
import type { Alert } from '../types'

const SEVERITY_BADGE: Record<Alert['severity'], string> = {
  info: 'bg-blue-50 text-blue-700',
  warning: 'bg-amber-50 text-amber-700',
  critical: 'bg-red-50 text-red-700',
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function isExpired(a: Alert): boolean {
  return !!a.expires_at && new Date(a.expires_at).getTime() <= Date.now()
}

function statusLabel(a: Alert): string {
  if (!a.active) return 'Deactivated'
  if (isExpired(a)) return 'Expired'
  return 'Active'
}

export default function Notifications() {
  const { data: alerts = [], isLoading } = useAlertLog()
  const seen = useSeenAlertIds()

  useEffect(() => {
    if (alerts.length === 0) return
    markAlertsSeen(alerts.map(a => a.id))
  }, [alerts])

  return (
    <div className="p-4 mt-2 space-y-4">
      <div className="flex items-center gap-2">
        <BackLink to="/" label="Back" />
      </div>
      <h2 className="text-xl font-bold text-slate-800">Notifications</h2>

      {isLoading ? (
        <p className="text-sm text-gray-400 text-center py-8">Loading…</p>
      ) : alerts.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">No notifications yet.</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm divide-y divide-gray-50">
          {alerts.map(a => {
            const isNew = !seen.has(a.id)
            const status = statusLabel(a)
            return (
              <div key={a.id} className="px-4 py-3 space-y-1.5">
                <div className="flex items-start gap-2">
                  <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${SEVERITY_BADGE[a.severity]}`}>
                    {a.severity}
                  </span>
                  {isNew && (
                    <span className="shrink-0 mt-1.5 w-2 h-2 rounded-full bg-blue-500" aria-label="Unread" />
                  )}
                  <p className="text-sm text-slate-800 whitespace-pre-wrap flex-1">{a.message}</p>
                </div>
                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span>{formatWhen(a.created_at)}</span>
                  <span>{status}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
