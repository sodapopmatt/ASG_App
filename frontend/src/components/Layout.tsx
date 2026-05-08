import { Outlet } from 'react-router-dom'
import BottomNav from './BottomNav'

export default function Layout() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-[#010F25] text-white px-4 flex items-center">
        <img src="/asg-logo.png" alt="Aerospace Summer Games" className="h-20 w-auto" />
      </header>
      <main className="flex-1 overflow-auto pb-20">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
