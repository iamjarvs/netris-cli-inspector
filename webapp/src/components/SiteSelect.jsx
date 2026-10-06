import { useSiteContext } from '../context/SiteContext'
import Select from './ui/Select'

export default function SiteSelect() {
  const { sites, sitesLoading, selectedSiteId, setSelectedSiteId } = useSiteContext()

  return (
    <Select
      label="Site"
      value={selectedSiteId ?? ''}
      loading={sitesLoading}
      disabled={sitesLoading || sites.length === 0}
      onChange={(e) => setSelectedSiteId(Number(e.target.value))}
    >
      {sitesLoading && <option value="">Loading sites…</option>}
      {!sitesLoading && sites.length === 0 && <option value="">No sites available</option>}
      {!sitesLoading &&
        sites.map((site) => (
          <option key={site.id} value={site.id} disabled={!site.reachable}>
            {site.name}
            {!site.reachable ? ' (not reachable from this jump host)' : ''}
          </option>
        ))}
    </Select>
  )
}
