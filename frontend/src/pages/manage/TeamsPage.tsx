import { useState, useMemo, useEffect, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getTeams, createTeam, updateTeam, deleteTeam } from '../../api/teams'
import { getSports } from '../../api/sports'
import { getCompanies } from '../../api/companies'
import { useAuth } from '../../contexts/AuthContext'
import type { Team, Sport, Company } from '../../types'

function indexBy<T>(arr: T[], key: keyof T): Record<string, T> {
  return Object.fromEntries(arr.map(item => [String(item[key]), item]))
}

const ChevronDownIcon = ({ open }: { open: boolean }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    className={`transition-transform ${open ? 'rotate-180' : ''}`}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
)

const EditIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
  </svg>
)

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

  const [editingTeamId, setEditingTeamId] = useState<string | null>(null)
  const [editingTeamName, setEditingTeamName] = useState('')

  const [filterSports, setFilterSports] = useState<Set<string>>(new Set())
  const [filterCompany, setFilterCompany] = useState<string>('')
  const [collapsedSports, setCollapsedSports] = useState<Set<string> | null>(null)
  const [collapsedCompanies, setCollapsedCompanies] = useState<Set<string> | null>(null)

  const { data: teams = [] } = useQuery({ queryKey: ['teams'], queryFn: () => getTeams() })
  const { data: sports = [] } = useQuery({ queryKey: ['sports'], queryFn: getSports, staleTime: Infinity })
  const { data: companies = [] } = useQuery({ queryKey: ['companies'], queryFn: getCompanies, staleTime: Infinity })

  const sportMap = useMemo(() => indexBy(sports, 'id') as Record<string, Sport>, [sports])
  const companyMap = useMemo(() => indexBy(companies, 'id') as Record<string, Company>, [companies])

  useEffect(() => {
    if (collapsedSports === null && sports.length > 0) {
      setCollapsedSports(new Set(sports.map(s => s.id)))
    }
  }, [sports])

  useEffect(() => {
    if (collapsedCompanies === null && companies.length > 0) {
      setCollapsedCompanies(new Set(companies.map(c => c.id)))
    }
  }, [companies])

  const grouped = useMemo(() => {
    const map = new Map<string, Map<string, Team[]>>()
    for (const team of teams) {
      if (!map.has(team.sport_id)) {
        map.set(team.sport_id, new Map())
      }
      const companies = map.get(team.sport_id)!
      const existing = companies.get(team.company_id) ?? []
      existing.push(team)
      companies.set(team.company_id, existing)
    }
    return map
  }, [teams])

  const filtered = useMemo(() => {
    const result = new Map<string, Map<string, Team[]>>()
    for (const [sportId, companiesMap] of grouped) {
      if (filterSports.size > 0 && !filterSports.has(sportId)) continue

      const filteredCompanies = new Map<string, Team[]>()
      for (const [companyId, teamList] of companiesMap) {
        if (filterCompany && companyId !== filterCompany) continue
        filteredCompanies.set(companyId, teamList)
      }

      if (filteredCompanies.size > 0) {
        result.set(sportId, filteredCompanies)
      }
    }
    return result
  }, [grouped, filterSports, filterCompany])

  const createMutation = useMutation({
    mutationFn: () => createTeam({ company_id: companyId, sport_id: sportId, name: name || null }),
    onSuccess: () => {
      qc.refetchQueries({ queryKey: ['teams'] })
      setShowForm(false)
      setCompanyId('')
      setSportId('')
      setName('')
      setFormError(null)
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : 'Failed to create team'),
  })

  const updateMutation = useMutation({
    mutationFn: (params: { id: string; name: string | null }) => updateTeam(params.id, { name: params.name }),
    onSuccess: () => {
      qc.refetchQueries({ queryKey: ['teams'] })
      setEditingTeamId(null)
      setEditingTeamName('')
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : 'Failed to update team'
      alert(message)
    }
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTeam(id),
    onSuccess: () => qc.refetchQueries({ queryKey: ['teams'] }),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)

    if (!companyId || !sportId) {
      setFormError('Company and sport are required')
      return
    }

    // Check for duplicate team name
    if (name) {
      const existingTeam = teams.find(
        t => t.company_id === companyId && t.sport_id === sportId && t.name === name
      )
      if (existingTeam) {
        setFormError(`A team named '${name}' already exists for this company and sport`)
        return
      }
    }

    createMutation.mutate()
  }

  function toggleSportCollapse(sportId: string) {
    setCollapsedSports(prev => {
      const next = new Set(prev || [])
      if (next.has(sportId)) {
        next.delete(sportId)
      } else {
        next.add(sportId)
      }
      return next
    })
  }

  function toggleCompanyCollapse(companyId: string) {
    setCollapsedCompanies(prev => {
      const next = new Set(prev || [])
      if (next.has(companyId)) {
        next.delete(companyId)
      } else {
        next.add(companyId)
      }
      return next
    })
  }

  function toggleSportFilter(sportId: string) {
    setFilterSports(prev => {
      const next = new Set(prev)
      if (next.has(sportId)) {
        next.delete(sportId)
      } else {
        next.add(sportId)
      }
      return next
    })
  }

  const hasFilters = filterSports.size > 0 || filterCompany.length > 0

  return (
    <div className="p-4 mt-2 space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/manage" className="text-blue-600 text-sm">← Manage</Link>
      </div>

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
              placeholder="e.g. A"
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

      <div className="bg-white rounded-xl p-4 border border-gray-200 space-y-3">
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">Sport</label>
          <div className="flex flex-wrap gap-2">
            {sports.map(sport => (
              <button
                key={sport.id}
                onClick={() => toggleSportFilter(sport.id)}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  filterSports.has(sport.id)
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {sport.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700">Company</label>
          <select
            value={filterCompany}
            onChange={e => setFilterCompany(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All companies</option>
            {companies.map(company => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </div>

        {hasFilters && (
          <button
            onClick={() => {
              setFilterSports(new Set())
              setFilterCompany('')
            }}
            className="text-sm text-gray-600 hover:text-gray-900 font-medium"
          >
            Clear filters
          </button>
        )}
      </div>

      {filtered.size === 0 && (
        <p className="text-center text-gray-400 py-12">
          {hasFilters ? 'No teams match your filters.' : 'No teams yet.'}
        </p>
      )}

      {[...filtered.entries()]
        .sort(([a], [b]) => (sportMap[a]?.name ?? '').localeCompare(sportMap[b]?.name ?? ''))
        .map(([sportId, companiesMap]) => {
          const sportCollapsed = collapsedSports?.has(sportId) ?? true
          const sportName = sportMap[sportId]?.name ?? 'Unknown sport'
          const sportTeamCount = Array.from(companiesMap.values()).reduce((sum, teams) => sum + teams.length, 0)

          return (
            <div key={sportId} className="space-y-2">
              <button
                onClick={() => toggleSportCollapse(sportId)}
                className="w-full flex items-center gap-2 px-4 py-3 bg-white rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                <ChevronDownIcon open={!sportCollapsed} />
                <span className="flex-1 text-left text-sm font-semibold text-slate-800">
                  {sportName}
                </span>
                <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                  {sportTeamCount}
                </span>
              </button>

              {!sportCollapsed && (
                <div className="space-y-2 pl-4">
                  {[...companiesMap.entries()]
                    .sort(([a], [b]) => (companyMap[a]?.name ?? '').localeCompare(companyMap[b]?.name ?? ''))
                    .map(([companyId, teamList]) => {
                      const companyCollapsed = collapsedCompanies?.has(companyId) ?? true
                      const companyName = companyMap[companyId]?.name ?? 'Unknown company'

                      return (
                        <div key={companyId} className="space-y-2">
                          <button
                            onClick={() => toggleCompanyCollapse(companyId)}
                            className="w-full flex items-center gap-2 px-4 py-2 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors"
                          >
                            <ChevronDownIcon open={!companyCollapsed} />
                            <span className="flex-1 text-left text-sm font-medium text-slate-700">
                              {companyName}
                            </span>
                            <span className="text-xs font-medium text-gray-500">
                              {teamList.length}
                            </span>
                          </button>

                          {!companyCollapsed && (
                            <div className="space-y-2">
                              {teamList.map(team => {
                                const isEditing = editingTeamId === team.id

                                return isEditing ? (
                                  <div
                                    key={team.id}
                                    className="bg-blue-50 rounded-lg px-4 py-3 border border-blue-200 space-y-2"
                                  >
                                    <input
                                      type="text"
                                      value={editingTeamName}
                                      onChange={e => setEditingTeamName(e.target.value)}
                                      placeholder="Team name (optional)"
                                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      autoFocus
                                    />
                                    <div className="flex gap-2">
                                      <button
                                        onClick={() => {
                                          setEditingTeamId(null)
                                          setEditingTeamName('')
                                        }}
                                        className="flex-1 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg py-1.5 transition-colors"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        onClick={() => {
                                          const newName = editingTeamName || null
                                          // Check for duplicate name in same company/sport (excluding current team)
                                          if (newName) {
                                            const duplicate = teams.find(
                                              t => t.id !== team.id && t.company_id === team.company_id && t.sport_id === team.sport_id && t.name === newName
                                            )
                                            if (duplicate) {
                                              alert(`A team named '${newName}' already exists for this company and sport`)
                                              return
                                            }
                                          }
                                          updateMutation.mutate({
                                            id: team.id,
                                            name: newName,
                                          })
                                        }}
                                        disabled={updateMutation.isPending}
                                        className="flex-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg py-1.5 transition-colors disabled:opacity-50"
                                      >
                                        {updateMutation.isPending ? 'Saving…' : 'Save'}
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div
                                    key={team.id}
                                    className="bg-white rounded-lg px-4 py-3 border border-gray-100 shadow-sm flex items-center gap-3"
                                  >
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm text-slate-800 truncate">
                                        {team.name || 'Default team'}
                                      </p>
                                    </div>
                                    <Link
                                      to={`/manage/teams/${team.id}/roster`}
                                      className="shrink-0 text-xs font-medium text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full"
                                    >
                                      Roster
                                    </Link>
                                    {isAdmin && (
                                      <>
                                        <button
                                          onClick={() => {
                                            setEditingTeamId(team.id)
                                            setEditingTeamName(team.name || '')
                                          }}
                                          className="shrink-0 text-gray-300 hover:text-blue-400 transition-colors"
                                          aria-label="Edit team"
                                        >
                                          <EditIcon />
                                        </button>
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
                                      </>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                </div>
              )}
            </div>
          )
        })}
    </div>
  )
}
