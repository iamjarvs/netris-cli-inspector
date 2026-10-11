import { createContext, useContext, useState } from 'react'

// "config" = the configuration applied on the switch (nv config).
// "intent" = what the Netris controller pushed the agent to render it from
// (/opt/netris/etc/nvue/00-netris.yaml). One shared choice across Explore,
// Compare and History, so flipping it once carries between tabs.
const STORAGE_KEY = 'cli-inspector:view-kind'
const ViewKindContext = createContext(null)

export const KIND_OPTIONS = [
  { value: 'config', label: 'Configuration' },
  { value: 'intent', label: 'Intent' },
]

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'intent' ? 'intent' : 'config'
  } catch {
    return 'config'
  }
}

export function ViewKindProvider({ children }) {
  const [kind, setKindState] = useState(readStored)

  function setKind(next) {
    setKindState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // storage unavailable -- the choice just won't persist across reloads
    }
  }

  return <ViewKindContext.Provider value={{ kind, setKind, isIntent: kind === 'intent' }}>{children}</ViewKindContext.Provider>
}

export function useViewKind() {
  const ctx = useContext(ViewKindContext)
  if (!ctx) throw new Error('useViewKind must be used within a ViewKindProvider')
  return ctx
}
