import { useState, useMemo, type FormEvent } from 'react'
import { useParams, Link } from 'react-router-dom'
import BackLink from '../../components/BackLink'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getTeams, createTeam, updateTeam, deleteTeam } from '../../api/teams'
import { getSports } from '../../api/sports'
import { getCompanies } from '../../api/companies'
import { getRosterEntries, addRosterEntry, removeRosterEntry } from '../../api/roster_entries'
import { useAuth } from '../../contexts/AuthContext'
import type { Team, Sport, Company } from '../../types'

function indexBy<T>(arr: T[], key: keyof T): Record<string, T> {
  return Object.fromEntries(arr.map(item => [String(item[key]), item]))
}

const ChevronDownIcon = ({ open }: { open: boolean }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    className={`transition-transform shrink-0 ${open ? 'rotate-180' : ''}`}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
)

const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="m19 6-.867 12.142A2 2 0 0 1 16.138 20H7.862a2 2 0 0 1-1.995-1.858L5 6" />
    <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
)

const EditIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
  </svg>
)

// ---- Roster panel ------------------------------------------------------------

function RosterPanel({ team, isAdmin }: { team: Team; isAdmin: boolean }) {
  const qc = useQueryClient()
  const [playerName, setPlayerName] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const { data: roster = [], isLoading } = useQuery({
    queryKey: ['roster-entries', team.id],
    queryFn: () => getRosterEntries(team.id),
    staleTime: Infinity,
  })

  const addMutation = useMutation({
    mutationFn: (name: string) => addRosterEntry(team.id, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roster-entries', team.id] })
      setPlayerName('')
      setFormError(null)
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : 'Failed to add player'),
  })

  const removeMutation = useMutation({
    mutationFn: (entryId: string) => removeRosterEntry(entryId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roster-entries', team.id] }),
  })

  function handleAdd(e: FormEvent) {
    e.preventDefault()
    const trimmed = playerName.trim()
    if (!trimmed) return
    addMutation.mutate(trimmed)
  }

  return (
    <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 space-y-3">
      {isAdmin && (
        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            type="text"
            value={playerName}
            onChange={e => setPlayerName(e.target.value)}
            placeholder="Player name"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={!playerName.trim() || addMutation.isPending}
            className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            Add
          </button>
        </form>
      )}
      {formError && <p className="text-xs text-red-600">{formError}</p>}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-4 rounded bg-gray-200 animate-pulse" />
          ))}
        </div>
      ) : roster.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No players on this roster yet.</p>
      ) : (
        <div className="space-y-1">
          {roster.map((entry, i) => (
            <div key={entry.id} className="flex items-center gap-2">
              <span className="text-gray-300 tabular-nums w-5 text-right text-sm shrink-0">{i + 1}</span>
              <span className="flex-1 text-sm text-slate-700 truncate">{entry.player_name}</span>
              {isAdmin && (
                <button
                  onClick={() => removeMutation.mutate(entry.id)}
                  disabled={removeMutation.isPending}
                  className="shrink-0 text-gray-300 hover:text-red-400 transition-colors disabled:opacity-40"
                  aria-label="Remove player"
                >
                  <TrashIcon />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---- Team card ---------------------------------------------------------------

function TeamCard({ team, isAdmin }: { team: Team; isAdmin: boolean }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')

  const updateMutation = useMutation({
    mutationFn: (name: string | null) => updateTeam(team.id, { name }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['teams'] }); setEditing(false) },
    onError: (e) => alert(e instanceof Error ? e.message : 'Failed to update'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteTeam(team.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams'] }),
  })

  if (editing) {
    return (
      <div className="bg-blue-50 rounded-lg border border-blue-200 px-4 py-3 space-y-2">
        <input
          type="text"
          value={editName}
          onChange={e => setEditName(e.target.value)}
          placeholder="Team name (optional)"
          autoFocus
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex gap-2">
          <button onClick={() => setEditing(false)}
            className="flex-1 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg py-1.5">
            Cancel
          </button>
          <button
            onClick={() => updateMutation.mutate(editName.trim() || null)}
            disabled={updateMutation.isPending}
            className="flex-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg py-1.5 disabled:opacity-50"
          >
            {updateMutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <button
          onClick={() => setOpen(v => !v)}
          className="flex-1 flex items-center gap-2 text-left min-w-0"
        >
          <span className="text-sm font-medium text-slate-700 truncate">
            {team.name || 'Team'}
          </span>
          <ChevronDownIcon open={open} />
        </button>
        {isAdmin && (
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => { setEditing(true); setEditName(team.name || '') }}
              className="text-gray-300 hover:text-blue-400 transition-colors"
              aria-label="Edit team"
            >
              <EditIcon />
            </button>
            <button
              onClick={() => { if (confirm('Delete this team and its roster?')) deleteMutation.mutate() }}
              className="text-gray-300 hover:text-red-400 transition-colors"
              aria-label="Delete team"
            >
              <TrashIcon />
            </button>
          </div>
        )}
      </div>
      {open && <RosterPanel team={team} isAdmin={isAdmin} />}
    </div>
  )
}

// ---- Sport section -----------------------------------------------------------

function SportSection({
  sport,
  teams,
  companyId,
  allTeams,
  isAdmin,
}: {
  sport: Sport
  teams: Team[]
  companyId: string
  allTeams: Team[]
  isAdmin: boolean
}) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const sorted = useMemo(() => [...teams].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')), [teams])

  const createMutation = useMutation({
    mutationFn: () => createTeam({ company_id: companyId, sport_id: sport.id, name: newTeamName.trim() || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] })
      setShowAddForm(false)
      setNewTeamName('')
      setFormError(null)
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : 'Failed to create team'),
  })

  function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (newTeamName.trim()) {
      const dup = allTeams.find(t => t.company_id === companyId && t.sport_id === sport.id && t.name === newTeamName.trim())
      if (dup) { setFormError(`A team named '${newTeamName.trim()}' already exists`); return }
    }
    setFormError(null)
    createMutation.mutate()
  }

  return (
    <div className="space-y-1.5">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-white rounded-xl border border-gray-200 shadow-sm active:bg-gray-50 transition-colors"
      >
        <ChevronDownIcon open={open} />
        <span className="flex-1 text-left text-sm font-semibold text-slate-800 truncate">
          {sport.name}
        </span>
        <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-full shrink-0">
          {teams.length}
        </span>
      </button>

      {open && (
        <div className="space-y-1.5 pl-4">
          {sorted.map(team => (
            <TeamCard key={team.id} team={team} isAdmin={isAdmin} />
          ))}

          {isAdmin && (
            showAddForm ? (
              <form onSubmit={handleAdd} className="bg-white rounded-lg border border-blue-200 px-4 py-3 space-y-2">
                <input
                  type="text"
                  value={newTeamName}
                  onChange={e => setNewTeamName(e.target.value)}
                  placeholder="Team name (optional)"
                  autoFocus
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {formError && <p className="text-xs text-red-600">{formError}</p>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setShowAddForm(false); setNewTeamName(''); setFormError(null) }}
                    className="flex-1 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg py-1.5"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createMutation.isPending}
                    className="flex-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg py-1.5 disabled:opacity-50"
                  >
                    {createMutation.isPending ? 'Creating…' : 'Create'}
                  </button>
                </div>
              </form>
            ) : (
              <button
                onClick={() => setShowAddForm(true)}
                className="w-full text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg py-2 border border-blue-200 transition-colors"
              >
                + Add Team
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}

// ---- Add team for a new sport ------------------------------------------------

function AddTeamForNewSport({
  companyId,
  sports,
  allTeams,
  onDone,
}: {
  companyId: string
  sports: Sport[]
  allTeams: Team[]
  onDone: () => void
}) {
  const qc = useQueryClient()
  const [sportId, setSportId] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: () => createTeam({ company_id: companyId, sport_id: sportId, name: name.trim() || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['teams'] }); onDone() },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to create team'),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!sportId) { setError('Sport is required'); return }
    if (name.trim()) {
      const dup = allTeams.find(t => t.company_id === companyId && t.sport_id === sportId && t.name === name.trim())
      if (dup) { setError(`A team named '${name.trim()}' already exists for this sport`); return }
    }
    setError(null)
    createMutation.mutate()
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-blue-200 px-4 py-3 space-y-3">
      <p className="text-sm font-semibold text-slate-700">Add Team</p>
      <div>
        <label className="text-xs font-semibold text-slate-600">Sport</label>
        <select
          value={sportId}
          onChange={e => setSportId(e.target.value)}
          required
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Select sport…</option>
          {sports.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div>
        <label className="text-xs font-semibold text-slate-600">
          Team name <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. A"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onDone}
          className="flex-1 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg py-2">
          Cancel
        </button>
        <button type="submit" disabled={createMutation.isPending}
          className="flex-1 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg py-2 disabled:opacity-50">
          {createMutation.isPending ? 'Creating…' : 'Create'}
        </button>
      </div>
    </form>
  )
}

// ---- Page --------------------------------------------------------------------

export default function ManageCompanyTeams() {
  const { companyId } = useParams<{ companyId: string }>()
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const { data: teams = [], isLoading } = useQuery({ queryKey: ['teams'], queryFn: () => getTeams() })
  const { data: sports = [] } = useQuery({ queryKey: ['sports'], queryFn: getSports, staleTime: Infinity })
  const { data: companies = [] } = useQuery({ queryKey: ['companies'], queryFn: getCompanies, staleTime: Infinity })

  const sportMap = useMemo(() => indexBy(sports, 'id') as Record<string, Sport>, [sports])
  const companyMap = useMemo(() => indexBy(companies, 'id') as Record<string, Company>, [companies])
  const company = companyId ? companyMap[companyId] : undefined

  const [showAddForm, setShowAddForm] = useState(false)

  const companyTeams = useMemo(
    () => (teams as Team[]).filter(t => t.company_id === companyId),
    [teams, companyId],
  )

  const sportGroups = useMemo(() => {
    const grouped = new Map<string, Team[]>()
    for (const t of companyTeams) {
      const list = grouped.get(t.sport_id) ?? []
      list.push(t)
      grouped.set(t.sport_id, list)
    }
    return [...grouped.entries()]
      .sort(([a], [b]) => (sportMap[a]?.name ?? '').localeCompare(sportMap[b]?.name ?? ''))
  }, [companyTeams, sportMap])

  return (
    <div className="p-4 mt-2 space-y-4">
      <BackLink to="/manage/teams" label="Teams" />
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-bold text-slate-800">{company?.name ?? 'Company'}</h2>
        {isAdmin && !showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            className="text-sm font-medium text-blue-600"
          >
            + Add Team
          </button>
        )}
      </div>

      {showAddForm && (
        <AddTeamForNewSport
          companyId={companyId!}
          sports={sports}
          allTeams={teams as Team[]}
          onDone={() => setShowAddForm(false)}
        />
      )}

      <div className="space-y-2">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 rounded-xl bg-gray-200 animate-pulse" />
          ))
        ) : sportGroups.length === 0 ? (
          <p className="text-center text-gray-400 py-12">No teams yet.</p>
        ) : (
          sportGroups.map(([sportId, sportTeams]) => (
            <SportSection
              key={sportId}
              sport={sportMap[sportId]}
              teams={sportTeams}
              companyId={companyId!}
              allTeams={teams as Team[]}
              isAdmin={isAdmin}
            />
          ))
        )}
      </div>
    </div>
  )
}
