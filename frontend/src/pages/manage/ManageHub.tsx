import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

interface HubCard {
  to: string
  label: string
  description: string
  icon: React.ReactNode
}

const TEAMS_CARD: HubCard = {
  to: '/manage/teams',
  label: 'Teams',
  description: 'Create and manage sport teams per company',
  icon: (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
}

const BRACKETS_CARD: HubCard = {
  to: '/manage/brackets',
  label: 'Matches',
  description: 'Generate matches for each sport',
  icon: (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
}

const RESULTS_CARD: HubCard = {
  to: '/manage/results',
  label: 'Enter Results',
  description: 'Submit match winners for scheduled and in-progress matches',
  icon: (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
}

const ALERTS_CARD: HubCard = {
  to: '/manage/alerts',
  label: 'Alerts',
  description: 'Broadcast a banner alert to everyone in the app',
  icon: (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
}

const SCORING_CARD: HubCard = {
  to: '/manage/scoring',
  label: 'Scoring',
  description: 'Assign final placements and award points to companies',
  icon: (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="6" />
      <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
    </svg>
  ),
}

function Card({ card }: { card: HubCard }) {
  return (
    <Link
      to={card.to}
      className="flex items-center gap-4 bg-white rounded-xl px-4 py-4 border border-gray-100 shadow-sm active:bg-gray-50 transition-colors"
    >
      <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 shrink-0">
        {card.icon}
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-slate-800">{card.label}</p>
        <p className="text-xs text-gray-400 mt-0.5">{card.description}</p>
      </div>
      <svg className="ml-auto shrink-0 text-gray-300" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </Link>
  )
}

export default function ManageHub() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const cards = isAdmin
    ? [TEAMS_CARD, BRACKETS_CARD, RESULTS_CARD, SCORING_CARD, ALERTS_CARD]
    : []

  return (
    <div className="p-4 mt-2 space-y-3">
      <h2 className="text-xl font-bold text-slate-800 mb-4">Manage</h2>
      {cards.map(card => <Card key={card.to} card={card} />)}
    </div>
  )
}
