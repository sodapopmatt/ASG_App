import { useState, type FormEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const ROLE_STYLES: Record<string, string> = {
  admin: 'bg-red-50 text-red-700',
  team_manager: 'bg-blue-50 text-blue-700',
  player: 'bg-gray-100 text-gray-600',
}

function Skeleton() {
  return (
    <div className="p-6 space-y-3">
      <div className="h-24 rounded-xl bg-gray-200 animate-pulse" />
      <div className="h-12 rounded-xl bg-gray-200 animate-pulse" />
    </div>
  )
}

export default function Account() {
  const { user, profile, isLoading, signIn, signOut } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  if (isLoading) return <Skeleton />

  if (user) {
    return (
      <div className="p-6 space-y-4 mt-2">
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 space-y-3">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Signed in as</p>
          <p className="font-semibold text-slate-800">{user.email}</p>
          {profile && (
            <span className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full ${ROLE_STYLES[profile.role] ?? 'bg-gray-100 text-gray-600'}`}>
              {profile.role.replace('_', ' ')}
            </span>
          )}
        </div>

        <button
          onClick={() => signOut()}
          className="w-full py-3 rounded-xl bg-gray-100 text-slate-700 font-medium hover:bg-gray-200 transition-colors"
        >
          Sign out
        </button>
      </div>
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await signIn(email, password)
      const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/leaderboard'
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-9rem)] p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-800">Sign in</h1>
          <p className="text-sm text-gray-400 mt-1">Aerospace Summer Games</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
