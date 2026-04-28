import { useQuery } from '@tanstack/react-query'
import { getLeaderboard } from '../api/leaderboard'
import type { LeaderboardEntry } from '../types'

const RANK_STYLES: Record<number, string> = {
  0: 'text-yellow-500',
  1: 'text-slate-400',
  2: 'text-amber-700',
}

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
  const { data, isLoading, isError } = useQuery({
    queryKey: ['leaderboard'],
    queryFn: getLeaderboard,
    refetchInterval: 30_000,
  })

  if (isLoading) return <Skeleton />
  if (isError) return <p className="text-center text-red-500 p-8">Failed to load standings.</p>

  return (
    <div className="p-4 space-y-2">
      <div className="flex items-baseline justify-between mt-2 mb-3">
        <h2 className="text-xl font-bold text-slate-800">Overall Standings</h2>
        <span className="text-xs text-gray-400">Live · refreshes every 30s</span>
      </div>

      {data?.length === 0 && (
        <p className="text-center text-gray-500 py-12">No scores recorded yet.</p>
      )}

      {data?.map((entry, idx) => (
        <EntryCard key={entry.company_id} entry={entry} rank={idx} />
      ))}
    </div>
  )
}
