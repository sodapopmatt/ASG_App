import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import Layout from './components/Layout'
import RequireAuth from './components/RequireAuth'
import Leaderboard from './pages/Leaderboard'
import Schedule from './pages/Schedule'
import Account from './pages/Account'
import BracketView from './pages/Brackets'
import BracketsSportIndex from './pages/BracketsSportIndex'
import Teams from './pages/Teams'
import CompanyTeams from './pages/CompanyTeams'
import ManageHub from './pages/manage/ManageHub'
import TeamsPage from './pages/manage/TeamsPage'
import ManageCompanyTeams from './pages/manage/ManageCompanyTeams'
import BracketsPage from './pages/manage/BracketsPage'
import ResultsPage from './pages/manage/ResultsPage'
import BracketResultsPage from './pages/manage/BracketResultsPage'
import HeatsResultPage from './pages/manage/HeatsResultPage'
import PoolResultsPage from './pages/manage/PoolResultsPage'
import ScoringPage from './pages/manage/ScoringPage'
import SportConfigPage from './pages/manage/SportConfigPage'

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/leaderboard" replace />} />
          <Route path="leaderboard" element={<Leaderboard />} />
          <Route path="schedule" element={<Schedule />} />
          <Route path="brackets" element={<BracketsSportIndex />} />
          <Route path="brackets/:sportId" element={<BracketView />} />
          <Route path="teams" element={<Teams />} />
          <Route path="teams/:companyId" element={<CompanyTeams />} />
          <Route path="account" element={<Account />} />
          <Route path="manage" element={<RequireAuth><ManageHub /></RequireAuth>} />
          <Route path="manage/teams" element={<RequireAuth><TeamsPage /></RequireAuth>} />
          <Route path="manage/teams/:companyId" element={<RequireAuth><ManageCompanyTeams /></RequireAuth>} />
          <Route path="manage/brackets" element={<RequireAuth><BracketsPage /></RequireAuth>} />
          <Route path="manage/brackets/:sportId" element={<RequireAuth><SportConfigPage /></RequireAuth>} />
          <Route path="manage/results" element={<RequireAuth><ResultsPage /></RequireAuth>} />
          <Route path="manage/results/brackets/:sportId" element={<RequireAuth><BracketResultsPage /></RequireAuth>} />
          <Route path="manage/results/heats/:sportId" element={<RequireAuth><HeatsResultPage /></RequireAuth>} />
          <Route path="manage/results/pools/:sportId" element={<RequireAuth><PoolResultsPage /></RequireAuth>} />
          <Route path="manage/scoring" element={<RequireAuth><ScoringPage /></RequireAuth>} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
