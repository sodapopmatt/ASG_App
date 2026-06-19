import { useState, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import BackLink from '../../components/BackLink'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSports } from '../../api/sports'
import { getTeams } from '../../api/teams'
import { getCompanies } from '../../api/companies'
import { getMatches, submitHeatResult } from '../../api/matches'
import type { Match, Team, Company, Sport } from '../../types'

function formatHeatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  const millis = ms % 1000
  return `${m}:${String(s).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}

function parseTimeInputs(mm: string, ss: string, ms: string): number | null {
  const m = parseInt(mm || '0', 10)
  const s = parseInt(ss || '0', 10)
  const milli = parseInt(ms || '0', 10)
  if (isNaN(m) || isNaN(s) || isNaN(milli)) return null
  if (s > 59 || milli > 999) return null
  return m * 60_000 + s * 1_000 + milli
}

function teamDisplayName(team: Team, companyMap: Record<string, Company>): string {
  const company = companyMap[team.company_id]
  const base = company?.name ?? 'Unknown'
  return team.name ? `${base} · ${team.name}` : base
}

function TeamRow({
  team,
  match,
  companyMap,
}: {
  team: Team
  match: Match | undefined
  companyMap: Record<string, Company>
}) {
  const qc = useQueryClient()

  const existingMs = match?.status === 'completed' && match.notes
    ? parseInt(match.notes, 10)
    : null

  const [mm, setMm] = useState(() => {
    if (existingMs === null) return ''
    return String(Math.floor(existingMs / 60_000))
  })
  const [ss, setSs] = useState(() => {
    if (existingMs === null) return ''
    return String(Math.floor((existingMs % 60_000) / 1_000))
  })
  const [ms, setMs] = useState(() => {
    if (existingMs === null) return ''
    return String(existingMs % 1_000)
  })

  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (body: { time_ms?: number; forfeit?: boolean }) =>
      submitHeatResult(match!.id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['matches'] })
      setError(null)
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to save'),
  })

  function handleSave() {
    if (!match) return
    const total = parseTimeInputs(mm, ss, ms)
    if (total === null || total <= 0) {
      setError('Enter a valid time (seconds must be 0–59, ms 0–999)')
      return
    }
    setError(null)
    mutation.mutate({ time_ms: total })
  }

  function handleForfeit() {
    if (!match) return
    setError(null)
    mutation.mutate({ forfeit: true })
  }

  const isForfeit = match?.status === 'forfeit'
  const hasNoMatch = !match

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 space-y-3">
      <div className="flex items-center gap-2">
        <p className="flex-1 font-semibold text-slate-800">{teamDisplayName(team, companyMap)}</p>
        {isForfeit && (
          <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
            Forfeit
          </span>
        )}
        {match?.status === 'completed' && existingMs !== null && (
          <span className="text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full font-mono">
            {formatHeatTime(existingMs)}
          </span>
        )}
      </div>

      {hasNoMatch ? (
        <p className="text-sm text-gray-400 italic">
          No entry found — generate entries from the Matches page first.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 flex-1">
              <div className="flex flex-col items-center">
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={mm}
                  onChange={e => setMm(e.target.value)}
                  placeholder="0"
                  className="w-14 text-center text-sm rounded-lg border border-gray-200 px-2 py-2 text-slate-700 tabular-nums"
                />
                <span className="text-xs text-gray-400 mt-0.5">min</span>
              </div>
              <span className="text-gray-400 font-bold pb-4">:</span>
              <div className="flex flex-col items-center">
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={ss}
                  onChange={e => setSs(e.target.value)}
                  placeholder="00"
                  className="w-14 text-center text-sm rounded-lg border border-gray-200 px-2 py-2 text-slate-700 tabular-nums"
                />
                <span className="text-xs text-gray-400 mt-0.5">sec</span>
              </div>
              <span className="text-gray-400 font-bold pb-4">.</span>
              <div className="flex flex-col items-center">
                <input
                  type="number"
                  min={0}
                  max={999}
                  value={ms}
                  onChange={e => setMs(e.target.value)}
                  placeholder="000"
                  className="w-16 text-center text-sm rounded-lg border border-gray-200 px-2 py-2 text-slate-700 tabular-nums"
                />
                <span className="text-xs text-gray-400 mt-0.5">ms</span>
              </div>
            </div>

            <div className="flex flex-col gap-1.5 shrink-0">
              <button
                onClick={handleSave}
                disabled={mutation.isPending}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {mutation.isPending ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={handleForfeit}
                disabled={mutation.isPending}
                className="px-4 py-2 bg-white border border-red-200 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 disabled:opacity-50"
              >
                Forfeit
              </button>
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </>
      )}
    </div>
  )
}

export default function HeatsResultPage() {
  const { sportId } = useParams<{ sportId: string }>()

  const { data: sports = [] } = useQuery({ queryKey: ['sports'], queryFn: getSports, staleTime: Infinity })
  const { data: teams = [] } = useQuery({ queryKey: ['teams'], queryFn: () => getTeams() })
  const { data: companies = [] } = useQuery({ queryKey: ['companies'], queryFn: getCompanies, staleTime: Infinity })
  const { data: matches = [], isLoading } = useQuery({
    queryKey: ['matches', { sport_id: sportId }],
    queryFn: () => getMatches({ sport_id: sportId }),
    enabled: !!sportId,
  })

  const sport: Sport | undefined = useMemo(
    () => sports.find(s => s.id === sportId),
    [sports, sportId],
  )

  const companyMap = useMemo(
    () => Object.fromEntries(companies.map(c => [c.id, c])) as Record<string, Company>,
    [companies],
  )

  const sportTeams = useMemo(
    () => teams.filter(t => t.sport_id === sportId).sort((a, b) => {
      const ca = companyMap[a.company_id]?.name ?? ''
      const cb = companyMap[b.company_id]?.name ?? ''
      return ca.localeCompare(cb)
    }),
    [teams, sportId, companyMap],
  )

  // Index matches by home_team_id (heats: one match per team)
  const matchByTeam = useMemo(
    () => Object.fromEntries(
      matches.filter(m => m.home_team_id).map(m => [m.home_team_id!, m])
    ) as Record<string, Match>,
    [matches],
  )

  if (isLoading) {
    return (
      <div className="p-4 mt-2 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-gray-200 animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="p-4 mt-2 space-y-3">
      <div className="flex items-center gap-2">
        <BackLink to="/manage/results" label="Enter Results" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-slate-800">{sport?.name ?? 'Heats'}</h2>
        <p className="text-sm text-gray-400 mt-0.5">Enter the time recorded by each team's referee.</p>
      </div>

      {sportTeams.length === 0 ? (
        <p className="text-center text-gray-400 py-12">No teams found for this sport.</p>
      ) : (
        sportTeams.map(team => (
          <TeamRow
            key={team.id}
            team={team}
            match={matchByTeam[team.id]}
            companyMap={companyMap}
          />
        ))
      )}
    </div>
  )
}
