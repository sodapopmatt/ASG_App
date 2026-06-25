import { Fragment, useState, useMemo, useEffect } from 'react'
import { useTabMemory } from '../lib/useTabMemory'
import { useQuery } from '@tanstack/react-query'
import { getMatches } from '../api/matches'
import { getSports } from '../api/sports'
import { getTeams } from '../api/teams'
import { getCompanies } from '../api/companies'
import { getLocations } from '../api/locations'
import type { Match, Sport, Team, Company, Location } from '../types'
import { compactLabel } from '../lib/bracketHelpers'
import { getSportIcon } from '../lib/sportIcons'

type ViewMode = 'by_sport' | 'timeline'
type StatusFilter = 'all' | 'active' | 'upcoming' | 'live' | 'completed'

function getCompanyIdsForFilter(
  companyId: string,
  teams: Team[],
): Set<string> {
  if (companyId === 'all') return new Set()
  return new Set(teams.filter(t => t.company_id === companyId).map(t => t.id))
}

function buildTimeSlot(minutes: number): { label: string; minutes: number } {
  const h = Math.floor(minutes / 60)
  const min = minutes % 60
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return { label: `${h12}:${min.toString().padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`, minutes }
}

function minutesOfDay(iso: string): number {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

function buildTimelineSlots(matches: Match[], extraTimes: string[] = []): { label: string; minutes: number }[] {
  const times = [
    ...matches.map(m => m.estimated_start ?? m.scheduled_at).filter(Boolean) as string[],
    ...extraTimes,
  ].map(minutesOfDay)

  const from = times.length ? Math.floor(Math.min(...times) / 30) * 30 : 8 * 60
  const to   = times.length ? Math.ceil(Math.max(...times) / 30) * 30  : 17 * 60

  const slots = []
  for (let m = from; m <= to; m += 30) slots.push(buildTimeSlot(m))
  return slots
}

// ── Data hook ───────────────────────────────────────────────────────────────

function useScheduleData() {
  const matches   = useQuery({ queryKey: ['matches'],   queryFn: () => getMatches() })
  const sports    = useQuery({ queryKey: ['sports'],    queryFn: getSports,         staleTime: Infinity })
  const teams     = useQuery({ queryKey: ['teams'],     queryFn: () => getTeams(),  staleTime: Infinity })
  const companies = useQuery({ queryKey: ['companies'], queryFn: getCompanies,      staleTime: Infinity })

  const sportMap   = useMemo(() => indexBy(sports.data   ?? [], 'id') as Record<string, Sport>,   [sports.data])
  const teamMap    = useMemo(() => indexBy(teams.data    ?? [], 'id') as Record<string, Team>,    [teams.data])
  const companyMap = useMemo(() => indexBy(companies.data ?? [], 'id') as Record<string, Company>, [companies.data])

  return {
    matches:   matches.data   ?? [],
    sports:    sports.data    ?? [],
    sportMap,
    teamMap,
    companyMap,
    isLoading: matches.isLoading || sports.isLoading || teams.isLoading || companies.isLoading,
    isError:   matches.isError,
  }
}

// ── Utilities ───────────────────────────────────────────────────────────────

function indexBy<T>(arr: T[], key: keyof T): Record<string, T> {
  return Object.fromEntries(arr.map(item => [item[key], item]))
}

function teamShort(
  teamId: string | null | undefined,
  teamMap: Record<string, Team>,
  companyMap: Record<string, Company>,
): string {
  if (!teamId) return 'TBD'
  const team = teamMap[teamId]
  if (!team) return '—'
  const company = companyMap[team.company_id]
  return company?.short_id ?? company?.name ?? '?'
}


function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])
  return now
}

function slotIndex(iso: string, baseMinutes: number): number {
  const d = new Date(iso)
  return Math.round((d.getHours() * 60 + d.getMinutes() - baseMinutes) / 30)
}

function isResolved(m: Match): boolean {
  return m.status === 'completed' || m.status === 'forfeit' || m.status === 'double_forfeit' || m.status === 'draw'
}

function matchesStatusFilter(m: Match, f: StatusFilter): boolean {
  if (f === 'all')       return true
  if (f === 'active')    return m.status === 'scheduled' || m.status === 'in_progress'
  if (f === 'upcoming')  return m.status === 'scheduled'
  if (f === 'live')      return m.status === 'in_progress'
  if (f === 'completed') return isResolved(m)
  return true
}

