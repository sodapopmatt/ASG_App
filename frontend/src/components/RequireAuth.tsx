import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { session, isLoading } = useAuth()
  const location = useLocation()
  if (isLoading) return null
  if (!session) return <Navigate to="/account" state={{ from: location }} replace />
  return <>{children}</>
}
