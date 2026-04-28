import { useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getMatches, startMatch, submitResult, submitForfeit, submitDoubleForfeit } from '../../api/matches'
import { getSports } from '../../api/sports'
import { getTeams } from '../../api/teams'
import { getCompanies } from '../../api/companies'
import { getBrackets } from '../../api/brackets'
import type { Match, Team, Company } from '../../types'

function indexBy<T>(arr: T[], key: keyof T): Record<string, T> {
  return Object.fromEntries(arr.map(item => [String(item[key]), item]))
}

function compactLabel(
  teamId: string | null,
  teamMap: Record<string, Team>,
  companyMap: Record<string, Company>,
): string {
  if (!teamId) return 'TBD'
  const team = teamMap[teamId]
  if (!team) return '—'
  const company = companyMap[team.company_id]
  const label = company?.short_id ?? company?.name ?? '?'
  return team.name ? `${label} · ${team.name}` : label
}

function slotLabel(
  teamId: string | null,
  otherTeamId: string | null,
  isDone: boolean,
  teamMap: Record<string, Team>,
  companyMap: Record<string, Company>,
): string {
  if (teamId) return compactLabel(teamId, teamMap, companyMap)
  if (isDone && otherTeamId) return 'Bye'
  if (isDone) return '—'
  return 'TBD'
}

function fullLabel(
  teamId: string | null,
  teamMap: Record<string, Team>,
  companyMap: Record<string, Company>,
): string {
  if (!teamId) return 'TBD'
  const team = teamMap[teamId]
  if (!team) return 'Unknown'
  const company = companyMap[team.company_id]
  const base = company?.name ?? 'Unknown'
  return team.name ? `${base} · ${team.name}` : base
}

// ─── Result Modal ─────────────────────────────────────────────────────────────

type PanelMode = 'result' | 'forfeit' | 'double_forfeit'

