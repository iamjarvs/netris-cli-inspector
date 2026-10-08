import PageBreadcrumb from '../components/layout/PageBreadcrumb'
import RoleBadge from '../components/RoleBadge'
import StatusBadge from '../components/StatusBadge'
import Badge from '../components/ui/Badge'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import ErrorState from '../components/ui/ErrorState'
import LoadingState from '../components/ui/LoadingState'
import { useSiteContext } from '../context/SiteContext'

function SiteCard({ site, selected, onSelect }) {
  const disabled = !site.reachable

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(site.id)}
      className={`flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition sm:p-6 ${
        disabled
          ? 'cursor-not-allowed border-gray-200 bg-gray-50 opacity-60'
          : selected
            ? 'border-brand-500 bg-white shadow-theme-sm ring-1 ring-brand-500'
            : 'border-gray-200 bg-white hover:border-brand-300 hover:shadow-theme-xs'
      }`}
    >
      <div className="flex w-full items-center justify-between">
        <span className="text-base font-medium text-gray-800">{site.name}</span>
        <Badge color={site.reachable ? 'success' : 'error'}>{site.reachable ? 'Reachable' : 'Not reachable'}</Badge>
      </div>
      <span className="text-theme-sm text-gray-500">
        {site.device_count} device{site.device_count === 1 ? '' : 's'}
        {!site.has_hardware && ' · no hardware in Netris inventory'}
      </span>
      {disabled && (
        <span className="text-theme-xs text-error-600">Not reachable from this jump host</span>
      )}
    </button>
  )
}

export default function DevicesPage() {
  const {
    sites,
    sitesLoading,
    sitesError,
    selectedSiteId,
    setSelectedSiteId,
    devices,
    devicesLoading,
    devicesError,
  } = useSiteContext()

  return (
    <div>
      <PageBreadcrumb title="Devices" />

      <Card title="Sites" description="Select a site to view its devices. Sites this jump host cannot reach are disabled.">
        {sitesLoading && <LoadingState label="Loading sites…" />}
        {sitesError && <ErrorState message={sitesError} />}
        {!sitesLoading && !sitesError && sites.length === 0 && <EmptyState message="No sites found." />}
        {!sitesLoading && !sitesError && sites.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sites.map((site) => (
              <SiteCard key={site.id} site={site} selected={site.id === selectedSiteId} onSelect={setSelectedSiteId} />
            ))}
          </div>
        )}
      </Card>

      <div className="h-6" />

      <Card title="Devices" description={selectedSiteId ? undefined : 'Pick a reachable site above to see its devices.'}>
        {!selectedSiteId && <EmptyState message="No site selected." />}
        {selectedSiteId && devicesLoading && <LoadingState label="Loading devices…" />}
        {selectedSiteId && devicesError && <ErrorState message={devicesError} />}
        {selectedSiteId && !devicesLoading && !devicesError && devices.length === 0 && (
          <EmptyState message="No devices found for this site." />
        )}
        {selectedSiteId && !devicesLoading && !devicesError && devices.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-gray-200">
            <div className="max-w-full overflow-x-auto">
              <table className="min-w-full">
                <thead className="border-b border-gray-100 bg-gray-50">
                  <tr>
                    <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Name</th>
                    <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Role</th>
                    <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Mgmt address</th>
                    <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {devices.map((device) => (
                    <tr key={device.name}>
                      <td className="px-5 py-4 text-theme-sm font-medium text-gray-800">{device.name}</td>
                      <td className="px-5 py-4 text-theme-sm">
                        <RoleBadge role={device.role} />
                      </td>
                      <td className="px-5 py-4 text-theme-sm text-gray-700">{device.mgmt_address}</td>
                      <td className="px-5 py-4 text-theme-sm">
                        <StatusBadge status={device.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
