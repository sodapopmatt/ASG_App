import { useState, useMemo, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getTeams, createTeam, deleteTeam } from '../../api/teams'
import { getSports } from '../../api/sports'
import { getCompanies } from '../../api/companies'
import { useAuth } from '../../contexts/AuthContext'
import type { Team, Sport, Company } from '../../types'

function indexBy<T>(arr: T[], key: keyof T): Record<string, T> {
  return Object.fromEntries(arr.map(item => [String(item[key]), item]))
}

const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="m19 6-.867 12.142A2 2 0 0 1 16.138 20H7.862a2 2 0 0 1-1.995-1.858L5 6" />
    <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
)

export default function TeamsPage() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const qc = useQueryClient()

  const [showForm, setShowForm] = useState(false)
  const [companyId, setCompanyId] = useState('')
  const [sportId, setSportId] = useState('')
  const [name, setName] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const { data: teams = [] } = useQuery({ queryKey: ['teams'], queryFn: () => getTeams() })
  const { data: sports = [] } = useQuery({ queryKey: ['sports'], queryFn: getSports, staleTime: Infinity })
  const { data: companies = [] } = useQuery({ queryKey: ['companies'], queryFn: getCompanies, staleTime: Infinity })

  const sportMap = useMemo(() => indexBy(sports, 'id') as Record<string, Sport>, [sports])
  const companyMap = useMemo(() => indexBy(companies, 'id') as Record<string, Company>, [companies])

  const grouped = useMemo(() => {
    const map = new Map<string, Team[]>()
    for (const team of teams) {
      const existing = map.get(team.sport_id) ?? []
      existing.push(team)
      map.set(team.sport_id, existing)
    }
    return map
  }, [teams])

  const createMutation = useMutation({
    mutationFn: () => createTeam({ company_id: companyId, sport_id: sportId, name: name || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] })
      setShowForm(false)
      setCompanyId('')
      setSportId('')
      setName('')
      setFormError(null)
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : 'Failed to create team'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTeam(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams'] }),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    createMutation.mutate()
  }

  return (
    <div className="p-4 mt-2 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-800">Teams</h2>
        {isAdmin && (
          <button
            onClick={() => setShowForm(v => !v)}
            className="text-sm font-medium text-blue-600"
          >
            {showForm ? 'Cancel' : '+ Add Team'}
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl p-4 border border-gray-200 space-y-3">
          <div>
            <label className="text-sm font-medium text-slate-700">Company</label>
            <select
              required
              value={companyId}
              onChange={e => setCompanyId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select company…</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">Sport</label>
            <select
              required
              value={sportId}
              onChange={e => setSportId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select sport…</option>
              {sports.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">
              Team name{' '}
              <span className="text-gray-400 font-normal">(optional, for multi-team sports)</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Team A"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="w-full py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {createMutation.isPending ? 'Creating…' : 'Create Team'}
          </button>
        </form>
      )}

      {grouped.size === 0 && (
        <p className="text-center text-gray-400 py-12">No teams yet.</p>
      )}

      {[...grouped.entries()]
        .sort(([a], [b]) => (sportMap[a]?.name ?? '').localeCompare(sportMap[b]?.name ?? ''))
        .map(([sid, sportTeams]) => (
          <div key={sid}>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              {sportMap[sid]?.name ?? 'Unknown sport'}
            </p>
            <div className="space-y-2">
              {sportTeams.map(team => (
                <div
                  key={team.id}
                  className="bg-white rounded-xl px-4 py-3 border border-gray-100 shadow-sm flex items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 truncate">
                      {companyMap[team.company_id]?.name ?? '—'}
                      {team.name && (
                        <span className="text-gray-400 font-normal"> · {team.name}</span>
                      )}
                    </p>
                  </div>
                  <Link
                    to={`/manage/teams/${team.id}/roster`}
                    className="shrink-0 text-xs font-medium text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full"
                  >
                    Roster
                  </Link>
                  {isAdmin && (
                    <button
                      onClick={() => {
                        if (confirm('Delete this team and its roster?')) {
                          deleteMutation.mutate(team.id)
                        }
                      }}
                      className="shrink-0 text-gray-300 hover:text-red-400 transition-colors"
                      aria-label="Delete team"
                    >
                      <TrashIcon />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
    </div>
  )
}
