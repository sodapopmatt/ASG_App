import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useState, useRef, useEffect } from 'react'
import BottomNav from './BottomNav'
import { useAuth } from '../contexts/AuthContext'

export default function Layout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { user, profile, signOut } = useAuth()
  const mainRef = useRef<HTMLElement>(null)
  const scrollPositions = useRef<Record<string, number>>({})

  useEffect(() => {
    const el = mainRef.current
    if (!el) return

    // Continuously save scroll position for this route
    const onScroll = () => {
      scrollPositions.current[location.pathname] = el.scrollTop
    }
    el.addEventListener('scroll', onScroll, { passive: true })

    // Restore after content has loaded — retry a few times to handle async renders
    const saved = scrollPositions.current[location.pathname] ?? 0
    if (saved > 0) {
      let attempts = 0
      const tryRestore = () => {
        const el = mainRef.current
        if (!el) return
        el.scrollTop = saved
        // If scroll didn't take (content not tall enough yet), retry
        if (el.scrollTop < saved - 10 && attempts < 10) {
          attempts++
          setTimeout(tryRestore, 100)
        }
      }
      requestAnimationFrame(tryRestore)
    }

    return () => el.removeEventListener('scroll', onScroll)
  }, [location.pathname])

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="relative text-white px-4 py-2 pb-6 flex items-center justify-between">
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
          <path d="M0,0 L1440,0 L1440,222 C1080,242 720,210 360,232 C180,242 90,222 0,232 Z" fill="url(#asgHeaderGrad)" />
          <path d="M0,60 C300,0 800,120 1440,40 L1440,232 C1080,242 720,210 360,232 C180,242 90,222 0,232 Z" fill="rgba(255,255,255,0.22)" />
          <path d="M0,120 C360,60 900,180 1440,105 L1440,232 C1080,242 720,210 360,232 C180,242 90,222 0,232 Z" fill="rgba(0,0,0,0.16)" />
          <path d="M0,175 C320,120 960,225 1440,160 L1440,232 C1080,242 720,210 360,232 C180,242 90,222 0,232 Z" fill="rgba(255,255,255,0.20)" />
        </svg>
        <img src="/asg-logo.png" alt="Aerospace Summer Games" className="relative h-24 w-auto" />

        <button
          onClick={() => setMenuOpen(true)}
          className="relative p-2 rounded-full transition-colors text-white/70 hover:text-white"
          aria-label="Open menu"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      </header>

      <main ref={mainRef} className="flex-1 overflow-auto pb-20">
        <Outlet />
      </main>

      <BottomNav />

      {/* Full-screen menu panel */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 bg-[#f2f2f7] flex flex-col">
          {/* Header */}
          <div className="flex items-center px-4 pt-14 pb-4">
            <button
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-1 text-blue-600 text-base font-normal"
              aria-label="Close menu"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Back
            </button>
            <h1 className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold text-slate-800">Menu</h1>
          </div>

          {/* Menu items */}
          <div className="px-4 mt-4 space-y-6">
            {/* Account */}
            <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
              {user ? (
                <>
                  <div className="px-4 py-4 flex flex-col gap-1.5">
                    <span className="text-xs text-gray-400">Signed in as</span>
                    <span className="text-base text-slate-800 font-medium">{user.email}</span>
                    {profile && (
                      <span className={`self-start text-xs font-medium px-2.5 py-0.5 rounded-full ${
                        profile.role === 'admin' ? 'bg-red-50 text-red-700' :
                        profile.role === 'team_manager' ? 'bg-blue-50 text-blue-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {profile.role.replace('_', ' ')}
                      </span>
                    )}
                  </div>
                  <div className="border-t border-gray-100 mx-4" />
                  <button
                    onClick={async () => { setMenuOpen(false); await signOut() }}
                    className="w-full flex items-center justify-between px-4 py-4 text-base text-red-600 hover:bg-gray-50 active:bg-gray-100"
                  >
                    <span>Sign out</span>
                  </button>
                </>
              ) : (
                <button
                  onClick={() => { setMenuOpen(false); navigate('/account') }}
                  className="w-full flex items-center justify-between px-4 py-4 text-base text-slate-800 hover:bg-gray-50 active:bg-gray-100"
                >
                  <span>Sign in</span>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    className="text-gray-300">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              )}
            </div>

            {/* Links group */}
            <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
              <a
                href="https://drive.google.com/file/d/10lNmjOK7lt8u7b259H4ctEX1ZNDjCySj/view"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMenuOpen(false)}
                className="flex items-center justify-between px-4 py-4 text-base text-slate-800 hover:bg-gray-50 active:bg-gray-100"
              >
                <span>Rule Book</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  className="text-gray-300">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </a>
              <div className="border-t border-gray-100 mx-4" />
              <a
                href="https://aerospacesummergames.com/"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMenuOpen(false)}
                className="flex items-center justify-between px-4 py-4 text-base text-slate-800 hover:bg-gray-50 active:bg-gray-100"
              >
                <span>ASG Website</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  className="text-gray-300">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </a>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-auto px-6 pb-10 pt-8 text-center space-y-1">
            <p className="text-xs text-gray-400">© 2026 Aerospace Summer Games, Inc. All Rights Reserved.</p>
            <p className="text-xs text-gray-400">Aerospace Summer Games, Inc. is a California nonprofit organization with 501(c)(3) tax‑exempt status.</p>
            <p className="text-xs text-gray-300 pt-1">v{__APP_VERSION__}</p>
          </div>
        </div>
      )}
    </div>
  )
}
