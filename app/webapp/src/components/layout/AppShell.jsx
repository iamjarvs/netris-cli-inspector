import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Header from './Header'
import Sidebar from './Sidebar'

export default function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      return localStorage.getItem('cli_inspector_sidebar_collapsed') === 'true'
    } catch {
      return false
    }
  })

  function toggleCollapse() {
    setIsCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem('cli_inspector_sidebar_collapsed', String(next))
      } catch {}
      return next
    })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        isCollapsed={isCollapsed}
        onToggleCollapse={toggleCollapse}
      />
      <div
        className={`transition-all duration-200 ease-in-out ${
          isCollapsed ? 'lg:ml-[72px]' : 'lg:ml-[290px]'
        }`}
      >
        <Header
          onMenuClick={() => setSidebarOpen((v) => !v)}
          isCollapsed={isCollapsed}
          onToggleCollapse={toggleCollapse}
        />
        <main className="p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
