import { useState, useMemo, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import BackLink from '../../components/BackLink'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSports } from '../../api/sports'
import { getCompanies } from '../../api/companies'
import { getDonationCounts, upsertDonationCount, deleteDonationCount } from '../../api/donation_counts'
import type { Sport, Company, DonationCount } from '../../types'

function donationPointsFor(counts: number[]): Record<number, number> {
  const distinct = Array.from(new Set(counts)).sort((a, b) => b - a)
  const map: Record<number, number> = {}
  distinct.forEach((c, i) => {
    if (i === 0) map[c] = 15
    else if (i === 1) map[c] = 10
    else if (c >= 10) map[c] = 5
    else map[c] = 0
  })
  return map
}

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

  const [values, setValues] = useState<Record<string, string>>({})
  useEffect(() => {
    const seeded: Record<string, string> = {}
    for (const d of donations) seeded[d.company_id] = String(d.item_count)
    setValues(seeded)
  }, [donations])

  const previewCounts = useMemo(
    () =>
      companies
        .map(c => {
          const raw = values[c.id]
          const n = raw === undefined || raw === '' ? null : Number(raw)
          return n != null && Number.isFinite(n) ? n : null
        })
        .filter((n): n is number => n != null && n >= 0),
    [values, companies],
  )
  const previewMap = useMemo(() => donationPointsFor(previewCounts), [previewCounts])

  const [savingId, setSavingId] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const saveMutation = useMutation({
    mutationFn: (vars: { company_id: string; item_count: number }) =>
      upsertDonationCount(vars.company_id, sportId!, vars.item_count),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['donation-counts', sportId] })
      qc.invalidateQueries({ queryKey: ['event-points'] })
      qc.invalidateQueries({ queryKey: ['leaderboard'] })
      setError(null)
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Failed to save'),
    onSettled: () => setSavingId(null),
  })

  const handleResetAll = async () => {
    if (!window.confirm('Reset all donation counts? This cannot be undone.')) return
    setResetting(true)
    setError(null)
    try {
      for (const d of donations) await deleteDonationCount(d.id)
      setValues({})
      qc.invalidateQueries({ queryKey: ['donation-counts', sportId] })
      qc.invalidateQueries({ queryKey: ['event-points'] })
      qc.invalidateQueries({ queryKey: ['leaderboard'] })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reset')
    } finally {
      setResetting(false)
    }
  }

  const handleSave = (company_id: string) => {
    const raw = values[company_id]
    if (raw === undefined || raw === '') return
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 0) {
      setError('Item count must be a non-negative integer')
      return
    }
    setSavingId(company_id)
    saveMutation.mutate({ company_id, item_count: n })
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

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm divide-y divide-gray-50">
        <div className="px-4 py-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Items Donated</p>
          <p className="text-xs text-gray-400 mt-1">
            Top donor: 15 pts · 2nd: 10 pts · everyone else with ≥ 10 items: 5 pts. Ties share points.
          </p>
        </div>
        {companies.map(c => {
          const existing = byCompany[c.id]
          const raw = values[c.id] ?? ''
          const n = raw === '' ? null : Number(raw)
          const validPreview = n != null && Number.isFinite(n) && n >= 0
          const previewPts = validPreview ? previewMap[n] ?? 0 : null
          const dirty = existing
            ? raw !== '' && String(existing.item_count) !== raw
            : raw !== ''
          return (
            <div key={c.id} className="flex items-center gap-3 px-4 py-3">
              <p className="flex-1 text-sm font-semibold text-slate-800 truncate">{c.name}</p>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={raw}
                onChange={e => setValues(v => ({ ...v, [c.id]: e.target.value }))}
                placeholder="—"
                className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-sm text-slate-800 text-right tabular-nums"
              />
              <span className="w-14 text-xs font-bold text-blue-600 text-right tabular-nums">
                {previewPts != null ? `${previewPts} pts` : ''}
              </span>
              <button
                type="button"
                onClick={() => handleSave(c.id)}
                disabled={!dirty || savingId === c.id}
                className="text-xs font-semibold text-blue-600 disabled:text-gray-300"
              >
                {savingId === c.id ? 'Saving…' : 'Save'}
              </button>
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
    </div>
  )
}
