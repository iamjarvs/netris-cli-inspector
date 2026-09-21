import { Route, Routes } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import { CatalogProvider } from './context/CatalogContext'
import { SiteProvider } from './context/SiteContext'
import ComparePage from './pages/ComparePage'
import DevicesPage from './pages/DevicesPage'
import DiffExamplesPage from './pages/DiffExamplesPage'
import ExplorePage from './pages/ExplorePage'
import HistoryPage from './pages/HistoryPage'
import IsolationPage from './pages/IsolationPage'
import RetentionPage from './pages/RetentionPage'

export default function App() {
  return (
    <SiteProvider>
      <CatalogProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<DevicesPage />} />
            <Route path="/explore" element={<ExplorePage />} />
            <Route path="/compare" element={<ComparePage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/diff-examples" element={<DiffExamplesPage />} />
            <Route path="/retention" element={<RetentionPage />} />
            <Route path="/isolation" element={<IsolationPage />} />
          </Route>
        </Routes>
      </CatalogProvider>
    </SiteProvider>
  )
}
