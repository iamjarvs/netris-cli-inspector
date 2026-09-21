import { NavLink } from 'react-router-dom'
import { BookmarkIcon, CompareIcon, DevicesIcon, ExploreIcon, GaugeIcon, HistoryIcon, ShieldIcon } from '../icons'

const navItems = [
  { to: '/', label: 'Devices', icon: DevicesIcon, end: true },
  { to: '/explore', label: 'Explore', icon: ExploreIcon },
  { to: '/compare', label: 'Compare', icon: CompareIcon },
  { to: '/history', label: 'History', icon: HistoryIcon },
  { to: '/diff-examples', label: 'Diff Examples', icon: BookmarkIcon },
  { to: '/retention', label: 'Retention', icon: GaugeIcon },
  { to: '/isolation', label: 'Isolation', icon: ShieldIcon },
]

export default function Sidebar({ open, onClose }) {
  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-gray-900/40 lg:hidden" onClick={onClose} />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[290px] border-r border-gray-200 bg-white transition-transform lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-[72px] items-center px-6">
          <span className="flex items-center gap-2 text-theme-xl font-semibold text-gray-900">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                <path d="M4 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M12 18h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
            CLI Inspector
          </span>
        </div>
        <nav className="flex flex-col gap-1 px-4 py-2">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onClose}
              className={({ isActive }) =>
                `group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-theme-sm font-medium ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-gray-700 hover:bg-gray-100'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={`h-5 w-5 ${isActive ? 'text-brand-700' : 'text-gray-500 group-hover:text-gray-700'}`} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  )
}
