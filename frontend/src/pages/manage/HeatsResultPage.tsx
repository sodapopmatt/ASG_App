import { useState, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import BackLink from '../../components/BackLink'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSports, generateBracket, type HeatSpec } from '../../api/sports'
import { getTeams } from '../../api/teams'
import { getCompanies } from '../../api/companies'
import { getMatches, submitHeatResult } from '../../api/matches'
import { getBrackets } from '../../api/brackets'
import type { Match, Team, Company, Sport, Bracket } from '../../types'

// ── constants ─────────────────────────────────────────────────────────────────

const PHASE_CONFIG: Record<string, { label: string; advance: number | null; order: number }> = {
  heats:   { label: 'Preliminary Heats', advance: 2, order: 1 },
  bracket: { label: 'Semi-Finals',       advance: 3, order: 2 },
  finals:  { label: 'Final',             advance: null, order: 3 },
}

// ── helpers ───────────────────────────────────────────────────────────────────

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

function rankMatches(matches: Match[]): Record<string, number> {
  const completed = matches
    .filter(m => m.status === 'completed' && m.notes)
    .map(m => ({ teamId: m.home_team_id!, ms: parseInt(m.notes!, 10) }))
    .filter(r => !isNaN(r.ms))
    .sort((a, b) => a.ms - b.ms)
  const map: Record<string, number> = {}
  completed.forEach((r, i) => { map[r.teamId] = i + 1 })
  return map
}

// ── TeamRow ───────────────────────────────────────────────────────────────────

function medalColor(rank: number): string {
  if (rank === 1) return 'text-yellow-500'
  if (rank === 2) return 'text-slate-400'
  if (rank === 3) return 'text-amber-700'
  return 'text-gray-400'
}

