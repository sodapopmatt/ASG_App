import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getLeaderboard } from '../api/leaderboard'
import { getEventPoints } from '../api/event_points'
import { getSports } from '../api/sports'
import { getCompanies } from '../api/companies'
import type { LeaderboardEntry, EventPoints, Sport, Company } from '../types'

const RANK_STYLES: Record<number, string> = {
  0: 'text-yellow-500',
  1: 'text-slate-400',
  2: 'text-amber-700',
}

type Tab = 'company' | 'sport'

function RankBadge({ rank }: { rank: number }) {
  const color = RANK_STYLES[rank] ?? 'text-gray-400'
  return (
    <span className={`w-8 text-center text-lg font-bold tabular-nums ${color}`}>
      {rank + 1}
    </span>
  )
}

function EntryCard({ entry, rank }: { entry: LeaderboardEntry; rank: number }) {
  return (
    <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100 flex items-center gap-3">
      <RankBadge rank={rank} />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-slate-800 truncate">{entry.company_name}</p>
        <p className="text-xs text-gray-400">
          {entry.sports_scored} sport{entry.sports_scored !== 1 ? 's' : ''} scored
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-xl font-bold text-blue-600 tabular-nums">{entry.total_points}</p>
        <p className="text-xs text-gray-400">pts</p>
      </div>
    </div>
  )
}

function PlacementRow({
  placement,
  company_name,
  points,
}: {
  placement: number
  company_name: string
  points: number
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <RankBadge rank={placement - 1} />
      <p className="flex-1 min-w-0 text-slate-800 truncate">{company_name}</p>
      <p className="text-right shrink-0 font-semibold text-blue-600 tabular-nums">
        {points}
        <span className="ml-1 text-xs text-gray-400 font-normal">pts</span>
      </p>
    </div>
  )
}

function SportSection({
  sport,
  rows,
  defaultOpen,
}: {
  sport: Sport
  rows: { placement: number; company_name: string; points: number }[]
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const sorted = [...rows].sort((a, b) => a.placement - b.placement)

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div>
          <p className="font-semibold text-slate-800">{sport.name}</p>
          <p className="text-xs text-gray-400">
            {sorted.length} placement{sorted.length !== 1 ? 's' : ''} recorded
          </p>
        </div>
        <span className={`text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}>
          ▸
        </span>
      </button>
      {open && (
        <div className="border-t border-gray-100 divide-y divide-gray-50 pb-1">
          {sorted.map((r, i) => (
            <PlacementRow key={`${r.placement}-${i}`} {...r} />
          ))}
        </div>
      )}
    </div>
  )
}

function Tabs({ value, onChange }: { value: Tab; onChange: (t: Tab) => void }) {
  const base =
    'flex-1 py-2.5 text-sm font-semibold rounded-lg transition-colors text-center'
  const active = 'bg-white text-slate-900 shadow-sm'
  const inactive = 'text-gray-400'
  return (
    <div className="bg-gray-100 rounded-xl p-1 flex gap-1">
      <button
        type="button"
        onClick={() => onChange('company')}
        className={`${base} ${value === 'company' ? active : inactive}`}
      >
        By Company
      </button>
      <button
        type="button"
        onClick={() => onChange('sport')}
        className={`${base} ${value === 'sport' ? active : inactive}`}
      >
        By Sport
      </button>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-2 p-4 mt-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-16 rounded-xl bg-gray-200 animate-pulse" />
      ))}
    </div>
  )
}

export default function Leaderboard() {
  const [tab, setTab] = useState<Tab>('company')

  const overall = useQuery({
    queryKey: ['leaderboard'],
    queryFn: getLeaderboard,
    refetchInterval: 30_000,
  })

  const sports = useQuery({ queryKey: ['sports'], queryFn: getSports, enabled: tab === 'sport' })
  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: getCompanies,
    enabled: tab === 'sport',
  })
  const eventPoints = useQuery({
    queryKey: ['event-points', 'all'],
    queryFn: () => getEventPoints(),
    refetchInterval: 30_000,
    enabled: tab === 'sport',
  })

  const bySportLoading =
    sports.isLoading || companies.isLoading || eventPoints.isLoading

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-baseline justify-between mt-2">
        <h2 className="text-xl font-bold text-slate-800">Standings</h2>
        <span className="text-xs text-gray-400">Live · refreshes every 30s</span>
      </div>

      <Tabs value={tab} onChange={setTab} />

      {tab === 'company' && (
        <div className="space-y-2">
          {overall.isLoading && <Skeleton />}
          {overall.isError && (
            <p className="text-center text-red-500 p-8">Failed to load standings.</p>
          )}
          {overall.data?.length === 0 && (
            <p className="text-center text-gray-500 py-12">No scores recorded yet.</p>
          )}
          {overall.data?.map((entry, idx) => (
            <EntryCard key={entry.company_id} entry={entry} rank={idx} />
          ))}
        </div>
      )}

      {tab === 'sport' && (
        <div className="space-y-2">
          {bySportLoading && <Skeleton />}
          {!bySportLoading && (() => {
            const companyById = new Map<string, Company>(
              (companies.data ?? []).map((c) => [c.id, c]),
            )
            const bySport = new Map<string, EventPoints[]>()
            for (const ep of eventPoints.data ?? []) {
              const list = bySport.get(ep.sport_id) ?? []
              list.push(ep)
              bySport.set(ep.sport_id, list)
            }
            const sportsWithResults = (sports.data ?? [])
              .map((s) => ({
                sport: s,
                rows: (bySport.get(s.id) ?? []).map((ep) => ({
                  placement: ep.placement,
                  points: ep.points,
                  company_name: companyById.get(ep.company_id)?.name ?? 'Unknown',
                })),
              }))
              .filter((s) => s.rows.length > 0)
              .sort((a, b) => a.sport.name.localeCompare(b.sport.name))

            if (sportsWithResults.length === 0) {
              return (
                <p className="text-center text-gray-500 py-12">
                  No sport placements recorded yet.
                </p>
              )
            }
            return sportsWithResults.map(({ sport, rows }, i) => (
              <SportSection key={sport.id} sport={sport} rows={rows} defaultOpen={i === 0} />
            ))
          })()}
        </div>
      )}
    </div>
  )
}