function groupBySportAndRound(
  matches: Match[],
  sportMap: Record<string, Sport>,
): { sportId: string; sport: Sport; rounds: { roundKey: string; matches: Match[] }[] }[] {
  const sportOrder: string[] = []
  const bySport: Record<string, { sport: Sport; rounds: Record<string, Match[]> }> = {}

  const sorted = [...matches].sort((a, b) => {
    if (!a.scheduled_at && !b.scheduled_at) return 0
    if (!a.scheduled_at) return 1
    if (!b.scheduled_at) return -1
    return a.scheduled_at.localeCompare(b.scheduled_at)
  })

  for (const match of sorted) {
    const sport = sportMap[match.sport_id]
    if (!sport) continue
    if (!bySport[match.sport_id]) {
      bySport[match.sport_id] = { sport, rounds: {} }
      sportOrder.push(match.sport_id)
    }
    const roundKey = match.match_round != null ? String(match.match_round) : 'unscheduled'
    bySport[match.sport_id].rounds[roundKey] ??= []
    bySport[match.sport_id].rounds[roundKey].push(match)
  }

  return sportOrder.map(sportId => ({
    sportId,
    sport: bySport[sportId].sport,
    rounds: Object.entries(bySport[sportId].rounds)
      .sort(([a], [b]) => {
        if (a === 'unscheduled') return 1
        if (b === 'unscheduled') return -1
        return Number(a) - Number(b)
      })
      .map(([roundKey, matches]) => ({ roundKey, matches })),
  }))
}

// ── Shared components ────────────────────────────────────────────────────────

function LiveClock({ base, actualStart }: {
  base: string
  actualStart: string | null
}) {
  const [elapsed, setElapsed] = useState(() =>
    actualStart ? Math.floor((Date.now() - new Date(actualStart).getTime()) / 60000) : 0
  )
  useEffect(() => {
    if (!actualStart) return
    const start = new Date(actualStart).getTime()
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 60000)), 30_000)
    return () => clearInterval(id)
  }, [actualStart])
  return (
    <span className={`${base} text-green-700 bg-green-100 animate-pulse`}>
      Live{actualStart ? ` · ${elapsed}m` : ''}
    </span>
  )
}

function StatusBadge({ match }: { match: Match }) {
  const now = useNow()
  const base = 'text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap'

  if (match.status === 'in_progress')
    return <LiveClock base={base} actualStart={match.actual_start} />

  if (match.status === 'scheduled') {
    const effectiveTime = match.estimated_start ?? match.scheduled_at
    const isPushed = !!(match.estimated_start && match.scheduled_at &&
      new Date(match.estimated_start) > new Date(match.scheduled_at))
    const overdueMs = effectiveTime ? now.getTime() - new Date(effectiveTime).getTime() : -Infinity
    const isOverdue = overdueMs >= 3 * 60 * 1000
    const overdueMins = Math.floor(overdueMs / 60000)

    if (isOverdue) {
      return (
        <div className="flex flex-col items-end gap-0.5">
          <span className={`${base} text-orange-700 bg-orange-100`}>
            {effectiveTime ? formatTime(effectiveTime) : 'TBD'}
          </span>
          <span className="text-xs text-orange-500 tabular-nums">{overdueMins}m late</span>
        </div>
      )
    }

    return (
      <span className={`${base} ${isPushed ? 'text-orange-700 bg-orange-100' : 'text-blue-700 bg-blue-100'}`}>
        {effectiveTime ? `${isPushed ? '~' : ''}${formatTime(effectiveTime)}` : 'TBD'}
      </span>
    )
  }

  if (match.status === 'completed' && match.actual_start && match.played_at) {
    const mins = Math.round(
      (new Date(match.played_at).getTime() - new Date(match.actual_start).getTime()) / 60000
    )
    return <span className={`${base} text-gray-500 bg-gray-100`}>{mins}m</span>
  }

  if (match.status === 'forfeit')
    return <span className={`${base} text-gray-500 bg-gray-100`}>Forfeit</span>
  if (match.status === 'double_forfeit')
    return <span className={`${base} text-gray-500 bg-gray-100`}>Dbl Forfeit</span>
  if (match.status === 'draw')
    return <span className={`${base} text-gray-500 bg-gray-100`}>Draw</span>
  return <span className={`${base} text-gray-500 bg-gray-100`}>Done</span>
}

