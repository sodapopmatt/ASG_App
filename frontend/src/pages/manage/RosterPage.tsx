import { useState, type FormEvent } from 'react'
import { useParams, Link } from 'react-router-dom'
import BackLink from '../../components/BackLink'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getTeam } from '../../api/teams'
import { getRosterEntries, addRosterEntry, removeRosterEntry } from '../../api/roster_entries'
import { getSports } from '../../api/sports'
import { getCompanies } from '../../api/companies'
import type { RosterEntry } from '../../types'

const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="m19 6-.867 12.142A2 2 0 0 1 16.138 20H7.862a2 2 0 0 1-1.995-1.858L5 6" />
    <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
)

export default function RosterPage() {
  const { teamId } = useParams<{ teamId: string }>()
  const qc = useQueryClient()

  const [name, setName] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const { data: team } = useQuery({
    queryKey: ['teams', teamId],
    queryFn: () => getTeam(teamId!),
    enabled: !!teamId,
  })

  const { data: sports = [] } = useQuery({ queryKey: ['sports'], queryFn: getSports, staleTime: Infinity })
  const { data: companies = [] } = useQuery({ queryKey: ['companies'], queryFn: getCompanies, staleTime: Infinity })

  const { data: roster = [], isLoading } = useQuery({
    queryKey: ['roster-entries', teamId],
    queryFn: () => getRosterEntries(teamId!),
    enabled: !!teamId,
  })

  const addMutation = useMutation({
    mutationFn: (playerName: string) => addRosterEntry(teamId!, playerName),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roster-entries', teamId] })
      setName('')
      setFormError(null)
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : 'Failed to add player'),
  })

  const removeMutation = useMutation({
    mutationFn: (entryId: string) => removeRosterEntry(entryId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roster-entries', teamId] }),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setFormError(null)
    addMutation.mutate(trimmed)
  }

  const sportName   = sports.find(s => s.id === team?.sport_id)?.name ?? '—'
  const companyName = companies.find(c => c.id === team?.company_id)?.name ?? '—'

  return (
    <div className="p-4 mt-2 space-y-4">
      <div className="flex items-center gap-2">
        <BackLink to="/manage/teams" label="Teams" />
      </div>

      <div>
        <h2 className="text-xl font-bold text-slate-800">
          {companyName}{team?.name ? ` · ${team.name}` : ''}
        </h2>
        <p className="text-sm text-gray-400">{sportName} roster</p>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Player name"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={!name.trim() || addMutation.isPending}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
        >
          Add
        </button>
      </form>
      {formError && <p className="text-sm text-red-600">{formError}</p>}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider pt-3 pb-1">
          On roster ({roster.length})
        </p>

        {isLoading && (
          <div className="space-y-2 py-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-8 rounded bg-gray-100 animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && roster.length === 0 && (
          <p className="text-sm text-gray-400 py-3">No players on this roster yet.</p>
        )}

        {roster.map((entry: RosterEntry) => (
          <div
            key={entry.id}
            className="flex items-center gap-3 py-2.5 border-b border-gray-100 last:border-0"
          >
            <p className="flex-1 text-sm font-medium text-slate-800">{entry.player_name}</p>
            <button
              onClick={() => removeMutation.mutate(entry.id)}
              disabled={removeMutation.isPending}
              className="shrink-0 text-gray-300 hover:text-red-400 transition-colors disabled:opacity-40"
              aria-label="Remove player"
            >
              <TrashIcon />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
