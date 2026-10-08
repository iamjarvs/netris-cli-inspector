import { useEffect, useState } from 'react'
import { getArchiveHistory, getOnboxHistory, postArchiveSnapshot } from '../api'
import PageBreadcrumb from '../components/layout/PageBreadcrumb'
import SiteSelect from '../components/SiteSelect'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import Select from '../components/ui/Select'
import Toast from '../components/ui/Toast'
import { useSiteContext } from '../context/SiteContext'
import ArchiveTable from './history/ArchiveTable'
import CompareViewer from './history/CompareViewer'
import RevisionTable from './history/RevisionTable'
import SourceSelect from './history/SourceSelect'
import { archiveSnapshotOptions, decodeSource, encodeSource, FIXED_SOURCES, onboxRevisionOptions } from './history/sourceOptions'

export default function HistoryPage() {
  const { devices } = useSiteContext()
  const [selectedDevice, setSelectedDevice] = useState('')
  const [hideStartup, setHideStartup] = useState(true)
  const [hidePruned, setHidePruned] = useState(true)
  const [onboxHistory, setOnboxHistory] = useState({ loading: false, error: null, data: null })
  const [archiveHistory, setArchiveHistory] = useState({ loading: false, error: null, data: null })
  const [snapshot, setSnapshot] = useState({ loading: false, toast: null })
  const [currentVsValue, setCurrentVsValue] = useState('')
  const [sideAValue, setSideAValue] = useState('')
  const [sideBValue, setSideBValue] = useState('')
  const [comparison, setComparison] = useState(null)

  const device = devices.find((d) => d.name === selectedDevice)

  function loadHistory(dev, { signal } = {}) {
    setOnboxHistory({ loading: true, error: null, data: null })
    getOnboxHistory(dev.name, dev.mgmt_address)
      .then((data) => !signal?.cancelled && setOnboxHistory({ loading: false, error: null, data }))
      .catch((err) => !signal?.cancelled && setOnboxHistory({ loading: false, error: err.message, data: null }))

    setArchiveHistory({ loading: true, error: null, data: null })
    getArchiveHistory(dev.name)
      .then((data) => !signal?.cancelled && setArchiveHistory({ loading: false, error: null, data }))
      .catch((err) => !signal?.cancelled && setArchiveHistory({ loading: false, error: err.message, data: null }))
  }

  useEffect(() => {
    setComparison(null)
    setCurrentVsValue('')
    setSideAValue('')
    setSideBValue('')

    if (!device) {
      setOnboxHistory({ loading: false, error: null, data: null })
      setArchiveHistory({ loading: false, error: null, data: null })
      return
    }

    const signal = { cancelled: false }
    loadHistory(device, { signal })
    return () => {
      signal.cancelled = true
    }
  }, [device?.name])

  function handleRefresh() {
    if (!device) return
    loadHistory(device)
  }

  async function handleSnapshot() {
    if (!device) return
    setSnapshot({ loading: true, toast: null })
    try {
      const res = await postArchiveSnapshot([device.name])
      if (res.failed?.includes(device.name)) {
        setSnapshot({ loading: false, toast: { message: `Snapshot failed for ${device.name}.`, color: 'error' } })
      } else if (res.results?.[device.name]) {
        setSnapshot({ loading: false, toast: { message: 'Snapshot recorded a configuration change.', color: 'success' } })
      } else {
        setSnapshot({ loading: false, toast: { message: 'No change since last snapshot.', color: 'info' } })
      }
    } catch (err) {
      setSnapshot({ loading: false, toast: { message: err.message, color: 'error' } })
    }
  }

  const revisions = onboxHistory.data?.revisions ?? []
  const archiveEntries = archiveHistory.data?.entries ?? []
  const onboxOptions = onboxRevisionOptions(revisions, hideStartup, hidePruned)
  const archiveOptions = archiveSnapshotOptions(archiveEntries)
  const vsTargetOptions = FIXED_SOURCES.filter((f) => f.ref !== 'applied')

  function handleCompare(sourceA, sourceB) {
    setComparison({ sourceA, sourceB })
  }

  // The other source is the "from" side (A) and current/applied is the "to"
  // side (B), so the diff reads the intuitive way: red/removed is what that
  // other source had and current doesn't anymore, green/added is what's
  // newly there since then. Passing applied as A inverts that.
  function handleCurrentVsChange(value) {
    setCurrentVsValue(value)
    if (!value) {
      setComparison(null)
      return
    }
    handleCompare(decodeSource(value), { type: 'onbox', ref: 'applied' })
  }

  function handleRowCompare(source) {
    setCurrentVsValue(encodeSource(source.type, source.ref))
    handleCompare(source, { type: 'onbox', ref: 'applied' })
  }

  function handleTwoSourceCompare() {
    if (!sideAValue || !sideBValue) return
    handleCompare(decodeSource(sideAValue), decodeSource(sideBValue))
  }

  return (
    <div>
      <PageBreadcrumb title="History" />

      <Card title="Device">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
          <SiteSelect />
          <Select label="Device" value={selectedDevice} onChange={(e) => setSelectedDevice(e.target.value)}>
            <option value="">Select a device…</option>
            {devices.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name}
              </option>
            ))}
          </Select>
          <Button
            variant="outline"
            onClick={handleRefresh}
            disabled={!device || onboxHistory.loading || archiveHistory.loading}
          >
            {onboxHistory.loading || archiveHistory.loading ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button onClick={handleSnapshot} disabled={!device || snapshot.loading}>
            {snapshot.loading ? 'Snapshotting…' : 'Snapshot now'}
          </Button>
        </div>
        {snapshot.toast && (
          <div className="mt-4">
            <Toast message={snapshot.toast.message} color={snapshot.toast.color} onDismiss={() => setSnapshot((s) => ({ ...s, toast: null }))} />
          </div>
        )}
      </Card>

      <div className="h-6" />

      {!device ? (
        <Card>
          <EmptyState message="Select a device above to view its history." />
        </Card>
      ) : (
        <>
          <Card title="Current vs…" description="Compare the device's current running configuration against an earlier point.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SourceSelect
                label="Compare current against"
                value={currentVsValue}
                onChange={handleCurrentVsChange}
                fixedOptions={vsTargetOptions}
                onboxOptions={onboxOptions}
                archiveOptions={archiveOptions}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
              <label className="flex items-center gap-2.5 text-theme-sm text-gray-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500/30"
                  checked={hideStartup}
                  onChange={(e) => setHideStartup(e.target.checked)}
                />
                Hide startup entries
              </label>
              <label className="flex items-center gap-2.5 text-theme-sm text-gray-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500/30"
                  checked={hidePruned}
                  onChange={(e) => setHidePruned(e.target.checked)}
                />
                Hide pruned revisions
                <span className="text-theme-xs text-gray-400">(no longer resident on the switch)</span>
              </label>
            </div>
          </Card>

          <div className="h-6" />

          {comparison && (
            <>
              <CompareViewer device={device} sourceA={comparison.sourceA} sourceB={comparison.sourceB} />
              <div className="h-6" />
            </>
          )}

          <Card title="On-box revision history">
            <RevisionTable state={onboxHistory} hideStartup={hideStartup} hidePruned={hidePruned} onCompare={handleRowCompare} />
          </Card>

          <div className="h-6" />

          <Card title="Archive history">
            <ArchiveTable state={archiveHistory} device={device.name} mgmtAddress={device.mgmt_address} onCompare={handleRowCompare} />
          </Card>

          <div className="h-6" />

          <Card title="Compare two sources" description="Pick any two on-box revisions or archive snapshots to diff against each other.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] sm:items-end">
              <SourceSelect
                label="Side A"
                value={sideAValue}
                onChange={setSideAValue}
                fixedOptions={FIXED_SOURCES}
                onboxOptions={onboxOptions}
                archiveOptions={archiveOptions}
              />
              <SourceSelect
                label="Side B"
                value={sideBValue}
                onChange={setSideBValue}
                fixedOptions={FIXED_SOURCES}
                onboxOptions={onboxOptions}
                archiveOptions={archiveOptions}
              />
              <Button onClick={handleTwoSourceCompare} disabled={!sideAValue || !sideBValue}>
                Compare
              </Button>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
