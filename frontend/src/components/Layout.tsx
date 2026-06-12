import { Outlet, NavLink } from 'react-router-dom'
import BottomNav from './BottomNav'

export default function Layout() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-[#010F25] text-white px-4 flex items-center justify-between">
        <img src="/asg-logo.png" alt="Aerospace Summer Games" className="h-20 w-auto" />
        <NavLink
          to="/account"
          className={({ isActive }) =>
            `p-2 rounded-full transition-colors ${isActive ? 'text-blue-400' : 'text-white/70 hover:text-white'}`
          }
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
          </svg>
        </NavLink>
      </header>
      <main className="flex-1 overflow-auto pb-20">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
