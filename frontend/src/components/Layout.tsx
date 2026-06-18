import { Outlet, NavLink } from 'react-router-dom'
import BottomNav from './BottomNav'

export default function Layout() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="relative overflow-hidden text-white px-4 py-2 flex items-center justify-between">
        {/* Wavy-gradient backdrop: vertical gold → olive → teal → blue with
            translucent wave layers stacked into soft ridges. */}
        <svg className="absolute inset-0 w-full h-full -z-0" viewBox="0 0 1440 240" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="asgHeaderGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#7f9b6a" />
              <stop offset="30%" stopColor="#d8a648" />
              <stop offset="55%" stopColor="#d07b46" />
              <stop offset="78%" stopColor="#8a7ba0" />
              <stop offset="100%" stopColor="#3f6f9e" />
            </linearGradient>
          </defs>
          <rect width="1440" height="240" fill="url(#asgHeaderGrad)" />
          <path d="M0,60 C300,0 800,120 1440,40 L1440,240 L0,240 Z" fill="rgba(255,255,255,0.22)" />
          <path d="M0,120 C360,60 900,180 1440,105 L1440,240 L0,240 Z" fill="rgba(0,0,0,0.16)" />
          <path d="M0,175 C320,120 960,225 1440,160 L1440,240 L0,240 Z" fill="rgba(255,255,255,0.20)" />
        </svg>
        <img src="/asg-logo.png" alt="Aerospace Summer Games" className="relative h-24 w-auto" />
        <NavLink
          to="/account"
          className={({ isActive }) =>
            `relative p-2 rounded-full transition-colors ${isActive ? 'text-blue-400' : 'text-white/70 hover:text-white'}`
          }
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]">
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
