import { useState, useMemo, useRef, useEffect } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import BackLink from '../../components/BackLink'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { getSports, generateBracket, resetBrackets, resetBracketPhase, updateSport, setSeedOrder, setPoolSetup, getStandings, type DivisionSpec, type PoolSpec, type HeatSpec } from '../../api/sports'
import { getMatches, patchMatch } from '../../api/matches'
import { getTeams } from '../../api/teams'
import { getCompanies } from '../../api/companies'
import { getLocations, createLocation, deleteLocation, updateLocation } from '../../api/locations'
import { getBrackets } from '../../api/brackets'
import { buildMultiTeamKeys } from '../../lib/bracketHelpers'
import { ROUND_1_NAME } from '../../lib/golf'
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
const poolName = (i: number, prefix: string = 'Pool', names?: string[]) =>
  names?.[i]?.trim() || `${prefix} ${poolLabel(i)}`

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
  multiTeamKeys?: Set<string>,
): string {
  if (!teamId) return 'TBD'
  const team = teamMap[teamId]
  if (!team) return '—'
  const company = companyMap[team.company_id]
  const base = company?.name ?? 'Unknown'
  const showSuffix = team.name && (multiTeamKeys ? multiTeamKeys.has(`${team.company_id}:${team.sport_id}`) : true)
  return showSuffix ? `${base} · ${team.name}` : base
}

function CalendarIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function LockedDateField({
  label,
  value,
  onEdit,
}: {
  label: string
  value: string | null
  onEdit: () => void
}) {
  return (
    <label className="space-y-1 block">
      <span className="text-xs text-gray-400">{label}</span>
      <div className="flex items-center justify-between w-full text-sm rounded-lg border border-gray-200 px-3 py-2 bg-gray-50 text-slate-700">
        <span>
          {value ? new Date(value).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not set'}
        </span>
        <button
          onClick={onEdit}
          aria-label={`Edit ${label.toLowerCase()}`}
          className="text-gray-400 hover:text-blue-600 shrink-0"
        >
          <CalendarIcon />
        </button>
      </div>
    </label>
  )
}

function PencilIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  )
}

function LockedField({
  label,
  value,
  onEdit,
}: {
  label: string
  value: string
  onEdit: () => void
}) {
  return (
    <label className="space-y-1 block">
      <span className="text-xs text-gray-400">{label}</span>
      <div className="flex items-center justify-between w-full text-sm rounded-lg border border-gray-200 px-3 py-2 bg-gray-50 text-slate-700">
        <span>{value || 'Not set'}</span>
        <button
          onClick={onEdit}
          aria-label={`Edit ${label.toLowerCase()}`}
          className="text-gray-400 hover:text-blue-600 shrink-0"
        >
          <PencilIcon />
        </button>
      </div>
    </label>
  )
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

function DragHandleIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
    </svg>
  )
}

