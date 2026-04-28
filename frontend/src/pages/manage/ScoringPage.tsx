import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSports } from '../../api/sports'
import { getCompanies } from '../../api/companies'
import { getEventPoints, awardPlacement } from '../../api/event_points'
import { getLeaderboard } from '../../api/leaderboard'
import type { Sport, Company, EventPoints } from '../../types'

const PLACEMENTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

function indexBy<T>(arr: T[], key: keyof T): Record<string, T> {
  return Object.fromEntries(arr.map(item => [String(item[key]), item]))
}

export default function ScoringPage() {
  const qc = useQueryClient()
  const [sportId, setSportId] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [placement, setPlacement] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

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

  const { data: eventPoints = [] } = useQuery<EventPoints[]>({
    queryKey: ['event-points'],
    queryFn: () => getEventPoints(),
  })

  const companyMap = useMemo(() => indexBy(companies, 'id'), [companies])

  const pointsBySportAndCompany = useMemo(() => {
    const map = new Map<string, EventPoints>()
    for (const ep of eventPoints) {
      map.set(`${ep.sport_id}:${ep.company_id}`, ep)
    }
    return map
  }, [eventPoints])

  const existing = sportId && companyId
    ? pointsBySportAndCompany.get(`${sportId}:${companyId}`) ?? null
    : null

  const sportPoints = useMemo(
    () => eventPoints.filter(ep => ep.sport_id === sportId).sort((a, b) => a.placement - b.placement),
    [eventPoints, sportId],
  )

  const mutation = useMutation({
    mutationFn: () => awardPlacement(companyId, sportId, Number(placement)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['event-points'] })
      qc.invalidateQueries({ queryKey: ['leaderboard'] })
      setSaved(true)
      setCompanyId('')
      setPlacement('')
      setError(null)
      setTimeout(() => setSaved(false), 2500)
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Failed to award placement'),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!sportId || !companyId || !placement) return
    setError(null)
    mutation.mutate()
  }

  return (
    <div className="p-4 mt-2 space-y-6">
      <h2 className="text-xl font-bold text-slate-800">Award Placements</h2>

      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
          Sport
        </label>
        <select
          value={sportId}
          onChange={e => { setSportId(e.target.value); setCompanyId(''); setPlacement('') }}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 bg-white"
        >
          <option value="">Select sport…</option>
          {sports.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {sportId && (
        <>
          <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Assign Placement</p>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Company</label>
              <select
                required
                value={companyId}
                onChange={e => { setCompanyId(e.target.value); setSaved(false) }}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 bg-white"
              >
                <option value="">Select company…</option>
                {companies.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Placement</label>
              <select
                required
                value={placement}
                onChange={e => { setPlacement(e.target.value); setSaved(false) }}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 bg-white"
              >
                <option value="">Select placement…</option>
                {PLACEMENTS.map(p => (
                  <option key={p} value={p}>{ordinal(p)}</option>
                ))}
              </select>
            </div>

            {existing && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                This company already has {ordinal(existing.placement)} place ({existing.points} pts) for this sport.
                Submitting will overwrite it.
              </p>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={mutation.isPending || !companyId || !placement}
              className="w-full py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-40 hover:bg-blue-700 transition-colors"
            >
              {mutation.isPending ? 'Saving…' : saved ? 'Saved!' : 'Award Placement'}
            </button>
          </form>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Current Placements
            </p>
            {sportPoints.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No placements awarded yet.</p>
            ) : (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm divide-y divide-gray-50">
                {sportPoints.map(ep => (
                  <div key={ep.company_id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">
                        {companyMap[ep.company_id]?.name ?? ep.company_id}
                      </p>
                      <p className="text-xs text-gray-400">{ordinal(ep.placement)} place</p>
                    </div>
                    <span className="text-sm font-bold text-blue-600">{ep.points} pts</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
