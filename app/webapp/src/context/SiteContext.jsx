import { createContext, useContext, useEffect, useState } from 'react'
import { getDevices, getSites } from '../api'
import { useFetch } from '../hooks/useFetch'

const SiteContext = createContext(null)

export function SiteProvider({ children }) {
  const [selectedSiteId, setSelectedSiteId] = useState(null)

  const sitesState = useFetch(() => getSites(), [])
  const sites = sitesState.data?.sites ?? []

  useEffect(() => {
    if (selectedSiteId !== null) return
    const firstReachable = sites.find((s) => s.reachable)
    if (firstReachable) setSelectedSiteId(firstReachable.id)
  }, [sites, selectedSiteId])

  const devicesState = useFetch(
    () => (selectedSiteId ? getDevices(selectedSiteId) : Promise.resolve({ devices: [] })),
    [selectedSiteId],
  )
  const devices = devicesState.data?.devices ?? []

  const value = {
    sites,
    sitesLoading: sitesState.loading,
    sitesError: sitesState.error,
    selectedSiteId,
    setSelectedSiteId,
    devices,
    devicesLoading: devicesState.loading,
    devicesError: devicesState.error,
  }

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>
}

export function useSiteContext() {
  const ctx = useContext(SiteContext)
  if (!ctx) throw new Error('useSiteContext must be used within a SiteProvider')
  return ctx
}
