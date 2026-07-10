import { useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import BackLink from '../../components/BackLink'
import { useTabMemory } from '../../lib/useTabMemory'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSports, generateBracket } from '../../api/sports'
import { getCompanies } from '../../api/companies'
import { getTeams } from '../../api/teams'
import { getBrackets } from '../../api/brackets'
import { getMatches } from '../../api/matches'
import { submitGolfResult } from '../../api/golf_results'
import { HOLES, ROUND_1_NAME, ROUND_2_NAME, golfHoleScores, golfTotal, golfPlayed } from '../../lib/golf'
import type { Sport, Company, Team, Bracket, Match } from '../../types'

const ROUND_2_SIZE = 6

function indexBy<T>(arr: T[], key: keyof T): Record<string, T> {
  return Object.fromEntries(arr.map(item => [String(item[key]), item]))
}

function formatTeeTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function CompanyRow({
  company,
  match,
  onSave,
  onForfeit,
  saving,
}: {
  company: Company
  match: Match | undefined
  onSave: (holeScores: number[]) => void
  onForfeit: () => void
  saving: boolean
}) {
  const existing = match ? golfHoleScores(match) : null
  const [holes, setHoles] = useState<string[]>(
    Array.from({ length: HOLES }, (_, i) => (existing && existing[i] != null ? String(existing[i]) : '')),
  )
  const [forceEdit, setForceEdit] = useState(false)
  const total = match ? golfTotal(match) : null

  if (!match) return null

  // Once a result is saved, grey the row out to confirm it went through;
  // "Edit" re-opens it for a correction without needing a separate flow.
  const isSaved = match.status === 'completed' || match.status === 'forfeit'
  const locked = (isSaved && !forceEdit) || saving

  const parsed = holes.map(h => Number(h))
  const allFilled = holes.every(h => h !== '') && parsed.every(n => Number.isInteger(n) && n >= 0)
  const teeTime = formatTeeTime(match.estimated_start ?? match.scheduled_at)

  function handleSave() {
    if (!allFilled) return
    setForceEdit(false)
    onSave(parsed)
  }

  function handleCancel() {
    setHoles(Array.from({ length: HOLES }, (_, i) => (existing && existing[i] != null ? String(existing[i]) : '')))
    setForceEdit(false)
  }

  return (
    <div className={`px-4 py-4 space-y-2 transition-colors ${locked ? 'bg-gray-50' : ''}`}>
      <div className="flex items-center gap-2">
        <p className={`flex-1 text-sm font-semibold truncate ${locked ? 'text-gray-400' : 'text-slate-800'}`}>
          {company.short_id ?? company.name}
        </p>
        {teeTime && (
          <span className="text-xs text-gray-400 tabular-nums">{teeTime}</span>
        )}
        {match.status === 'forfeit' && (
          <span className="text-xs text-red-500 font-semibold">Forfeited (no-show)</span>
        )}
        {total != null && (
          <span className="text-xs font-bold tabular-nums text-slate-700 bg-gray-100 px-2 py-0.5 rounded-full">
            {total} total
          </span>
        )}
        {isSaved && !saving && (
          <button
            type="button"
            onClick={() => setForceEdit(true)}
            className="text-xs font-semibold text-blue-600"
          >
            Edit
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {holes.map((h, i) => (
          <label key={i} className="flex items-center gap-1">
            <span className="text-xs text-gray-500">H{i + 1}</span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={h}
              disabled={locked}
              onChange={e => setHoles(prev => prev.map((v, j) => (j === i ? e.target.value : v)))}
              className="w-12 rounded-lg border border-gray-200 px-2 py-1 text-sm text-slate-800 text-right tabular-nums disabled:bg-gray-100 disabled:text-gray-400"
              onKeyDown={e => {
                if (e.key === 'Enter' && allFilled) handleSave()
              }}
            />
          </label>
        ))}
        {saving && <span className="text-xs text-gray-400">Saving…</span>}
        {!locked && (
          <>
            <button
              type="button"
              onClick={handleSave}
              disabled={!allFilled}
              className="text-xs font-semibold text-blue-600 disabled:text-gray-300"
            >
              Save
            </button>
            {forceEdit && (
              <button type="button" onClick={handleCancel} className="text-xs text-gray-500">
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={onForfeit}
              className="text-xs text-red-500 ml-auto"
            >
              Forfeit
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default function GolfResultsPage() {
  const { sportId } = useParams<{ sportId: string }>()
  const qc = useQueryClient()
  const [tab, setTab] = useTabMemory<string>('golf-round-tab', ROUND_1_NAME)
  const [error, setError] = useState<string | null>(null)
  const [busyMatchId, setBusyMatchId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

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
  const teamByCompany = useMemo(() => indexBy(teams, 'company_id') as Record<string, Team>, [teams])
  const matchByTeam = useMemo(() => {
    const m: Record<string, Match> = {}
    for (const match of matches) if (match.home_team_id) m[match.home_team_id] = match
    return m
  }, [matches])

  const round1 = brackets.find(b => b.name === ROUND_1_NAME)
  const round2 = brackets.find(b => b.name === ROUND_2_NAME)
  const hasRound2 = !!round2
  const ROUND_NAMES = [ROUND_1_NAME, ROUND_2_NAME] as const

  const saveMutation = useMutation({
    mutationFn: (vars: { matchId: string; holeScores?: number[]; forfeit?: boolean }) =>
      submitGolfResult(vars.matchId, vars.forfeit ? { forfeit: true } : { hole_scores: vars.holeScores! }),
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
      // /golf-results never joins `locations` or computes `estimated_start`
      // (only GET /matches does), so keep the previously known values for
      // those two fields instead of letting the response null them out —
      // otherwise the court/time briefly blanks and then "reloads".
      qc.setQueryData<Match[]>(['matches', { sport_id: sportId }], old =>
        old ? old.map(m => (m.id === updated.id
          ? { ...m, ...updated, locations: m.locations, estimated_start: m.estimated_start }
          : m)) : old,
      )
      qc.invalidateQueries({ queryKey: ['matches'] })
      // Deliberately does NOT touch event_points/leaderboard — standings only
      // update once an admin reviews and saves from the Scoring page.
      setError(null)
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Failed to save'),
    onSettled: () => setBusyMatchId(null),
  })

  const generateRound2 = useMutation({
    mutationFn: (teamIds: string[]) => {
      // Round 2 starts after the whole Round-1 field has teed off, on the same
      // starting tee. estimated_start ripple then spaces the 6 tee times out.
      let scheduledAt: string | undefined
      if (sport?.schedule_start) {
        const dur = sport.match_duration_minutes ?? 3
        const r1count = Object.values(matchByTeam).filter(m => m.bracket_id === round1?.id).length
        scheduledAt = new Date(new Date(sport.schedule_start).getTime() + r1count * dur * 60000).toISOString()
      }
      return generateBracket(sportId!, [], false, undefined, undefined, [
        { name: ROUND_2_NAME, team_ids: teamIds, phase: 'heats', scheduled_at: scheduledAt },
      ])
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brackets', sportId] })
      qc.invalidateQueries({ queryKey: ['matches'] })
      setSelected(new Set())
      setError(null)
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Failed to generate Round 2'),
  })

  // Companies in a round, sorted by tee time (staggered per company) so the
  // entry list reads top-to-bottom in the order they actually tee off.
  const companiesInRound = (bracketId: string) =>
    companies
      .map(c => ({ company: c, team: teamByCompany[c.id] }))
      .filter(({ team }) => team && matchByTeam[team.id]?.bracket_id === bracketId)
      .sort((a, b) => {
        const ta = matchByTeam[a.team!.id]
        const tb = matchByTeam[b.team!.id]
        const timeA = ta?.estimated_start ?? ta?.scheduled_at
        const timeB = tb?.estimated_start ?? tb?.scheduled_at
        if (timeA && timeB && timeA !== timeB) return timeA.localeCompare(timeB)
        return a.company.name.localeCompare(b.company.name)
      })

  // Round-1 leaderboard for the top-6 selection: lowest total first, then
  // played-but-forfeit, then unplayed, then alphabetical.
  const round1Ranking = useMemo(() => {
    if (!round1) return []
    return companiesInRound(round1.id)
      .map(({ company, team }) => {
        const match = matchByTeam[team!.id]
        return { company, team: team!, match, total: golfTotal(match), played: golfPlayed(match) }
      })
      .sort((a, b) => {
        if (a.total != null && b.total != null) return a.total - b.total
        if (a.total != null) return -1
        if (b.total != null) return 1
        if (a.played !== b.played) return a.played ? -1 : 1
        return a.company.name.localeCompare(b.company.name)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round1, companies, teamByCompany, matchByTeam])

  const round1Complete =
    !!round1 &&
    round1Ranking.length > 0 &&
    round1Ranking.every(r => golfPlayed(r.match))

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

  if (!round1) {
    return (
      <div className="p-4 mt-2 space-y-4">
        <BackLink to="/manage/results" label="Enter Results" />
        <h2 className="text-xl font-bold text-slate-800">{sport.name}</h2>
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Round 1 hasn't been generated yet. Add a tee location and generate Round 1 from{' '}
          <Link to={`/manage/brackets/${sportId}`} className="underline font-semibold">
            Manage &gt; Matches &gt; {sport.name}
          </Link>
          .
        </p>
      </div>
    )
  }

  const activeRoundName = ROUND_NAMES.includes(tab as typeof ROUND_NAMES[number]) ? tab : ROUND_1_NAME
  const activeBracket = activeRoundName === ROUND_1_NAME ? round1 : round2
  const showRound2Panel = activeRoundName === ROUND_2_NAME && round1Complete && !hasRound2

  function toggleSelected(teamId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(teamId)) next.delete(teamId)
      else if (next.size < ROUND_2_SIZE) next.add(teamId)
      return next
    })
  }

  return (
    <div className="p-4 mt-2 space-y-4">
      <BackLink to="/manage/results" label="Enter Results" />
      <h2 className="text-xl font-bold text-slate-800">{sport.name}</h2>
      <p className="text-xs text-gray-400 -mt-3">
        Each company tees off at its own time (shown per row). As each one finishes, enter its {HOLES}{' '}
        hole scores (the app totals them) or mark a no-show as forfeit. After Round 1, pick the {ROUND_2_SIZE}{' '}
        companies advancing. Standings don't update here — review and save placements from Scoring.
      </p>

      <div className="flex rounded-lg bg-gray-100 p-1">
        {ROUND_NAMES.map(name => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
              activeRoundName === name ? 'bg-white shadow-sm text-slate-800' : 'text-gray-500'
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      {!activeBracket ? (
        showRound2Panel ? null : (
          <p className="text-center text-gray-400 py-12">
            Round 1 must be completed before advancing to Round 2.
          </p>
        )
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm divide-y divide-gray-50">
            {companiesInRound(activeBracket.id).map(({ company, team }) => (
              <CompanyRow
                key={company.id}
                company={company}
                match={matchByTeam[team!.id]}
                saving={busyMatchId === matchByTeam[team!.id]?.id && saveMutation.isPending}
                onSave={holeScores => {
                  const matchId = matchByTeam[team!.id]?.id
                  if (!matchId) return
                  setBusyMatchId(matchId)
                  saveMutation.mutate({ matchId, holeScores })
                }}
                onForfeit={() => {
                  const matchId = matchByTeam[team!.id]?.id
                  if (!matchId) return
                  setBusyMatchId(matchId)
                  saveMutation.mutate({ matchId, forfeit: true })
                }}
              />
            ))}
          </div>
        </>
      )}

      {showRound2Panel && (
        <div className="bg-white rounded-xl border border-emerald-200 shadow-sm p-4 space-y-3">
          <div>
            <p className="font-semibold text-slate-800">Advance to Round 2</p>
            <p className="text-xs text-gray-500">
              Round 1 is complete. Select the {ROUND_2_SIZE} companies with the lowest totals to
              advance (break any tie at the cutoff with a closest-to-the-hole tee shot).
            </p>
          </div>
          <ol className="divide-y divide-gray-50">
            {round1Ranking.map((r, i) => {
              const checked = selected.has(r.team.id)
              const atLimit = selected.size >= ROUND_2_SIZE && !checked
              return (
                <li key={r.company.id} className="flex items-center gap-3 py-2">
                  <span className="w-5 text-right text-xs tabular-nums text-gray-400">{i + 1}</span>
                  <span className="flex-1 text-sm text-slate-800 truncate">{r.company.short_id ?? r.company.name}</span>
                  <span className="text-xs tabular-nums text-gray-500">
                    {r.match.status === 'forfeit' ? 'Forfeit' : r.total != null ? `${r.total}` : '—'}
                  </span>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={atLimit}
                    onChange={() => toggleSelected(r.team.id)}
                    className="h-4 w-4 accent-emerald-600 disabled:opacity-40"
                  />
                </li>
              )
            })}
          </ol>
          <button
            type="button"
            onClick={() => generateRound2.mutate([...selected])}
            disabled={selected.size !== ROUND_2_SIZE || generateRound2.isPending}
            className="w-full py-2 rounded-lg bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            {generateRound2.isPending
              ? 'Generating…'
              : `Generate Round 2 (${selected.size}/${ROUND_2_SIZE} selected)`}
          </button>
        </div>
      )}

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
