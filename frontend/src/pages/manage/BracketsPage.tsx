import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSports, generateBracket, resetBrackets } from '../../api/sports'
import { getTeams } from '../../api/teams'
import { getCompanies } from '../../api/companies'
import { getLocations } from '../../api/locations'
import type { Sport, Team, Company } from '../../types'

const GENERATABLE = new Set(['single_elimination', 'double_elimination'])

const BRACKET_LABELS: Record<string, string> = {
  single_elimination: 'Single elim',
  double_elimination: 'Double elim',
  pool_bracket: 'Pool + bracket',
  pool_swiss: 'Pool + Swiss',
  heats: 'Heats',
  points_based: 'Points based',
}

function indexBy<T>(arr: T[], key: keyof T): Record<string, T> {
  return Object.fromEntries(arr.map(item => [String(item[key]), item]))
}

function UpIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  )
}

function DownIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function SportCard({
  sport,
  sportTeams,
  companyMap,
}: {
  sport: Sport
  sportTeams: Team[]
  companyMap: Record<string, Company>
}) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [seeds, setSeeds] = useState<Team[]>([])
  const [clearExisting, setClearExisting] = useState(false)
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const canGenerate = GENERATABLE.has(sport.bracket_type)
  const isRandomized = sport.bracket_type === 'double_elimination'

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: getLocations,
    enabled: open && isRandomized,
    staleTime: Infinity,
  })

  function openSetup() {
    setSeeds([...sportTeams])
    setClearExisting(false)
    setSelectedLocationIds([])
    setError(null)
    setSuccess(false)
    setOpen(true)
  }

  function move(idx: number, dir: -1 | 1) {
    const next = [...seeds]
    const swap = idx + dir
    if (swap < 0 || swap >= next.length) return
    ;[next[idx], next[swap]] = [next[swap], next[idx]]
    setSeeds(next)
  }

  function toggleLocation(id: string) {
    setSelectedLocationIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const mutation = useMutation({
    mutationFn: () =>
      isRandomized
        ? generateBracket(sport.id, sportTeams.map(t => t.id), clearExisting, selectedLocationIds)
        : generateBracket(sport.id, seeds.map(t => t.id), clearExisting),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] })
      setSuccess(true)
      setOpen(false)
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to generate bracket'),
  })

  const resetMutation = useMutation({
    mutationFn: () => resetBrackets(sport.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brackets'] })
      qc.invalidateQueries({ queryKey: ['matches'] })
      setSuccess(false)
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to reset brackets'),
  })

  function handleReset() {
    if (!window.confirm(`Reset all brackets for ${sport.name}? This will delete all matches and cannot be undone.`)) return
    resetMutation.mutate()
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-800">{sport.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {BRACKET_LABELS[sport.bracket_type] ?? sport.bracket_type}
            {' · '}
            {sportTeams.length} team{sportTeams.length !== 1 ? 's' : ''}
          </p>
        </div>
        {success && (
          <span className="text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
            Generated
          </span>
        )}
        <button
          onClick={handleReset}
          disabled={resetMutation.isPending}
          className="shrink-0 text-sm font-medium text-red-500 disabled:text-gray-300"
        >
          {resetMutation.isPending ? 'Resetting…' : 'Reset'}
        </button>
        {canGenerate ? (
          <button
            onClick={open ? () => setOpen(false) : openSetup}
            disabled={sportTeams.length < 2}
            className="shrink-0 text-sm font-medium text-blue-600 disabled:text-gray-300"
          >
            {open ? 'Cancel' : 'Setup'}
          </button>
        ) : (
          <span className="shrink-0 text-xs text-gray-400">Manual entry</span>
        )}
      </div>

      {open && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-3 bg-gray-50">
          {isRandomized ? (
            <>
              <p className="text-sm text-slate-500 italic">
                {sport.name} matchups are randomized automatically.
              </p>

              {locations.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Courts</p>
                  {locations.map(loc => (
                    <label
                      key={loc.id}
                      className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-gray-200 cursor-pointer text-sm text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={selectedLocationIds.includes(loc.id)}
                        onChange={() => toggleLocation(loc.id)}
                        className="rounded"
                      />
                      {loc.name}
                    </label>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Seed order</p>
              <div className="space-y-1">
                {seeds.map((team, idx) => (
                  <div key={team.id} className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-gray-200">
                    <span className="text-xs font-bold text-gray-400 w-5 text-center">{idx + 1}</span>
                    <span className="flex-1 text-sm text-slate-700">
                      {companyMap[team.company_id]?.name ?? '—'}
                      {team.name && <span className="text-gray-400"> · {team.name}</span>}
                    </span>
                    <div className="flex gap-0.5">
                      <button
                        onClick={() => move(idx, -1)}
                        disabled={idx === 0}
                        className="p-1 text-gray-400 hover:text-slate-700 disabled:opacity-20"
                      >
                        <UpIcon />
                      </button>
                      <button
                        onClick={() => move(idx, 1)}
                        disabled={idx === seeds.length - 1}
                        className="p-1 text-gray-400 hover:text-slate-700 disabled:opacity-20"
                      >
                        <DownIcon />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={clearExisting}
              onChange={e => setClearExisting(e.target.checked)}
              className="rounded"
            />
            Clear existing brackets first
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="w-full py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {mutation.isPending ? 'Generating…' : 'Generate Bracket'}
          </button>
        </div>
      )}
    </div>
  )
}

export default function BracketsPage() {
  const { data: sports = [], isLoading } = useQuery({ queryKey: ['sports'], queryFn: getSports, staleTime: Infinity })
  const { data: teams = [] } = useQuery({ queryKey: ['teams'], queryFn: () => getTeams() })
  const { data: companies = [] } = useQuery({ queryKey: ['companies'], queryFn: getCompanies, staleTime: Infinity })

  const companyMap = useMemo(() => indexBy(companies, 'id') as Record<string, Company>, [companies])

  const teamsBySport = useMemo(() => {
    const map = new Map<string, Team[]>()
    for (const team of teams) {
      const list = map.get(team.sport_id) ?? []
      list.push(team)
      map.set(team.sport_id, list)
    }
    return map
  }, [teams])

  if (isLoading) {
    return (
      <div className="p-4 mt-2 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-gray-200 animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="p-4 mt-2 space-y-3">
      <h2 className="text-xl font-bold text-slate-800 mb-4">Brackets</h2>
      {sports.map(sport => (
        <SportCard
          key={sport.id}
          sport={sport}
          sportTeams={teamsBySport.get(sport.id) ?? []}
          companyMap={companyMap}
        />
      ))}
    </div>
  )
}