function MatchRow({
  match, teamMap, companyMap, bracketType,
}: {
  match: Match
  teamMap: Record<string, Team>
  companyMap: Record<string, Company>
  bracketType?: string
}) {
  const home = compactLabel(match.home_team_id ?? null, teamMap, companyMap)
  const away = compactLabel(match.away_team_id ?? null, teamMap, companyMap)
  const showTime = match.status !== 'scheduled'
  const time = match.scheduled_at ? formatTime(match.scheduled_at) : null
  const isSingleTeam = bracketType === 'heats'
  const courtName = match.locations?.name
  const hasScore = match.status === 'completed' && match.home_score != null && match.away_score != null

  if (isSingleTeam) {
    return (
      <div
        className="grid items-center gap-x-2 px-4 py-2 hover:bg-gray-50 text-sm border-t border-gray-100"
        style={{ gridTemplateColumns: '4rem 1fr 5.5rem' }}
      >
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-gray-400 tabular-nums">{showTime && time ? time : ''}</span>
          {courtName && <span className="text-xs text-gray-500 truncate">{courtName}</span>}
        </div>
        <span className="font-medium text-slate-700 truncate text-center">{home}</span>
        <div className="flex justify-end"><StatusBadge match={match}  /></div>
      </div>
    )
  }

  return (
    <div
      className="grid items-center gap-x-2 px-4 py-2 hover:bg-gray-50 text-sm border-t border-gray-100"
      style={{ gridTemplateColumns: '4rem 1fr 2rem 1fr 5.5rem' }}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-gray-400 tabular-nums">{showTime && time ? time : ''}</span>
        {courtName && <span className="text-xs text-gray-500 truncate">{courtName}</span>}
      </div>
      <span className="text-right font-medium text-slate-700 truncate">{home}</span>
      {hasScore ? (
        <span className="text-center text-xs font-semibold text-slate-600 tabular-nums">
          {match.home_score}–{match.away_score}
        </span>
      ) : (
        <span className="text-center text-xs text-gray-400">vs</span>
      )}
      <span className="font-medium text-slate-700 truncate">{away}</span>
      <div className="flex justify-end"><StatusBadge match={match}  /></div>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-3 p-4 mt-16">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-16 rounded-xl bg-gray-200 animate-pulse" />
      ))}
    </div>
  )
}

// ── Toolbar ──────────────────────────────────────────────────────────────────

function StatsStrip({ matches }: { matches: Match[] }) {
  const live     = matches.filter(m => m.status === 'in_progress').length
  const done     = matches.filter(m => isResolved(m)).length
  const upcoming = matches.filter(m => m.status === 'scheduled').length
  return (
    <div className="flex items-center gap-3 text-xs text-gray-500">
      <span className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
        {live} live
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block" />
        {done} done
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" />
        {upcoming} upcoming
      </span>
    </div>
  )
}

// ── By Sport view ────────────────────────────────────────────────────────────

