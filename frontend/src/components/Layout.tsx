import { Outlet } from 'react-router-dom'
import BottomNav from './BottomNav'

export default function Layout() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-slate-900 text-white px-4 py-3 flex items-center gap-2">
        <span className="text-xl font-bold tracking-tight">Aerospace Summer Games</span>
      </header>
      <main className="flex-1 overflow-auto pb-20">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
