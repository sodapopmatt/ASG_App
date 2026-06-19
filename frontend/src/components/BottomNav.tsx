import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'

const NAV_ITEMS = [
  {
    to: '/leaderboard',
    label: 'Standings',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
        <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
        <path d="M4 22h16" />
        <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
        <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
        <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
      </svg>
    ),
  },
  {
    to: '/schedule',
    label: 'Schedule',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
        <line x1="16" x2="16" y1="2" y2="6" />
        <line x1="8" x2="8" y1="2" y2="6" />
        <line x1="3" x2="21" y1="10" y2="10" />
      </svg>
    ),
  },
  {
    to: '/brackets',
    label: 'Matches',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 6 8 6" />
        <polyline points="4 12 8 12" />
        <polyline points="4 18 8 18" />
        <polyline points="8 6 8 9 16 9 16 6" />
        <polyline points="8 18 8 15 16 15 16 18" />
        <line x1="16" y1="9" x2="16" y2="15" />
        <polyline points="16 12 20 12" />
      </svg>
    ),
  },
  {
    to: '/teams',
    label: 'Teams',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
]

const MANAGE_ITEM = {
  to: '/manage',
  label: 'Manage',
  icon: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  ),
}

export default function BottomNav() {
  const { profile } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const lastPaths = useRef<Record<string, string>>({})

  const isManager = profile?.role === 'admin' || profile?.role === 'team_manager'
  const items = isManager
    ? [...NAV_ITEMS, MANAGE_ITEM]
    : [...NAV_ITEMS]

  // Keep the remembered path up to date as the user navigates
  useEffect(() => {
    for (const { to } of items) {
      if (location.pathname.startsWith(to)) {
        lastPaths.current[to] = location.pathname
      }
    }
  })

  return (
    <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 flex justify-around z-10">
      {items.map(({ to, label, icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to !== '/brackets' && to !== '/teams' && to !== '/manage'}
          onClick={(e) => {
            const remembered = lastPaths.current[to]
            if (remembered && remembered !== to && location.pathname !== remembered) {
              e.preventDefault()
              navigate(remembered)
            }
          }}
          className={({ isActive }) =>
            `flex flex-col items-center gap-1 py-2 px-4 text-xs font-medium transition-colors ${
              isActive ? 'text-blue-600' : 'text-gray-500'
            }`
          }
        >
          {icon}
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
