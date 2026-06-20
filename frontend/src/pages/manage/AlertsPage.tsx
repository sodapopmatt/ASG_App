import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import BackLink from '../../components/BackLink'
import { getAllAlerts, createAlert, updateAlert, deleteAlert, type AlertSeverity } from '../../api/alerts'
import type { Alert } from '../../types'

const SEVERITIES: { value: AlertSeverity; label: string }[] = [
  { value: 'info', label: 'Info' },
  { value: 'warning', label: 'Warning' },
  { value: 'critical', label: 'Critical' },
]

const SEVERITY_BADGE: Record<AlertSeverity, string> = {
  info: 'bg-blue-50 text-blue-700',
  warning: 'bg-amber-50 text-amber-700',
  critical: 'bg-red-50 text-red-700',
}

function isExpired(a: Alert): boolean {
  return !!a.expires_at && new Date(a.expires_at).getTime() <= Date.now()
}

function formatExpiry(iso: string | null): string {
  if (!iso) return 'No expiry'
  const d = new Date(iso)
  return d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
}

function toIsoOrNull(localDateTime: string): string | null {
  if (!localDateTime) return null
  const d = new Date(localDateTime)
  if (isNaN(d.getTime())) return null
  return d.toISOString()
}

export default function AlertsPage() {
  const qc = useQueryClient()
  const [message, setMessage] = useState('')
  const [severity, setSeverity] = useState<AlertSeverity>('info')
  const [expiresAt, setExpiresAt] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: alerts = [] } = useQuery<Alert[]>({
    queryKey: ['alerts', 'all'],
    queryFn: getAllAlerts,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['alerts', 'all'] })
    qc.invalidateQueries({ queryKey: ['alerts', 'active'] })
  }

  const createMutation = useMutation({
    mutationFn: () =>
      createAlert({
        message: message.trim(),
        severity,
        expires_at: toIsoOrNull(expiresAt),
      }),
    onSuccess: () => {
      invalidate()
      setMessage('')
      setSeverity('info')
      setExpiresAt('')
      setError(null)
    },
    onError: e => setError(e instanceof Error ? e.message : 'Failed to send alert'),
  })

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => updateAlert(id, { active: false }),
    onSuccess: invalidate,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAlert(id),
    onSuccess: invalidate,
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!message.trim()) return
    setError(null)
    createMutation.mutate()
  }

  const activeAlerts = alerts.filter(a => a.active && !isExpired(a))
  const pastAlerts = alerts.filter(a => !a.active || isExpired(a))

  return (
    <div className="p-4 mt-2 space-y-6">
      <div className="flex items-center gap-2">
        <BackLink to="/manage" label="Manage" />
      </div>
      <h2 className="text-xl font-bold text-slate-800">Alerts</h2>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Send New Alert</p>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Message</label>
          <textarea
            required
            value={message}
            onChange={e => setMessage(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="e.g. Lightning delay — all matches paused until 2:30pm."
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 bg-white resize-none"
          />
          <p className="text-xs text-gray-400 mt-1">{message.length}/500</p>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Severity</label>
          <select
            value={severity}
            onChange={e => setSeverity(e.target.value as AlertSeverity)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 bg-white"
          >
            {SEVERITIES.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Expires at (optional)</label>
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={e => setExpiresAt(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 bg-white"
          />
          <p className="text-xs text-gray-400 mt-1">Leave blank to stay active until manually deactivated.</p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={createMutation.isPending || !message.trim()}
          className="w-full py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-40 hover:bg-blue-700 transition-colors"
        >
          {createMutation.isPending ? 'Sending…' : 'Send Alert'}
        </button>
      </form>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Active</p>
        {activeAlerts.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">No active alerts.</p>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm divide-y divide-gray-50">
            {activeAlerts.map(a => (
              <div key={a.id} className="px-4 py-3 space-y-2">
                <div className="flex items-start gap-2">
                  <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${SEVERITY_BADGE[a.severity]}`}>
                    {a.severity}
                  </span>
                  <p className="text-sm text-slate-800 whitespace-pre-wrap flex-1">{a.message}</p>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Expires: {formatExpiry(a.expires_at)}</span>
                  <button
                    onClick={() => deactivateMutation.mutate(a.id)}
                    disabled={deactivateMutation.isPending}
                    className="text-xs text-blue-600 font-semibold hover:underline"
                  >
                    Deactivate
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {pastAlerts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Past</p>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm divide-y divide-gray-50">
            {pastAlerts.map(a => (
              <div key={a.id} className="px-4 py-3 space-y-1 opacity-70">
                <div className="flex items-start gap-2">
                  <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${SEVERITY_BADGE[a.severity]}`}>
                    {a.severity}
                  </span>
                  <p className="text-sm text-slate-800 whitespace-pre-wrap flex-1">{a.message}</p>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">
                    {new Date(a.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                    {isExpired(a) && a.active ? ' · expired' : ''}
                  </span>
                  <button
                    onClick={() => deleteMutation.mutate(a.id)}
                    disabled={deleteMutation.isPending}
                    className="text-xs text-red-600 font-semibold hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
