import { useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import BackLink from '../../components/BackLink'
import { useTabMemory } from '../../lib/useTabMemory'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSports } from '../../api/sports'
import { getCompanies } from '../../api/companies'
import { getTeams } from '../../api/teams'
import { getBrackets } from '../../api/brackets'
import { getMatches, bulkStartMatches, submitHeatResult } from '../../api/matches'
import { waterballMatchPoints } from '../../lib/waterball'
import type { Sport, Company, Team, Bracket, Match } from '../../types'

function indexBy<T>(arr: T[], key: keyof T): Record<string, T> {
  return Object.fromEntries(arr.map(item => [String(item[key]), item]))
}

function pointsFor(match: Match | undefined): number | null {
  if (!match) return null
  return waterballMatchPoints(match)
}

function TeamRow({
  team,
  index,
  match,
  groupStarted,
  onSave,
  saving,
}: {
  team: Team
  index: number
  match: Match | undefined
  groupStarted: boolean
  onSave: (rounds_survived: number | null, forfeit: boolean) => void
  saving: boolean
}) {
  const existing = match?.status === 'completed' && match.notes != null ? parseInt(match.notes, 10) : null
  const [rounds, setRounds] = useState(existing != null && !isNaN(existing) ? String(existing) : '')
  const points = pointsFor(match)

  if (!match) return null

  if (!groupStarted) {
    return (
      <div className="px-4 py-3 flex items-center gap-2">
        <p className="flex-1 text-sm font-semibold text-slate-800 truncate">
          {team.name ?? `Team ${index + 1}`}
        </p>
        <span className="text-xs text-gray-400">Waiting to start</span>
      </div>
    )
  }

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-sm font-semibold text-slate-800 truncate">
          {team.name ?? `Team ${index + 1}`}
        </p>
        {points != null && (
          <span className="text-xs font-bold tabular-nums text-slate-700 bg-gray-50 px-2 py-0.5 rounded-full">
            {points} pt{points === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {match.status === 'forfeit' && (
          <span className="text-xs text-red-600 font-semibold">Forfeited (no-show)</span>
        )}
        <span className="text-xs text-gray-500">Rounds survived:</span>
        <input
          type="number"
          min={0}
          inputMode="numeric"
          value={rounds}
          onChange={e => setRounds(e.target.value)}
          className="w-16 rounded-lg border border-gray-200 px-2 py-1 text-sm text-slate-800 text-right tabular-nums"
          onKeyDown={e => {
            if (e.key === 'Enter') {
              const n = Number(rounds)
              if (rounds !== '' && Number.isInteger(n) && n >= 0) onSave(n, false)
            }
          }}
        />
        <button
          type="button"
          onClick={() => {
            const n = Number(rounds)
            if (rounds === '' || !Number.isInteger(n) || n < 0) return
            onSave(n, false)
          }}
          disabled={saving || rounds === ''}
          className="text-xs font-semibold text-blue-600 disabled:text-gray-300"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => onSave(null, true)}
          disabled={saving}
          className="text-xs text-red-500 ml-auto"
        >
          Forfeit (no-show)
        </button>
      </div>
    </div>
  )
}

export default function WaterballResultsPage() {
  const { sportId } = useParams<{ sportId: string }>()
  const qc = useQueryClient()
  const [tab, setTab] = useTabMemory<string>('waterball-group-tab', '0')
  const [error, setError] = useState<string | null>(null)
  const [busyMatchId, setBusyMatchId] = useState<string | null>(null)

  const { data: sports = [], isLoading: sportsLoading } = useQuery<Sport[]>({
    queryKey: ['sports'],
    queryFn: getSports,
    staleTime: Infinity,
  })
  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ['companies'],
    queryFn: getCompanies,
    staleTime: Infinity,
  })
  const { data: teams = [] } = useQuery<Team[]>({
    queryKey: ['teams', 'sport', sportId],
    queryFn: () => getTeams({ sport_id: sportId! }),
    enabled: !!sportId,
  })
  const { data: brackets = [], isLoading: bracketsLoading } = useQuery<Bracket[]>({
    queryKey: ['brackets', sportId],
    queryFn: () => getBrackets(sportId!),
    enabled: !!sportId,
  })
  const { data: matches = [], isLoading: matchesLoading } = useQuery<Match[]>({
    queryKey: ['matches', { sport_id: sportId }],
    queryFn: ({ signal }) => getMatches({ sport_id: sportId!, signal }),
    enabled: !!sportId,
    refetchInterval: 5000,
  })
  const isLoading = sportsLoading || bracketsLoading || matchesLoading

  const sport = useMemo(() => sports.find(s => s.id === sportId), [sports, sportId])
  const companyMap = useMemo(() => indexBy(companies, 'id') as Record<string, Company>, [companies])
  const matchByTeam = useMemo(() => {
    const m: Record<string, Match> = {}
    for (const match of matches) {
      if (match.home_team_id) m[match.home_team_id] = match
    }
    return m
  }, [matches])

  const groups = useMemo(
    () => [...brackets].sort((a, b) => a.name.localeCompare(b.name)),
    [brackets],
  )

  const startGroupMutation = useMutation({
    mutationFn: (matchIds: string[]) => bulkStartMatches(matchIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['matches'] })
      setError(null)
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Failed to start group'),
  })

  const saveMutation = useMutation({
    mutationFn: (vars: { matchId: string; rounds_survived: number | null; forfeit: boolean }) =>
      submitHeatResult(vars.matchId, vars.forfeit ? { forfeit: true } : { time_ms: vars.rounds_survived! }),
    // Cancel any in-flight matches poll first so a late, pre-mutation response
    // can't land after our patch and stomp the fresh result back to stale
    // values (the "have to submit twice" symptom).
    onMutate: () => qc.cancelQueries({ queryKey: ['matches'] }),
    onSuccess: updated => {
      // Patch the one changed match into the cache directly from the response
      // instead of waiting on a full refetch — GET /matches recomputes
      // estimated_start for every match in the sport on each call, which is
      // slow enough to notice. The row updates instantly; a background
      // invalidate still runs to eventually pick up any downstream effects.
      //
      // /heat-result never joins `locations` or computes `estimated_start`
      // (only GET /matches does), so keep the previously known values for
      // those two fields instead of letting the response null them out —
      // otherwise the court/time briefly blanks and then "reloads".
      qc.setQueryData<Match[]>(['matches', { sport_id: sportId }], old =>
        old ? old.map(m => (m.id === updated.id
          ? { ...m, ...updated, locations: m.locations, estimated_start: m.estimated_start }
          : m)) : old,
      )
      qc.invalidateQueries({ queryKey: ['matches'] })
      // Deliberately does NOT touch event_points/leaderboard here — standings
      // only update once an admin reviews and saves from the Scoring page.
      setError(null)
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Failed to save'),
    onSettled: () => setBusyMatchId(null),
  })

  const teamsByCompany = useMemo(() => {
    const grouped = new Map<string, Team[]>()
    for (const t of teams) {
      const list = grouped.get(t.company_id) ?? []
      list.push(t)
      grouped.set(t.company_id, list)
    }
    return [...grouped.entries()]
      .map(([companyId, ts]) => ({ company: companyMap[companyId], teams: ts }))
      .filter(g => g.company)
      .sort((a, b) => a.company.name.localeCompare(b.company.name))
  }, [teams, companyMap])

  if (isLoading) {
    return (
      <div className="p-4 mt-2 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-gray-200 animate-pulse" />
        ))}
      </div>
    )
  }

  if (!sport) {
    return (
      <div className="p-4 mt-2">
        <BackLink to="/manage/results" label="Enter Results" />
        <p className="text-center text-gray-500 py-12">Sport not found.</p>
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="p-4 mt-2 space-y-4">
        <BackLink to="/manage/results" label="Enter Results" />
        <h2 className="text-xl font-bold text-slate-800">{sport.name}</h2>
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Matches haven't been generated yet. Set up groups and generate matches from{' '}
          <Link to={`/manage/brackets/${sportId}`} className="underline font-semibold">
            Manage &gt; Matches &gt; {sport.name}
          </Link>
          .
        </p>
      </div>
    )
  }

  const activeGroup = groups.find(g => g.id === tab) ?? groups[0]
  const activeGroupMatches = matches.filter(m => m.bracket_id === activeGroup.id)
  const scheduledMatchIds = activeGroupMatches.filter(m => m.status === 'scheduled').map(m => m.id)
  const groupStarted = activeGroupMatches.length > 0 && scheduledMatchIds.length < activeGroupMatches.length

  return (
    <div className="p-4 mt-2 space-y-4">
      <BackLink to="/manage/results" label="Enter Results" />
      <h2 className="text-xl font-bold text-slate-800">{sport.name}</h2>
      <p className="text-xs text-gray-400 -mt-3">
        Start a group when every team in it is ready to throw, then enter each team's rounds
        survived or mark a no-show as forfeit. Standings don't update here — review and save
        placements from Scoring once results are in.
      </p>

      <div className="flex rounded-lg bg-gray-100 p-1">
        {groups.map(g => (
          <button
            key={g.id}
            type="button"
            onClick={() => setTab(g.id)}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
              activeGroup.id === g.id ? 'bg-white shadow-sm text-slate-800' : 'text-gray-500'
            }`}
          >
            {g.name}
          </button>
        ))}
      </div>

      {!groupStarted && (
        <div className="bg-blue-50 rounded-xl border border-blue-100 p-3 flex items-center gap-3">
          <p className="flex-1 text-sm text-blue-700">
            {activeGroupMatches.length} team{activeGroupMatches.length !== 1 ? 's' : ''} ready in{' '}
            {activeGroup.name}.
          </p>
          <button
            type="button"
            onClick={() => startGroupMutation.mutate(scheduledMatchIds)}
            disabled={startGroupMutation.isPending}
            className="shrink-0 py-2 px-4 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {startGroupMutation.isPending ? 'Starting…' : `Start ${activeGroup.name}`}
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm divide-y divide-gray-50">
        {teamsByCompany.map(({ company, teams: companyTeams }) => {
          const visible = companyTeams.filter(t => matchByTeam[t.id]?.bracket_id === activeGroup.id)
          if (visible.length === 0) return null
          return (
            <div key={company.id}>
              <div className="px-4 pt-3 pb-1">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  {company.name}
                </p>
              </div>
              {visible.map((t, i) => (
                <TeamRow
                  key={t.id}
                  team={t}
                  index={i}
                  match={matchByTeam[t.id]}
                  groupStarted={groupStarted}
                  saving={busyMatchId === matchByTeam[t.id]?.id && saveMutation.isPending}
                  onSave={(rounds_survived, forfeit) => {
                    const matchId = matchByTeam[t.id]?.id
                    if (!matchId) return
                    setBusyMatchId(matchId)
                    saveMutation.mutate({ matchId, rounds_survived, forfeit })
                  }}
                />
              ))}
            </div>
          )
        })}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

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
