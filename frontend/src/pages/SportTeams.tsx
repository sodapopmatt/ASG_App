import { useState, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import BackLink from '../components/BackLink'
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

function TeamCard({ team }: { team: Team }) {
  const [open, setOpen] = useState(false)

  const rosterQuery = useQuery({
    queryKey: ['roster', team.id],
    queryFn: () => getRosterEntries(team.id),
    enabled: open,
    staleTime: Infinity,
  })

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left active:bg-gray-50 transition-colors"
      >
        <span className="flex-1 min-w-0 text-sm font-medium text-slate-700 truncate">
          {team.name || 'Team'}
        </span>
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

function CompanySection({ company, teams }: { company?: Company; teams: Team[] }) {
  const [open, setOpen] = useState(false)
  const sortedTeams = useMemo(
    () => [...teams].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
    [teams],
  )

  return (
    <div className="space-y-2">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-white rounded-xl border border-gray-200 shadow-sm active:bg-gray-50 transition-colors"
      >
        <ChevronDownIcon open={open} />
        {company?.logo_url ? (
          <img src={company.logo_url} alt="" className="w-6 h-6 rounded object-contain bg-gray-50 shrink-0" />
        ) : (
          <div className="w-6 h-6 rounded bg-gray-100 flex items-center justify-center shrink-0">
            <span className="text-[8px] font-bold text-gray-400 leading-none">{company?.short_id ?? company?.name.charAt(0).toUpperCase() ?? '?'}</span>
          </div>
        )}
        <span className="flex-1 text-left text-sm font-semibold text-slate-800 truncate">
          {company?.name ?? 'Unknown company'}
        </span>
        <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-full shrink-0">
          {teams.length}
        </span>
      </button>

      {open && (
        <div className="space-y-2 pl-4">
          {sortedTeams.map(team => (
            <TeamCard key={team.id} team={team} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function SportTeams() {
  const { sportId } = useParams<{ sportId: string }>()

  const { data: teams = [], isLoading: teamsLoading } = useQuery({ queryKey: ['teams'], queryFn: () => getTeams() })
  const { data: sports = [] } = useQuery({ queryKey: ['sports'], queryFn: getSports, staleTime: Infinity })
  const { data: companies = [] } = useQuery({ queryKey: ['companies'], queryFn: getCompanies, staleTime: Infinity })

  const sportMap = useMemo(() => indexBy(sports, 'id') as Record<string, Sport>, [sports])
  const companyMap = useMemo(() => indexBy(companies, 'id') as Record<string, Company>, [companies])
  const sport = sportId ? sportMap[sportId] : undefined

  const companyGroups = useMemo(() => {
    const grouped = new Map<string, Team[]>()
    for (const t of teams as Team[]) {
      if (t.sport_id !== sportId) continue
      const list = grouped.get(t.company_id) ?? []
      list.push(t)
      grouped.set(t.company_id, list)
    }
    return [...grouped.entries()]
      .sort(([a], [b]) => (companyMap[a]?.name ?? '').localeCompare(companyMap[b]?.name ?? ''))
  }, [teams, sportId, companyMap])

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 bg-gray-50 px-4 pt-4 pb-3 space-y-1 border-b border-gray-200">
        <BackLink to="/teams" label="Teams" />
        <h2 className="text-lg font-bold text-slate-800">{sport?.name ?? 'Sport'}</h2>
      </div>

      <div className="p-4 space-y-2">
        {teamsLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 rounded-xl bg-gray-200 animate-pulse" />
          ))
        ) : companyGroups.length === 0 ? (
          <p className="text-center text-gray-400 py-12">No teams for this sport yet.</p>
        ) : (
          companyGroups.map(([cId, companyTeams]) => (
            <CompanySection key={cId} company={companyMap[cId]} teams={companyTeams} />
          ))
        )}
      </div>
    </div>
  )
}