function MatchResultModal({
  match,
  teamMap,
  companyMap,
  onClose,
}: {
  match: Match
  teamMap: Record<string, Team>
  companyMap: Record<string, Company>
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<PanelMode>('result')
  const [error, setError] = useState<string | null>(null)

  const homeLabel = fullLabel(match.home_team_id, teamMap, companyMap)
  const awayLabel = fullLabel(match.away_team_id, teamMap, companyMap)
  const isScheduled = match.status === 'scheduled'
  const isDone = match.status === 'completed' || match.status === 'forfeit' || match.status === 'double_forfeit'

  const onSuccess = () => {
    qc.invalidateQueries({ queryKey: ['matches'] })
    onClose()
  }
  const onError = (e: unknown) => setError(e instanceof Error ? e.message : 'Failed to submit')

  const startMutation = useMutation({
    mutationFn: () => startMatch(match.id),
    onSuccess,
    onError,
  })
  const resultMutation = useMutation({
    mutationFn: (winnerId: string) => submitResult(match.id, winnerId),
    onSuccess,
    onError,
  })
  const forfeitMutation = useMutation({
    mutationFn: (forfeitingTeamId: string) => submitForfeit(match.id, forfeitingTeamId),
    onSuccess,
    onError,
  })
  const doubleForfeitMutation = useMutation({
    mutationFn: () => submitDoubleForfeit(match.id),
    onSuccess,
    onError,
  })

  const isPending = startMutation.isPending || resultMutation.isPending || forfeitMutation.isPending || doubleForfeitMutation.isPending

  const handleForfeit = (forfeitingTeamId: string, label: string) => {
    if (!window.confirm(`Mark "${label}" as forfeited? Their opponent will be recorded as the winner.`)) return
    forfeitMutation.mutate(forfeitingTeamId)
  }

  const handleDoubleForfeit = () => {
    if (!window.confirm('Mark both teams as forfeited? Neither team will advance.')) return
    doubleForfeitMutation.mutate()
  }

  const switchMode = (next: PanelMode) => {
    setMode(next)
    setError(null)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 pt-4 pb-3 flex items-start justify-between border-b border-gray-100">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
              {isDone ? 'Change Result' : match.status === 'in_progress' ? 'In Progress' : 'Enter Result'}
            </p>
            <p className="font-semibold text-slate-800 text-sm leading-tight">{homeLabel}</p>
            <p className="text-xs text-gray-400 my-0.5">vs</p>
            <p className="font-semibold text-slate-800 text-sm leading-tight">{awayLabel}</p>
            {isScheduled && (
              <button
                onClick={() => startMutation.mutate()}
                disabled={isPending}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-300 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-40 transition-colors"
              >
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                Mark In Progress
              </button>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 -mt-1 -mr-1 shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex border-b border-gray-100">
          {(['result', 'forfeit', 'double_forfeit'] as PanelMode[]).map(m => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${
                mode === m
                  ? m === 'result'
                    ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/40'
                    : m === 'forfeit'
                    ? 'text-red-600 border-b-2 border-red-600 bg-red-50/40'
                    : 'text-orange-600 border-b-2 border-orange-600 bg-orange-50/40'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              {m === 'result' ? 'Result' : m === 'forfeit' ? 'Forfeit' : 'Dbl Forfeit'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="px-4 py-4 space-y-3">
          {mode === 'result' && (
            <>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Who won?</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => resultMutation.mutate(match.home_team_id!)}
                  disabled={isPending || !match.home_team_id}
                  className="py-3 px-2 rounded-xl bg-gray-50 border-2 border-blue-200 text-sm font-semibold text-slate-800 hover:border-blue-500 hover:bg-blue-50 disabled:opacity-40 transition-colors"
                >
                  {homeLabel}
                </button>
                <button
                  onClick={() => resultMutation.mutate(match.away_team_id!)}
                  disabled={isPending || !match.away_team_id}
                  className="py-3 px-2 rounded-xl bg-gray-50 border-2 border-blue-200 text-sm font-semibold text-slate-800 hover:border-blue-500 hover:bg-blue-50 disabled:opacity-40 transition-colors"
                >
                  {awayLabel}
                </button>
              </div>
            </>
          )}

          {mode === 'forfeit' && (
            <>
              <p className="text-xs font-semibold text-red-500 uppercase tracking-wider">Which team forfeited?</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleForfeit(match.home_team_id!, homeLabel)}
                  disabled={isPending || !match.home_team_id}
                  className="py-3 px-2 rounded-xl bg-red-50 border-2 border-red-200 text-sm font-semibold text-slate-800 hover:border-red-500 disabled:opacity-40 transition-colors"
                >
                  {homeLabel}
                </button>
                <button
                  onClick={() => handleForfeit(match.away_team_id!, awayLabel)}
                  disabled={isPending || !match.away_team_id}
                  className="py-3 px-2 rounded-xl bg-red-50 border-2 border-red-200 text-sm font-semibold text-slate-800 hover:border-red-500 disabled:opacity-40 transition-colors"
                >
                  {awayLabel}
                </button>
              </div>
            </>
          )}

          {mode === 'double_forfeit' && (
            <>
              <p className="text-xs font-semibold text-orange-500 uppercase tracking-wider">Neither team showed up</p>
              <p className="text-sm text-gray-600">
                Both teams will be eliminated. The next bracket slot will receive a bye.
              </p>
              <button
                onClick={handleDoubleForfeit}
                disabled={isPending}
                className="w-full py-3 rounded-xl bg-orange-50 border-2 border-orange-300 text-sm font-semibold text-orange-700 hover:border-orange-500 disabled:opacity-40 transition-colors"
              >
                Confirm Double Forfeit
              </button>
            </>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </div>
    </div>
  )
}

// ─── Bracket rendering ────────────────────────────────────────────────────────

const PHASE_ORDER = ['winners', 'losers', 'finals'] as const

const PHASE_LABELS: Record<string, string> = {
  winners: 'Winners Bracket',
  losers: 'Losers Bracket',
  finals: 'Final',
}

function CheckIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-green-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function ClickableMatchCard({
  match,
  teamMap,
  companyMap,
  onClick,
}: {
  match: Match
  teamMap: Record<string, Team>
  companyMap: Record<string, Company>
  onClick: (match: Match) => void
}) {
  const isLive = match.status === 'in_progress'
  const isDone = match.status === 'completed' || match.status === 'forfeit' || match.status === 'double_forfeit'
  const homeLabel = slotLabel(match.home_team_id, match.away_team_id, isDone, teamMap, companyMap)
  const awayLabel = slotLabel(match.away_team_id, match.home_team_id, isDone, teamMap, companyMap)
  const homeWon = match.winner_id != null && match.winner_id === match.home_team_id
  const awayWon = match.winner_id != null && match.winner_id === match.away_team_id
  const isNotClickable = !match.home_team_id || !match.away_team_id
  const showFooter = isLive || isDone || !!match.locations?.name

  return (
    <button
      onClick={() => !isNotClickable && onClick(match)}
      disabled={isNotClickable}
      className={`bg-white rounded-xl border-2 shadow-sm overflow-hidden w-48 text-left transition-all ${
        isNotClickable
          ? 'border-gray-200 opacity-60 cursor-default'
          : isLive
          ? 'border-amber-400 shadow-amber-100 hover:border-amber-500 hover:shadow-md cursor-pointer active:scale-[0.98]'
          : 'border-gray-200 hover:border-blue-400 hover:shadow-md cursor-pointer active:scale-[0.98]'
      }`}
    >
      <div className={`flex items-center px-3 py-2.5 gap-2 ${homeWon ? 'bg-green-50' : ''}`}>
        <span className={`flex-1 text-sm truncate ${
          homeWon ? 'font-semibold text-green-700'
          : !match.home_team_id ? 'italic text-gray-400'
          : 'font-semibold text-slate-800'
        }`}>
          {homeLabel}
        </span>
        {homeWon && <CheckIcon />}
        {isLive && !homeWon && (
          <span className="shrink-0 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        )}
      </div>

      <div className="border-t border-gray-100" />

      <div className={`flex items-center px-3 py-2.5 gap-2 ${awayWon ? 'bg-green-50' : ''}`}>
        <span className={`flex-1 text-sm truncate ${
          awayWon ? 'font-semibold text-green-700'
          : !match.away_team_id ? 'italic text-gray-400'
          : 'font-semibold text-slate-800'
        }`}>
          {awayLabel}
        </span>
        {awayWon && <CheckIcon />}
        {isLive && !awayWon && (
          <span className="shrink-0 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        )}
      </div>

      {showFooter && (
        <div className="border-t border-gray-100 px-3 py-1.5 bg-gray-50 flex items-center justify-between gap-2">
          <span className="text-xs text-gray-400 truncate">{match.locations?.name ?? ''}</span>
          {isLive ? (
            <span className="text-xs font-medium text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full animate-pulse shrink-0">
              Live
            </span>
          ) : isDone ? (
            <span className="text-xs text-gray-400 shrink-0">
              {match.status === 'double_forfeit'
                ? 'Dbl Forfeit'
                : match.status === 'forfeit'
                ? 'Forfeit'
                : 'Final'}
            </span>
          ) : null}
        </div>
      )}
    </button>
  )
}

function RoundColumn({
  label,
  matches,
  teamMap,
  companyMap,
  onMatchClick,
}: {
  label: string | null
  matches: Match[]
  teamMap: Record<string, Team>
  companyMap: Record<string, Company>
  onMatchClick: (match: Match) => void
}) {
  return (
    <div className="flex flex-col gap-3 w-48">
      <div className="h-6 flex items-center justify-center">
        {label && (
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</p>
        )}
      </div>
      <div className="flex flex-col gap-3">
        {matches.map(match => (
          <ClickableMatchCard
            key={match.id}
            match={match}
            teamMap={teamMap}
            companyMap={companyMap}
            onClick={onMatchClick}
          />
        ))}
      </div>
    </div>
  )
}

type LabelMode = 'rounds' | 'finale' | 'flat'

function BracketPhase({
  title,
  roundMap,
  labelMode,
  teamMap,
  companyMap,
  onMatchClick,
}: {
  title?: string
  roundMap: Map<number, Match[]>
  labelMode: LabelMode
  teamMap: Record<string, Team>
  companyMap: Record<string, Company>
  onMatchClick: (match: Match) => void
}) {
  const entries = [...roundMap.entries()]
  const total = entries.length

  function getLabel(round: number, idx: number, matchCount: number): string | null {
    if (labelMode === 'finale') return null
    if (labelMode === 'flat') {
      if (round === 0) return 'Unassigned'
      if (idx === total - 1 && matchCount === 1) return 'Final'
    }
    return `Round ${round}`
  }

  return (
    <div>
      {title && (
        <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider border-b border-gray-200 pb-2 mb-4">
          {title}
        </h3>
      )}
      <div className="overflow-x-auto -mx-4 px-4">
        <div className="flex gap-5 pb-4" style={{ minWidth: 'max-content' }}>
          {entries.map(([round, matches], idx) => (
            <RoundColumn
              key={round}
              label={getLabel(round, idx, matches.length)}
              matches={matches}
              teamMap={teamMap}
              companyMap={companyMap}
              onMatchClick={onMatchClick}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="p-4 mt-2 space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-16 rounded-xl bg-gray-200 animate-pulse" />
      ))}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BracketResultsPage() {
  const { sportId } = useParams<{ sportId: string }>()
  const [activeMatch, setActiveMatch] = useState<Match | null>(null)

  const matchesQuery   = useQuery({ queryKey: ['matches'],              queryFn: () => getMatches() })
  const sportsQuery    = useQuery({ queryKey: ['sports'],               queryFn: getSports,          staleTime: Infinity })
  const teamsQuery     = useQuery({ queryKey: ['teams'],                queryFn: () => getTeams(),   staleTime: Infinity })
  const companiesQuery = useQuery({ queryKey: ['companies'],            queryFn: getCompanies,       staleTime: Infinity })
  const bracketsQuery  = useQuery({
    queryKey: ['brackets', sportId],
    queryFn:  () => getBrackets(sportId!),
    enabled:  !!sportId,
    staleTime: Infinity,
  })

  const teamMap    = useMemo(() => indexBy(teamsQuery.data    ?? [], 'id') as Record<string, Team>,    [teamsQuery.data])
  const companyMap = useMemo(() => indexBy(companiesQuery.data ?? [], 'id') as Record<string, Company>, [companiesQuery.data])
  const sport      = useMemo(() => (sportsQuery.data ?? []).find(s => s.id === sportId), [sportsQuery.data, sportId])

  const bracketPhaseMap = useMemo((): Record<string, string> => {
    const map: Record<string, string> = {}
    for (const b of (bracketsQuery.data ?? [])) {
      if (b.phase) map[b.id] = b.phase
    }
    return map
  }, [bracketsQuery.data])

  const sportMatches = useMemo(
    () => (matchesQuery.data ?? []).filter(m => m.sport_id === sportId),
    [matchesQuery.data, sportId],
  )

  const phaseGroups = useMemo((): Map<string, Map<number, Match[]>> => {
    const result = new Map<string, Map<number, Match[]>>()
    for (const m of sportMatches) {
      const phase = (m.bracket_id ? bracketPhaseMap[m.bracket_id] : null) ?? 'unassigned'
      const round = m.match_round ?? 0
      if (!result.has(phase)) result.set(phase, new Map())
      const roundMap = result.get(phase)!
      const list = roundMap.get(round) ?? []
      list.push(m)
      roundMap.set(round, list)
    }
    for (const phase of [...result.keys()]) {
      const roundMap = result.get(phase)!
      result.set(phase, new Map([...roundMap.entries()].sort(([a], [b]) => a - b)))
    }
    return result
  }, [sportMatches, bracketPhaseMap])

  const orderedPhases = PHASE_ORDER.filter(p => phaseGroups.has(p))
  const hasPhases = orderedPhases.length > 0

  const flatRoundMap = useMemo((): Map<number, Match[]> => {
    const map = new Map<number, Match[]>()
    for (const roundMap of phaseGroups.values()) {
      for (const [round, matches] of roundMap) {
        map.set(round, [...(map.get(round) ?? []), ...matches])
      }
    }
    return new Map([...map.entries()].sort(([a], [b]) => a - b))
  }, [phaseGroups])

  const isLoading =
    matchesQuery.isLoading ||
    sportsQuery.isLoading ||
    teamsQuery.isLoading ||
    companiesQuery.isLoading ||
    bracketsQuery.isLoading

  if (isLoading) return <Skeleton />

  const hasMatches = phaseGroups.size > 0

  return (
    <>
      <div className="p-4 mt-2">
        <Link
          to="/manage/results"
          className="inline-flex items-center gap-1 text-sm text-blue-600 mb-4"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Enter Results
        </Link>

        <h2 className="text-xl font-bold text-slate-800 mb-1">{sport?.name ?? 'Bracket'}</h2>
        <p className="text-xs text-gray-400 mb-5">Tap a match slot to enter the result</p>

        {!hasMatches ? (
          <p className="text-center text-gray-500 py-12">No matches for this sport yet.</p>
        ) : hasPhases ? (
          <div className="space-y-8">
            {orderedPhases.map(phase => (
              <BracketPhase
                key={phase}
                title={PHASE_LABELS[phase] ?? phase}
                roundMap={phaseGroups.get(phase)!}
                labelMode={phase === 'finals' ? 'finale' : 'rounds'}
                teamMap={teamMap}
                companyMap={companyMap}
                onMatchClick={setActiveMatch}
              />
            ))}
          </div>
        ) : (
          <BracketPhase
            roundMap={flatRoundMap}
            labelMode="flat"
            teamMap={teamMap}
            companyMap={companyMap}
            onMatchClick={setActiveMatch}
          />
        )}
      </div>

      {activeMatch && (
        <MatchResultModal
          match={activeMatch}
          teamMap={teamMap}
          companyMap={companyMap}
          onClose={() => setActiveMatch(null)}
        />
      )}
    </>
  )
}
