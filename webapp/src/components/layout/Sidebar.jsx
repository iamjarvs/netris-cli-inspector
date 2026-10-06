import { NavLink } from 'react-router-dom'
import {
  BookmarkIcon,
  CollapseSidebarIcon,
  CompareIcon,
  DevicesIcon,
  ExpandSidebarIcon,
  ExploreIcon,
  GaugeIcon,
  HistoryIcon,
  ShieldIcon,
  WatchIcon,
} from '../icons'

const navItems = [
  { to: '/', label: 'Devices', icon: DevicesIcon, end: true },
  { to: '/explore', label: 'Explore', icon: ExploreIcon },
  { to: '/compare', label: 'Compare', icon: CompareIcon },
  { to: '/watch', label: 'Live Watch', icon: WatchIcon },
  { to: '/history', label: 'History', icon: HistoryIcon },
  { to: '/diff-examples', label: 'Diff Examples', icon: BookmarkIcon },
  { to: '/retention', label: 'Retention', icon: GaugeIcon },
  { to: '/isolation', label: 'Isolation', icon: ShieldIcon },
]

export default function Sidebar({ open, onClose, isCollapsed, onToggleCollapse }) {
  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-gray-900/40 lg:hidden" onClick={onClose} />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col justify-between border-r border-gray-200 bg-white transition-all duration-200 ease-in-out ${
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } ${isCollapsed ? 'lg:w-[72px] w-[280px]' : 'w-[290px]'}`}
      >
        <div>
          {/* Sidebar Top Header */}
          <div
            className={`flex h-[72px] items-center border-b border-gray-100 ${
              isCollapsed ? 'lg:justify-center px-4 justify-between' : 'justify-between px-5'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white shadow-2xs">
                <svg viewBox="0 0 24 24" fill="none" className="h-4.5 w-4.5">
                  <path
                    d="M4 6l6 6-6 6"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M12 18h8"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              {/* Brand title: visible on mobile or when not collapsed */}
              <span
                className={`text-theme-base font-bold text-gray-900 tracking-tight truncate ${
                  isCollapsed ? 'lg:hidden' : 'block'
                }`}
              >
                CLI Inspector
              </span>
            </div>

            {/* Quick collapse/expand button in header (desktop) */}
            <button
              type="button"
              onClick={onToggleCollapse}
              title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden lg:flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            >
              {isCollapsed ? (
                <ExpandSidebarIcon className="h-4 w-4" />
              ) : (
                <CollapseSidebarIcon className="h-4 w-4" />
              )}
            </button>
          </div>

          {/* Navigation Links */}
          <nav className={`flex flex-col gap-1.5 py-3 ${isCollapsed ? 'lg:px-2 px-3' : 'px-3'}`}>
            {navItems.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={onClose}
                title={isCollapsed ? label : undefined}
                className={({ isActive }) =>
                  `group relative flex items-center rounded-lg transition-colors ${
                    isCollapsed
                      ? 'lg:justify-center lg:px-0 lg:py-2.5 px-3 py-2'
                      : 'px-3 py-2 gap-3'
                  } ${
                    isActive
                      ? 'bg-brand-50 text-brand-700 font-semibold'
                      : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900 font-medium'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      className={`h-5 w-5 shrink-0 ${
                        isActive
                          ? 'text-brand-700'
                          : 'text-gray-500 group-hover:text-gray-800'
                      }`}
                    />
                    <span
                      className={`text-theme-sm truncate ${
                        isCollapsed ? 'lg:hidden' : 'block'
                      }`}
                    >
                      {label}
                    </span>

                    {/* Collapsed Tooltip on Hover */}
                    {isCollapsed && (
                      <div className="hidden lg:group-hover:flex absolute left-full ml-3 z-50 whitespace-nowrap rounded-md bg-gray-900 px-2.5 py-1 text-xs font-medium text-white shadow-md">
                        {label}
                      </div>
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </div>

        {/* Sidebar Footer with Collapse Toggle */}
        <div className="border-t border-gray-100 p-2.5 hidden lg:block">
          <button
            type="button"
            onClick={onToggleCollapse}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`flex w-full items-center rounded-lg text-theme-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors ${
              isCollapsed ? 'justify-center p-2' : 'gap-2.5 px-3 py-2'
            }`}
          >
            {isCollapsed ? (
              <ExpandSidebarIcon className="h-4 w-4" />
            ) : (
              <>
                <CollapseSidebarIcon className="h-4 w-4" />
                <span>Collapse Sidebar</span>
              </>
            )}
          </button>
        </div>
      </aside>
    </>
  )
}
