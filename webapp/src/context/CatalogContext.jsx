import { createContext, useContext } from 'react'
import { getCatalog } from '../api'
import { useFetch } from '../hooks/useFetch'

const CatalogContext = createContext(null)

export function CatalogProvider({ children }) {
  const state = useFetch(() => getCatalog(), [])

  const value = {
    config: state.data?.config ?? [],
    show: state.data?.show ?? [],
    loading: state.loading,
    error: state.error,
  }

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
}

export function useCatalog() {
  const ctx = useContext(CatalogContext)
  if (!ctx) throw new Error('useCatalog must be used within a CatalogProvider')
  return ctx
}