function TeamRow({
  team,
  match,
  companyMap,
  rank,
  advances,
  isFinal = false,
}: {
  team: Team
  match: Match | undefined
  companyMap: Record<string, Company>
  rank: number | null
  advances: boolean
  isFinal?: boolean
}) {
  const qc = useQueryClient()
  const existingMs = match?.status === 'completed' && match.notes ? parseInt(match.notes, 10) : null

  const [mm, setMm] = useState(() => existingMs === null ? '' : String(Math.floor(existingMs / 60_000)))
  const [ss, setSs] = useState(() => existingMs === null ? '' : String(Math.floor((existingMs % 60_000) / 1_000)))
  const [ms, setMs] = useState(() => existingMs === null ? '' : String(existingMs % 1_000))
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (body: { time_ms?: number; forfeit?: boolean }) => submitHeatResult(match!.id, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['matches'] }); setError(null) },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to save'),
  })

  function handleSave() {
    if (!match) return
    const total = parseTimeInputs(mm, ss, ms)
    if (total === null || total <= 0) { setError('Enter a valid time (seconds 0–59, ms 0–999)'); return }
    setError(null)
    mutation.mutate({ time_ms: total })
  }

  const isForfeit = match?.status === 'forfeit'

  return (
    <div className={`bg-white rounded-xl border shadow-sm px-4 py-3 space-y-3 ${advances ? 'border-green-200' : 'border-gray-100'}`}>
      <div className="flex items-center gap-2">
        {rank !== null && (
          <span className={`text-sm font-bold w-5 text-center shrink-0 ${
            isFinal ? medalColor(rank) : advances ? 'text-green-700' : 'text-gray-400'
          }`}>
            {rank}
          </span>
        )}
        <p className="flex-1 font-semibold text-slate-800 min-w-0 truncate">{teamDisplayName(team, companyMap)}</p>
        {advances && rank !== null && (
          <span className="text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full border border-green-200 shrink-0">
            Advances
          </span>
        )}
        {isForfeit && (
          <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full shrink-0">Forfeit</span>
        )}
        {match?.status === 'completed' && existingMs !== null && (
          <span className="text-xs font-medium text-slate-600 bg-gray-50 px-2 py-0.5 rounded-full font-mono shrink-0">
            {formatHeatTime(existingMs)}
          </span>
        )}
      </div>

      {!match ? (
        <p className="text-sm text-gray-400 italic">No entry found.</p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 flex-1">
                <div className="flex flex-col items-center">
                <input type="number" min={0} max={99} value={mm} onChange={e => setMm(e.target.value)} placeholder="0"
                  className="w-14 text-center text-sm rounded-lg border border-gray-200 px-2 py-2 text-slate-700 tabular-nums" />
                <span className="text-xs text-gray-400 mt-0.5">min</span>
              </div>
              <span className="text-gray-400 font-bold pb-4">:</span>
              <div className="flex flex-col items-center">
                <input type="number" min={0} max={59} value={ss} onChange={e => setSs(e.target.value)} placeholder="00"
                  className="w-14 text-center text-sm rounded-lg border border-gray-200 px-2 py-2 text-slate-700 tabular-nums" />
                <span className="text-xs text-gray-400 mt-0.5">sec</span>
              </div>
              <span className="text-gray-400 font-bold pb-4">.</span>
              <div className="flex flex-col items-center">
                <input type="number" min={0} max={999} value={ms} onChange={e => setMs(e.target.value)} placeholder="000"
                  className="w-16 text-center text-sm rounded-lg border border-gray-200 px-2 py-2 text-slate-700 tabular-nums" />
                <span className="text-xs text-gray-400 mt-0.5">ms</span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5 shrink-0">
              <button onClick={handleSave} disabled={mutation.isPending}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {mutation.isPending ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => { if (!match) return; setError(null); mutation.mutate({ forfeit: true }) }}
                disabled={mutation.isPending}
                className="px-4 py-2 bg-white border border-red-200 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 disabled:opacity-50">
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

// ── HeatSection ───────────────────────────────────────────────────────────────

function HeatSection({
  bracket,
  matches,
  teamMap,
  companyMap,
  advanceCount,
}: {
  bracket: Bracket
  matches: Match[]
  teamMap: Record<string, Team>
  companyMap: Record<string, Company>
  advanceCount: number | null
}) {
  const isFinal = bracket.phase === 'finals'
  const rankMap = useMemo(() => rankMatches(matches), [matches])

  const sortedMatches = useMemo(() => [...matches].sort((a, b) => {
    const ra = a.home_team_id ? (rankMap[a.home_team_id] ?? Infinity) : Infinity
    const rb = b.home_team_id ? (rankMap[b.home_team_id] ?? Infinity) : Infinity
    if (ra !== rb) return ra - rb
    if (a.status === 'forfeit' && b.status !== 'forfeit') return 1
    if (b.status === 'forfeit' && a.status !== 'forfeit') return -1
    return 0
  }), [matches, rankMap])

  const matchByTeam: Record<string, Match> = {}
  for (const m of matches) {
    if (m.home_team_id) matchByTeam[m.home_team_id] = m
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold text-slate-700 text-sm">{bracket.name}</h3>
        {advanceCount !== null && (
          <span className="text-xs text-gray-400">Top {advanceCount} advance</span>
        )}
        {advanceCount === null && (
          <span className="text-xs text-gray-400">Ranked by finish</span>
        )}
      </div>
      {sortedMatches.map(m => {
        const team = m.home_team_id ? teamMap[m.home_team_id] : undefined
        if (!team) return null
        const rank = m.home_team_id ? (rankMap[m.home_team_id] ?? null) : null
        const advances = advanceCount !== null && rank !== null && rank <= advanceCount
        return (
          <TeamRow
            key={team.id}
            team={team}
            match={matchByTeam[team.id]}
            companyMap={companyMap}
            rank={rank}
            advances={advances}
            isFinal={isFinal}
          />
        )
      })}
    </div>
  )
}

// ── GenerateSemiFinalsCard ────────────────────────────────────────────────────

function GenerateSemiFinalsCard({
  qualifiers,
  teamMap,
  companyMap,
  sportId,
}: {
  qualifiers: { teamId: string; rank: number; fromHeat: string }[]
  teamMap: Record<string, Team>
  companyMap: Record<string, Company>
  sportId: string
}) {
  const qc = useQueryClient()

  // Snake distribution: alternate between heats so each gets a mix of top finishers
  const [assignment, setAssignment] = useState<Record<string, 0 | 1>>(() => {
    const map: Record<string, 0 | 1> = {}
    qualifiers.forEach((q, i) => { map[q.teamId] = (i % 2 === 0 ? 0 : 1) as 0 | 1 })
    return map
  })
  const [genError, setGenError] = useState<string | null>(null)

  const heat1 = qualifiers.filter(q => assignment[q.teamId] === 0)
  const heat2 = qualifiers.filter(q => assignment[q.teamId] === 1)

  const genMutation = useMutation({
    mutationFn: () => {
      const specs: HeatSpec[] = [
        { name: 'Semi-Final Heat 1', team_ids: heat1.map(q => q.teamId), phase: 'bracket' },
        { name: 'Semi-Final Heat 2', team_ids: heat2.map(q => q.teamId), phase: 'bracket' },
      ]
      return generateBracket(sportId, [], false, undefined, undefined, specs)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['matches'] })
      qc.invalidateQueries({ queryKey: ['brackets'] })
      setGenError(null)
    },
    onError: (e) => setGenError(e instanceof Error ? e.message : 'Failed to generate semi-finals'),
  })

  function toggle(teamId: string) {
    setAssignment(prev => ({ ...prev, [teamId]: prev[teamId] === 0 ? 1 : 0 }))
  }

  function teamName(teamId: string) {
    const team = teamMap[teamId]
    if (!team) return '?'
    return companyMap[team.company_id]?.name ?? '?'
  }

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-4">
      <div>
        <h3 className="font-bold text-blue-900">Generate Semi-Finals</h3>
        <p className="text-sm text-blue-700 mt-0.5">
          {qualifiers.length} teams qualified. Tap a name to swap between heats.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {([0, 1] as const).map(heatIdx => (
          <div key={heatIdx} className="space-y-1">
            <p className="text-xs font-semibold text-blue-800">Semi-Final Heat {heatIdx + 1}</p>
            {(heatIdx === 0 ? heat1 : heat2).map(q => (
              <button key={q.teamId} onClick={() => toggle(q.teamId)}
                className="w-full text-left text-xs px-2 py-1.5 rounded-lg bg-white border border-blue-200 text-slate-700 hover:bg-blue-100 truncate">
                {teamName(q.teamId)}
              </button>
            ))}
          </div>
        ))}
      </div>
      {genError && <p className="text-sm text-red-600">{genError}</p>}
      <button
        onClick={() => genMutation.mutate()}
        disabled={genMutation.isPending || heat1.length < 2 || heat2.length < 2}
        className="w-full py-2 bg-blue-600 text-white font-semibold text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
        {genMutation.isPending ? 'Generating…' : 'Generate Semi-Finals'}
      </button>
    </div>
  )
}

