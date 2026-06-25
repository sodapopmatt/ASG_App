import { useState, useMemo } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import BackLink from '../../components/BackLink'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSports, generateBracket, resetBrackets, updateSport, getStandings, type DivisionSpec, type PoolSpec } from '../../api/sports'
import { getMatches, patchMatch } from '../../api/matches'
import { getTeams } from '../../api/teams'
import { getCompanies } from '../../api/companies'
import { getLocations, createLocation, deleteLocation, updateLocation } from '../../api/locations'
import { getBrackets } from '../../api/brackets'
import type { Match, Team, Company, Location as LocationRow } from '../../types'

const GENERATABLE = new Set(['single_elimination', 'double_elimination', 'heats', 'pool_bracket', 'pool_swiss'])

const poolName = (i: number) => `Pool ${String.fromCharCode(65 + i)}`

function indexBy<T>(arr: T[], key: keyof T): Record<string, T> {
  return Object.fromEntries(arr.map(item => [String(item[key]), item]))
}

function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function teamLabel(
  teamId: string | null | undefined,
  teamMap: Record<string, Team>,
  companyMap: Record<string, Company>,
): string {
  if (!teamId) return 'TBD'
  const team = teamMap[teamId]
  if (!team) return '—'
  const company = companyMap[team.company_id]
  const base = company?.name ?? 'Unknown'
  return team.name ? `${base} · ${team.name}` : base
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

function DonationSportConfig({
  sportId,
  sportName,
  scheduleStart,
  scheduleEnd,
  locations,
}: {
  sportId: string
  sportName: string
  scheduleStart: string | null
  scheduleEnd: string | null
  locations: LocationRow[]
}) {
  const qc = useQueryClient()
  const [start, setStart] = useState(toDatetimeLocal(scheduleStart))
  const [end, setEnd] = useState(toDatetimeLocal(scheduleEnd))
  const [locationName, setLocationName] = useState(locations[0]?.name ?? '')
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [locationError, setLocationError] = useState<string | null>(null)

  const scheduleMutation = useMutation({
    mutationFn: () =>
      updateSport(sportId, {
        schedule_start: start ? new Date(start).toISOString() : null,
        schedule_end: end ? new Date(end).toISOString() : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sports'] })
      setScheduleError(null)
    },
    onError: e => setScheduleError(e instanceof Error ? e.message : 'Failed to save'),
  })

  const locationMutation = useMutation({
    mutationFn: async () => {
      const name = locationName.trim()
      const [first, ...rest] = locations
      if (!name) {
        for (const loc of locations) await deleteLocation(loc.id)
        return
      }
      if (first) {
        if (first.name !== name) await updateLocation(first.id, name)
      } else {
        await createLocation(sportId, name)
      }
      // Clean up any legacy extras so the donation sport only has one location.
      for (const extra of rest) await deleteLocation(extra.id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['locations', sportId] })
      setLocationError(null)
    },
    onError: e => setLocationError(e instanceof Error ? e.message : 'Failed to save location'),
  })

  return (
    <div className="p-4 mt-2 space-y-5">
      <div>
        <BackLink to="/manage/brackets" label="Matches" />
        <h2 className="text-xl font-bold text-slate-800">{sportName}</h2>
        <p className="text-xs text-gray-400 mt-0.5">Donation drive · sport-wide event</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-4 space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Schedule</p>
        <label className="space-y-1 block">
          <span className="text-xs text-gray-400">Start time</span>
          <input
            type="datetime-local"
            value={start}
            onChange={e => setStart(e.target.value)}
            className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white text-slate-700"
          />
        </label>
        <label className="space-y-1 block">
          <span className="text-xs text-gray-400">End time</span>
          <input
            type="datetime-local"
            value={end}
            onChange={e => setEnd(e.target.value)}
            className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white text-slate-700"
          />
        </label>
        {scheduleError && <p className="text-sm text-red-600">{scheduleError}</p>}
        <button
          onClick={() => scheduleMutation.mutate()}
          disabled={scheduleMutation.isPending}
          className="w-full py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {scheduleMutation.isPending ? 'Saving…' : scheduleMutation.isSuccess ? 'Saved' : 'Save'}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-4 space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Location</p>
        <input
          type="text"
          value={locationName}
          onChange={e => setLocationName(e.target.value)}
          placeholder="e.g. Main Lobby"
          className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white text-slate-700"
        />
        {locationError && <p className="text-sm text-red-600">{locationError}</p>}
        <button
          onClick={() => locationMutation.mutate()}
          disabled={locationMutation.isPending}
          className="w-full py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {locationMutation.isPending ? 'Saving…' : locationMutation.isSuccess ? 'Saved' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{children}</p>
  )
}

function DivToggle({
  value,
  names,
  onChange,
}: {
  value: 0 | 1
  names: [string, string]
  onChange: (v: 0 | 1) => void
}) {
  return (
    <div className="flex rounded-lg overflow-hidden border border-gray-200 shrink-0">
      {([0, 1] as const).map(i => (
        <button
          key={i}
          onClick={() => onChange(i)}
          className={`px-2 py-1 text-xs font-medium max-w-[5.5rem] truncate transition-colors ${
            value === i ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
          }`}
        >
          {names[i].trim() || `Div ${i + 1}`}
        </button>
      ))}
    </div>
  )
}

const SHARED_COURT_VALUE = -1

function CourtPill({
  loc,
  currentPool,
  poolCount,
  onMoveCourt,
}: {
  loc: { id: string; name: string }
  currentPool: number
  poolCount: number
  onMoveCourt: (locId: string, pool: number) => void
}) {
  return (
    <div className="flex items-center gap-1 bg-blue-50 border border-blue-100 rounded-md px-2 py-1 text-xs text-slate-700">
      <span>{loc.name}</span>
      <select
        value={currentPool}
        onChange={e => onMoveCourt(loc.id, Number(e.target.value))}
        className="ml-1 text-[10px] bg-transparent text-blue-400 cursor-pointer border-none outline-none"
      >
        <option value={SHARED_COURT_VALUE}>Shared (all pools)</option>
        {Array.from({ length: poolCount }, (_, j) => (
          <option key={j} value={j}>{poolName(j)}</option>
        ))}
      </select>
    </div>
  )
}

function PoolBuckets({
  poolCount,
  seeds,
  locations,
  teamPoolOf,
  courtPoolOf,
  companyMap,
  onMoveTeam,
  onMoveCourt,
}: {
  poolCount: number
  seeds: Team[]
  locations: { id: string; name: string; sport_id: string }[]
  teamPoolOf: (id: string) => number
  courtPoolOf: (id: string) => number
  companyMap: Record<string, Company>
  onMoveTeam: (teamId: string, pool: number) => void
  onMoveCourt: (locId: string, pool: number) => void
}) {
  const [openPool, setOpenPool] = useState<number | null>(0)

  const sharedCourts = locations.filter(l => courtPoolOf(l.id) === SHARED_COURT_VALUE)

  return (
    <div className="space-y-2">
      {/* Shared courts */}
      {sharedCourts.length > 0 && (
        <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2.5">
          <p className="text-xs font-semibold text-blue-600 mb-1.5">Shared courts (all pools)</p>
          <div className="flex flex-wrap gap-1.5">
            {sharedCourts.map(loc => (
              <CourtPill key={loc.id} loc={loc} currentPool={SHARED_COURT_VALUE} poolCount={poolCount} onMoveCourt={onMoveCourt} />
            ))}
          </div>
        </div>
      )}

      {/* Per-pool accordions */}
      {Array.from({ length: poolCount }, (_, i) => {
        const poolTeams = seeds.filter(t => teamPoolOf(t.id) === i)
        const poolCourts = locations.filter(l => courtPoolOf(l.id) === i)
        const isOpen = openPool === i
        return (
          <div key={i} className="rounded-xl border border-gray-200 overflow-hidden">
            <button
              onClick={() => setOpenPool(isOpen ? null : i)}
              className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 text-left hover:bg-gray-100 transition-colors"
            >
              <span className="text-sm font-semibold text-slate-800">{poolName(i)}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">{poolTeams.length} teams</span>
                {poolCourts.length > 0 && (
                  <span className="text-xs text-gray-400">· {poolCourts.map(c => c.name).join(', ')}</span>
                )}
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
            </button>
            {isOpen && (
              <div className="px-3 py-2.5 space-y-2 bg-white">
                <div className="flex flex-wrap gap-1.5">
                  {poolTeams.map(team => (
                    <div key={team.id} className="flex items-center gap-1 bg-gray-100 rounded-md px-2 py-1 text-xs text-slate-700">
                      <span>{companyMap[team.company_id]?.name ?? '—'}{team.name ? ` · ${team.name}` : ''}</span>
                      <select
                        value={i}
                        onChange={e => onMoveTeam(team.id, Number(e.target.value))}
                        className="ml-1 text-[10px] bg-transparent text-gray-400 cursor-pointer border-none outline-none"
                      >
                        {Array.from({ length: poolCount }, (_, j) => (
                          <option key={j} value={j}>{poolName(j)}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                  {poolTeams.length === 0 && <p className="text-xs text-gray-400 italic">No teams assigned</p>}
                </div>
                {locations.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1 border-t border-gray-100">
                    {poolCourts.map(loc => (
                      <CourtPill key={loc.id} loc={loc} currentPool={i} poolCount={poolCount} onMoveCourt={onMoveCourt} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function SportConfigPage() {
  const { sportId } = useParams<{ sportId: string }>()
  const qc = useQueryClient()

  const { data: sports = [], isLoading: sportsLoading } = useQuery({
    queryKey: ['sports'],
    queryFn: getSports,
    staleTime: Infinity,
  })
  const { data: teams = [] } = useQuery({ queryKey: ['teams'], queryFn: () => getTeams() })
  const { data: companies = [] } = useQuery({ queryKey: ['companies'], queryFn: getCompanies, staleTime: Infinity })
  const { data: locations = [] } = useQuery({
    queryKey: ['locations', sportId],
    queryFn: () => getLocations(sportId!),
    enabled: !!sportId,
  })
  const { data: matches = [] } = useQuery({
    queryKey: ['matches', { sport_id: sportId }],
    queryFn: () => getMatches({ sport_id: sportId! }),
    enabled: !!sportId,
  })

  const sport = sports.find(s => s.id === sportId)
  const sportTeams = useMemo(() => teams.filter(t => t.sport_id === sportId), [teams, sportId])
  const companyMap = useMemo(() => indexBy(companies, 'id') as Record<string, Company>, [companies])
  const teamMap = useMemo(() => indexBy(teams, 'id') as Record<string, Team>, [teams])

  // Schedule config state
  const [configDuration, setConfigDuration] = useState<number | null>(null)
  const [configStart, setConfigStart] = useState<string | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)

  // Courts state
  const [newCourtName, setNewCourtName] = useState('')
  const [courtError, setCourtError] = useState<string | null>(null)
  const [bulkPrefix, setBulkPrefix] = useState('Ct')
  const [bulkCount, setBulkCount] = useState(1)
  const [bulkGenerating, setBulkGenerating] = useState(false)

  // Generate bracket state
  const [seeds, setSeeds] = useState<Team[]>([])
  const [seedsInit, setSeedsInit] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)

  // Division split state (elimination sports across two venues)
  const [splitEnabled, setSplitEnabled] = useState(false)
  const [divNames, setDivNames] = useState<[string, string]>(['Main Gym', 'North Gym'])
  const [teamDiv, setTeamDiv] = useState<Record<string, 0 | 1>>({})
  const [courtDiv, setCourtDiv] = useState<Record<string, 0 | 1>>({})

  // Pool play state (pool_bracket / pool_swiss)
  const [poolCount, setPoolCount] = useState<number | null>(null)
  const [teamPool, setTeamPool] = useState<Record<string, number>>({})
  const [courtPool, setCourtPool] = useState<Record<string, number>>({})

  // Bracket phase state (pool_bracket, after pool play)
  const [advanceCount, setAdvanceCount] = useState(2)
  const [advOverride, setAdvOverride] = useState<string[] | null>(null)

  // Schedule patch state
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [pendingTimes, setPendingTimes] = useState<Record<string, string>>({})
  const [patchError, setPatchError] = useState<string | null>(null)

  const matchesByRound = useMemo(() => {
    const sorted = [...matches].sort((a, b) => {
      if (!a.scheduled_at && !b.scheduled_at) return 0
      if (!a.scheduled_at) return 1
      if (!b.scheduled_at) return -1
      return a.scheduled_at.localeCompare(b.scheduled_at)
    })
    const groups: Record<string, Match[]> = {}
    for (const m of sorted) {
      const key = m.match_round != null ? String(m.match_round) : 'unscheduled'
      groups[key] ??= []
      groups[key].push(m)
    }
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === 'unscheduled') return 1
      if (b === 'unscheduled') return -1
      return Number(a) - Number(b)
    })
  }, [matches])

  // Init seeds once sport teams are loaded
  if (sport && !seedsInit && sportTeams.length > 0) {
    setSeeds([...sportTeams])
    setSeedsInit(true)
  }

  const effectiveDuration = configDuration ?? sport?.match_duration_minutes ?? 30
  const effectiveStart = configStart ?? (sport?.schedule_start ? toDatetimeLocal(sport.schedule_start) : '')

  const configMutation = useMutation({
    mutationFn: () => updateSport(sportId!, {
      match_duration_minutes: effectiveDuration,
      schedule_start: effectiveStart ? new Date(effectiveStart).toISOString() : null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sports'] })
      setConfigError(null)
    },
    onError: (e) => setConfigError(e instanceof Error ? e.message : 'Failed to save config'),
  })

  const createCourtMutation = useMutation({
    mutationFn: (name: string) => createLocation(sportId!, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['locations', sportId] })
      setNewCourtName('')
      setCourtError(null)
    },
    onError: (e) => setCourtError(e instanceof Error ? e.message : 'Failed to add court'),
  })

  const deleteCourtMutation = useMutation({
    mutationFn: (locationId: string) => deleteLocation(locationId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['locations', sportId] }),
    onError: (e) => setCourtError(e instanceof Error ? e.message : 'Failed to remove court'),
  })

  const isHeats = sport?.bracket_type === 'heats'
  const isRandomized = sport?.bracket_type === 'double_elimination'
  const isElimination = sport?.bracket_type === 'single_elimination' || sport?.bracket_type === 'double_elimination'
  const isPool = sport?.bracket_type === 'pool_bracket' || sport?.bracket_type === 'pool_swiss'
  const isPoolBracket = sport?.bracket_type === 'pool_bracket'

  const alreadyGenerated = matches.length > 0

  // â”€â”€ Pool play setup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const effectivePoolCount = Math.max(1, Math.min(
    poolCount ?? Math.ceil(sportTeams.length / 8),
    Math.floor(sportTeams.length / 2) || 1,
  ))

  // Snake distribution over seed order keeps pools balanced by strength
  const teamPoolOf = (teamId: string): number => {
    const override = teamPool[teamId]
    if (override !== undefined && override < effectivePoolCount) return override
    const idx = seeds.findIndex(t => t.id === teamId)
    if (idx < 0) return 0
    const P = effectivePoolCount
    const lap = idx % (2 * P)
    return lap < P ? lap : 2 * P - 1 - lap
  }
  // -1 = shared across all pools; 0..n = dedicated to that pool
  const SHARED_COURT = -1
  const courtPoolOf = (locId: string): number => {
    const override = courtPool[locId]
    if (override === SHARED_COURT) return SHARED_COURT
    if (override !== undefined && override < effectivePoolCount) return override
    const idx = locations.findIndex(l => l.id === locId)
    if (idx < 0 || locations.length === 0) return 0
    // Auto-share when there are fewer courts than pools
    if (locations.length < effectivePoolCount) return SHARED_COURT
    return Math.min(Math.floor(idx * effectivePoolCount / locations.length), effectivePoolCount - 1)
  }

  const poolSpecs: PoolSpec[] = Array.from({ length: effectivePoolCount }, (_, i) => ({
    name: poolName(i),
    team_ids: seeds.filter(t => teamPoolOf(t.id) === i).map(t => t.id),
    // Include courts dedicated to this pool AND courts shared across all pools
    location_ids: locations.filter(l => courtPoolOf(l.id) === i || courtPoolOf(l.id) === SHARED_COURT).map(l => l.id),
  }))
  const poolsValid = poolSpecs.every(p => p.team_ids.length >= 2)

  // â”€â”€ Bracket phase (pool_bracket only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { data: brackets = [] } = useQuery({
    queryKey: ['brackets', sportId],
    queryFn: () => getBrackets(sportId!),
    enabled: !!sportId && isPool,
  })
  const hasBracketPhase = isPool && brackets.some(b => b.phase !== 'pool')
  // Keep the bracket phase card visible even after the first bracket is generated
  // so pickleball (and any pool_bracket sport) can generate a second bracket (e.g. 13th–20th).
  const showBracketPhaseCard = isPoolBracket && alreadyGenerated

  const { data: standings = [] } = useQuery({
    queryKey: ['standings', sportId],
    queryFn: () => getStandings(sportId!),
    enabled: !!sportId && showBracketPhaseCard,
  })

  const pendingPoolCount = useMemo(
    () => matches.filter(m => m.status === 'scheduled' || m.status === 'in_progress').length,
    [matches],
  )

  // Default advancing order: pool winners first, then runners-up, etc.
  const defaultAdvancing = useMemo(() => {
    const ids: string[] = []
    for (let r = 0; r < advanceCount; r++) {
      for (const pool of standings) {
        const row = pool.standings[r]
        if (row) ids.push(row.team_id)
      }
    }
    return ids
  }, [standings, advanceCount])
  const advancing = advOverride ?? defaultAdvancing

  const teamRecord = useMemo(() => {
    const map: Record<string, { wins: number; losses: number; game_wins: number; point_diff: number; total_points: number }> = {}
    for (const pool of standings) {
      for (const row of pool.standings) map[row.team_id] = {
        wins: row.wins, losses: row.losses,
        game_wins: row.game_wins, point_diff: row.point_diff, total_points: row.total_points,
      }
    }
    return map
  }, [standings])

  // Pools where the last team in and the first team out have identical records on all 4 tiebreakers
  const cutLineTies = useMemo(() => {
    return standings
      .filter(pool => {
        const inside = pool.standings[advanceCount - 1]
        const outside = pool.standings[advanceCount]
        return inside && outside &&
          inside.wins === outside.wins &&
          inside.losses === outside.losses &&
          inside.game_wins === outside.game_wins &&
          inside.point_diff === outside.point_diff &&
          inside.total_points === outside.total_points
      })
      .map(pool => pool.name)
  }, [standings, advanceCount])

  // Division assignment with sensible defaults: teams alternate (keeps the top
  // seeds apart), courts split first half / second half (courts at the same
  // venue are usually created together).
  const orderedTeams = isRandomized ? sportTeams : seeds
  const teamDivOf = (teamId: string): 0 | 1 => {
    if (teamDiv[teamId] !== undefined) return teamDiv[teamId]
    const idx = orderedTeams.findIndex(t => t.id === teamId)
    return (idx >= 0 ? idx % 2 : 0) as 0 | 1
  }
  const courtDivOf = (locId: string): 0 | 1 => {
    if (courtDiv[locId] !== undefined) return courtDiv[locId]
    const idx = locations.findIndex(l => l.id === locId)
    return idx >= 0 && idx >= Math.ceil(locations.length / 2) ? 1 : 0
  }

  const divisionSpecs: DivisionSpec[] = ([0, 1] as const).map(i => ({
    name: divNames[i].trim() || `Division ${i + 1}`,
    team_ids: orderedTeams.filter(t => teamDivOf(t.id) === i).map(t => t.id),
    location_ids: locations.filter(l => courtDivOf(l.id) === i).map(l => l.id),
  }))
  const splitValid = divisionSpecs.every(d => d.team_ids.length >= 2)

  const genMutation = useMutation({
    mutationFn: () => {
      if (isPool) return generateBracket(sportId!, [], false, undefined, poolSpecs)
      if (splitEnabled) return generateBracket(sportId!, [], false, divisionSpecs)
      return isRandomized
        ? generateBracket(sportId!, sportTeams.map(t => t.id), false)
        : generateBracket(sportId!, seeds.map(t => t.id), false)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['matches'] })
      qc.invalidateQueries({ queryKey: ['brackets'] })
      setGenError(null)
    },
    onError: (e) => setGenError(e instanceof Error ? e.message : 'Failed to generate bracket'),
  })

  const bracketPhaseMutation = useMutation({
    mutationFn: () => generateBracket(sportId!, advancing, false),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['matches'] })
      qc.invalidateQueries({ queryKey: ['brackets'] })
      setGenError(null)
    },
    onError: (e) => setGenError(e instanceof Error ? e.message : 'Failed to generate bracket phase'),
  })

  const resetMutation = useMutation({
    mutationFn: () => resetBrackets(sportId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brackets'] })
      qc.invalidateQueries({ queryKey: ['matches'] })
      setGenError(null)
    },
    onError: (e) => setGenError(e instanceof Error ? e.message : 'Failed to reset brackets'),
  })

  const patchMutation = useMutation({
    mutationFn: ({ matchId, scheduledAt }: { matchId: string; scheduledAt: string }) =>
      patchMatch(matchId, { scheduled_at: scheduledAt }),
    onSuccess: (_, { matchId }) => {
      qc.invalidateQueries({ queryKey: ['matches'] })
      setPendingTimes(prev => { const n = { ...prev }; delete n[matchId]; return n })
    },
    onError: (e) => setPatchError(e instanceof Error ? e.message : 'Failed to save time'),
  })

  const sortedLocations = useMemo(
    () => [...locations].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    ),
    [locations],
  )

  async function handleBulkGenerate() {
    const prefix = bulkPrefix.trim()
    if (!prefix || bulkCount < 1) return
    setBulkGenerating(true)
    setCourtError(null)
    try {
      const existing = new Set(locations.map(l => l.name))
      for (let i = 1; i <= bulkCount; i++) {
        const name = `${prefix} ${i}`
        if (!existing.has(name)) await createLocation(sportId!, name)
      }
      qc.invalidateQueries({ queryKey: ['locations', sportId] })
    } catch (e) {
      setCourtError(e instanceof Error ? e.message : 'Failed to generate courts')
    } finally {
      setBulkGenerating(false)
    }
  }

  function move(idx: number, dir: -1 | 1) {
    const next = [...seeds]
    const swap = idx + dir
    if (swap < 0 || swap >= next.length) return
    ;[next[idx], next[swap]] = [next[swap], next[idx]]
    setSeeds(next)
  }

  function moveAdvancing(idx: number, dir: -1 | 1) {
    const next = [...advancing]
    const swap = idx + dir
    if (swap < 0 || swap >= next.length) return
    ;[next[idx], next[swap]] = [next[swap], next[idx]]
    setAdvOverride(next)
  }

  function addCourt() {
    const name = newCourtName.trim()
    if (!name) return
    setCourtError(null)
    createCourtMutation.mutate(name)
  }

  function handleReset() {
    if (!window.confirm(`Reset all brackets for ${sport?.name}? This will delete all matches and cannot be undone.`)) return
    resetMutation.mutate()
  }

  if (sportsLoading) {
    return (
      <div className="p-4 mt-2 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-gray-200 animate-pulse" />
        ))}
      </div>
    )
  }

  if (!sport) return <Navigate to="/manage/brackets" replace />

  if (sport.scoring_mode === 'donation_count') {
    return (
      <DonationSportConfig
        sportId={sportId!}
        sportName={sport.name}
        scheduleStart={sport.schedule_start}
        scheduleEnd={sport.schedule_end}
        locations={sortedLocations}
      />
    )
  }

  const canGenerate = GENERATABLE.has(sport.bracket_type)

  return (
    <div className="p-4 mt-2 space-y-5">
      {/* Header */}
      <div>
        <BackLink to="/manage/brackets" label="Matches" />
        <h2 className="text-xl font-bold text-slate-800">{sport.name}</h2>
        <p className="text-xs text-gray-400 mt-0.5">{sport.bracket_type.replace(/_/g, ' ')} · {sportTeams.length} team{sportTeams.length !== 1 ? 's' : ''}</p>
      </div>

      {/* Schedule Config */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-4 space-y-3">
        <SectionHeading>Scheduling</SectionHeading>
        <label className="space-y-1 block">
          <span className="text-xs text-gray-400">Start time</span>
          <input
            type="datetime-local"
            value={effectiveStart}
            onChange={e => setConfigStart(e.target.value)}
            className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white text-slate-700"
          />
        </label>
        <label className="space-y-1 block">
          <span className="text-xs text-gray-400">Match duration (min)</span>
          <input
            type="number"
            min={5}
            value={effectiveDuration}
            onChange={e => setConfigDuration(Number(e.target.value))}
            className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white text-slate-700"
          />
        </label>
        {configError && <p className="text-sm text-red-600">{configError}</p>}
        <button
          onClick={() => configMutation.mutate()}
          disabled={configMutation.isPending}
          className="w-full py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {configMutation.isPending ? 'Saving…' : configMutation.isSuccess ? 'Saved' : 'Save'}
        </button>
      </div>

      {/* Courts */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-4 space-y-3">
        <SectionHeading>Courts</SectionHeading>

        {/* Chip grid */}
        {sortedLocations.length === 0 ? (
          <p className="text-sm text-slate-400 italic">No courts defined — matches will be unassigned.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {sortedLocations.map(loc => (
              <div key={loc.id} className="flex items-center gap-1.5 bg-gray-100 border border-gray-200 rounded-lg px-2.5 py-1.5">
                <span className="text-sm text-slate-700">{loc.name}</span>
                <button
                  onClick={() => deleteCourtMutation.mutate(loc.id)}
                  disabled={deleteCourtMutation.isPending}
                  className="text-gray-400 hover:text-red-500 disabled:opacity-40 leading-none text-base"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Bulk generate */}
        <div>
          <p className="text-xs text-gray-400 mb-1.5">Generate courts</p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Prefix (e.g. Ct)"
              value={bulkPrefix}
              onChange={e => setBulkPrefix(e.target.value)}
              className="w-28 text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white text-slate-700"
            />
            <input
              type="number"
              min={1}
              max={100}
              value={bulkCount}
              onChange={e => setBulkCount(Math.max(1, Number(e.target.value)))}
              className="w-20 text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white text-slate-700"
            />
            <button
              onClick={handleBulkGenerate}
              disabled={bulkGenerating || !bulkPrefix.trim()}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 shrink-0"
            >
              {bulkGenerating ? 'Generating…' : 'Generate'}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Creates "{bulkPrefix.trim() || 'Ct'} 1" through "{bulkPrefix.trim() || 'Ct'} {bulkCount}" — skips any that already exist.
          </p>
        </div>

        {/* Single add */}
        <div>
          <p className="text-xs text-gray-400 mb-1.5">Add one</p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="e.g. Court 1"
              value={newCourtName}
              onChange={e => setNewCourtName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addCourt()}
              className="flex-1 text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white text-slate-700"
            />
            <button
              onClick={addCourt}
              disabled={!newCourtName.trim() || createCourtMutation.isPending}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 shrink-0"
            >
              Add
            </button>
          </div>
        </div>

        {courtError && <p className="text-sm text-red-600">{courtError}</p>}
      </div>

      {/* Generate / Setup */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-4 space-y-3">
        <div className="flex items-center gap-2">
          <SectionHeading>{canGenerate ? 'Generate Bracket' : 'Bracket Setup'}</SectionHeading>
          {canGenerate && alreadyGenerated && (
            <span className="mb-2 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
              Generated
            </span>
          )}
        </div>

        {!canGenerate ? (
          <p className="text-sm text-slate-500 italic">
            This sport uses manual entry. Create matches directly in the schedule.
          </p>
        ) : alreadyGenerated ? (
          <p className="text-sm text-slate-500">
            {isPool ? 'Pool play has been generated.' : 'Bracket has been generated.'} To regenerate, reset all brackets &amp; matches below first.
          </p>
        ) : isHeats ? (
          <p className="text-sm text-slate-500 italic">
            This will create one entry per team. Each team's ref will record their time separately.
          </p>
        ) : isPool ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-500 italic">
              Each pool plays a round robin — every team plays every other team in its pool once.
              {isPoolBracket && ' After pool play, the top teams advance to a single-elimination bracket.'}
            </p>

            <label className="space-y-1 block">
              <span className="text-xs text-gray-400">Number of pools</span>
              <input
                type="number"
                min={1}
                max={Math.floor(sportTeams.length / 2) || 1}
                value={effectivePoolCount}
                onChange={e => setPoolCount(Number(e.target.value))}
                className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white text-slate-700"
              />
            </label>

            <PoolBuckets
              poolCount={effectivePoolCount}
              seeds={seeds}
              locations={sortedLocations}
              teamPoolOf={teamPoolOf}
              courtPoolOf={courtPoolOf}
              companyMap={companyMap}
              onMoveTeam={(teamId, pool) => setTeamPool(prev => ({ ...prev, [teamId]: pool }))}
              onMoveCourt={(locId, pool) => setCourtPool(prev => ({ ...prev, [locId]: pool }))}
            />

            {!poolsValid && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Each pool needs at least 2 teams.
              </p>
            )}
          </div>
        ) : (
          <>
            {isRandomized && (
              <p className="text-sm text-slate-500 italic">
                {sport.name} matchups are randomized automatically.
                {locations.length > 0
                  ? ` Matches will be distributed across ${locations.length} court${locations.length !== 1 ? 's' : ''}.`
                  : ' Add courts above to enable court assignment and scheduling.'}
              </p>
            )}

            {isElimination && sportTeams.length >= 4 && (
              <label className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2.5 border border-gray-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={splitEnabled}
                  onChange={e => setSplitEnabled(e.target.checked)}
                  className="accent-blue-600"
                />
                <span className="text-sm text-slate-700">
                  Split into two divisions
                  <span className="block text-xs text-gray-400">
                    Separate brackets per venue — the two division winners meet in a championship match.
                  </span>
                </span>
              </label>
            )}

            {splitEnabled ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {([0, 1] as const).map(i => (
                    <label key={i} className="space-y-1 block">
                      <span className="text-xs text-gray-400">Division {i + 1} name</span>
                      <input
                        type="text"
                        value={divNames[i]}
                        onChange={e => setDivNames(prev => (i === 0 ? [e.target.value, prev[1]] : [prev[0], e.target.value]))}
                        placeholder={`Division ${i + 1}`}
                        className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white text-slate-700"
                      />
                    </label>
                  ))}
                </div>

                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Teams</p>
                <div className="space-y-1">
                  {orderedTeams.map((team, idx) => (
                    <div key={team.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
                      {!isRandomized && <span className="text-xs font-bold text-gray-400 w-5 text-center">{idx + 1}</span>}
                      <span className="flex-1 text-sm text-slate-700 truncate min-w-0">
                        {companyMap[team.company_id]?.name ?? '—'}
                        {team.name && <span className="text-gray-400"> · {team.name}</span>}
                      </span>
                      <DivToggle
                        value={teamDivOf(team.id)}
                        names={divNames}
                        onChange={v => setTeamDiv(prev => ({ ...prev, [team.id]: v }))}
                      />
                      {!isRandomized && (
                        <div className="flex gap-0.5">
                          <button onClick={() => move(idx, -1)} disabled={idx === 0} className="p-1 text-gray-400 hover:text-slate-700 disabled:opacity-20"><UpIcon /></button>
                          <button onClick={() => move(idx, 1)} disabled={idx === seeds.length - 1} className="p-1 text-gray-400 hover:text-slate-700 disabled:opacity-20"><DownIcon /></button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Courts</p>
                {locations.length === 0 ? (
                  <p className="text-sm text-slate-400 italic">No courts defined — add courts above to assign them to divisions.</p>
                ) : (
                  <div className="space-y-1">
                    {locations.map(loc => (
                      <div key={loc.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
                        <span className="flex-1 text-sm text-slate-700 truncate min-w-0">{loc.name}</span>
                        <DivToggle
                          value={courtDivOf(loc.id)}
                          names={divNames}
                          onChange={v => setCourtDiv(prev => ({ ...prev, [loc.id]: v }))}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {!splitValid && (
                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Each division needs at least 2 teams.
                  </p>
                )}
              </div>
            ) : !isRandomized ? (
              <>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Seed order</p>
                <div className="space-y-1">
                  {seeds.map((team, idx) => (
                    <div key={team.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
                      <span className="text-xs font-bold text-gray-400 w-5 text-center">{idx + 1}</span>
                      <span className="flex-1 text-sm text-slate-700">
                        {companyMap[team.company_id]?.name ?? '—'}
                        {team.name && <span className="text-gray-400"> · {team.name}</span>}
                      </span>
                      <div className="flex gap-0.5">
                        <button onClick={() => move(idx, -1)} disabled={idx === 0} className="p-1 text-gray-400 hover:text-slate-700 disabled:opacity-20"><UpIcon /></button>
                        <button onClick={() => move(idx, 1)} disabled={idx === seeds.length - 1} className="p-1 text-gray-400 hover:text-slate-700 disabled:opacity-20"><DownIcon /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </>
        )}

        {canGenerate && !alreadyGenerated && (
          <>
            {genError && <p className="text-sm text-red-600">{genError}</p>}
            <button
              onClick={() => genMutation.mutate()}
              disabled={genMutation.isPending || sportTeams.length < 2 || (splitEnabled && !splitValid) || (isPool && !poolsValid)}
              className="w-full py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {genMutation.isPending ? 'Generating…' : isHeats ? 'Generate Entries' : isPool ? 'Generate Pool Play' : splitEnabled ? 'Generate Division Brackets' : 'Generate Bracket'}
            </button>
          </>
        )}
      </div>

      {/* Bracket Phase (pool_bracket: seeded from pool standings) */}
      {showBracketPhaseCard && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <SectionHeading>Generate Bracket Phase</SectionHeading>
            {hasBracketPhase && (
              <span className="mb-2 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full shrink-0">
                Additional bracket
              </span>
            )}
          </div>

          {pendingPoolCount > 0 && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {pendingPoolCount} pool match{pendingPoolCount !== 1 ? 'es are' : ' is'} still pending.
              Standings may change — enter all results before generating the bracket.
            </p>
          )}

          <label className="space-y-1 block">
            <span className="text-xs text-gray-400">Teams advancing per pool</span>
            <input
              type="number"
              min={1}
              value={advanceCount}
              onChange={e => { setAdvanceCount(Math.max(1, Number(e.target.value))); setAdvOverride(null) }}
              className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white text-slate-700"
            />
          </label>

          {cutLineTies.length > 0 && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Tied records at the cut line in {cutLineTies.join(', ')}. Check score sheets and
              swap teams below (or adjust the order) before generating.
            </p>
          )}

          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Bracket seeds</p>
          {advancing.length === 0 ? (
            <p className="text-sm text-slate-400 italic">No standings yet — enter pool results first.</p>
          ) : (
            <div className="space-y-1">
              {advancing.map((teamId, idx) => {
                const record = teamRecord[teamId]
                return (
                  <div key={teamId} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
                    <span className="text-xs font-bold text-gray-400 w-5 text-center">{idx + 1}</span>
                    <span className="flex-1 text-sm text-slate-700 truncate min-w-0">
                      {teamLabel(teamId, teamMap, companyMap)}
                    </span>
                    {record && (
                      <span className="text-xs text-gray-400 shrink-0">
                        {record.wins}–{record.losses}
                        {sport?.name === 'Pickleball' && (
                          <> · {record.game_wins}GW · {record.point_diff >= 0 ? '+' : ''}{record.point_diff}PD</>
                        )}
                      </span>
                    )}
                    <div className="flex gap-0.5">
                      <button onClick={() => moveAdvancing(idx, -1)} disabled={idx === 0} className="p-1 text-gray-400 hover:text-slate-700 disabled:opacity-20"><UpIcon /></button>
                      <button onClick={() => moveAdvancing(idx, 1)} disabled={idx === advancing.length - 1} className="p-1 text-gray-400 hover:text-slate-700 disabled:opacity-20"><DownIcon /></button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {genError && <p className="text-sm text-red-600">{genError}</p>}
          <button
            onClick={() => bracketPhaseMutation.mutate()}
            disabled={bracketPhaseMutation.isPending || advancing.length < 2}
            className="w-full py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {bracketPhaseMutation.isPending ? 'Generating…' : 'Generate Bracket Phase'}
          </button>
        </div>
      )}

      {/* Adjust Match Times */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <button
          onClick={() => setScheduleOpen(v => !v)}
          className="w-full px-4 py-4 flex items-center justify-between text-left"
        >
          <SectionHeading>Manually Adjust Match Times</SectionHeading>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`shrink-0 text-gray-400 transition-transform ${scheduleOpen ? 'rotate-180' : ''}`}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {scheduleOpen && (
          <div className="border-t border-gray-100 px-4 py-3 space-y-3">
            {matches.length === 0 ? (
              <p className="text-sm text-slate-500 italic text-center py-2">
                No matches yet. Generate a bracket first.
              </p>
            ) : (
              <>
                {patchError && <p className="text-sm text-red-600">{patchError}</p>}
                {matchesByRound.map(([roundKey, roundMatches]) => (
                  <div key={roundKey} className="space-y-1">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      {roundKey === 'unscheduled' ? 'Unscheduled' : `Round ${roundKey}`}
                    </p>
                    {roundMatches.map(match => {
                      const label = isHeats
                        ? teamLabel(match.home_team_id, teamMap, companyMap)
                        : `${teamLabel(match.home_team_id, teamMap, companyMap)} vs ${teamLabel(match.away_team_id, teamMap, companyMap)}`
                      const inputVal = pendingTimes[match.id] ?? toDatetimeLocal(match.scheduled_at)
                      return (
                        <div key={match.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
                          <span className="flex-1 text-sm text-slate-700 truncate min-w-0">
                            {label}
                            {match.locations?.name && (
                              <span className="text-gray-400"> · {match.locations.name}</span>
                            )}
                          </span>
                          <input
                            type="datetime-local"
                            value={inputVal}
                            onChange={e => setPendingTimes(prev => ({ ...prev, [match.id]: e.target.value }))}
                            className="text-sm border border-gray-200 rounded-lg px-2 py-1 text-slate-700 shrink-0"
                          />
                          <button
                            onClick={() => {
                              if (!inputVal) return
                              setPatchError(null)
                              patchMutation.mutate({ matchId: match.id, scheduledAt: new Date(inputVal).toISOString() })
                            }}
                            disabled={patchMutation.isPending}
                            className="text-sm font-medium text-blue-600 disabled:text-gray-300 shrink-0"
                          >
                            Set
                          </button>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Danger zone */}
      <div className="bg-white rounded-xl border border-red-100 shadow-sm px-4 py-4 space-y-3">
        <SectionHeading>Danger Zone</SectionHeading>
        {resetMutation.isError && <p className="text-sm text-red-600">{genError}</p>}
        <button
          onClick={handleReset}
          disabled={resetMutation.isPending}
          className="w-full py-2 rounded-lg border border-red-200 text-red-600 font-semibold text-sm hover:bg-red-50 disabled:opacity-50"
        >
          {resetMutation.isPending ? 'Resetting…' : 'Reset All Brackets & Matches'}
        </button>
      </div>
    </div>
  )
}
