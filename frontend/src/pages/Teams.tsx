import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getTeams } from '../api/teams'
import { getCompanies } from '../api/companies'
import { getSports } from '../api/sports'
import { getSportIcon } from '../lib/sportIcons'
import type { Team, Company, Sport } from '../types'

const ChevronRightIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    className="shrink-0 text-gray-300">
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

type View = 'companies' | 'sports'

export default function Teams() {
  const navigate = useNavigate()
  const { data: companies = [], isLoading: companiesLoading } = useQuery({ queryKey: ['companies'], queryFn: getCompanies, staleTime: Infinity })
  const { data: sports = [], isLoading: sportsLoading } = useQuery({ queryKey: ['sports'], queryFn: getSports, staleTime: Infinity })
  const { data: teams = [] } = useQuery({ queryKey: ['teams'], queryFn: () => getTeams() })

  const [view, setView] = useState<View>('companies')
  const [search, setSearch] = useState('')

  const teamsByCompany = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const t of teams as Team[]) counts[t.company_id] = (counts[t.company_id] ?? 0) + 1
    return counts
  }, [teams])

  const teamsBySport = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const t of teams as Team[]) counts[t.sport_id] = (counts[t.sport_id] ?? 0) + 1
    return counts
  }, [teams])

  const filteredCompanies = useMemo(() => {
    const q = search.trim().toLowerCase()
    return [...companies as Company[]]
      .filter(c => !q || c.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [companies, search])

  const filteredSports = useMemo(() => {
    const q = search.trim().toLowerCase()
    return [...sports as Sport[]]
      .filter(s => !q || s.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [sports, search])

  const isLoading = view === 'companies' ? companiesLoading : sportsLoading

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 bg-gray-50 px-4 pt-4 pb-3 border-b border-gray-200 space-y-3">
        {/* View toggle */}
        <div className="flex rounded-lg border border-gray-200 overflow-hidden bg-white p-1 gap-1">
          {(['companies', 'sports'] as View[]).map(v => (
            <button
              key={v}
              onClick={() => { setView(v); setSearch('') }}
              className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-colors ${
                view === v ? 'bg-gray-100 text-slate-800' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              {v === 'companies' ? 'By Company' : 'By Sport'}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={view === 'companies' ? 'Search company…' : 'Search sport…'}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="p-4 space-y-2">
        {isLoading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-gray-200 animate-pulse" />
          ))
        ) : view === 'companies' ? (
          filteredCompanies.length === 0 ? (
            <p className="text-center text-gray-400 py-12">
              {search ? 'No companies match your search.' : 'No companies yet.'}
            </p>
          ) : (
            filteredCompanies.map((company: Company) => (
              <button
                key={company.id}
                onClick={() => navigate(`/teams/${company.id}`)}
                className="w-full flex items-center gap-3 px-4 py-3 bg-white rounded-xl border border-gray-200 shadow-sm text-left active:bg-gray-50 transition-colors"
              >
                {company.logo_url ? (
                  <img src={company.logo_url} alt="" className="w-10 h-10 rounded-lg object-contain bg-gray-50 shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                    <span className="text-[9px] font-bold text-gray-400 leading-none text-center whitespace-nowrap overflow-hidden">
                      {company.short_id ?? company.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{company.name}</p>
                  <p className="text-xs text-gray-500">
                    {teamsByCompany[company.id] ?? 0} team{(teamsByCompany[company.id] ?? 0) === 1 ? '' : 's'}
                  </p>
                </div>
                <ChevronRightIcon />
              </button>
            ))
          )
        ) : (
          filteredSports.length === 0 ? (
            <p className="text-center text-gray-400 py-12">
              {search ? 'No sports match your search.' : 'No sports yet.'}
            </p>
          ) : (
            filteredSports.map((sport: Sport) => (
              <button
                key={sport.id}
                onClick={() => navigate(`/teams/sport/${sport.id}`)}
                className="w-full flex items-center gap-3 px-4 py-3 bg-white rounded-xl border border-gray-200 shadow-sm text-left active:bg-gray-50 transition-colors"
              >
                <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                  <span className="text-xl leading-none">{getSportIcon(sport.name)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{sport.name}</p>
                  <p className="text-xs text-gray-500">
                    {teamsBySport[sport.id] ?? 0} team{(teamsBySport[sport.id] ?? 0) === 1 ? '' : 's'}
                  </p>
                </div>
                <ChevronRightIcon />
              </button>
            ))
          )
        )}
      </div>
    </div>
  )
}
