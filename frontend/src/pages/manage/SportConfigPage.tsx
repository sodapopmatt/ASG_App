import { useState, useMemo, useRef, useEffect } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import BackLink from '../../components/BackLink'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSports, generateBracket, resetBrackets, updateSport, getStandings, type DivisionSpec, type PoolSpec, type HeatSpec } from '../../api/sports'
import { getMatches, patchMatch } from '../../api/matches'
import { getTeams } from '../../api/teams'
import { getCompanies } from '../../api/companies'
import { getLocations, createLocation, deleteLocation, updateLocation } from '../../api/locations'
import { getBrackets } from '../../api/brackets'
import type { Match, Team, Company, Location as LocationRow } from '../../types'

const GENERATABLE = new Set(['single_elimination', 'double_elimination', 'heats', 'pool_bracket', 'pool_swiss'])

const poolLabel = (i: number): string => {
  let label = ''
  let n = i
  do {
    label = String.fromCharCode(65 + (n % 26)) + label
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return label
}
const poolName = (i: number) => `Pool ${poolLabel(i)}`

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
        {locations[0]?.name && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Saved:</span>
            <span className="text-sm text-gray-400 bg-gray-100 rounded-lg px-2.5 py-1">{locations[0].name}</span>
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={locationName}
            onChange={e => setLocationName(e.target.value)}
            placeholder="e.g. Main Lobby"
            className="flex-1 text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white text-slate-700"
          />
          <button
            onClick={() => locationMutation.mutate()}
            disabled={locationMutation.isPending}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 shrink-0"
          >
            {locationMutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
        {locationError && <p className="text-sm text-red-600">{locationError}</p>}
      </div>
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{children}</p>
  )
}

function CollapsibleSection({
  title,
  children,
  badge,
  borderColor = 'border-gray-100',
  defaultOpen = true,
}: {
  title: React.ReactNode
  children: React.ReactNode
  badge?: React.ReactNode
  borderColor?: string
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`bg-white rounded-xl border ${borderColor} shadow-sm overflow-hidden`}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full px-4 py-4 flex items-center justify-between text-left gap-2"
      >
        <div className="flex items-center gap-2 min-w-0">
          <SectionHeading>{title}</SectionHeading>
          {badge}
        </div>
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-gray-100 px-4 py-4 space-y-3">
          {children}
        </div>
      )}
    </div>
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
const UNASSIGNED_POOL = -2

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