// ── GenerateFinalCard ─────────────────────────────────────────────────────────

function GenerateFinalCard({
  qualifiers,
  teamMap,
  companyMap,
  sportId,
}: {
  qualifiers: { teamId: string; rank: number; fromHeat: string }[]
  teamMap: Record<string, Team>
  companyMap: Record<string, Company>
  sportId: string
}) {
  const qc = useQueryClient()
  const [genError, setGenError] = useState<string | null>(null)

  const genMutation = useMutation({
    mutationFn: () => generateBracket(sportId, [], false, undefined, undefined, [{
      name: 'Final',
      team_ids: qualifiers.map(q => q.teamId),
      phase: 'finals',
    }]),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['matches'] })
      qc.invalidateQueries({ queryKey: ['brackets'] })
      setGenError(null)
    },
    onError: (e) => setGenError(e instanceof Error ? e.message : 'Failed to generate final'),
  })

  function teamName(teamId: string) {
    const team = teamMap[teamId]
    if (!team) return '?'
    return companyMap[team.company_id]?.name ?? '?'
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-4">
      <div>
        <h3 className="font-bold text-amber-900">Generate Final Heat</h3>
        <p className="text-sm text-amber-700 mt-0.5">{qualifiers.length} finalists qualified.</p>
      </div>
      <div className="space-y-1">
        {qualifiers.map((q, i) => (
          <div key={q.teamId} className="flex items-center gap-2 px-2 py-1.5 bg-white rounded-lg border border-amber-200">
            <span className="text-xs font-bold text-amber-600 w-4 shrink-0">{i + 1}</span>
            <span className="text-sm text-slate-700 flex-1 truncate">{teamName(q.teamId)}</span>
            <span className="text-xs text-gray-400 shrink-0">{q.fromHeat}</span>
          </div>
        ))}
      </div>
      {genError && <p className="text-sm text-red-600">{genError}</p>}
      <button
        onClick={() => genMutation.mutate()}
        disabled={genMutation.isPending || qualifiers.length < 2}
        className="w-full py-2 bg-amber-600 text-white font-semibold text-sm rounded-lg hover:bg-amber-700 disabled:opacity-50">
        {genMutation.isPending ? 'Generating…' : 'Generate Final Heat'}
      </button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const PHASE_SHORT: Record<string, string> = {
  heats:   'Prelims',
  bracket: 'Semi-Finals',
  finals:  'Final',
}

const ALL_PHASES = ['heats', 'bracket', 'finals'] as const

export default function HeatsResultPage() {
  const { sportId } = useParams<{ sportId: string }>()
  const [activePhase, setActivePhase] = useState<string>('heats')
  const [activeHeatByPhase, setActiveHeatByPhase] = useState<Record<string, string>>({})

  const { data: sports = [] } = useQuery({ queryKey: ['sports'], queryFn: getSports, staleTime: Infinity })
  const { data: teams = [] } = useQuery({ queryKey: ['teams'], queryFn: () => getTeams() })
  const { data: companies = [] } = useQuery({ queryKey: ['companies'], queryFn: getCompanies, staleTime: Infinity })
  const { data: matches = [], isLoading: matchesLoading } = useQuery({
    queryKey: ['matches', { sport_id: sportId }],
    queryFn: () => getMatches({ sport_id: sportId }),
    enabled: !!sportId,
  })
  const { data: brackets = [], isLoading: bracketsLoading } = useQuery({
    queryKey: ['brackets', sportId],
    queryFn: () => getBrackets(sportId),
    enabled: !!sportId,
  })

  const sport: Sport | undefined = useMemo(() => sports.find(s => s.id === sportId), [sports, sportId])
  const companyMap = useMemo(() => Object.fromEntries(companies.map(c => [c.id, c])) as Record<string, Company>, [companies])
  const teamMap = useMemo(() => Object.fromEntries(teams.map(t => [t.id, t])) as Record<string, Team>, [teams])
  const sportTeams = useMemo(() => teams.filter(t => t.sport_id === sportId), [teams, sportId])

  const matchesByBracket = useMemo(() => {
    const map: Record<string, Match[]> = {}
    for (const m of matches) {
      const key = m.bracket_id ?? '__flat'
      ;(map[key] ??= []).push(m)
    }
    return map
  }, [matches])

  const sortedBrackets = useMemo(() => [...brackets].sort((a, b) => {
    const ao = PHASE_CONFIG[a.phase ?? '']?.order ?? 99
    const bo = PHASE_CONFIG[b.phase ?? '']?.order ?? 99
    if (ao !== bo) return ao - bo
    return a.name.localeCompare(b.name)
  }), [brackets])

  const bracketsByPhase = useMemo(() => {
    const map: Record<string, Bracket[]> = {}
    for (const b of sortedBrackets) {
      const phase = b.phase ?? 'unknown'
      ;(map[phase] ??= []).push(b)
    }
    return map
  }, [sortedBrackets])

  function getQualifiers(phase: string, advance: number) {
    const phaseBrackets = bracketsByPhase[phase] ?? []
    return phaseBrackets.flatMap(b => {
      const heatMatches = matchesByBracket[b.id] ?? []
      const rankMap = rankMatches(heatMatches)
      return heatMatches
        .filter(m => m.home_team_id && (rankMap[m.home_team_id] ?? Infinity) <= advance)
        .map(m => ({ teamId: m.home_team_id!, rank: rankMap[m.home_team_id!], fromHeat: b.name }))
        .sort((a, b) => a.rank - b.rank)
    })
  }

  function phaseAllDone(phase: string) {
    const phaseBrackets = bracketsByPhase[phase] ?? []
    if (phaseBrackets.length === 0) return false
    return phaseBrackets.every(b => {
      const heatMatches = matchesByBracket[b.id] ?? []
      return heatMatches.length > 0 && heatMatches.every(m => m.status === 'completed' || m.status === 'forfeit')
    })
  }

  const hasGroupedBrackets = brackets.some(b => b.phase !== null)
  const hasSemiFinals = (bracketsByPhase['bracket'] ?? []).length > 0
  const hasFinal = (bracketsByPhase['finals'] ?? []).length > 0
  const prelimDone = phaseAllDone('heats')
  const semiDone = phaseAllDone('bracket')

  const semiQualifiers = prelimDone && !hasSemiFinals ? getQualifiers('heats', 2) : []
  const finalQualifiers = semiDone && !hasFinal ? getQualifiers('bracket', 3) : []

  const flatMatches = matchesByBracket['__flat'] ?? []

  if (matchesLoading || bracketsLoading) {
    return (
      <div className="p-4 mt-2 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-gray-200 animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="p-4 mt-2 space-y-5">
      <BackLink to="/manage/results" label="Enter Results" />
      <div>
        <h2 className="text-xl font-bold text-slate-800">{sport?.name ?? 'Heats'}</h2>
        <p className="text-sm text-gray-400 mt-0.5">Enter the time recorded by each team's referee.</p>
      </div>

      {hasGroupedBrackets ? (
        <div className="space-y-4">
          {/* Phase segmented tabs */}
          <div className="flex rounded-lg bg-gray-100 p-1">
            {ALL_PHASES.map(phase => (
              <button
                key={phase}
                onClick={() => setActivePhase(phase)}
                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  phase === activePhase ? 'bg-white shadow-sm text-slate-800' : 'text-gray-500'
                }`}
              >
                {PHASE_SHORT[phase]}
              </button>
            ))}
          </div>

          {/* Active phase content */}
          {(() => {
            const phaseBrackets = bracketsByPhase[activePhase] ?? []
            const config = PHASE_CONFIG[activePhase]

            if (phaseBrackets.length > 0) {
              const activeBracketId = activeHeatByPhase[activePhase] ?? phaseBrackets[0]?.id
              const activeBracket = phaseBrackets.find(b => b.id === activeBracketId) ?? phaseBrackets[0]
              return (
                <div className="space-y-3">
                  {phaseBrackets.length > 1 && (
                    <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 no-scrollbar">
                      {phaseBrackets.map((b, i) => {
                        const hm = matchesByBracket[b.id] ?? []
                        const done = hm.length > 0 && hm.every(m => m.status === 'completed' || m.status === 'forfeit')
                        const active = b.id === activeBracketId
                        return (
                          <button
                            key={b.id}
                            onClick={() => setActiveHeatByPhase(prev => ({ ...prev, [activePhase]: b.id }))}
                            className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
                              active
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                            }`}
                          >
                            Heat {i + 1}
                            {done && (
                              <span className={`text-xs ${active ? 'text-blue-200' : 'text-green-500'}`}>✓</span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {activeBracket && (
                    <HeatSection
                      bracket={activeBracket}
                      matches={matchesByBracket[activeBracket.id] ?? []}
                      teamMap={teamMap}
                      companyMap={companyMap}
                      advanceCount={config?.advance ?? null}
                    />
                  )}
                </div>
              )
            }

            if (activePhase === 'bracket') {
              return semiQualifiers.length > 0
                ? <GenerateSemiFinalsCard qualifiers={semiQualifiers} teamMap={teamMap} companyMap={companyMap} sportId={sportId!} />
                : <p className="text-center text-gray-400 py-12">Complete all Preliminary Heats first.</p>
            }

            if (activePhase === 'finals') {
              return finalQualifiers.length > 0
                ? <GenerateFinalCard qualifiers={finalQualifiers} teamMap={teamMap} companyMap={companyMap} sportId={sportId!} />
                : <p className="text-center text-gray-400 py-12">Complete Semi-Finals first.</p>
            }

            return <p className="text-center text-gray-400 py-12">No heats generated yet.</p>
          })()}
        </div>
      ) : (
        // Flat mode — Human Pyramid and legacy
        sportTeams.length === 0 ? (
          <p className="text-center text-gray-400 py-12">No teams found for this sport.</p>
        ) : flatMatches.length === 0 ? (
          <p className="text-center text-gray-400 py-12">
            No entries yet — generate entries from the sport config page first.
          </p>
        ) : (
          <div className="space-y-3">
            {sportTeams.map(team => (
              <TeamRow
                key={team.id}
                team={team}
                match={flatMatches.find(m => m.home_team_id === team.id)}
                companyMap={companyMap}
                rank={null}
                advances={false}
              />
            ))}
          </div>
        )
      )}
    </div>
  )
}