function SportCard({
  sport, rounds, teamMap, companyMap, expanded, onToggle,
}: {
  sport: Sport
  rounds: { roundKey: string; matches: Match[] }[]
  teamMap: Record<string, Team>
  companyMap: Record<string, Company>
  expanded: boolean
  onToggle: () => void
}) {
  const now = useNow()
  const totalMatches = rounds.reduce((n, r) => n + r.matches.length, 0)
  const allMatches = rounds.flatMap(r => r.matches)
  const hasLive = allMatches.some(m => m.status === 'in_progress') || (
    sport.bracket_type === 'heats' &&
    allMatches.some(m => !isResolved(m)) &&
    allMatches.some(m => m.scheduled_at && new Date(m.scheduled_at) <= now)
  )

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <span className="text-xl leading-none shrink-0" aria-hidden="true">{getSportIcon(sport.name)}</span>
        <span className="font-semibold text-slate-800 flex-1">{sport.name}</span>
        {hasLive && (
          <span className="text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">Live</span>
        )}
        <span className="text-xs text-gray-400">{totalMatches} match{totalMatches !== 1 ? 'es' : ''}</span>
        <svg
          className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
          viewBox="0 0 20 20" fill="currentColor"
        >
          <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
        </svg>
      </button>

      {expanded && (
        <div>
          {rounds.map(({ roundKey, matches: roundMatches }) => (
            <div key={roundKey}>
              <div className="px-4 py-1.5 bg-white border-t border-gray-100">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  {roundKey === 'unscheduled' ? 'Unscheduled' : `Round ${roundKey}`}
                </span>
              </div>
              {roundMatches.map(match => (
                <MatchRow key={match.id} match={match} teamMap={teamMap} companyMap={companyMap} bracketType={sport.bracket_type} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Donation-count sport card ───────────────────────────────────────────────

function DonationEventCard({ sport }: { sport: Sport }) {
  const now = useNow()
  const { data: locations = [] } = useQuery({
    queryKey: ['locations', sport.id],
    queryFn: () => getLocations(sport.id),
    staleTime: Infinity,
  })

  const startLabel = sport.schedule_start ? formatTime(sport.schedule_start) : null
  const endLabel = sport.schedule_end ? formatTime(sport.schedule_end) : null
  const timeRange =
    startLabel && endLabel ? `${startLabel} – ${endLabel}` : startLabel ?? endLabel ?? 'Time TBD'
  const locationLabel = locations.map((l: Location) => l.name).join(', ')

  const startMs = sport.schedule_start ? new Date(sport.schedule_start).getTime() : null
  const endMs = sport.schedule_end ? new Date(sport.schedule_end).getTime() : null
  const isLive =
    startMs != null && now.getTime() >= startMs && (endMs == null || now.getTime() < endMs)

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 bg-gray-50">
        <span className="text-xl leading-none shrink-0" aria-hidden="true">{getSportIcon(sport.name)}</span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-800 truncate">{sport.name}</p>
          <p className="text-xs text-gray-500 truncate">
            {timeRange}
            {locationLabel && ` · ${locationLabel}`}
          </p>
        </div>
        {isLive ? (
          <span className="text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">Live</span>
        ) : (
          <span className="text-xs font-medium text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">Event</span>
        )}
      </div>
    </div>
  )
}

// ── Timeline view ────────────────────────────────────────────────────────────

function MatchChip({
  match, teamMap, companyMap, bracketType,
}: {
  match: Match
  teamMap: Record<string, Team>
  companyMap: Record<string, Company>
  bracketType?: string
}) {
  const home = teamShort(match.home_team_id, teamMap, companyMap)
  const away = teamShort(match.away_team_id, teamMap, companyMap)
  const cls = match.status === 'in_progress'
    ? 'bg-green-100 text-green-800'
    : isResolved(match)
    ? 'bg-gray-100 text-gray-600'
    : 'bg-blue-100 text-blue-800'
  const hasScore = match.status === 'completed' && match.home_score != null && match.away_score != null
  const label = bracketType === 'heats'
    ? home
    : hasScore
    ? `${home} ${match.home_score}–${match.away_score} ${away}`
    : `${home} vs ${away}`
  return (
    <div className={`text-xs rounded px-1.5 py-0.5 mb-0.5 whitespace-nowrap leading-snug ${cls}`}>
      {label}
    </div>
  )
}

function TimelineView({
  matches, sports, donationSports, teamMap, companyMap,
}: {
  matches: Match[]
  sports: Sport[]
  donationSports: Sport[]
  teamMap: Record<string, Team>
  companyMap: Record<string, Company>
}) {
  const sportIds = useMemo(() => {
    const ids = [...new Set(matches.map(m => m.sport_id))]
    // Keep same order as sorted sports list
    return sports.filter(s => ids.includes(s.id)).map(s => s.id)
  }, [matches, sports])

  const now = useNow()
  const extraTimes = useMemo(
    () =>
      donationSports.flatMap(s => [s.schedule_start, s.schedule_end].filter(Boolean) as string[]),
    [donationSports],
  )
  const timelineSlots = useMemo(() => buildTimelineSlots(matches, extraTimes), [matches, extraTimes])
  const baseMinutes = timelineSlots[0]?.minutes ?? 8 * 60

  const grid = useMemo(() => {
    const g: Record<string, Record<number, Match[]>> = {}
    for (const m of matches) {
      const timeSource = m.estimated_start ?? m.scheduled_at
      if (!timeSource) continue
      const idx = slotIndex(timeSource, baseMinutes)
      if (idx < 0 || idx >= timelineSlots.length) continue
      g[m.sport_id] ??= {}
      g[m.sport_id][idx] ??= []
      g[m.sport_id][idx].push(m)
    }
    return g
  }, [matches, baseMinutes, timelineSlots.length])

  const sportMap = useMemo(() => indexBy(sports, 'id') as Record<string, Sport>, [sports])

  if (sportIds.length === 0 && donationSports.length === 0) {
    return <p className="text-center text-gray-500 py-12">No matches to display.</p>
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <div
        style={{ display: 'grid', gridTemplateColumns: `160px repeat(${timelineSlots.length}, minmax(80px, auto))` }}
      >
        {/* Header row */}
        <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-400">
          Sport
        </div>
        {timelineSlots.map(slot => (
          <div
            key={slot.label}
            className="px-1 py-2 bg-gray-50 border-b border-l border-gray-200 text-xs text-gray-500 text-center"
          >
            {slot.label}
          </div>
        ))}

        {/* Sport rows */}
        {sportIds.map(sportId => {
          const sport = sportMap[sportId]
          const slots = grid[sportId] ?? {}
          return (
            <Fragment key={sportId}>
              <div className="flex items-center gap-2 px-3 py-3 border-b border-gray-100">
                <span className="text-base leading-none shrink-0" aria-hidden="true">{getSportIcon(sport?.name ?? '')}</span>
                <span className="text-xs font-medium text-slate-700 truncate">{sport?.name}</span>
              </div>
              {timelineSlots.map((_, idx) => (
                <div
                  key={idx}
                  className="p-1 border-b border-l border-gray-100 min-h-[48px] align-top"
                >
                  {(slots[idx] ?? []).map(m => (
                    <MatchChip key={m.id} match={m} teamMap={teamMap} companyMap={companyMap} bracketType={sportMap[m.sport_id]?.bracket_type} />
                  ))}
                </div>
              ))}
            </Fragment>
          )
        })}

        {/* Donation drive rows */}
        {donationSports.map(sport => {
          const startIdx = sport.schedule_start ? slotIndex(sport.schedule_start, baseMinutes) : -1
          const endTime = sport.schedule_end ?? sport.schedule_start
          const rawEndIdx = endTime ? slotIndex(endTime, baseMinutes) : -1
          const clampedStart = Math.max(0, Math.min(startIdx, timelineSlots.length - 1))
          const clampedEnd = Math.max(clampedStart, Math.min(rawEndIdx, timelineSlots.length - 1))
          const hasRange = startIdx >= 0
          const span = hasRange ? clampedEnd - clampedStart + 1 : 0
          const leading = hasRange ? clampedStart : 0
          const trailing = hasRange ? timelineSlots.length - clampedEnd - 1 : timelineSlots.length
          const startMs = sport.schedule_start ? new Date(sport.schedule_start).getTime() : null
          const endMs = sport.schedule_end ? new Date(sport.schedule_end).getTime() : null
          const isLive =
            startMs != null && now.getTime() >= startMs && (endMs == null || now.getTime() < endMs)
          const chipClass = isLive
            ? 'bg-green-100 text-green-800'
            : 'bg-blue-100 text-blue-800'
          const timeLabel =
            sport.schedule_start && sport.schedule_end
              ? `${formatTime(sport.schedule_start)} – ${formatTime(sport.schedule_end)}`
              : sport.schedule_start
              ? formatTime(sport.schedule_start)
              : 'Time TBD'
          return (
            <Fragment key={sport.id}>
              <div className="flex items-center gap-2 px-3 py-3 border-b border-gray-100">
                <span className="text-base leading-none shrink-0" aria-hidden="true">{getSportIcon(sport.name)}</span>
                <span className="text-xs font-medium text-slate-700 truncate">{sport.name}</span>
              </div>
              {Array.from({ length: leading }).map((_, i) => (
                <div key={`l-${i}`} className="p-1 border-b border-l border-gray-100 min-h-[48px]" />
              ))}
              {hasRange ? (
                <div
                  className="p-1 border-b border-l border-gray-100 min-h-[48px]"
                  style={{ gridColumn: `span ${span}` }}
                >
                  <div className={`text-xs rounded px-1.5 py-0.5 whitespace-nowrap leading-snug truncate ${chipClass}`}>
                    {timeLabel}
                  </div>
                </div>
              ) : null}
              {Array.from({ length: trailing }).map((_, i) => (
                <div key={`t-${i}`} className="p-1 border-b border-l border-gray-100 min-h-[48px]" />
              ))}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function Schedule() {
  const [view, setView]                   = useTabMemory<ViewMode>('/schedule/view', 'by_sport')
  const [companyFilter, setCompanyFilter] = useState<string>(
    () => localStorage.getItem('schedule_company_filter') ?? 'all'
  )
  const [statusFilter, setStatusFilter]   = useState<StatusFilter>('active')
  const [expandedSports, setExpandedSports] = useState<Set<string>>(new Set())

  const { matches, sports, sportMap, teamMap, companyMap, isLoading, isError } = useScheduleData()

  const teams = useMemo(() => Object.values(teamMap), [teamMap])
  const companyTeamIds = useMemo(
    () => getCompanyIdsForFilter(companyFilter, teams),
    [companyFilter, teams],
  )

  const filteredMatches = useMemo(() =>
    matches
      .filter(m => m.home_team_id !== null || m.away_team_id !== null)
      .filter(m => {
        if (companyFilter === 'all') return true
        return companyTeamIds.has(m.home_team_id ?? '') || companyTeamIds.has(m.away_team_id ?? '')
      })
      .filter(m => matchesStatusFilter(m, statusFilter)),
    [matches, companyFilter, companyTeamIds, statusFilter],
  )

  const grouped = useMemo(
    () => groupBySportAndRound(filteredMatches, sportMap),
    [filteredMatches, sportMap],
  )

  const donationSports = useMemo(
    () =>
      sports
        .filter(s => s.scoring_mode === 'donation_count')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [sports],
  )

  function toggleSport(sportId: string) {
    setExpandedSports(prev => {
      const next = new Set(prev)
      next.has(sportId) ? next.delete(sportId) : next.add(sportId)
      return next
    })
  }

  if (isLoading) return <Skeleton />
  if (isError)   return <p className="text-center text-red-500 p-8">Failed to load schedule.</p>

  return (
    <div className="p-4 space-y-3">
      {/* Toolbar row 1: toggle + stats */}
      <div className="flex items-center gap-3 mt-2">
        <div className="flex rounded-lg bg-gray-100 p-1">
          {(['by_sport', 'timeline'] as ViewMode[]).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                view === v ? 'bg-white shadow-sm text-slate-800' : 'text-gray-500'
              }`}
            >
              {v === 'by_sport' ? 'By Sport' : 'Timeline'}
            </button>
          ))}
        </div>
        <div className="flex-1 flex justify-end">
          <StatsStrip matches={matches} />
        </div>
      </div>

      {/* Toolbar row 2: company filter */}
      <div className="flex gap-2">
        <select
          value={companyFilter}
          onChange={e => {
            setCompanyFilter(e.target.value)
            localStorage.setItem('schedule_company_filter', e.target.value)
          }}
          className="flex-1 text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white text-slate-700"
        >
          <option value="all">All companies</option>
          {[...Object.values(companyMap)].sort((a, b) => a.name.localeCompare(b.name)).map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div className="flex rounded-lg bg-gray-100 p-1 gap-0.5">
        {([
          ['active',    'Live & Upcoming'],
          ['live',      'Live'],
          ['upcoming',  'Upcoming'],
          ['completed', 'Completed'],
        ] as [StatusFilter, string][]).map(([val, label]) => (
          <button
            key={val}
            onClick={() => setStatusFilter(val)}
            className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              statusFilter === val ? 'bg-white shadow-sm text-slate-800' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Views */}
      {view === 'by_sport' && (
        <div className="space-y-2">
          {grouped.length === 0 && donationSports.length === 0 && (
            <p className="text-center text-gray-500 py-12">No matches found.</p>
          )}
          {donationSports.map(s => <DonationEventCard key={s.id} sport={s} />)}
          {grouped.map(({ sportId, sport, rounds }) => (
            <SportCard
              key={sportId}
              sport={sport}
              rounds={rounds}
              teamMap={teamMap}
              companyMap={companyMap}
              expanded={expandedSports.has(sportId)}
              onToggle={() => toggleSport(sportId)}
            />
          ))}
        </div>
      )}

      {view === 'timeline' && (
        <TimelineView
          matches={filteredMatches}
          sports={[...sports].sort((a, b) => a.name.localeCompare(b.name))}
          donationSports={donationSports}
          teamMap={teamMap}
          companyMap={companyMap}
        />
      )}
    </div>
  )
}
