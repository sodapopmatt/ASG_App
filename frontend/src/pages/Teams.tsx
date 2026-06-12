import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getTeams } from '../api/teams'
import { getSports } from '../api/sports'
import { getCompanies } from '../api/companies'
import { getRosterEntries } from '../api/roster_entries'
import type { Team, Sport, Company } from '../types'

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

function TeamCard({ team, sport, company }: { team: Team; sport?: Sport; company?: Company }) {
  const [open, setOpen] = useState(false)

  const rosterQuery = useQuery({
    queryKey: ['roster', team.id],
    queryFn: () => getRosterEntries(team.id),
    enabled: open,
    staleTime: Infinity,
  })

  const companyName = company?.name ?? 'Unknown company'

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-gray-50 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">
            {companyName}
            {team.name && <span className="text-gray-400 font-normal"> · {team.name}</span>}
          </p>
          <p className="text-xs text-gray-500 truncate">{sport?.name ?? 'Unknown sport'}</p>
        </div>
        <ChevronDownIcon open={open} />
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
          {rosterQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-4 rounded bg-gray-200 animate-pulse" />
              ))}
            </div>
          ) : (rosterQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-gray-400 italic">No players on this roster yet.</p>
          ) : (
            <ol className="space-y-1">
              {rosterQuery.data!.map((entry, i) => (
                <li key={entry.id} className="text-sm text-slate-700 flex gap-2">
                  <span className="text-gray-300 tabular-nums w-5 text-right shrink-0">{i + 1}</span>
                  <span className="truncate">{entry.player_name}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}

export default function Teams() {
  const { data: teams = [], isLoading: teamsLoading } = useQuery({ queryKey: ['teams'], queryFn: () => getTeams() })
  const { data: sports = [] } = useQuery({ queryKey: ['sports'], queryFn: getSports, staleTime: Infinity })
  const { data: companies = [] } = useQuery({ queryKey: ['companies'], queryFn: getCompanies, staleTime: Infinity })

  const sportMap = useMemo(() => indexBy(sports, 'id') as Record<string, Sport>, [sports])
  const companyMap = useMemo(() => indexBy(companies, 'id') as Record<string, Company>, [companies])

  const [search, setSearch] = useState('')
  const [filterSport, setFilterSport] = useState('')
  const [filterCompany, setFilterCompany] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return teams
      .filter(t => {
        if (filterSport && t.sport_id !== filterSport) return false
        if (filterCompany && t.company_id !== filterCompany) return false
        if (q) {
          const haystack = [
            companyMap[t.company_id]?.name,
            sportMap[t.sport_id]?.name,
            t.name,
          ].filter(Boolean).join(' ').toLowerCase()
          if (!haystack.includes(q)) return false
        }
        return true
      })
      .sort((a, b) => {
        const ca = (companyMap[a.company_id]?.name ?? '').localeCompare(companyMap[b.company_id]?.name ?? '')
        if (ca !== 0) return ca
        const sa = (sportMap[a.sport_id]?.name ?? '').localeCompare(sportMap[b.sport_id]?.name ?? '')
        if (sa !== 0) return sa
        return (a.name ?? '').localeCompare(b.name ?? '')
      })
  }, [teams, search, filterSport, filterCompany, companyMap, sportMap])

  const hasFilters = search.length > 0 || filterSport.length > 0 || filterCompany.length > 0

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 bg-gray-50 px-4 pt-4 pb-3 space-y-3 border-b border-gray-200">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search team, company, or sport…"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <div className="flex gap-2 overflow-x-auto -mx-4 px-4 no-scrollbar">
          <button
            onClick={() => setFilterSport('')}
            className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filterSport === '' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All sports
          </button>
          {sports.map(sport => (
            <button
              key={sport.id}
              onClick={() => setFilterSport(s => (s === sport.id ? '' : sport.id))}
              className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                filterSport === sport.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {sport.name}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={filterCompany}
            onChange={e => setFilterCompany(e.target.value)}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All companies</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {hasFilters && (
            <button
              onClick={() => { setSearch(''); setFilterSport(''); setFilterCompany('') }}
              className="shrink-0 text-sm text-gray-600 hover:text-gray-900 font-medium"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-2">
        {teamsLoading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 rounded-xl bg-gray-200 animate-pulse" />
          ))
        ) : filtered.length === 0 ? (
          <p className="text-center text-gray-400 py-12">
            {hasFilters ? 'No teams match your filters.' : 'No teams yet.'}
          </p>
        ) : (
          <>
            <p className="text-xs text-gray-400 px-1">{filtered.length} team{filtered.length === 1 ? '' : 's'}</p>
            {filtered.map(team => (
              <TeamCard
                key={team.id}
                team={team}
                sport={sportMap[team.sport_id]}
                company={companyMap[team.company_id]}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
