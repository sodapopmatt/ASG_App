import { useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import BackLink from '../../components/BackLink'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSports } from '../../api/sports'
import { getCompanies } from '../../api/companies'
import { getDonationCounts, upsertDonationCount, deleteDonationCount } from '../../api/donation_counts'
import { clearEventPoints } from '../../api/event_points'
import type { Sport, Company, DonationCount } from '../../types'

export default function DonationResultsPage() {
  const { sportId } = useParams<{ sportId: string }>()
  const qc = useQueryClient()

  const { data: sports = [] } = useQuery<Sport[]>({
    queryKey: ['sports'],
    queryFn: getSports,
    staleTime: Infinity,
  })
  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ['companies'],
    queryFn: getCompanies,
    staleTime: Infinity,
  })
  const { data: donations = [] } = useQuery<DonationCount[]>({
    queryKey: ['donation-counts', sportId],
    queryFn: () => getDonationCounts({ sport_id: sportId! }),
    enabled: !!sportId,
  })

  const sport = useMemo(() => sports.find(s => s.id === sportId), [sports, sportId])

  const byCompany = useMemo(() => {
    const m: Record<string, DonationCount> = {}
    for (const d of donations) m[d.company_id] = d
    return m
  }, [donations])

  const [addValues, setAddValues] = useState<Record<string, string>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const QUERY_KEY = ['donation-counts', sportId] as const

  // Write the returned record straight into the cache so the display updates
  // instantly without waiting for a background refetch. Does NOT touch
  // event_points/leaderboard — standings are reviewed and saved from Scoring.
  const patchCache = (updated: DonationCount) => {
    qc.setQueryData<DonationCount[]>(QUERY_KEY, prev => {
      if (!prev) return [updated]
      const exists = prev.some(d => d.company_id === updated.company_id)
      return exists
        ? prev.map(d => d.company_id === updated.company_id ? updated : d)
        : [...prev, updated]
    })
  }

  const saveMutation = useMutation({
    mutationFn: (vars: { company_id: string; item_count: number }) =>
      upsertDonationCount(vars.company_id, sportId!, vars.item_count),
    onSuccess: patchCache,
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Failed to save'),
    onSettled: () => setSavingId(null),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDonationCount(id),
    onSuccess: (_data, id) => {
      qc.setQueryData<DonationCount[]>(QUERY_KEY, prev =>
        (prev ?? []).filter(d => d.id !== id),
      )
      setError(null)
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Failed to clear'),
    onSettled: () => setSavingId(null),
  })

  const handleAdd = (company_id: string) => {
    const raw = addValues[company_id] ?? ''
    if (raw === '') {
      setError('Enter a number to add')
      return
    }
    const n = Number(raw)
    if (!Number.isInteger(n) || n <= 0) {
      setError('Enter a positive whole number to add')
      return
    }
    const current = byCompany[company_id]?.item_count ?? 0
    const next = current + n
    setError(null)
    setSavingId(company_id)
    saveMutation.mutate(
      { company_id, item_count: next },
      { onSuccess: () => setAddValues(v => ({ ...v, [company_id]: '' })) },
    )
  }

  const openEdit = (company_id: string) => {
    setEditValue(String(byCompany[company_id]?.item_count ?? 0))
    setEditingId(company_id)
    setError(null)
  }

  const handleEditSave = (company_id: string) => {
    const n = Number(editValue)
    if (!Number.isInteger(n) || n < 0) {
      setError('Total must be a non-negative whole number')
      return
    }
    setError(null)
    setSavingId(company_id)
    // Setting total to 0 removes the record so it doesn't count toward scoring.
    if (n === 0) {
      const existing = byCompany[company_id]
      if (existing) {
        deleteMutation.mutate(existing.id, { onSuccess: () => setEditingId(null) })
      } else {
        setEditingId(null)
        setSavingId(null)
      }
      return
    }
    saveMutation.mutate(
      { company_id, item_count: n },
      { onSuccess: () => setEditingId(null) },
    )
  }

  const handleResetAll = async () => {
    if (!window.confirm('Reset all donation counts and standings? This cannot be undone.')) return
    setResetting(true)
    setError(null)
    try {
      for (const d of donations) await deleteDonationCount(d.id)
      // Also clears any saved event_points for this sport, same as Golf/
      // Waterball's "Reset All Results" wiping matches + standings together.
      await clearEventPoints(sportId!)
      qc.setQueryData<DonationCount[]>(QUERY_KEY, [])
      qc.invalidateQueries({ queryKey: ['event-points'] })
      qc.invalidateQueries({ queryKey: ['leaderboard'] })
      setEditingId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reset')
    } finally {
      setResetting(false)
    }
  }

  if (!sport) {
    return (
      <div className="p-4 mt-2">
        <BackLink to="/manage/results" label="Enter Results" />
        <p className="text-center text-gray-500 py-12">Sport not found.</p>
      </div>
    )
  }

  return (
    <div className="p-4 mt-2 space-y-4">
      <BackLink to="/manage/results" label="Enter Results" />
      <h2 className="text-xl font-bold text-slate-800">{sport.name}</h2>
      <p className="text-xs text-gray-400 -mt-3">
        Enter running totals as donations come in. Standings don't update here — review and save
        placements from Scoring once counts are in.
      </p>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm divide-y divide-gray-50">
        <div className="px-4 py-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Running Totals</p>
          <p className="text-xs text-gray-400 mt-1">
            Enter each donation as it comes in — amounts add to the running total.
          </p>
        </div>

        {companies.map(c => {
          const existing = byCompany[c.id]
          const total = existing?.item_count ?? 0
          const isEditing = editingId === c.id
          const isSaving = savingId === c.id

          return (
            <div key={c.id} className="px-4 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <p className="flex-1 text-sm font-semibold text-slate-800 truncate">{c.name}</p>
                <span className="text-sm font-bold tabular-nums text-slate-700">
                  {total > 0
                    ? <>{total} <span className="text-gray-400 font-normal">cans</span></>
                    : <span className="text-gray-300 font-normal">—</span>
                  }
                </span>
              </div>

              {isEditing ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Set total:</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    className="w-24 rounded-lg border border-gray-200 px-2 py-1 text-sm text-slate-800 text-right tabular-nums"
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleEditSave(c.id)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleEditSave(c.id)}
                    disabled={isSaving}
                    className="text-xs font-semibold text-blue-600 disabled:text-gray-300"
                  >
                    {isSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="text-xs text-gray-400"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">+ Add:</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={addValues[c.id] ?? ''}
                    onChange={e => setAddValues(v => ({ ...v, [c.id]: e.target.value }))}
                    placeholder="0"
                    className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-sm text-slate-800 text-right tabular-nums"
                    onKeyDown={e => { if (e.key === 'Enter') handleAdd(c.id) }}
                  />
                  <button
                    type="button"
                    onClick={() => handleAdd(c.id)}
                    disabled={isSaving}
                    className="text-xs font-semibold text-blue-600 disabled:text-gray-300"
                  >
                    {isSaving ? 'Adding…' : 'Add'}
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(c.id)}
                    className="text-xs text-gray-400 ml-auto"
                  >
                    Edit total
                  </button>
                </div>
              )}
            </div>
          )
        })}

        {error && <p className="text-sm text-red-600 px-4 py-2">{error}</p>}
      </div>

      {donations.length > 0 && (
        <button
          type="button"
          onClick={handleResetAll}
          disabled={resetting}
          className="w-full py-2 rounded-lg border border-red-200 text-red-600 font-semibold text-sm hover:bg-red-50 disabled:opacity-50"
        >
          {resetting ? 'Resetting…' : 'Reset All'}
        </button>
      )}

      <p className="text-xs text-gray-400 text-center">
        Standings are reviewed and saved from{' '}
        <Link to="/manage/scoring" className="underline font-semibold">
          Scoring
        </Link>
        .
      </p>
    </div>
  )
}
