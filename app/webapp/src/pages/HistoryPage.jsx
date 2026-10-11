import { useEffect, useRef, useState } from 'react'
import { getArchiveHistory, getOnboxHistory, postArchiveSnapshot } from '../api'
import PageBreadcrumb from '../components/layout/PageBreadcrumb'
import KindToggle from '../components/KindToggle'
import SiteSelect from '../components/SiteSelect'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import Select from '../components/ui/Select'
import Toast from '../components/ui/Toast'
import { useSiteContext } from '../context/SiteContext'
import { useViewKind } from '../context/ViewKindContext'
import ArchiveTable from './history/ArchiveTable'
import CompareViewer from './history/CompareViewer'
import RevisionTable from './history/RevisionTable'
import SourceSelect from './history/SourceSelect'
import {
  archiveSnapshotOptions,
  decodeSource,
  encodeSource,
  FIXED_SOURCES,
  INTENT_FIXED_SOURCES,
  onboxRevisionOptions,
} from './history/sourceOptions'

export default function HistoryPage() {
  const { devices } = useSiteContext()
  const { kind, isIntent } = useViewKind()
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

  // The switch only keeps NVUE *config* revisions. Intent has no on-box
  // history (the file is overwritten each render), so for intent the archive
  // is the whole story and the on-box revision list isn't fetched at all.
  const currentSource = { type: 'onbox', ref: isIntent ? 'live' : 'applied' }

  function loadHistory(dev, { signal } = {}) {
    if (isIntent) {
      setOnboxHistory({ loading: false, error: null, data: null })
    } else {
      setOnboxHistory({ loading: true, error: null, data: null })
      getOnboxHistory(dev.name, dev.mgmt_address)
        .then((data) => !signal?.cancelled && setOnboxHistory({ loading: false, error: null, data }))
        .catch((err) => !signal?.cancelled && setOnboxHistory({ loading: false, error: err.message, data: null }))
    }

    setArchiveHistory({ loading: true, error: null, data: null })
    getArchiveHistory(dev.name, 20, kind)
      .then((data) => !signal?.cancelled && setArchiveHistory({ loading: false, error: null, data }))
      .catch((err) => !signal?.cancelled && setArchiveHistory({ loading: false, error: err.message, data: null }))
  }

  // handleSnapshot awaits a slow request; by the time it finishes the user may
  // have flipped Configuration/Intent, so it must reload with the *latest*
  // loadHistory, not the one from the render that started it.
  const loadHistoryRef = useRef(loadHistory)
  loadHistoryRef.current = loadHistory

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
  }, [device?.name, kind])

  function handleRefresh() {
    if (!device) return
    loadHistory(device)
  }

  async function handleSnapshot() {
    if (!device) return
    setSnapshot({ loading: true, toast: null })
    try {
      const res = await postArchiveSnapshot([device.name])
      const configChanged = res.results?.[device.name]
      const intentChanged = res.intent_results?.[device.name]
      if (res.failed?.includes(device.name)) {
        const why = res.errors?.[device.name]
        setSnapshot({ loading: false, toast: { message: `Snapshot failed for ${device.name}${why ? `: ${why}` : '.'}`, color: 'error' } })
      } else if (configChanged || intentChanged) {
        const what = [configChanged && 'configuration', intentChanged && 'intent'].filter(Boolean).join(' and ')
        setSnapshot({ loading: false, toast: { message: `Snapshot recorded a change to the ${what}.`, color: 'success' } })
        loadHistoryRef.current(device)
      } else {
        setSnapshot({ loading: false, toast: { message: 'No change since last snapshot.', color: 'info' } })
      }
    } catch (err) {
      setSnapshot({ loading: false, toast: { message: err.message, color: 'error' } })
    }
  }

  const revisions = onboxHistory.data?.revisions ?? []
  const archiveEntries = archiveHistory.data?.entries ?? []
  const onboxOptions = isIntent ? [] : onboxRevisionOptions(revisions, hideStartup, hidePruned)
  const archiveOptions = archiveSnapshotOptions(archiveEntries)
  const fixedSources = isIntent ? INTENT_FIXED_SOURCES : FIXED_SOURCES
  const vsTargetOptions = fixedSources.filter((f) => f.ref !== currentSource.ref)

  function handleCompare(sourceA, sourceB) {
    setComparison({ sourceA, sourceB, kind })
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
    handleCompare(decodeSource(value), currentSource)
  }

  function handleRowCompare(source) {
    setCurrentVsValue(encodeSource(source.type, source.ref))
    handleCompare(source, currentSource)
  }

  function handleTwoSourceCompare() {
    if (!sideAValue || !sideBValue) return
    handleCompare(decodeSource(sideAValue), decodeSource(sideBValue))
  }

  return (
    <div>
      <PageBreadcrumb title="History" />

      <Card title="Device">
        <div className="mb-4">
          <KindToggle />
        </div>
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
            {snapshot.loading ? 'Snapshotting…' : 'Snapshot now (config + intent)'}
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
          <Card
            title="Current vs…"
            description={
              isIntent
                ? "Compare the intent currently on the switch against an earlier archived capture."
                : "Compare the device's current running configuration against an earlier point."
            }
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SourceSelect
                label="Compare current against"
                value={currentVsValue}
                onChange={handleCurrentVsChange}
                fixedOptions={vsTargetOptions}
                onboxOptions={onboxOptions}
                archiveOptions={archiveOptions}
                showOnbox={!isIntent}
              />
            </div>
            <div className={`mt-4 flex flex-wrap gap-x-6 gap-y-2 ${isIntent ? 'hidden' : ''}`}>
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

          {/* A comparison belongs to the Configuration/Intent choice it was made under. */}
          {comparison && comparison.kind === kind && (
            <>
              <CompareViewer device={device} sourceA={comparison.sourceA} sourceB={comparison.sourceB} kind={kind} />
              <div className="h-6" />
            </>
          )}

          {!isIntent && (
            <>
              <Card title="On-box revision history">
                <RevisionTable state={onboxHistory} hideStartup={hideStartup} hidePruned={hidePruned} onCompare={handleRowCompare} />
              </Card>
              <div className="h-6" />
            </>
          )}

          <Card
            title={isIntent ? 'Intent archive history' : 'Archive history'}
            description={
              isIntent
                ? 'The switch overwrites its intent file every time the agent renders it and keeps no history, so every version here was captured by this tool when a change was detected.'
                : undefined
            }
          >
            <ArchiveTable
              state={archiveHistory}
              device={device.name}
              mgmtAddress={device.mgmt_address}
              onCompare={handleRowCompare}
              kind={kind}
            />
          </Card>

          <div className="h-6" />

          <Card
            title="Compare two sources"
            description={
              isIntent
                ? 'Pick the live intent or any archived capture on each side to diff them.'
                : 'Pick any two on-box revisions or archive snapshots to diff against each other.'
            }
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] sm:items-end">
              <SourceSelect
                label="Side A"
                value={sideAValue}
                onChange={setSideAValue}
                fixedOptions={fixedSources}
                onboxOptions={onboxOptions}
                archiveOptions={archiveOptions}
                showOnbox={!isIntent}
              />
              <SourceSelect
                label="Side B"
                value={sideBValue}
                onChange={setSideBValue}
                fixedOptions={fixedSources}
                onboxOptions={onboxOptions}
                archiveOptions={archiveOptions}
                showOnbox={!isIntent}
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
