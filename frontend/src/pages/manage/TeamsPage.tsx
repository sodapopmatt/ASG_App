import { useState, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getTeams } from '../../api/teams'
import { getCompanies } from '../../api/companies'
import type { Team, Company } from '../../types'

const ChevronRightIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    className="shrink-0 text-gray-300">
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

export default function TeamsPage() {
  const navigate = useNavigate()
  const { data: companies = [], isLoading } = useQuery({ queryKey: ['companies'], queryFn: getCompanies, staleTime: Infinity })
  const { data: teams = [] } = useQuery({ queryKey: ['teams'], queryFn: () => getTeams() })

  const [search, setSearch] = useState('')

  const teamCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const t of teams as Team[]) counts[t.company_id] = (counts[t.company_id] ?? 0) + 1
    return counts
  }, [teams])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return [...companies as Company[]]
      .filter(c => !q || c.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [companies, search])

  return (
    <div className="p-4 mt-2 space-y-4">
      <Link to="/manage" className="text-blue-600 text-sm">← Manage</Link>
      <h2 className="text-xl font-bold text-slate-800">Teams</h2>

      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search company…"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <div className="space-y-2">
        {isLoading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-gray-200 animate-pulse" />
          ))
        ) : filtered.length === 0 ? (
          <p className="text-center text-gray-400 py-12">
            {search ? 'No companies match your search.' : 'No companies yet.'}
          </p>
        ) : (
          filtered.map(company => (
            <button
              key={company.id}
              onClick={() => navigate(`/manage/teams/${company.id}`)}
              className="w-full flex items-center gap-3 px-4 py-3 bg-white rounded-xl border border-gray-200 shadow-sm text-left active:bg-gray-50 transition-colors"
            >
              {company.logo_url ? (
                <img src={company.logo_url} alt="" className="w-10 h-10 rounded-lg object-contain bg-gray-50 shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-400 shrink-0">
                  {company.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{company.name}</p>
                <p className="text-xs text-gray-500">
                  {teamCounts[company.id] ?? 0} team{(teamCounts[company.id] ?? 0) === 1 ? '' : 's'}
                </p>
              </div>
              <ChevronRightIcon />
            </button>
          ))
        )}
      </div>
    </div>
  )
}
