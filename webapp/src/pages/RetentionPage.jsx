import { useState } from 'react'
import { postRevisionsApply, postRevisionsStatus } from '../api'
import PageBreadcrumb from '../components/layout/PageBreadcrumb'
import RoleBadge from '../components/RoleBadge'
import SiteSelect from '../components/SiteSelect'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import ErrorState from '../components/ui/ErrorState'
import Input from '../components/ui/Input'
import LoadingState from '../components/ui/LoadingState'
import { useSiteContext } from '../context/SiteContext'

const MIN_VALUE = 10
const SUSPICIOUS_VALUE = 100000

export default function RetentionPage() {
  const { devices, devicesLoading, devicesError } = useSiteContext()
  const [selected, setSelected] = useState([])
  const [status, setStatus] = useState({ loading: false, error: null, results: null })
  const [value, setValue] = useState('300')
  const [pendingApply, setPendingApply] = useState(null)
  const [apply, setApply] = useState({ loading: false, error: null, results: null })

  const parsedValue = Number(value)
  const valueInvalid = !Number.isInteger(parsedValue) || parsedValue < MIN_VALUE
  const valueSuspicious = !valueInvalid && parsedValue > SUSPICIOUS_VALUE
  const statusFetched = status.results !== null

  function toggleDevice(name) {
    setSelected((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))
  }

  async function handleFetchStatus() {
    if (selected.length === 0) return
    setPendingApply(null)
    setApply({ loading: false, error: null, results: null })
    setStatus({ loading: true, error: null, results: status.results })
    try {
      const data = await postRevisionsStatus(selected)
      setStatus({ loading: false, error: null, results: data.results })
    } catch (err) {
      setStatus({ loading: false, error: err.message, results: null })
    }
  }

  function handleStartApply() {
    if (selected.length === 0 || valueInvalid) return
    setApply({ loading: false, error: null, results: null })
    setPendingApply({ targets: [...selected], value: parsedValue })
  }

  function handleCancelApply() {
    setPendingApply(null)
  }

  async function handleConfirmApply() {
    if (!pendingApply) return
    setApply({ loading: true, error: null, results: null })
    try {
      const data = await postRevisionsApply(pendingApply.targets, pendingApply.value)
      setApply({ loading: false, error: null, results: data.results })
    } catch (err) {
      setApply({ loading: false, error: err.message, results: null })
    } finally {
      setPendingApply(null)
    }
  }

  const applyEntries = apply.results ? Object.entries(apply.results) : []
  const successCount = applyEntries.filter(([, r]) => r.ok).length

  return (
    <div>
      <PageBreadcrumb title="Retention" />

      <Card
        title="Select devices"
        description="Pick one or more switches from the selected site to view or raise their NVUE config-revision retention (NVUE_MAX_REVISIONS)."
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div>
            <SiteSelect />
          </div>

          <div className="lg:col-span-2">
            <span className="mb-1.5 block text-theme-sm font-medium text-gray-700">Devices</span>
            <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-300 p-3">
              {devicesLoading && <LoadingState label="Loading devices…" />}
              {devicesError && <ErrorState message={devicesError} />}
              {!devicesLoading && !devicesError && devices.length === 0 && (
                <EmptyState message="No devices for this site." />
              )}
              {!devicesLoading &&
                !devicesError &&
                devices.map((device) => (
                  <label key={device.name} className="flex items-center gap-2.5 py-1.5 text-theme-sm text-gray-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500/30"
                      checked={selected.includes(device.name)}
                      onChange={() => toggleDevice(device.name)}
                    />
                    {device.name}
                    <RoleBadge role={device.role} />
                  </label>
                ))}
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <Button onClick={handleFetchStatus} disabled={selected.length === 0 || status.loading}>
            {status.loading ? 'Fetching…' : 'Fetch current'}
          </Button>
        </div>
      </Card>

      <div className="h-6" />

      {status.loading && <LoadingState label="Reading current retention settings…" />}
      {status.error && <ErrorState message={status.error} />}

      {statusFetched && !status.loading && (
        <Card title="Current retention" description="Configured is the value stored in /etc/default/nvued. Running is what the live nvued process is actually using.">
          <div className="overflow-hidden rounded-xl border border-gray-200">
            <div className="max-w-full overflow-x-auto">
              <table className="min-w-full">
                <thead className="border-b border-gray-100 bg-gray-50">
                  <tr>
                    <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Device</th>
                    <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Configured (file)</th>
                    <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Running (live)</th>
                    <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Service</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {Object.entries(status.results).map(([device, result]) => (
                    <tr key={device}>
                      <td className="px-5 py-4 text-theme-sm font-medium text-gray-800">{device}</td>
                      {result.ok ? (
                        <>
                          <td className="px-5 py-4 text-theme-sm text-gray-700">{result.configured}</td>
                          <td className="px-5 py-4 text-theme-sm text-gray-700">
                            <span className="flex items-center gap-2">
                              {result.running}
                              {result.configured !== result.running && <Badge color="warning">restart pending</Badge>}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-theme-sm">
                            <Badge color={result.service_active ? 'success' : 'error'}>
                              {result.service_active ? 'active' : 'inactive'}
                            </Badge>
                          </td>
                        </>
                      ) : (
                        <td className="px-5 py-4 text-theme-sm text-error-600 whitespace-pre-line" colSpan={3}>
                          {result.error || 'Could not read this device.'}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}

      {statusFetched && !status.loading && (
        <>
          <div className="h-6" />

          <Card
            title="Raise retention"
            description="Set a new NVUE_MAX_REVISIONS value and apply it to the devices selected above."
          >
            <div className="grid grid-cols-1 gap-4 sm:max-w-xs">
              <Input
                label="New value"
                type="number"
                min={MIN_VALUE}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                hint={`Minimum ${MIN_VALUE}. Applying this edits /etc/default/nvued and restarts the nvued service on each selected switch.`}
              />
              {valueSuspicious && (
                <p className="text-theme-xs text-warning-600">That's an unusually large value — double check it isn't a typo.</p>
              )}
              {valueInvalid && (
                <p className="text-theme-xs text-error-600">Enter a whole number of at least {MIN_VALUE}.</p>
              )}
            </div>

            {!pendingApply && (
              <div className="mt-6">
                <Button onClick={handleStartApply} disabled={selected.length === 0 || valueInvalid || apply.loading}>
                  Apply new value
                </Button>
              </div>
            )}

            {pendingApply && (
              <div className="mt-6 rounded-xl border border-warning-500/20 bg-warning-50 p-4 text-theme-sm text-warning-600">
                <p className="font-medium">
                  This will set NVUE_MAX_REVISIONS to {pendingApply.value} on {pendingApply.targets.length} device
                  {pendingApply.targets.length === 1 ? '' : 's'}: {pendingApply.targets.join(', ')}.
                </p>
                <p className="mt-2">
                  It edits /etc/default/nvued and restarts the nvued service on each device. The NVUE API will be briefly
                  unavailable on each switch during its restart, but this has zero impact on forwarding or the switch's
                  existing configuration.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button variant="outline" onClick={handleCancelApply} disabled={apply.loading}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleConfirmApply}
                    disabled={apply.loading}
                    className="bg-warning-500 hover:bg-warning-600 disabled:bg-warning-500/50"
                  >
                    {apply.loading ? 'Applying…' : 'Confirm & Apply'}
                  </Button>
                </div>
              </div>
            )}

            <div className="mt-6">
              {apply.loading && (
                <LoadingState label="Applying and restarting nvued… this can take up to ~15s per device (running in parallel)." />
              )}
              {apply.error && <ErrorState message={apply.error} />}
            </div>
          </Card>
        </>
      )}

      {applyEntries.length > 0 && !apply.loading && (
        <>
          <div className="h-6" />
          <Card title="Apply results">
            <p className="mb-4 text-theme-sm text-gray-700">
              {successCount} / {applyEntries.length} succeeded
            </p>
            <div className="overflow-hidden rounded-xl border border-gray-200">
              <div className="max-w-full overflow-x-auto">
                <table className="min-w-full">
                  <thead className="border-b border-gray-100 bg-gray-50">
                    <tr>
                      <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Device</th>
                      <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Previous → Requested</th>
                      <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Verified (running)</th>
                      <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Service</th>
                      <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {applyEntries.map(([device, result]) => (
                      <tr key={device}>
                        <td className="px-5 py-4 text-theme-sm font-medium text-gray-800">{device}</td>
                        <td className="px-5 py-4 text-theme-sm text-gray-700">
                          {result.previous} → {result.requested}
                        </td>
                        <td className="px-5 py-4 text-theme-sm text-gray-700">{result.verified ?? '—'}</td>
                        <td className="px-5 py-4 text-theme-sm">
                          <Badge color={result.service_active ? 'success' : 'error'}>
                            {result.service_active ? 'active' : 'inactive'}
                          </Badge>
                        </td>
                        <td className="px-5 py-4 text-theme-sm">
                          <div className="flex items-start gap-2">
                            <Badge color={result.ok ? 'success' : 'error'}>{result.ok ? 'success' : 'failed'}</Badge>
                            {!result.ok && result.error && (
                              <span className="whitespace-pre-line text-theme-xs text-error-600">{result.error}</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