function PoolBucketRow({
  poolIndex,
  poolCount,
  seeds,
  locations,
  teamPoolOf,
  courtPoolOf,
  companyMap,
  cohortMode,
  onMoveTeam,
  onMoveCourt,
  onUnassignTeam,
  isOpen,
  onToggle,
}: {
  poolIndex: number
  poolCount: number
  seeds: Team[]
  locations: { id: string; name: string; sport_id: string }[]
  teamPoolOf: (id: string) => number
  courtPoolOf: (id: string) => number
  companyMap: Record<string, Company>
  cohortMode: boolean
  onMoveTeam: (teamId: string, pool: number) => void
  onMoveCourt: (locId: string, pool: number) => void
  onUnassignTeam: (teamId: string) => void
  isOpen: boolean
  onToggle: () => void
}) {
  const [search, setSearch] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!dropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdownOpen])

  const poolTeams = seeds.filter(t => teamPoolOf(t.id) === poolIndex)
  const poolCourts = locations.filter(l => courtPoolOf(l.id) === poolIndex)

  const q = search.trim().toLowerCase()
  const searchResults = q.length > 0
    ? seeds.filter(team => {
        const co = companyMap[team.company_id]
        return (
          (co?.name ?? '').toLowerCase().includes(q) ||
          (co?.short_id ?? '').toLowerCase().includes(q) ||
          (team.name ?? '').toLowerCase().includes(q)
        )
      })
    : []

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 text-left hover:bg-gray-100 transition-colors"
      >
        <span className="text-sm font-semibold text-slate-800">{poolName(poolIndex)}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">{poolTeams.length} teams</span>
          {!cohortMode && poolCourts.length > 0 && (
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
        <div className="px-3 py-2.5 space-y-2.5 bg-white">
          {/* Team search */}
          <div ref={searchRef} className="relative">
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setDropdownOpen(true) }}
              onFocus={() => { if (search) setDropdownOpen(true) }}
              placeholder="Search by team name or company ID…"
              className="w-full text-sm rounded-lg border border-gray-200 px-3 py-1.5 bg-white text-slate-700 placeholder-gray-400 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
            />
            {dropdownOpen && searchResults.length > 0 && (
              <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
                {searchResults.map(team => {
                  const co = companyMap[team.company_id]
                  const inThisPool = teamPoolOf(team.id) === poolIndex
                  const currentPool = teamPoolOf(team.id)
                  const currentLabel = currentPool === UNASSIGNED_POOL
                    ? 'Unassigned'
                    : inThisPool
                      ? '✓ in this pool'
                      : poolName(currentPool)
                  return (
                    <button
                      key={team.id}
                      onMouseDown={e => {
                        e.preventDefault()
                        if (!inThisPool) onMoveTeam(team.id, poolIndex)
                        setSearch('')
                        setDropdownOpen(false)
                      }}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between transition-colors ${
                        inThisPool ? 'text-gray-400 cursor-default' : 'text-slate-700 hover:bg-gray-50 cursor-pointer'
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        {co?.name ?? '—'}{team.name ? ` · ${team.name}` : ''}
                        {co?.short_id && (
                          <span className="text-[10px] font-mono text-gray-400 bg-gray-100 rounded px-1">{co.short_id}</span>
                        )}
                      </span>
                      <span className="text-xs text-gray-400 shrink-0 ml-2">{currentLabel}</span>
                    </button>
                  )
                })}
              </div>
            )}
            {dropdownOpen && q.length > 0 && searchResults.length === 0 && (
              <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-sm text-gray-400">
                No teams match "{search}"
              </div>
            )}
          </div>

          {/* Team chips */}
          <div className="flex flex-wrap gap-1.5">
            {poolTeams.map(team => (
              <div key={team.id} className="flex items-center gap-1 bg-gray-100 rounded-md px-2 py-1 text-xs text-slate-700">
                <span>{companyMap[team.company_id]?.short_id ?? companyMap[team.company_id]?.name ?? '—'}{team.name ? ` · ${team.name}` : ''}</span>
                <select
                  value={poolIndex}
                  onChange={e => onMoveTeam(team.id, Number(e.target.value))}
                  className="ml-1 text-[10px] bg-transparent text-gray-400 cursor-pointer border-none outline-none"
                >
                  {Array.from({ length: poolCount }, (_, j) => (
                    <option key={j} value={j}>{poolName(j)}</option>
                  ))}
                </select>
                <button
                  onClick={() => onUnassignTeam(team.id)}
                  className="ml-0.5 text-gray-400 hover:text-red-500 transition-colors leading-none"
                  title="Remove from pool"
                >
                  ×
                </button>
              </div>
            ))}
            {poolTeams.length === 0 && <p className="text-xs text-gray-400 italic">No teams assigned</p>}
          </div>

          {!cohortMode && locations.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1 border-t border-gray-100">
              {poolCourts.map(loc => (
                <CourtPill key={loc.id} loc={loc} currentPool={poolIndex} poolCount={poolCount} onMoveCourt={onMoveCourt} />
              ))}
            </div>
          )}
        </div>
      )}
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
  cohortMode,
  onMoveTeam,
  onMoveCourt,
  onUnassignTeam,
}: {
  poolCount: number
  seeds: Team[]
  locations: { id: string; name: string; sport_id: string }[]
  teamPoolOf: (id: string) => number
  courtPoolOf: (id: string) => number
  companyMap: Record<string, Company>
  cohortMode: boolean
  onMoveTeam: (teamId: string, pool: number) => void
  onMoveCourt: (locId: string, pool: number) => void
  onUnassignTeam: (teamId: string) => void
}) {
  const [openPool, setOpenPool] = useState<number | null>(0)

  const sharedCourts = locations.filter(l => courtPoolOf(l.id) === SHARED_COURT_VALUE)
  const unassignedTeams = seeds.filter(t => teamPoolOf(t.id) === UNASSIGNED_POOL)

  return (
    <div className="space-y-2">
      {/* Cohort mode: fields auto-distributed, no manual assignment needed */}
      {cohortMode ? (
        <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2.5">
          <p className="text-xs font-semibold text-blue-600 mb-0.5">Fields auto-distributed</p>
          <p className="text-xs text-blue-500">
            {locations.length} field{locations.length !== 1 ? 's' : ''} will be automatically split into pairs and rotated across pools each round. No manual assignment needed.
          </p>
        </div>
      ) : (
        /* Shared courts (manual assignment mode) */
        sharedCourts.length > 0 && (
          <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2.5">
            <p className="text-xs font-semibold text-blue-600 mb-1.5">Shared courts (all pools)</p>
            <div className="flex flex-wrap gap-1.5">
              {sharedCourts.map(loc => (
                <CourtPill key={loc.id} loc={loc} currentPool={SHARED_COURT_VALUE} poolCount={poolCount} onMoveCourt={onMoveCourt} />
              ))}
            </div>
          </div>
        )
      )}

      {/* Per-pool accordions */}
      {Array.from({ length: poolCount }, (_, i) => (
        <PoolBucketRow
          key={i}
          poolIndex={i}
          poolCount={poolCount}
          seeds={seeds}
          locations={locations}
          teamPoolOf={teamPoolOf}
          courtPoolOf={courtPoolOf}
          companyMap={companyMap}
          cohortMode={cohortMode}
          onMoveTeam={onMoveTeam}
          onMoveCourt={onMoveCourt}
          onUnassignTeam={onUnassignTeam}
          isOpen={openPool === i}
          onToggle={() => setOpenPool(openPool === i ? null : i)}
        />
      ))}

      {/* Unassigned teams tray */}
      {unassignedTeams.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5">
          <p className="text-xs font-semibold text-amber-700 mb-1.5">Unassigned — assign to a pool to continue</p>
          <div className="flex flex-wrap gap-1.5">
            {unassignedTeams.map(team => {
              const co = companyMap[team.company_id]
              return (
                <div key={team.id} className="flex items-center gap-1 bg-white border border-amber-200 rounded-md px-2 py-1 text-xs text-slate-700">
                  <span>{co?.short_id ?? co?.name ?? '—'}{team.name ? ` · ${team.name}` : ''}</span>
                  <select
                    value=""
                    onChange={e => { if (e.target.value !== '') onMoveTeam(team.id, Number(e.target.value)) }}
                    className="ml-1 text-[10px] bg-transparent text-amber-600 cursor-pointer border-none outline-none"
                  >
                    <option value="" disabled>Move to…</option>
                    {Array.from({ length: poolCount }, (_, j) => (
                      <option key={j} value={j}>{poolName(j)}</option>
                    ))}
                  </select>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function HeatLocationEditor({
  sportId,
  locations,
  onSuccess,
}: {
  sportId: string
  locations: LocationRow[]
  onSuccess: () => void
}) {
  const [name, setName] = useState(locations[0]?.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [, setSaved] = useState(false)

  useEffect(() => { setName(locations[0]?.name ?? '') }, [locations])

  const mutation = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim()
      const [first, ...rest] = locations
      if (!trimmed) {
        for (const loc of locations) await deleteLocation(loc.id)
        return
      }
      if (first) {
        if (first.name !== trimmed) await updateLocation(first.id, trimmed)
      } else {
        await createLocation(sportId, trimmed)
      }
      for (const extra of rest) await deleteLocation(extra.id)
    },
    onSuccess: () => {
      onSuccess()
      setError(null)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
    onError: e => setError(e instanceof Error ? e.message : 'Failed to save'),
  })

  const savedName = locations[0]?.name

  return (
    <div className="space-y-3">
      {savedName && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Saved:</span>
          <span className="text-sm text-gray-400 bg-gray-100 rounded-lg px-2.5 py-1">{savedName}</span>
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Track"
          className="flex-1 text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white text-slate-700"
        />
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 shrink-0"
        >
          {mutation.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
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
  const [configVenue, setConfigVenue] = useState<string | null>(null)
  const [configAssumedCourts, setConfigAssumedCourts] = useState<number | null>(null)

  // Courts state
  const [newCourtName, setNewCourtName] = useState('')
  const [courtError, setCourtError] = useState<string | null>(null)
  const [bulkCount, setBulkCount] = useState<number | ''>('')
  const [bulkGenerating, setBulkGenerating] = useState(false)
  const [labelInput, setLabelInput] = useState<string | null>(null)

  // Generate bracket state
  const [seeds, setSeeds] = useState<Team[]>([])
  const [seedsInit, setSeedsInit] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [numHeats, setNumHeats] = useState(1)

  useEffect(() => {
    if (sport?.name === 'Relay Race') setNumHeats(7)
    else setNumHeats(1)
  }, [sport?.name])

  // Division split state (elimination sports across two venues)
  const [splitEnabled, setSplitEnabled] = useState(false)
  const [divNames, setDivNames] = useState<[string, string]>(['Main Gym', 'North Gym'])
  const [teamDiv, setTeamDiv] = useState<Record<string, 0 | 1>>({})
  const [courtDiv, setCourtDiv] = useState<Record<string, 0 | 1>>({})

  // Pool play state — restored from localStorage only if the user explicitly saved groups
  const [poolCount, setPoolCount] = useState<number | null>(() => {
    try { return JSON.parse(localStorage.getItem(`pool-count-${sportId}`) ?? 'null') } catch { return null }
  })
  const [teamPool, setTeamPool] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(`pool-teams-${sportId}`) ?? 'null') ?? {} } catch { return {} }
  })
  const [courtPool, setCourtPool] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(`pool-courts-${sportId}`) ?? 'null') ?? {} } catch { return {} }
  })
  const [groupsSavedFeedback, setGroupsSavedFeedback] = useState(false)

  function saveGroups() {
    if (!sportId) return
    localStorage.setItem(`pool-count-${sportId}`, JSON.stringify(poolCount))
    localStorage.setItem(`pool-teams-${sportId}`, JSON.stringify(teamPool))
    localStorage.setItem(`pool-courts-${sportId}`, JSON.stringify(courtPool))
    setGroupsSavedFeedback(true)
    setTimeout(() => setGroupsSavedFeedback(false), 2000)
  }

  // Bracket phase state (pool_bracket, after pool play)
  const advanceCount = 2
  const [advOverride, setAdvOverride] = useState<string[] | null>(null)

  // Schedule patch state
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
  const effectiveVenue = configVenue ?? sport?.venue ?? ''
  const effectiveAssumedCourts = configAssumedCourts ?? sport?.assumed_courts_per_group ?? 1

  const configMutation = useMutation({
    mutationFn: () => updateSport(sportId!, {
      match_duration_minutes: effectiveDuration,
      schedule_start: effectiveStart ? new Date(effectiveStart).toISOString() : null,
      venue: effectiveVenue.trim() || null,
      assumed_courts_per_group: effectiveAssumedCourts > 0 ? effectiveAssumedCourts : null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sports'] })
      setConfigError(null)
    },
    onError: (e) => setConfigError(e instanceof Error ? e.message : 'Failed to save config'),
  })

  const createCourtMutation = useMutation({
    mutationFn: (courtNumberOrName: number | string) => createLocation(sportId!, courtNumberOrName),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['locations', sportId] })
      setNewCourtName('')
      setCourtError(null)
    },
    onError: (e) => setCourtError(e instanceof Error ? e.message : 'Failed to add court'),
  })

  const labelMutation = useMutation({
    mutationFn: (label: string) => updateSport(sportId!, { location_label: label }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sports'] })
      setLabelInput(null)
    },
    onError: (e) => setCourtError(e instanceof Error ? e.message : 'Failed to update label'),
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
  const isPoolSwiss = sport?.bracket_type === 'pool_swiss'

  const alreadyGenerated = matches.length > 0

  // â”€â”€ Pool play setup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const effectivePoolCount = Math.max(1, Math.min(
    poolCount ?? Math.ceil(sportTeams.length / 8),
    Math.floor(sportTeams.length / 2) || 1,
  ))

  // Snake distribution over seed order keeps pools balanced by strength
  const teamPoolOf = (teamId: string): number => {
    const override = teamPool[teamId]
    if (override === UNASSIGNED_POOL) return UNASSIGNED_POOL
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

  // Cohort mode: fewer courts than pools means all courts auto-share and the
  // backend's greedy cohort scheduler handles field pair rotation automatically.
  const cohortMode = locations.length > 0 && locations.length < effectivePoolCount

  const poolSpecs: PoolSpec[] = Array.from({ length: effectivePoolCount }, (_, i) => ({
    name: poolName(i),
    team_ids: seeds.filter(t => teamPoolOf(t.id) === i).map(t => t.id),
    // Include courts dedicated to this pool AND courts shared across all pools
    location_ids: locations.filter(l => courtPoolOf(l.id) === i || courtPoolOf(l.id) === SHARED_COURT).map(l => l.id),
  }))
  const hasUnassignedTeams = seeds.some(t => teamPoolOf(t.id) === UNASSIGNED_POOL)
  const poolsValid = !hasUnassignedTeams && poolSpecs.every(p => p.team_ids.length >= 2)

  // ── Heats setup (heats sports with multiple heats, e.g. Relay Race) ─────────
  const effectiveNumHeats = Math.max(1, Math.min(numHeats, sportTeams.length))
  const heatSpecs = useMemo((): HeatSpec[] =>
    Array.from({ length: effectiveNumHeats }, (_, i) => ({
      name: `Preliminary Heat ${i + 1}`,
      team_ids: sportTeams.filter((_, ti) => ti % effectiveNumHeats === i).map(t => t.id),
      phase: 'heats',
    })),
    [sportTeams, effectiveNumHeats],
  )

  // Custom points scale for multi-phase heats (relay race scoring tiers)
  const RELAY_RACE_SCALE: Record<string, number> = {
    '1': 40, '2': 38, '3': 36, '4': 34, '5': 32, '6': 30,
    '7': 22, '8': 22, '9': 22, '10': 22, '11': 22, '12': 22,
    '13': 12, '14': 12, '15': 12, '16': 12, '17': 12, '18': 12,
    'default': 4,
  }

  // ── Bracket phase (pool_bracket only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
          inside.played > 0 &&
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
    mutationFn: async () => {
      if (isHeats && effectiveNumHeats > 1) {
        await generateBracket(sportId!, [], false, undefined, undefined, heatSpecs)
        if (sport?.name === 'Relay Race') {
          await updateSport(sportId!, { points_scale: RELAY_RACE_SCALE })
        }
        return
      }
      if (isPool) return generateBracket(sportId!, [], false, undefined, poolSpecs)
      if (splitEnabled) return generateBracket(sportId!, [], false, divisionSpecs)
      // Flat heats (Human Pyramid): no seeding order needed — use live sportTeams so
      // newly registered teams are always included, not just those present at page load.
      if (isHeats) return generateBracket(sportId!, sportTeams.map(t => t.id), false)
      return isRandomized
        ? generateBracket(sportId!, sportTeams.map(t => t.id), false)
        : generateBracket(sportId!, seeds.map(t => t.id), false)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['matches'] })
      qc.invalidateQueries({ queryKey: ['brackets'] })
      qc.invalidateQueries({ queryKey: ['sports'] })
      setGenError(null)
      if (isPool && sportId) {
        localStorage.setItem(`pool-count-${sportId}`, JSON.stringify(poolCount))
        localStorage.setItem(`pool-teams-${sportId}`, JSON.stringify(teamPool))
        localStorage.setItem(`pool-courts-${sportId}`, JSON.stringify(courtPool))
      }
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
      qc.invalidateQueries({ queryKey: ['event-points'] })
      qc.invalidateQueries({ queryKey: ['leaderboard'] })
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
    () => [...locations].sort((a, b) => {
      if (a.court_number == null && b.court_number == null) return a.name.localeCompare(b.name)
      if (a.court_number == null) return 1
      if (b.court_number == null) return -1
      return a.court_number - b.court_number
    }),
    [locations],
  )

  async function handleBulkGenerate() {
    const count = Number(bulkCount)
    if (!count || count < 1) return
    setBulkGenerating(true)
    setCourtError(null)
    try {
      const currentLabel = labelInput || sport?.location_label || 'Court'
      if (labelInput !== null && labelInput !== sport?.location_label) {
        await labelMutation.mutateAsync(currentLabel)
      }
      const existing = new Set(locations.map(l => l.court_number).filter(Boolean))
      for (let i = 1; i <= count; i++) {
        if (!existing.has(i)) await createLocation(sportId!, i)
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
    const trimmed = newCourtName.trim()
    if (!trimmed) return
    setCourtError(null)
    const asNumber = Number(trimmed)
    createCourtMutation.mutate(isNaN(asNumber) || trimmed === '' ? trimmed : asNumber)
  }

  function handleRestartPoolPlay() {
    if (!window.confirm(`Reset pool play for ${sport?.name}? Matches will be deleted but your group assignments will be kept.`)) return
    resetMutation.mutate()
  }

  function handleReset() {
    if (!window.confirm(`Reset all brackets for ${sport?.name}? This will delete all matches and cannot be undone.`)) return
    if (sportId) {
      localStorage.removeItem(`pool-count-${sportId}`)
      localStorage.removeItem(`pool-teams-${sportId}`)
      localStorage.removeItem(`pool-courts-${sportId}`)
    }
    setTeamPool({})
    setCourtPool({})
    setPoolCount(null)
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
      <CollapsibleSection title="Scheduling">
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
        <label className="space-y-1 block">
          <span className="text-xs text-gray-400">Venue label (shown on schedule when no court assigned)</span>
          <input
            type="text"
            placeholder='e.g. "Cornhole Area", "Soccer Fields"'
            value={effectiveVenue}
            onChange={e => setConfigVenue(e.target.value)}
            className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white text-slate-700"
          />
        </label>
        {isPool && (
          <label className="space-y-1 block">
            <span className="text-xs text-gray-400">Assumed boards/courts per group (used for scheduling when no courts are assigned)</span>
            <input
              type="number"
              min={1}
              value={effectiveAssumedCourts}
              onChange={e => setConfigAssumedCourts(Number(e.target.value))}
              className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white text-slate-700"
            />
          </label>
        )}
        {configError && <p className="text-sm text-red-600">{configError}</p>}
        <button
          onClick={() => configMutation.mutate()}
          disabled={configMutation.isPending}
          className="w-full py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {configMutation.isPending ? 'Saving…' : configMutation.isSuccess ? 'Saved' : 'Save'}
        </button>
      </CollapsibleSection>

      {/* Courts — hidden for pool_swiss (uses venue label + assumed boards instead) */}
      {!isPoolSwiss && (
      <CollapsibleSection title={isHeats ? 'Location' : 'Courts'}>
        {isHeats ? (
          // Heats sports only ever need one location (e.g. "Track")
          <HeatLocationEditor
            sportId={sportId!}
            locations={sortedLocations}
            onSuccess={() => qc.invalidateQueries({ queryKey: ['locations', sportId] })}
          />
        ) : (
          <>
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

            {/* Single add */}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder='Name or number (e.g. "Main" or 5)'
                value={newCourtName}
                onChange={e => setNewCourtName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCourt()}
                className="flex-1 text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white text-slate-700"
              />
              <button
                onClick={addCourt}
                disabled={newCourtName.trim() === '' || createCourtMutation.isPending}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 shrink-0"
              >
                {createCourtMutation.isPending ? 'Adding…' : 'Add'}
              </button>
            </div>

            {/* Generate numbered */}
            <div>
              <p className="text-xs text-gray-400 mb-1.5">Generate numbered</p>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  placeholder="Ct"
                  value={labelInput ?? ''}
                  onChange={e => setLabelInput(e.target.value)}
                  className="w-24 text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white text-slate-700"
                />
                <span className="text-sm text-gray-400">1 through</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  placeholder="24"
                  value={bulkCount}
                  onChange={e => setBulkCount(e.target.value === '' ? '' : Math.max(1, Number(e.target.value)))}
                  className="w-16 text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white text-slate-700"
                />
                <button
                  onClick={handleBulkGenerate}
                  disabled={bulkGenerating || !bulkCount}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 shrink-0"
                >
                  {bulkGenerating ? 'Generating…' : 'Generate'}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Skips any that already exist.
              </p>
            </div>

            {courtError && <p className="text-sm text-red-600">{courtError}</p>}
          </>
        )}
      </CollapsibleSection>
      )}

      {/* Generate / Setup */}
      <CollapsibleSection
        title={canGenerate ? (isPool ? 'Generate Pool Play' : isHeats ? 'Generate Entries' : 'Generate Bracket') : 'Bracket Setup'}
        badge={canGenerate && alreadyGenerated ? (
          <span className="text-xs font-semibold text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full shrink-0">
            Generated
          </span>
        ) : undefined}
      >

        {!canGenerate ? (
          <p className="text-sm text-slate-500 italic">
            This sport uses manual entry. Create matches directly in the schedule.
          </p>
        ) : alreadyGenerated ? (
          isPool ? (
            <div className="space-y-2">
              <p className="text-sm text-slate-500">Pool play has been generated.</p>
              <button
                onClick={handleRestartPoolPlay}
                disabled={resetMutation.isPending}
                className="w-full py-2 rounded-lg border border-amber-200 text-amber-700 font-semibold text-sm hover:bg-amber-50 disabled:opacity-50"
              >
                {resetMutation.isPending ? 'Resetting…' : 'Restart Pool Play'}
              </button>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              Bracket has been generated. To regenerate, reset all brackets &amp; matches below first.
            </p>
          )
        ) : isHeats ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-500 italic">
              {effectiveNumHeats > 1
                ? 'Teams are distributed into preliminary heats. After entering results, generate semi-finals and the final from the Results page.'
                : 'This will create one entry per team. Each team\'s referee records their time separately.'}
            </p>
            <label className="space-y-1 block">
              <span className="text-xs text-gray-400">Number of preliminary heats</span>
              <input
                type="number"
                min={1}
                max={Math.max(1, sportTeams.length)}
                value={numHeats}
                onChange={e => setNumHeats(Math.max(1, Number(e.target.value)))}
                className="w-24 text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white text-slate-700"
              />
            </label>
            {effectiveNumHeats > 1 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Distribution preview</p>
                {heatSpecs.map((h, i) => (
                  <div key={i} className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-200 flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-600 shrink-0">{h.name}</span>
                    <span className="text-xs text-gray-400">{h.team_ids.length} team{h.team_ids.length !== 1 ? 's' : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
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
              cohortMode={cohortMode}
              onMoveTeam={(teamId, pool) => setTeamPool(prev => ({ ...prev, [teamId]: pool }))}
              onMoveCourt={(locId, pool) => setCourtPool(prev => ({ ...prev, [locId]: pool }))}
              onUnassignTeam={(teamId) => setTeamPool(prev => ({ ...prev, [teamId]: UNASSIGNED_POOL }))}
            />

            {hasUnassignedTeams && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                All teams must be assigned to a pool before generating.
              </p>
            )}
            {!hasUnassignedTeams && !poolsValid && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Each pool needs at least 2 teams.
              </p>
            )}
            <button
              onClick={saveGroups}
              className="w-full py-2 rounded-lg border border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50"
            >
              {groupsSavedFeedback ? 'Groups saved ✓' : 'Save Groups'}
            </button>
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
              {genMutation.isPending ? 'Generating…' : isHeats ? (effectiveNumHeats > 1 ? 'Generate Preliminary Heats' : 'Generate Entries') : isPool ? 'Generate Pool Play' : splitEnabled ? 'Generate Division Brackets' : 'Generate Bracket'}
            </button>
          </>
        )}
      </CollapsibleSection>

      {/* Bracket Phase (pool_bracket: seeded from pool standings) */}
      {showBracketPhaseCard && (
        <CollapsibleSection
          title="Generate Bracket Phase"
          badge={hasBracketPhase ? (
            <span className="text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full shrink-0">
              Additional bracket
            </span>
          ) : undefined}
        >

          {pendingPoolCount > 0 && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {pendingPoolCount} pool match{pendingPoolCount !== 1 ? 'es are' : ' is'} still pending.
              Standings may change — enter all results before generating the bracket.
            </p>
          )}

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
        </CollapsibleSection>
      )}

      {/* Adjust Match Times */}
      <CollapsibleSection title="Manually Adjust Match Times" defaultOpen={false}>
        <>
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
        </>
      </CollapsibleSection>

      {/* Danger zone */}
      <CollapsibleSection title="Danger Zone" borderColor="border-red-100" defaultOpen={false}>
        {resetMutation.isError && <p className="text-sm text-red-600">{genError}</p>}
        <button
          onClick={handleReset}
          disabled={resetMutation.isPending}
          className="w-full py-2 rounded-lg border border-red-200 text-red-600 font-semibold text-sm hover:bg-red-50 disabled:opacity-50"
        >
          {resetMutation.isPending ? 'Resetting…' : 'Reset All Brackets & Matches'}
        </button>
      </CollapsibleSection>
    </div>
  )
}
