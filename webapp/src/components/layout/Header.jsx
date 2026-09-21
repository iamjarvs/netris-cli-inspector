import { useEffect, useState } from 'react'
import { getHealth } from '../../api'
import { MenuIcon } from '../icons'

export default function Header({ onMenuClick }) {
  const [status, setStatus] = useState('checking')

  useEffect(() => {
    let cancelled = false

    async function check() {
      try {
        const res = await getHealth()
        if (!cancelled) setStatus(res?.ok ? 'connected' : 'unreachable')
      } catch {
        if (!cancelled) setStatus('unreachable')
      }
    }

    check()
    const interval = setInterval(check, 15000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const statusDot = {
    checking: 'bg-gray-400',
    connected: 'bg-success-500',
    unreachable: 'bg-error-500',
  }[status]

  const statusText = {
    checking: 'Checking backend…',
    connected: 'Backend connected',
    unreachable: 'Backend unreachable',
  }[status]

  const statusTextClasses = {
    checking: 'text-gray-500',
    connected: 'text-success-600',
    unreachable: 'text-error-600',
  }[status]

  return (
    <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-gray-200 bg-white px-4 md:px-6">
      <button
        onClick={onMenuClick}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 lg:hidden"
        aria-label="Toggle menu"
      >
        <MenuIcon className="h-5 w-5" />
      </button>
      <div className="hidden lg:block" />
      <div className="flex items-center gap-2 text-theme-sm">
        <span className={`h-2 w-2 rounded-full ${statusDot}`} />
        <span className={statusTextClasses}>{statusText}</span>
      </div>
    </header>
  )
}
