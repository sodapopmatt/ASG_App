import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { startMatch, submitResult, submitForfeit, submitDoubleForfeit } from '../api/matches'
import type { Match, Team, Company } from '../types'

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

type PanelMode = 'result' | 'forfeit' | 'double_forfeit'

export default function MatchResultModal({
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

  const onSuccess = () => { qc.invalidateQueries({ queryKey: ['matches'] }); onClose() }
  const onError = (e: unknown) => setError(e instanceof Error ? e.message : 'Failed to submit')

  const startMutation        = useMutation({ mutationFn: () => startMatch(match.id), onSuccess, onError })
  const resultMutation       = useMutation({ mutationFn: (winnerId: string) => submitResult(match.id, winnerId), onSuccess, onError })
  const forfeitMutation      = useMutation({ mutationFn: (forfeitingTeamId: string) => submitForfeit(match.id, forfeitingTeamId), onSuccess, onError })
  const doubleForfeitMutation = useMutation({ mutationFn: () => submitDoubleForfeit(match.id), onSuccess, onError })

  const isPending = startMutation.isPending || resultMutation.isPending || forfeitMutation.isPending || doubleForfeitMutation.isPending

  const handleForfeit = (forfeitingTeamId: string, label: string) => {
    if (!window.confirm(`Mark "${label}" as forfeited? Their opponent will be recorded as the winner.`)) return
    forfeitMutation.mutate(forfeitingTeamId)
  }

  const handleDoubleForfeit = () => {
    if (!window.confirm('Mark both teams as forfeited? Neither team will advance.')) return
    doubleForfeitMutation.mutate()
  }

  const switchMode = (next: PanelMode) => { setMode(next); setError(null) }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>
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
                  ? m === 'result'      ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/40'
                  : m === 'forfeit'     ? 'text-red-600 border-b-2 border-red-600 bg-red-50/40'
                  :                       'text-orange-600 border-b-2 border-orange-600 bg-orange-50/40'
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
              <p className="text-sm text-gray-600">Both teams take a loss. Neither team advances.</p>
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