// Wraps one row of a drag-reorderable list. Drag handle + dnd-kit wiring live
// here so callers just render their row content as `children`.
function SortableRow({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200"
    >
      <button
        {...attributes}
        {...listeners}
        className="p-1 -ml-1 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing touch-none shrink-0"
        aria-label="Drag to reorder"
      >
        <DragHandleIcon />
      </button>
      {children}
    </div>
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
  const [isEditingSchedule, setIsEditingSchedule] = useState(false)
  const [isEditingLocation, setIsEditingLocation] = useState(false)
  const [start, setStart] = useState(toDatetimeLocal(scheduleStart))
  const [end, setEnd] = useState(toDatetimeLocal(scheduleEnd))
  const [locationName, setLocationName] = useState(locations[0]?.name ?? '')
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [locationError, setLocationError] = useState<string | null>(null)

  function openScheduleEditor() {
    setStart(toDatetimeLocal(scheduleStart))
    setEnd(toDatetimeLocal(scheduleEnd))
    setScheduleError(null)
    setIsEditingSchedule(true)
  }

  function openLocationEditor() {
    setLocationName(locations[0]?.name ?? '')
    setLocationError(null)
    setIsEditingLocation(true)
  }

  const scheduleMutation = useMutation({
    mutationFn: () =>
      updateSport(sportId, {
        schedule_start: start ? new Date(start).toISOString() : null,
        schedule_end: end ? new Date(end).toISOString() : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sports'] })
      setScheduleError(null)
      setIsEditingSchedule(false)
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
      setIsEditingLocation(false)
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

        {isEditingSchedule ? (
          <>
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
            <div className="flex gap-2">
              <button
                onClick={() => setIsEditingSchedule(false)}
                disabled={scheduleMutation.isPending}
                className="flex-1 py-2 rounded-lg border border-gray-200 text-slate-600 font-semibold text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => scheduleMutation.mutate()}
                disabled={scheduleMutation.isPending}
                className="flex-1 py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {scheduleMutation.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </>
        ) : (
          <>
            <LockedDateField label="Start time" value={scheduleStart} onEdit={openScheduleEditor} />
            <LockedDateField label="End time" value={scheduleEnd} onEdit={openScheduleEditor} />
          </>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-4 space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Location</p>
        {isEditingLocation ? (
          <>
            <input
              type="text"
              value={locationName}
              onChange={e => setLocationName(e.target.value)}
              placeholder="e.g. Main Lobby"
              className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white text-slate-700"
            />
            {locationError && <p className="text-sm text-red-600">{locationError}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => setIsEditingLocation(false)}
                disabled={locationMutation.isPending}
                className="flex-1 py-2 rounded-lg border border-gray-200 text-slate-600 font-semibold text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => locationMutation.mutate()}
                disabled={locationMutation.isPending}
                className="flex-1 py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {locationMutation.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </>
        ) : (
          <LockedField label="Name" value={locations[0]?.name ?? ''} onEdit={openLocationEditor} />
        )}
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
  defaultOpen = false,
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

function SeedPositionInput({
  position,
  max,
  onCommit,
}: {
  position: number // 1-based
  max: number
  onCommit: (position: number) => void
}) {
  const [draft, setDraft] = useState(String(position))
  useEffect(() => setDraft(String(position)), [position])
  return (
    <input
      type="number"
      inputMode="numeric"
      min={1}
      max={max}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        const n = Number(draft)
        if (n) onCommit(n)
        else setDraft(String(position))
      }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      className="w-11 text-xs font-bold text-gray-600 text-center border border-gray-200 rounded-md px-1 py-1 shrink-0"
    />
  )
}

const SHARED_COURT_VALUE = -1
const UNASSIGNED_POOL = -2

function CourtPill({
  loc,
  currentPool,
  poolCount,
  onMoveCourt,
  namePrefix = 'Pool',
  poolNames,
}: {
  loc: { id: string; name: string }
  currentPool: number
  poolCount: number
  onMoveCourt: (locId: string, pool: number) => void
  namePrefix?: string
  poolNames?: string[]
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
          <option key={j} value={j}>{poolName(j, namePrefix, poolNames)}</option>
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
  namePrefix = 'Pool',
  poolNames,
  allowUnassign = true,
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
  namePrefix?: string
  poolNames?: string[]
  allowUnassign?: boolean
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
    <div className="rounded-xl border border-gray-200">
      <button
        onClick={onToggle}
        className={`w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 text-left hover:bg-gray-100 transition-colors rounded-t-xl ${!isOpen ? 'rounded-b-xl' : ''}`}
      >
        <span className="text-sm font-semibold text-slate-800">{poolName(poolIndex, namePrefix, poolNames)}</span>
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
                      : poolName(currentPool, namePrefix, poolNames)
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
                    <option key={j} value={j}>{poolName(j, namePrefix, poolNames)}</option>
                  ))}
                </select>
                {allowUnassign && (
                  <button
                    onClick={() => onUnassignTeam(team.id)}
                    className="ml-0.5 text-gray-400 hover:text-red-500 transition-colors leading-none"
                    title="Remove from pool"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {poolTeams.length === 0 && <p className="text-xs text-gray-400 italic">No teams assigned</p>}
          </div>

          {!cohortMode && locations.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1 border-t border-gray-100">
              {poolCourts.map(loc => (
                <CourtPill key={loc.id} loc={loc} currentPool={poolIndex} poolCount={poolCount} onMoveCourt={onMoveCourt} namePrefix={namePrefix} poolNames={poolNames} />
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
  namePrefix = 'Pool',
  poolNames,
  allowUnassign = true,
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
  namePrefix?: string
  poolNames?: string[]
  allowUnassign?: boolean
}) {
  const [openPool, setOpenPool] = useState<number | null>(null)

  const sharedCourts = locations.filter(l => courtPoolOf(l.id) === SHARED_COURT_VALUE)
  const unassignedTeams = seeds.filter(t => teamPoolOf(t.id) === UNASSIGNED_POOL)

  return (
    <div className="space-y-2">
      {/* Cohort mode: fields auto-distributed, no manual assignment needed.
          Only relevant when there are actual courts to distribute — Water
          Ball Toss forces cohortMode with no locations at all. */}
      {cohortMode && locations.length > 0 ? (
        <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2.5">
          <p className="text-xs font-semibold text-blue-600 mb-0.5">Fields auto-distributed</p>
          <p className="text-xs text-blue-500">
            {locations.length} field{locations.length !== 1 ? 's' : ''} will be automatically split into pairs and rotated across pools each round. No manual assignment needed.
          </p>
        </div>
      ) : !cohortMode ? (
        /* Shared courts (manual assignment mode) */
        sharedCourts.length > 0 && (
          <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2.5">
            <p className="text-xs font-semibold text-blue-600 mb-1.5">Shared courts (all pools)</p>
            <div className="flex flex-wrap gap-1.5">
              {sharedCourts.map(loc => (
                <CourtPill key={loc.id} loc={loc} currentPool={SHARED_COURT_VALUE} poolCount={poolCount} onMoveCourt={onMoveCourt} namePrefix={namePrefix} poolNames={poolNames} />
              ))}
            </div>
          </div>
        )
      ) : null}

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
          namePrefix={namePrefix}
          poolNames={poolNames}
          allowUnassign={allowUnassign}
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
                      <option key={j} value={j}>{poolName(j, namePrefix, poolNames)}</option>
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
  const multiTeamKeys = useMemo(() => buildMultiTeamKeys(teamMap), [teamMap])

  // Schedule config state
  const [configDuration, setConfigDuration] = useState<number | null>(null)
  const [configStart, setConfigStart] = useState<string | null>(null)
  const [isEditingSchedule, setIsEditingSchedule] = useState(false)
  const [configError, setConfigError] = useState<string | null>(null)
  const [configVenue, setConfigVenue] = useState<string | null>(null)
  const [configAssumedCourts, setConfigAssumedCourts] = useState<number | null>(null)
  // Pool-stage games per team: null = full round robin, N = truncate to N rounds
  const [configPoolPlayRounds, setConfigPoolPlayRounds] = useState<number | null>(null)
  const [isEditingPoolCount, setIsEditingPoolCount] = useState(false)
  const [isEditingPoolPlayRounds, setIsEditingPoolPlayRounds] = useState(false)

  // Courts state
  const [newCourtName, setNewCourtName] = useState('')
  const [courtError, setCourtError] = useState<string | null>(null)
  const [bulkCount, setBulkCount] = useState<number | ''>('')
  const [bulkGenerating, setBulkGenerating] = useState(false)
  const [labelInput, setLabelInput] = useState<string | null>(null)

  // Generate bracket state
  const [seeds, setSeeds] = useState<Team[]>([])
  const [seedsInit, setSeedsInit] = useState(false)
  const [seedsDirty, setSeedsDirty] = useState(false)
  const [seedSaving, setSeedSaving] = useState(false)
  const [seedSavedFeedback, setSeedSavedFeedback] = useState(false)
  const [seedSaveError, setSeedSaveError] = useState<string | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  const [numHeats, setNumHeats] = useState(1)

  useEffect(() => {
    if (sport?.name === 'Relay Race') setNumHeats(7)
    else setNumHeats(1)
  }, [sport?.name])

  // Division split state (elimination sports across two venues)
  const [splitEnabled, setSplitEnabled] = useState(false)
  const [divNames, setDivNames] = useState<[string, string]>(['Main Gym', 'North Gym'])
  const [isEditingDivNames, setIsEditingDivNames] = useState(false)
  const [teamDiv, setTeamDiv] = useState<Record<string, 0 | 1>>({})
  const [courtDiv, setCourtDiv] = useState<Record<string, 0 | 1>>({})

  // Pool play state — persisted to the backend (teams.pool_index, locations.pool_index,
  // sports.pool_count) so groups are the same on every device, not just this browser.
  const [poolCount, setPoolCount] = useState<number | null>(null)
  const [teamPool, setTeamPool] = useState<Record<string, number>>({})
  const [courtPool, setCourtPool] = useState<Record<string, number>>({})
  const [poolInit, setPoolInit] = useState(false)
  const [groupsSavedFeedback, setGroupsSavedFeedback] = useState(false)
  const [groupsSaving, setGroupsSaving] = useState(false)
  const [groupsSaveError, setGroupsSaveError] = useState<string | null>(null)

  async function saveGroups(
    poolCountOverride?: number,
    teamPoolOverride?: Record<string, number>,
    courtPoolOverride?: Record<string, number>,
  ) {
    if (!sportId) return
    setGroupsSaveError(null)
    setGroupsSaving(true)
    try {
      // One request for the whole group setup — avoids firing a burst of
      // concurrent PATCH requests (each with its own auth check) at Supabase.
      await setPoolSetup(sportId, { pool_count: poolCountOverride ?? poolCount, team_pool: teamPoolOverride ?? teamPool, court_pool: courtPoolOverride ?? courtPool })
      qc.invalidateQueries({ queryKey: ['teams'] })
      qc.invalidateQueries({ queryKey: ['locations', sportId] })
      qc.invalidateQueries({ queryKey: ['sports'] })
      setGroupsSavedFeedback(true)
      setTimeout(() => setGroupsSavedFeedback(false), 2000)
    } catch (e) {
      setGroupsSaveError(e instanceof Error ? e.message : 'Failed to save groups')
    } finally {
      setGroupsSaving(false)
    }
  }

  // Bracket phase state (pool_bracket, after pool play)
  // Pickleball's rules only send pool winners into the top bracket; every
  // other pool_bracket sport (Soccer, Ultimate Frisbee) sends the top 2.
  const defaultAdvancePerPool = sport?.name === 'Pickleball' ? 1 : 2
  const [configAdvancePerPool, setConfigAdvancePerPool] = useState<number | null>(null)
  const [isEditingAdvanceCount, setIsEditingAdvanceCount] = useState(false)
  const advanceCount = configAdvancePerPool ?? sport?.advance_per_pool ?? defaultAdvancePerPool
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

  // Init seeds once sport teams are loaded — sorted by persisted seed rank
  // (nulls last, in whatever order the API returned them) so a saved seed
  // order is honored on every device instead of resetting each page load.
  if (sport && !seedsInit && sportTeams.length > 0) {
    const sorted = [...sportTeams].sort((a, b) => {
      if (a.seed == null && b.seed == null) return 0
      if (a.seed == null) return 1
      if (b.seed == null) return -1
      return a.seed - b.seed
    })
    setSeeds(sorted)
    setSeedsInit(true)
  }

  // Init pool groups once from persisted backend fields, not localStorage
  if (sport && !poolInit && sportTeams.length > 0) {
    const tp: Record<string, number> = {}
    for (const t of sportTeams) if (t.pool_index != null) tp[t.id] = t.pool_index
    const cp: Record<string, number> = {}
    for (const l of locations) if (l.pool_index != null) cp[l.id] = l.pool_index
    setTeamPool(tp)
    setCourtPool(cp)
    setPoolCount(sport.pool_count ?? null)
    setPoolInit(true)
  }

  const effectiveDuration = configDuration ?? sport?.match_duration_minutes ?? 30
  const effectiveStart = configStart ?? (sport?.schedule_start ? toDatetimeLocal(sport.schedule_start) : '')
  const effectiveVenue = configVenue ?? sport?.venue ?? ''
  const effectiveAssumedCourts = configAssumedCourts ?? sport?.assumed_courts_per_group ?? 1
  // 0 / blank = full round robin (stored as null)
  const effectivePoolPlayRounds = configPoolPlayRounds ?? sport?.pool_play_rounds ?? 0

  const configMutation = useMutation({
    mutationFn: () => updateSport(sportId!, {
      match_duration_minutes: effectiveDuration,
      schedule_start: effectiveStart ? new Date(effectiveStart).toISOString() : null,
      venue: effectiveVenue.trim() || null,
      assumed_courts_per_group: effectiveAssumedCourts > 0 ? effectiveAssumedCourts : null,
      pool_play_rounds: effectivePoolPlayRounds > 0 ? effectivePoolPlayRounds : null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sports'] })
      setConfigError(null)
      setIsEditingSchedule(false)
    },
    onError: (e) => setConfigError(e instanceof Error ? e.message : 'Failed to save config'),
  })

  function openScheduleEditor() {
    setConfigDuration(null)
    setConfigStart(null)
    setConfigVenue(null)
    setConfigAssumedCourts(null)
    setConfigError(null)
    setIsEditingSchedule(true)
  }

  function cancelScheduleEdit() {
    setConfigDuration(null)
    setConfigStart(null)
    setConfigVenue(null)
    setConfigAssumedCourts(null)
    setConfigError(null)
    setIsEditingSchedule(false)
  }

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
  const isElimination = sport?.bracket_type === 'single_elimination' || sport?.bracket_type === 'double_elimination'
  const isPool = sport?.bracket_type === 'pool_bracket' || sport?.bracket_type === 'pool_swiss'
  const isPoolBracket = sport?.bracket_type === 'pool_bracket'
  const isPoolSwiss = sport?.bracket_type === 'pool_swiss'
  const isWaterball = sport?.scoring_mode === 'water_ball_toss'
  const isGolf = sport?.scoring_mode === 'executive_golf'
  const isPickleball = sport?.name === 'Pickleball'

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

  // Water Ball Toss groups — reuses the same teams.pool_index field as pool play,
  // but there's no seed order or courts to split; default is a straight alternating
  // split by company (so a company's teams stay together) with manual overrides.
  const waterballCompanyOrder = useMemo(() => {
    const ids = Array.from(new Set(sportTeams.map(t => t.company_id)))
    return ids.sort((a, b) => (companyMap[a]?.name ?? '').localeCompare(companyMap[b]?.name ?? ''))
  }, [sportTeams, companyMap])
  const teamGroupOf = (teamId: string): number => {
    const override = teamPool[teamId]
    if (override === UNASSIGNED_POOL) return UNASSIGNED_POOL
    if (override === 0 || override === 1) return override
    const team = sportTeams.find(t => t.id === teamId)
    if (!team) return 0
    return waterballCompanyOrder.indexOf(team.company_id) % 2
  }
  const hasUnassignedWaterballTeams = sportTeams.some(t => teamGroupOf(t.id) === UNASSIGNED_POOL)

  const poolSpecs: PoolSpec[] = Array.from({ length: effectivePoolCount }, (_, i) => ({
    name: poolName(i),
    team_ids: seeds.filter(t => teamPoolOf(t.id) === i).map(t => t.id),
    // Include courts dedicated to this pool AND courts shared across all pools
    location_ids: locations.filter(l => courtPoolOf(l.id) === i || courtPoolOf(l.id) === SHARED_COURT).map(l => l.id),
  }))
  const hasUnassignedTeams = seeds.some(t => teamPoolOf(t.id) === UNASSIGNED_POOL)
  const poolsValid = !hasUnassignedTeams && poolSpecs.every(p => p.team_ids.length >= 2)

  // Persist every team's/court's RESOLVED pool (not just manually-overridden
  // ones). The snake distribution is preview-only: teams left on their computed
  // default carry no entry in `teamPool`, and an empty/sparse map is a no-op
  // server-side (see set_pool_setup). Editing the pool count also clears the
  // override maps, so a plain saveGroups() would persist nothing and the DB
  // would keep NULL pool_index — collapsing everything into Group A on reload.
  // Same shape as the waterball group save.
  function saveResolvedGroups() {
    const fullTeamPool = Object.fromEntries(
      seeds.map(t => [t.id, teamPoolOf(t.id)]).filter(([, p]) => p !== UNASSIGNED_POOL),
    )
    const fullCourtPool = Object.fromEntries(locations.map(l => [l.id, courtPoolOf(l.id)]))
    return saveGroups(effectivePoolCount, fullTeamPool, fullCourtPool)
  }

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

  // Custom points scale for multi-phase heats (official ASG Relay Race tiers)
  const RELAY_RACE_SCALE: Record<string, number> = {
    '1': 40, '2': 38, '3': 36, '4': 34, '5': 32, '6': 30,
    '7': 26, '8': 26, '9': 22, '10': 22, '11': 18, '12': 18, '13': 14, '14': 14,
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

  const poolBracketIds = useMemo(
    () => new Set(brackets.filter(b => b.phase === 'pool').map(b => b.id)),
    [brackets],
  )
  const pendingPoolCount = useMemo(
    () => matches.filter(
      m => (m.status === 'scheduled' || m.status === 'in_progress') && m.bracket_id && poolBracketIds.has(m.bracket_id),
    ).length,
    [matches, poolBracketIds],
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
    const map: Record<string, {
      wins: number; losses: number; goal_diff: number; goals_for: number
      game_wins: number; point_diff: number; total_points: number
    }> = {}
    for (const pool of standings) {
      for (const row of pool.standings) map[row.team_id] = {
        wins: row.wins, losses: row.losses,
        goal_diff: row.goal_diff, goals_for: row.goals_for,
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
          inside.goal_diff === outside.goal_diff &&
          inside.goals_for === outside.goals_for &&
          inside.game_wins === outside.game_wins &&
          inside.point_diff === outside.point_diff &&
          inside.total_points === outside.total_points
      })
      .map(pool => pool.name)
  }, [standings, advanceCount])

  // Division assignment with sensible defaults: teams alternate (keeps the top
  // seeds apart), courts split first half / second half (courts at the same
  // venue are usually created together).
  const orderedTeams = seeds
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

  const waterballHeatSpecs: HeatSpec[] = (['Group A', 'Group B'] as const).map((name, i) => ({
    name,
    team_ids: sportTeams.filter(t => teamGroupOf(t.id) === i).map(t => t.id),
  }))

const genMutation = useMutation({
    mutationFn: async () => {
      if (isGolf) {
        // Round 1 = one flat match per company in a single "Round 1" heat
        // bracket, all on the first tee. Staggered tee times come from the
        // dynamic estimated_start ripple, not from stored times. Round 2 is
        // generated later from the Results page once the top 6 are known.
        return generateBracket(sportId!, [], false, undefined, undefined, [
          { name: ROUND_1_NAME, team_ids: sportTeams.map(t => t.id), phase: 'heats' },
        ])
      }
      if (isWaterball) {
        // Persist every team's resolved group (not just manually-overridden
        // ones) — otherwise a team left on its computed default never gets
        // a `pool_index` written (an empty team_pool is a no-op server-side),
        // so the Groups panel can drift from what's actually baked into the
        // matches being generated right now.
        const fullTeamPool = Object.fromEntries(
          sportTeams.map(t => [t.id, teamGroupOf(t.id)]).filter(([, g]) => g !== UNASSIGNED_POOL),
        )
        await saveGroups(2, fullTeamPool)
        return generateBracket(sportId!, [], false, undefined, undefined, waterballHeatSpecs)
      }
      if (isHeats && effectiveNumHeats > 1) {
        await generateBracket(sportId!, [], false, undefined, undefined, heatSpecs)
        if (sport?.name === 'Relay Race') {
          await updateSport(sportId!, { points_scale: RELAY_RACE_SCALE })
        }
        return
      }
      if (isPool) return generateBracket(sportId!, [], false, undefined, poolSpecs)
      // Flat heats (Human Pyramid): no seeding order needed — use live sportTeams so
      // newly registered teams are always included, not just those present at page load.
      if (isHeats) return generateBracket(sportId!, sportTeams.map(t => t.id), false)
      // Persist the current seed order regardless of whether "Save Seed Order"
      // was clicked, so the seed number shown on bracket slots always matches
      // what was actually generated (not a stale earlier save).
      await setSeedOrder(sportId!, seeds.map(t => t.id))
      if (splitEnabled) return generateBracket(sportId!, [], false, divisionSpecs)
      return generateBracket(sportId!, seeds.map(t => t.id), false)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['matches'] })
      qc.invalidateQueries({ queryKey: ['brackets'] })
      qc.invalidateQueries({ queryKey: ['sports'] })
      setGenError(null)
      if (isPool && sportId) saveResolvedGroups()
    },
    onError: (e) => setGenError(e instanceof Error ? e.message : 'Failed to generate bracket'),
  })

  const bracketPhaseMutation = useMutation({
    mutationFn: async () => {
      if (configAdvancePerPool !== null && configAdvancePerPool !== (sport?.advance_per_pool ?? defaultAdvancePerPool)) {
        await updateSport(sportId!, { advance_per_pool: configAdvancePerPool })
      }
      // Persist the seed order so bracket slots show seed numbers, same as
      // the elimination-sport generate path does.
      await setSeedOrder(sportId!, advancing)
      return generateBracket(sportId!, advancing, false)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['matches'] })
      qc.invalidateQueries({ queryKey: ['brackets'] })
      qc.invalidateQueries({ queryKey: ['sports'] })
      setGenError(null)
    },
    onError: (e) => setGenError(e instanceof Error ? e.message : 'Failed to generate bracket phase'),
  })

  const restartBracketPhaseMutation = useMutation({
    mutationFn: () => resetBracketPhase(sportId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['matches'] })
      qc.invalidateQueries({ queryKey: ['brackets'] })
      setAdvOverride(null)
      setGenError(null)
    },
    onError: (e) => setGenError(e instanceof Error ? e.message : 'Failed to restart bracket phase'),
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

  // Rearranging is purely local state — no network call per move. This avoids
  // firing a request every time you nudge a team while still deciding on an
  // order, and means a network blip mid-edit can't corrupt anything. Nothing
  // is durable until "Save Seed Order" is clicked (below), matching the
  // existing "Save Groups" pattern for pool setup.
  function reorderSeeds(next: Team[]) {
    setSeeds(next)
    setSeedsDirty(true)
  }

  function move(idx: number, dir: -1 | 1) {
    const next = [...seeds]
    const swap = idx + dir
    if (swap < 0 || swap >= next.length) return
    ;[next[idx], next[swap]] = [next[swap], next[idx]]
    reorderSeeds(next)
  }

  const seedsDragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  )
  function handleSeedsDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIdx = seeds.findIndex(t => t.id === active.id)
    const newIdx = seeds.findIndex(t => t.id === over.id)
    if (oldIdx === -1 || newIdx === -1) return
    reorderSeeds(arrayMove(seeds, oldIdx, newIdx))
  }

  // Jump a team directly to a 1-based seed position, so reordering a long list
  // doesn't require clicking an arrow repeatedly.
  function moveTeamToPosition(teamId: string, position: number) {
    if (!Number.isFinite(position)) return
    const from = seeds.findIndex(t => t.id === teamId)
    if (from < 0) return
    const to = Math.min(Math.max(Math.trunc(position) - 1, 0), seeds.length - 1)
    if (to === from) return
    const next = [...seeds]
    const [team] = next.splice(from, 1)
    next.splice(to, 0, team)
    reorderSeeds(next)
  }

  async function saveSeedOrder() {
    if (!sportId) return
    setSeedSaveError(null)
    setSeedSaving(true)
    try {
      await setSeedOrder(sportId, seeds.map(t => t.id))
      qc.invalidateQueries({ queryKey: ['teams'] })
      setSeedsDirty(false)
      setSeedSavedFeedback(true)
      setTimeout(() => setSeedSavedFeedback(false), 2000)
    } catch (e) {
      setSeedSaveError(e instanceof Error ? e.message : 'Failed to save seed order')
    } finally {
      setSeedSaving(false)
    }
  }

  function moveAdvancing(idx: number, dir: -1 | 1) {
    const next = [...advancing]
    const swap = idx + dir
    if (swap < 0 || swap >= next.length) return
    ;[next[idx], next[swap]] = [next[swap], next[idx]]
    setAdvOverride(next)
  }

  const advancingDragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  )
  function handleAdvancingDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIdx = advancing.indexOf(String(active.id))
    const newIdx = advancing.indexOf(String(over.id))
    if (oldIdx === -1 || newIdx === -1) return
    setAdvOverride(arrayMove(advancing, oldIdx, newIdx))
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
    const msg = isWaterball || isGolf
      ? `Reset all results for ${sport?.name}? This will delete every match (both rounds) and cannot be undone.`
      : `Reset all brackets for ${sport?.name}? This will delete all matches and cannot be undone.`
    if (!window.confirm(msg)) return
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
        {isEditingSchedule ? (
          <>
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
              <span className="text-xs text-gray-400">Venue label (shown as a header on the schedule when set)</span>
              <input
                type="text"
                placeholder='e.g. "Cornhole Area", "Soccer Fields"'
                value={effectiveVenue}
                onChange={e => setConfigVenue(e.target.value)}
                className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white text-slate-700"
              />
            </label>
            {configError && <p className="text-sm text-red-600">{configError}</p>}
            <div className="flex gap-2">
              <button
                onClick={cancelScheduleEdit}
                disabled={configMutation.isPending}
                className="flex-1 py-2 rounded-lg border border-gray-200 text-slate-600 font-semibold text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => configMutation.mutate()}
                disabled={configMutation.isPending}
                className="flex-1 py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {configMutation.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </>
        ) : (
          <>
            <LockedDateField label="Start time" value={sport.schedule_start} onEdit={openScheduleEditor} />
            <LockedField label="Match duration (min)" value={String(effectiveDuration)} onEdit={openScheduleEditor} />
            <LockedField label="Venue label" value={effectiveVenue} onEdit={openScheduleEditor} />
          </>
        )}
      </CollapsibleSection>

      {/* Courts — hidden for pool_swiss and heats sports (both use the venue label instead).
          Executive Golf is a heats sport but DOES use a real location (the starting tee),
          which the estimated_start ripple relies on to stagger tee times. */}
      {!isPoolSwiss && (!isHeats || isGolf) && (
      <CollapsibleSection title="Courts">
        {/* Chip grid */}
        {sortedLocations.length === 0 ? (
          <p className="text-sm text-slate-400 italic">No courts defined — matches will be unassigned.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {sortedLocations.map(loc => (
              <div key={loc.id} className="flex items-center gap-1.5 bg-gray-100 border border-gray-200 rounded-lg px-2.5 py-1.5">
                <span className="text-sm text-slate-700">{loc.name}</span>
                <button
                  onClick={() => {
                    if (confirm(`Remove court "${loc.name}"? Any scheduled matches on it will lose their court assignment.`)) {
                      deleteCourtMutation.mutate(loc.id)
                    }
                  }}
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
      </CollapsibleSection>
      )}

      {/* Water Ball Toss groups — same team-grouping mechanism as pool play
          (teams.pool_index), just two fixed groups and no courts to assign. */}
      {isWaterball && (
        <CollapsibleSection title="Groups">
          <p className="text-xs text-gray-400 -mt-1">
            Split teams into two groups so both can run the toss at the same time. Group
            assignment doesn't affect scoring — enter results per team from Enter Results.
          </p>
          <PoolBuckets
            poolCount={2}
            seeds={sportTeams}
            locations={[]}
            teamPoolOf={teamGroupOf}
            courtPoolOf={() => SHARED_COURT_VALUE}
            companyMap={companyMap}
            cohortMode={true}
            onMoveTeam={(teamId, pool) => setTeamPool(prev => ({ ...prev, [teamId]: pool }))}
            onMoveCourt={() => {}}
            onUnassignTeam={(teamId) => setTeamPool(prev => ({ ...prev, [teamId]: UNASSIGNED_POOL }))}
            namePrefix="Group"
          />
          {hasUnassignedWaterballTeams && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Unassigned teams default to an alternating split by company until saved.
            </p>
          )}
          {groupsSaveError && <p className="text-sm text-red-600">{groupsSaveError}</p>}
          <button
            onClick={() => saveGroups(2)}
            disabled={groupsSaving}
            className="w-full py-2 rounded-lg border border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {groupsSaving ? 'Saving…' : groupsSavedFeedback ? 'Groups saved ✓' : 'Save Groups'}
          </button>
        </CollapsibleSection>
      )}

      {/* Generate / Setup */}
      <CollapsibleSection
        title={canGenerate ? (isGolf ? 'Generate Round 1' : isWaterball ? 'Generate Matches' : isPool ? 'Generate Pool Play' : isHeats ? 'Generate Entries' : 'Generate Bracket') : 'Bracket Setup'}
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
          isGolf ? (
            <p className="text-sm text-slate-500">
              Round 1 has been generated. Enter hole scores and advance the top 6 to Round 2 from
              Enter Results, or reset all matches below to regenerate.
            </p>
          ) : isWaterball ? (
            <p className="text-sm text-slate-500">
              Matches have been generated. Enter results from Enter Results, or reset all matches below to regenerate.
            </p>
          ) : isPool ? (
            <div className="space-y-2">
              <p className="text-sm text-slate-500">Pool play has been generated.</p>
              <button
                onClick={handleRestartPoolPlay}
                disabled={resetMutation.isPending}
                className="w-full py-2 rounded-lg border border-red-200 text-red-700 font-semibold text-sm hover:bg-red-50 disabled:opacity-50"
              >
                {resetMutation.isPending ? 'Resetting…' : 'Restart Pool Play'}
              </button>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              Bracket has been generated. To regenerate, reset all brackets &amp; matches below first.
            </p>
          )
        ) : isGolf ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-500 italic">
              Creates one Round 1 match per company, each with its own tee time staggered by the
              match duration from the start time. Enter each company's hole scores from Enter
              Results as they finish, then advance the top 6 to Round 2 there. A court/tee is
              optional — set a venue label under Scheduling if you want it shown on the schedule.
            </p>
          </div>
        ) : isWaterball ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-500 italic">
              Creates one match per team, split into the two groups configured above. Each match is
              started and its result entered from Enter Results.
            </p>
            {hasUnassignedWaterballTeams && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                All teams must be assigned to a group above before generating.
              </p>
            )}
          </div>
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
              {effectivePoolPlayRounds > 0
                ? `Each team plays ${effectivePoolPlayRounds} game${effectivePoolPlayRounds === 1 ? '' : 's'} against different opponents in its pool (truncated round robin).`
                : 'Each pool plays a round robin — every team plays every other team in its pool once.'}
              {isPoolBracket && ' After pool play, the top teams advance to a single-elimination bracket.'}
            </p>

            {isEditingPoolCount ? (
              <label className="space-y-1 block">
                <span className="text-xs text-gray-400">Number of pools</span>
                <input
                  type="number"
                  min={1}
                  max={Math.floor(sportTeams.length / 2) || 1}
                  autoFocus
                  value={effectivePoolCount}
                  onChange={e => {
                    setPoolCount(Number(e.target.value))
                    // Stale per-team/court pool overrides from a previous pool
                    // count would otherwise stay pinned forever (teamPoolOf
                    // honors any override < effectivePoolCount regardless of
                    // when it was set), skewing pools out of balance. Clearing
                    // them here re-triggers the snake distribution for a fresh
                    // preview; nothing is persisted until "Save Groups".
                    setTeamPool({})
                    setCourtPool({})
                  }}
                  onBlur={() => setIsEditingPoolCount(false)}
                  onKeyDown={e => { if (e.key === 'Enter') setIsEditingPoolCount(false) }}
                  className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white text-slate-700"
                />
              </label>
            ) : (
              <LockedField
                label="Number of pools"
                value={String(effectivePoolCount)}
                onEdit={() => setIsEditingPoolCount(true)}
              />
            )}

            {isEditingPoolPlayRounds ? (
              <label className="space-y-1 block">
                <span className="text-xs text-gray-400">Games per team (pool stage)</span>
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, Math.ceil(sportTeams.length / effectivePoolCount) - 1)}
                  placeholder="All opponents (full round robin)"
                  autoFocus
                  value={effectivePoolPlayRounds > 0 ? effectivePoolPlayRounds : ''}
                  onChange={e => setConfigPoolPlayRounds(e.target.value ? Number(e.target.value) : 0)}
                  onBlur={() => { configMutation.mutate(); setIsEditingPoolPlayRounds(false) }}
                  onKeyDown={e => { if (e.key === 'Enter') { configMutation.mutate(); setIsEditingPoolPlayRounds(false) } }}
                  className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white text-slate-700"
                />
                <span className="text-xs text-slate-400">
                  Leave blank to play a full round robin. Set a number when there isn't
                  time for every team to play everyone — each team plays that many
                  different opponents instead.
                </span>
              </label>
            ) : (
              <LockedField
                label="Games per team (pool stage)"
                value={effectivePoolPlayRounds > 0 ? String(effectivePoolPlayRounds) : 'All opponents (full round robin)'}
                onEdit={() => setIsEditingPoolPlayRounds(true)}
              />
            )}

            {isPoolSwiss && (
              <label className="space-y-1 block">
                <span className="text-xs text-gray-400">Number of Board Sets per Group</span>
                <input
                  type="number"
                  min={1}
                  value={effectiveAssumedCourts}
                  onChange={e => setConfigAssumedCourts(Number(e.target.value))}
                  onBlur={() => configMutation.mutate()}
                  className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white text-slate-700"
                />
              </label>
            )}

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
            {groupsSaveError && <p className="text-sm text-red-600">{groupsSaveError}</p>}
            <button
              onClick={() => saveResolvedGroups()}
              disabled={groupsSaving}
              className="w-full py-2 rounded-lg border border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              {groupsSaving ? 'Saving…' : groupsSavedFeedback ? 'Groups saved ✓' : 'Save Groups'}
            </button>
          </div>
        ) : (
          <>
            {isElimination && sport.name === 'Basketball' && sportTeams.length >= 4 && (
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
                {isEditingDivNames ? (
                  <div
                    className="grid grid-cols-2 gap-2"
                    onBlur={e => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsEditingDivNames(false)
                    }}
                  >
                    {([0, 1] as const).map(i => (
                      <label key={i} className="space-y-1 block">
                        <span className="text-xs text-gray-400">Division {i + 1} name</span>
                        <input
                          type="text"
                          autoFocus={i === 0}
                          value={divNames[i]}
                          onChange={e => setDivNames(prev => (i === 0 ? [e.target.value, prev[1]] : [prev[0], e.target.value]))}
                          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                          placeholder={`Division ${i + 1}`}
                          className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white text-slate-700"
                        />
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <LockedField label="Division 1 name" value={divNames[0]} onEdit={() => setIsEditingDivNames(true)} />
                    <LockedField label="Division 2 name" value={divNames[1]} onEdit={() => setIsEditingDivNames(true)} />
                  </div>
                )}

                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Seed order</p>
                {seedSaveError && <p className="text-sm text-red-600">{seedSaveError}</p>}
                <DndContext sensors={seedsDragSensors} collisionDetection={closestCenter} onDragEnd={handleSeedsDragEnd}>
                  <SortableContext items={orderedTeams.map(t => t.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-1">
                      {orderedTeams.map((team, idx) => (
                        <SortableRow key={team.id} id={team.id}>
                          <SeedPositionInput
                            position={idx + 1}
                            max={seeds.length}
                            onCommit={p => moveTeamToPosition(team.id, p)}
                          />
                          <span className="flex-1 text-sm text-slate-700 truncate min-w-0">
                            {companyMap[team.company_id]?.name ?? '—'}
                            {team.name && <span className="text-gray-400"> · {team.name}</span>}
                          </span>
                          <div className="flex gap-0.5">
                            <button onClick={() => move(idx, -1)} disabled={idx === 0} className="p-1 text-gray-400 hover:text-slate-700 disabled:opacity-20"><UpIcon /></button>
                            <button onClick={() => move(idx, 1)} disabled={idx === seeds.length - 1} className="p-1 text-gray-400 hover:text-slate-700 disabled:opacity-20"><DownIcon /></button>
                          </div>
                        </SortableRow>
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
                <button
                  onClick={saveSeedOrder}
                  disabled={seedSaving || !seedsDirty}
                  className="w-full py-2 rounded-lg border border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  {seedSaving ? 'Saving…' : seedSavedFeedback ? 'Seed order saved ✓' : seedsDirty ? 'Save Seed Order' : 'Seed order saved'}
                </button>

                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Divisions</p>
                <p className="text-xs text-gray-400 -mt-1">
                  Assign each team and court to a division. The seed order above still determines
                  bracket seeding within each division.
                </p>
                <PoolBuckets
                  poolCount={2}
                  seeds={orderedTeams}
                  locations={locations}
                  teamPoolOf={teamDivOf}
                  courtPoolOf={courtDivOf}
                  companyMap={companyMap}
                  cohortMode={false}
                  allowUnassign={false}
                  poolNames={divNames}
                  onMoveTeam={(teamId, div) => setTeamDiv(prev => ({ ...prev, [teamId]: div as 0 | 1 }))}
                  onMoveCourt={(locId, div) => setCourtDiv(prev => ({ ...prev, [locId]: div as 0 | 1 }))}
                  onUnassignTeam={() => {}}
                />

                {!splitValid && (
                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Each division needs at least 2 teams.
                  </p>
                )}
              </div>
            ) : (
              <>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Seed order</p>
                {seedSaveError && <p className="text-sm text-red-600">{seedSaveError}</p>}
                <DndContext sensors={seedsDragSensors} collisionDetection={closestCenter} onDragEnd={handleSeedsDragEnd}>
                  <SortableContext items={seeds.map(t => t.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-1">
                      {seeds.map((team, idx) => (
                        <SortableRow key={team.id} id={team.id}>
                          <SeedPositionInput
                            position={idx + 1}
                            max={seeds.length}
                            onCommit={p => moveTeamToPosition(team.id, p)}
                          />
                          <span className="flex-1 text-sm text-slate-700">
                            {companyMap[team.company_id]?.name ?? '—'}
                            {team.name && <span className="text-gray-400"> · {team.name}</span>}
                          </span>
                          <div className="flex gap-0.5">
                            <button onClick={() => move(idx, -1)} disabled={idx === 0} className="p-1 text-gray-400 hover:text-slate-700 disabled:opacity-20"><UpIcon /></button>
                            <button onClick={() => move(idx, 1)} disabled={idx === seeds.length - 1} className="p-1 text-gray-400 hover:text-slate-700 disabled:opacity-20"><DownIcon /></button>
                          </div>
                        </SortableRow>
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
                <button
                  onClick={saveSeedOrder}
                  disabled={seedSaving || !seedsDirty}
                  className="w-full py-2 rounded-lg border border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  {seedSaving ? 'Saving…' : seedSavedFeedback ? 'Seed order saved ✓' : seedsDirty ? 'Save Seed Order' : 'Seed order saved'}
                </button>
              </>
            )}
          </>
        )}

{canGenerate && !alreadyGenerated && (
          <>
            {genError && <p className="text-sm text-red-600">{genError}</p>}
            <button
              onClick={() => genMutation.mutate()}
              disabled={genMutation.isPending || sportTeams.length < 2 || (splitEnabled && !splitValid) || (isPool && !poolsValid) || (isWaterball && hasUnassignedWaterballTeams)}
              className="w-full py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {genMutation.isPending ? 'Generating…' : isGolf ? 'Generate Round 1' : isWaterball ? 'Generate Matches' : isHeats ? (effectiveNumHeats > 1 ? 'Generate Preliminary Heats' : 'Generate Entries') : isPool ? 'Generate Pool Play' : splitEnabled ? 'Generate Division Brackets' : 'Generate Bracket'}
            </button>
          </>
        )}
      </CollapsibleSection>

      {/* Bracket Phase (pool_bracket: seeded from pool standings) */}
      {showBracketPhaseCard && (
        <CollapsibleSection
          title="Generate Bracket Phase"
          badge={hasBracketPhase ? (
            <span className="text-xs font-semibold text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full shrink-0">
              Generated
            </span>
          ) : undefined}
        >

          {!hasBracketPhase && (
            isEditingAdvanceCount ? (
              <label className="space-y-1 block">
                <span className="text-xs text-gray-400">Teams advancing per pool</span>
                <input
                  type="number"
                  min={1}
                  autoFocus
                  value={advanceCount}
                  onChange={e => setConfigAdvancePerPool(Math.max(1, Number(e.target.value)))}
                  onBlur={() => setIsEditingAdvanceCount(false)}
                  onKeyDown={e => { if (e.key === 'Enter') setIsEditingAdvanceCount(false) }}
                  className="w-24 text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white text-slate-700"
                />
              </label>
            ) : (
              <LockedField
                label="Teams advancing per pool"
                value={String(advanceCount)}
                onEdit={() => setIsEditingAdvanceCount(true)}
              />
            )
          )}

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
            <DndContext
              sensors={advancingDragSensors}
              collisionDetection={closestCenter}
              onDragEnd={handleAdvancingDragEnd}
            >
              <SortableContext items={advancing} strategy={verticalListSortingStrategy} disabled={hasBracketPhase}>
                <div className="space-y-1">
                  {advancing.map((teamId, idx) => {
                    const record = teamRecord[teamId]
                    const rowContent = (
                      <>
                        <span className="text-xs font-bold text-gray-400 w-5 text-center">{idx + 1}</span>
                        <span className="flex-1 text-sm text-slate-700 truncate min-w-0">
                          {teamLabel(teamId, teamMap, companyMap, multiTeamKeys)}
                        </span>
                        {record && (
                          <span className="text-xs text-gray-400 shrink-0">
                            {record.wins}–{record.losses}
                            {isPickleball ? (
                              <> · {record.game_wins}GW · {record.point_diff >= 0 ? '+' : ''}{record.point_diff}PD · {record.total_points}TP</>
                            ) : (
                              <> · {record.goal_diff >= 0 ? '+' : ''}{record.goal_diff}GD · {record.goals_for}GF</>
                            )}
                          </span>
                        )}
                        {!hasBracketPhase && (
                          <div className="flex gap-0.5">
                            <button onClick={() => moveAdvancing(idx, -1)} disabled={idx === 0} className="p-1 text-gray-400 hover:text-slate-700 disabled:opacity-20"><UpIcon /></button>
                            <button onClick={() => moveAdvancing(idx, 1)} disabled={idx === advancing.length - 1} className="p-1 text-gray-400 hover:text-slate-700 disabled:opacity-20"><DownIcon /></button>
                          </div>
                        )}
                      </>
                    )
                    return hasBracketPhase ? (
                      <div key={teamId} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
                        {rowContent}
                      </div>
                    ) : (
                      <SortableRow key={teamId} id={teamId}>{rowContent}</SortableRow>
                    )
                  })}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {genError && <p className="text-sm text-red-600">{genError}</p>}
          {hasBracketPhase ? (
            <button
              onClick={() => {
                if (!window.confirm('Restart the bracket phase? This deletes the current bracket and its matches (pool play is untouched) so you can re-seed and regenerate.')) return
                restartBracketPhaseMutation.mutate()
              }}
              disabled={restartBracketPhaseMutation.isPending}
              className="w-full py-2 rounded-lg border border-red-200 text-red-700 font-semibold text-sm hover:bg-red-50 disabled:opacity-50"
            >
              {restartBracketPhaseMutation.isPending ? 'Restarting…' : 'Restart Bracket Phase'}
            </button>
          ) : (
            <button
              onClick={() => bracketPhaseMutation.mutate()}
              disabled={bracketPhaseMutation.isPending || advancing.length < 2}
              className="w-full py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {bracketPhaseMutation.isPending ? 'Generating…' : 'Generate Bracket Phase'}
            </button>
          )}
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
                        ? teamLabel(match.home_team_id, teamMap, companyMap, multiTeamKeys)
                        : `${teamLabel(match.home_team_id, teamMap, companyMap, multiTeamKeys)} vs ${teamLabel(match.away_team_id, teamMap, companyMap, multiTeamKeys)}`
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
      <CollapsibleSection title="Reset" borderColor="border-red-100" defaultOpen={false}>
        {resetMutation.isError && <p className="text-sm text-red-600">{genError}</p>}
        <button
          onClick={handleReset}
          disabled={resetMutation.isPending}
          className="w-full py-2 rounded-lg border border-red-200 text-red-600 font-semibold text-sm hover:bg-red-50 disabled:opacity-50"
        >
          {resetMutation.isPending ? 'Resetting…' : isWaterball || isGolf ? 'Reset All Results' : 'Reset All Brackets & Matches'}
        </button>
      </CollapsibleSection>
    </div>
  )
}
