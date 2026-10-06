import { useEffect, useRef, useState } from 'react'
import { getWatchEvents, postSavedDiff, postWatchPoll } from '../api'
import DiffView from '../components/DiffView'
import DeviceContextCard from '../components/DeviceContextCard'
import SwitchScopeSelector from '../components/SwitchScopeSelector'
import { CheckIcon, ChevronDownIcon, CopyIcon, TrashIcon } from '../components/icons'
import PageBreadcrumb from '../components/layout/PageBreadcrumb'
import RoleBadge from '../components/RoleBadge'
import SideBySideDiffView from '../components/SideBySideDiffView'
import SiteSelect from '../components/SiteSelect'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import ErrorState from '../components/ui/ErrorState'
import Toast from '../components/ui/Toast'
import ToggleGroup from '../components/ui/ToggleGroup'
import { useSiteContext } from '../context/SiteContext'

export default function WatchPage() {
  const { currentSite, devices } = useSiteContext()

  // Watcher state
  const [active, setActive] = useState(true)
  const [polling, setPolling] = useState(false)
  const [error, setError] = useState(null)
  const [lastCheckTime, setLastCheckTime] = useState(null)
  const [cursorEpoch, setCursorEpoch] = useState(0)

  // Switch monitoring scope
  const [selectedSwitches, setSelectedSwitches] = useState([])
  const initializedSiteRef = useRef(null)

  // Keep selected switches in sync when site or devices change
  useEffect(() => {
    if (devices && devices.length > 0) {
      if (initializedSiteRef.current !== currentSite?.id) {
        // Site changed or initial load: select all switches by default
        setSelectedSwitches(devices.map((d) => d.name))
        initializedSiteRef.current = currentSite?.id
      } else {
        // Preserve user selection if valid
        setSelectedSwitches((prev) => {
          const valid = prev.filter((name) => devices.some((d) => d.name === name))
          return valid.length > 0 ? valid : devices.map((d) => d.name)
        })
      }
    } else {
      setSelectedSwitches([])
    }
  }, [devices, currentSite?.id])

  // Data streams
  const [events, setEvents] = useState([])
  const [changeBatches, setChangeBatches] = useState([])
  const [activeViewMode, setActiveViewMode] = useState({}) // device -> 'unified' | 'added_removed' | 'side_by_side'
  const [toastMessage, setToastMessage] = useState(null)

  // Expanded event payloads state (collapsed by default)
  const [expandedEventIds, setExpandedEventIds] = useState({})
  const [copiedId, setCopiedId] = useState(null)

  function toggleEvent(id) {
    setExpandedEventIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }))
  }

  function handleCopyJson(e, id, payload) {
    e.stopPropagation()
    const str = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
    navigator.clipboard.writeText(str)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  function handleClearAll() {
    setChangeBatches([])
    setEvents([])
    setExpandedEventIds({})
    const nowEpoch = Math.floor(Date.now() / 1000)
    setCursorEpoch(nowEpoch)
    cursorRef.current = nowEpoch
    setToastMessage('Live watch view and event history cleared')
  }

  function handleClearDiffs() {
    setChangeBatches([])
    setToastMessage('Cleared detected config diffs')
  }

  function handleClearEvents() {
    setEvents([])
    setExpandedEventIds({})
    const nowEpoch = Math.floor(Date.now() / 1000)
    setCursorEpoch(nowEpoch)
    cursorRef.current = nowEpoch
    setToastMessage('Cleared Netris activity feed')
  }

  // Keep refs for continuous streaming loop
  const pollingRef = useRef(false)
  const cursorRef = useRef(0)
  cursorRef.current = cursorEpoch
  const selectedSwitchesRef = useRef(selectedSwitches)
  selectedSwitchesRef.current = selectedSwitches

  // Initial load of past Netris write events
  useEffect(() => {
    async function loadPastEvents() {
      try {
        const res = await getWatchEvents(Math.floor(Date.now() / 1000) - 3600)
        if (res?.events?.length > 0) {
          setEvents(res.events.slice(-10))
        }
      } catch (err) {
        console.error('Failed to load past events:', err)
      }
    }
    loadPastEvents()
  }, [])

  // Poll function
  async function poll() {
    if (pollingRef.current) return
    pollingRef.current = true
    setPolling(true)
    setError(null)

    try {
      const data = await postWatchPoll(
        currentSite?.id,
        cursorRef.current,
        selectedSwitchesRef.current
      )
      if (data?.cursor_epoch) {
        setCursorEpoch(data.cursor_epoch)
      }
      setLastCheckTime(new Date())

      // Append any new product events
      if (data?.events?.length > 0) {
        setEvents((prev) => {
          const existingIds = new Set(prev.map((e) => e.id))
          const fresh = data.events.filter((e) => !existingIds.has(e.id))
          return [...fresh, ...prev].slice(0, 30)
        })
      }

      // Check if switch diffs were found
      if (data?.affected_devices?.length > 0) {
        const newBatch = {
          id: Date.now(),
          timestamp: new Date().toLocaleTimeString(),
          trigger: data.events?.[0]?.summary || 'Switch CLI / Config update',
          affectedDevices: data.affected_devices,
          unchangedDevices: data.unchanged_devices || [],
          diffs: data.diffs || {},
        }
        setChangeBatches((prev) => [newBatch, ...prev])
      }
    } catch (err) {
      setError(err.message || 'Inspection failed')
    } finally {
      setPolling(false)
      pollingRef.current = false
    }
  }

  // Continuous live stream loop (replaces manual interval dropdown)
  useEffect(() => {
    if (!active) return

    let cancelled = false
    let timerId = null

    async function streamLoop() {
      if (cancelled) return
      await poll()
      if (!cancelled) {
        // Continuous live refresh: brief 1.5s interval between passes
        timerId = setTimeout(streamLoop, 1500)
      }
    }

    timerId = setTimeout(streamLoop, 300)

    return () => {
      cancelled = true
      if (timerId) clearTimeout(timerId)
    }
  }, [active, currentSite?.id])

  async function handleSaveDiff(device, diffObj) {
    try {
      const label = `Watch: ${diffObj.trigger?.slice(0, 35) || 'Config Change'}`
      await postSavedDiff({
        device,
        label,
        source_a_desc: `${device} (before change)`,
        source_b_desc: `${device} (after change)`,
        diff: diffObj.raw_diff || '',
      })
      setToastMessage(`Saved diff for ${device} to Diff Examples!`)
    } catch (err) {
      setToastMessage(`Failed to save: ${err.message}`)
    }
  }


  return (
    <div className="space-y-6">
      {toastMessage && (
        <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
      )}

      <PageBreadcrumb title="Live Watch Mode" />

      {/* Control Card */}
      <Card
        title="Live Switch Config & Drift Monitor"
        description="Continuously streams Netris Controller activity and live switch config revisions, detecting affected devices and showing unified diffs in real-time."
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearAll}
            className="flex items-center gap-1.5 text-gray-600 hover:text-error-600 hover:border-error-200"
            title="Clear all live diffs and event history"
          >
            <TrashIcon className="h-3.5 w-3.5" />
            <span>Clear All</span>
          </Button>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12 items-end">
          <div className="lg:col-span-3">
            <SiteSelect />
          </div>

          <div className="lg:col-span-3">
            <SwitchScopeSelector
              devices={devices}
              selected={selectedSwitches}
              onChange={setSelectedSwitches}
            />
          </div>

          <div className="lg:col-span-2">
            <label className="block text-theme-xs font-medium text-gray-700 mb-1.5">
              Live Stream
            </label>
            <Button
              variant={active ? 'outline' : 'primary'}
              size="sm"
              onClick={() => setActive(!active)}
              className="w-full"
            >
              {active ? (
                <span className="flex items-center justify-center gap-1.5 text-warning-700">
                  <span className="h-2 w-2 rounded-full bg-warning-500 animate-pulse" />
                  Pause Stream
                </span>
              ) : (
                <span className="flex items-center justify-center gap-1.5 text-white">
                  <span className="h-2 w-2 rounded-full bg-success-400" />
                  Resume Stream
                </span>
              )}
            </Button>
          </div>

          <div className="lg:col-span-2">
            <label className="block text-theme-xs font-medium text-gray-700 mb-1.5">
              Instant Audit
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={poll}
              disabled={polling}
              className="w-full"
            >
              {polling ? 'Auditing…' : 'Check Now'}
            </Button>
          </div>

          <div className="lg:col-span-2">
            <label className="block text-theme-xs font-medium text-gray-700 mb-1.5">
              Reset View
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearAll}
              className="w-full text-gray-600 hover:text-error-600 hover:border-error-200"
            >
              <TrashIcon className="h-3.5 w-3.5" />
              <span>Clear</span>
            </Button>
          </div>
        </div>

        {/* Live Status Bar */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3 text-theme-xs text-gray-500">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  active ? 'bg-success-500 animate-pulse' : 'bg-gray-400'
                }`}
              />
              <strong className="text-gray-900 font-medium">
                {active
                  ? `Streaming live: ${selectedSwitches.length} of ${devices?.length || 0} switches monitored`
                  : 'Streaming paused'}
              </strong>
            </span>
            <span>•</span>
            <span>Site: <strong className="text-gray-700">{currentSite?.name || 'All'}</strong></span>
            {lastCheckTime && (
              <>
                <span>•</span>
                <span>Last verified: {lastCheckTime.toLocaleTimeString()}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge color="info" size="sm">Git Archive Synced</Badge>
            <Badge color="gray" size="sm">NVUE Applied Configs</Badge>
          </div>
        </div>

        {error && <div className="mt-3"><ErrorState message={error} /></div>}
      </Card>

      {/* Netris Product Activity Feed */}
      {events.length > 0 && (
        <Card
          title="Netris Product Activity"
          description="Recent write calls detected on the Netris Controller (/api/apilogs). Click any entry to inspect the JSON payload."
          action={
            <Button
              variant="outline"
              size="xs"
              onClick={handleClearEvents}
              className="text-gray-600 hover:text-error-600 hover:border-error-200"
              title="Clear activity log entries"
            >
              <TrashIcon className="h-3 w-3" />
              <span>Clear</span>
            </Button>
          }
        >
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {events.slice(0, 8).map((ev, i) => {
              const eventKey = ev.id || `${ev.timestamp}-${i}`
              const isExpanded = !!expandedEventIds[eventKey]
              const hasPayload = ev.payload && (typeof ev.payload === 'object' ? Object.keys(ev.payload).length > 0 : true)
              const formattedPayload = ev.payload ? (typeof ev.payload === 'object' ? JSON.stringify(ev.payload, null, 2) : String(ev.payload)) : null

              return (
                <div
                  key={eventKey}
                  className={`rounded-xl border transition-all duration-150 overflow-hidden ${
                    isExpanded
                      ? 'border-brand-300 bg-white shadow-sm ring-1 ring-brand-100'
                      : 'border-gray-200 bg-gray-50/70 hover:bg-gray-50 hover:border-gray-300'
                  }`}
                >
                  {/* Clickable Header Row (Collapsed by default) */}
                  <div
                    onClick={() => toggleEvent(eventKey)}
                    className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 cursor-pointer select-none text-theme-xs"
                  >
                    <div className="flex items-center gap-2.5">
                      <Badge
                        color={
                          ev.method === 'POST'
                            ? 'success'
                            : ev.method === 'DELETE'
                            ? 'error'
                            : 'primary'
                        }
                        size="sm"
                      >
                        {ev.method}
                      </Badge>
                      <span className="font-semibold text-gray-900">{ev.resource_type}</span>
                      <span className="text-gray-600 font-mono text-[11px]">{ev.url}</span>
                      {ev.resource_name && (
                        <span className="text-brand-700 font-medium bg-brand-50 px-2 py-0.5 rounded border border-brand-200/50">
                          '{ev.resource_name}'
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-gray-500 text-[11px]">
                      <span>by <strong className="text-gray-700 font-medium">{ev.user}</strong></span>
                      <span>•</span>
                      <span>{ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : 'Just now'}</span>
                      <ChevronDownIcon
                        className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${
                          isExpanded ? 'rotate-180 text-brand-600' : ''
                        }`}
                      />
                    </div>
                  </div>

                  {/* Expanded JSON Details */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 bg-white px-4 py-3.5 text-theme-xs">
                      {/* Sub-header / metadata */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-gray-100 text-[11px] text-gray-500">
                        <div className="flex items-center gap-3">
                          <span>Endpoint: <strong className="text-gray-800 font-mono">{ev.method} {ev.url}</strong></span>
                          {ev.ip && <span>Client IP: <strong className="text-gray-800 font-mono">{ev.ip}</strong></span>}
                          {ev.trace?.traceId && (
                            <span className="font-mono text-[10px] text-gray-400">Trace: {ev.trace.traceId.slice(0, 12)}…</span>
                          )}
                        </div>
                        {hasPayload && (
                          <button
                            type="button"
                            onClick={(e) => handleCopyJson(e, eventKey, ev.payload)}
                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium text-[11px] transition-colors"
                          >
                            {copiedId === eventKey ? (
                              <>
                                <CheckIcon className="h-3.5 w-3.5 text-success-600" />
                                <span className="text-success-600">Copied!</span>
                              </>
                            ) : (
                              <>
                                <CopyIcon className="h-3.5 w-3.5 text-gray-500" />
                                <span>Copy JSON</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>

                      {/* Request Payload Section */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-semibold text-gray-700 text-theme-xs">Request JSON Payload:</span>
                          <span className="text-[11px] text-gray-400 font-mono">
                            {hasPayload ? `${formattedPayload.split('\n').length} lines` : 'empty'}
                          </span>
                        </div>
                        {hasPayload ? (
                          <pre className="rounded-lg border border-gray-200 bg-gray-900 text-gray-100 p-3.5 font-mono text-[11px] leading-5 overflow-x-auto max-h-72 select-text">
                            {formattedPayload}
                          </pre>
                        ) : (
                          <p className="text-gray-400 italic font-mono text-[11px] p-2 bg-gray-50 rounded border border-gray-100">
                            {ev.method === 'DELETE' ? '{} (HTTP DELETE - target ID in URL)' : '{} (No request body)'}
                          </p>
                        )}
                      </div>

                      {/* Response Status Note */}
                      <div className="mt-3 flex items-center justify-between rounded-lg bg-success-50/60 border border-success-200/60 px-3 py-2 text-[11px] text-success-800">
                        <span className="flex items-center gap-1.5 font-medium">
                          <span className="h-2 w-2 rounded-full bg-success-500" />
                          Response Status: HTTP 200/201 OK — Committed to Netris Controller
                        </span>
                        <span className="font-mono text-success-700 text-[10px]">{ev.id}</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* Detected Changes Streaming Timeline */}
      {changeBatches.length > 0 ? (
        <div className="space-y-8">
          <div className="flex items-center justify-between border-b border-gray-200 pb-2">
            <div className="flex items-center gap-2">
              <h3 className="text-theme-base font-bold text-gray-900">
                Live Configuration Changes Stream
              </h3>
              <Badge color="primary" size="sm">
                {changeBatches.length} {changeBatches.length === 1 ? 'Event' : 'Events'} Captured
              </Badge>
            </div>
            <Button
              variant="outline"
              size="xs"
              onClick={handleClearDiffs}
              className="text-gray-600 hover:text-error-600 hover:border-error-200"
              title="Clear all captured configuration diffs"
            >
              <TrashIcon className="h-3 w-3" />
              <span>Clear Stream</span>
            </Button>
          </div>

          {changeBatches.map((batch, batchIndex) => {
            const isLatest = batchIndex === 0
            const eventNum = changeBatches.length - batchIndex
            return (
              <div key={batch.id} className="space-y-4">
                {/* Event Header Banner */}
                <div
                  className={`rounded-xl border p-4 transition-all ${
                    isLatest
                      ? 'border-warning-300 bg-warning-50/70 shadow-2xs'
                      : 'border-gray-200 bg-gray-50/90'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                            isLatest
                              ? 'bg-warning-500 text-white'
                              : 'bg-gray-400 text-white'
                          }`}
                        >
                          {isLatest ? '⚡' : `#${eventNum}`}
                        </span>
                        <h4 className="text-theme-base font-semibold text-gray-900">
                          {isLatest ? 'Latest Config Change' : `Change Event #${eventNum}`} at {batch.timestamp}
                        </h4>
                        {isLatest && (
                          <Badge color="success" size="sm">
                            Most Recent
                          </Badge>
                        )}
                      </div>
                      <p className="text-theme-xs text-gray-600 mt-1 pl-8.5">
                        Trigger: <span className="font-mono font-medium text-gray-800">{batch.trigger}</span>
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <Badge color="primary" size="sm">
                        {batch.affectedDevices.length} Affected Switches
                      </Badge>
                      {batch.unchangedDevices?.length > 0 && (
                        <Badge color="gray" size="sm">
                          {batch.unchangedDevices.length} Unchanged
                        </Badge>
                      )}
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => {
                          setChangeBatches((prev) => prev.filter((b) => b.id !== batch.id))
                          setToastMessage(`Cleared event from ${batch.timestamp}`)
                        }}
                        className="bg-white hover:text-error-600 border-gray-300 ml-1"
                        title="Dismiss this change event"
                      >
                        <TrashIcon className="h-3 w-3" />
                        <span>Dismiss</span>
                      </Button>
                    </div>
                  </div>

                  {/* Affected devices quick pills */}
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-200/60 pt-2.5 pl-8.5">
                    <span className="text-theme-xs font-medium text-gray-700">Affected Switches:</span>
                    {batch.affectedDevices.map((dev) => (
                      <span
                        key={dev}
                        className="inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1 text-theme-xs font-mono font-medium text-gray-900 shadow-2xs border border-gray-300"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-success-500" />
                        {dev}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Per-Device Configuration Review Cards */}
                <div className="space-y-6">
                  {batch.affectedDevices.map((deviceName) => {
                    const diffData = batch.diffs[deviceName] || {}
                    const viewKey = `${batch.id}-${deviceName}`
                    const viewMode = activeViewMode[viewKey] || activeViewMode[deviceName] || 'unified'

                    return (
                      <Card key={deviceName}>
                        {/* Switch Card Header */}
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
                                <rect x="3" y="4" width="18" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
                                <rect x="3" y="14" width="18" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
                                <circle cx="7" cy="7" r="0.9" fill="currentColor" />
                                <circle cx="7" cy="17" r="0.9" fill="currentColor" />
                              </svg>
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="text-theme-base font-bold text-gray-900 font-mono">
                                  {deviceName}
                                </h4>
                                {diffData.role && <RoleBadge role={diffData.role} />}
                                <span className="text-theme-xs text-gray-500 font-mono">
                                  {diffData.mgmt_address}
                                </span>
                              </div>
                              <p className="text-theme-xs text-gray-500 mt-0.5">
                                {diffData.summary || 'Configuration changed'}
                              </p>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-3">
                            {/* Diff Mode Toggle - Unified Diff by default */}
                            <ToggleGroup
                              options={[
                                { value: 'unified', label: 'Unified Diff' },
                                { value: 'added_removed', label: 'Added & Removed' },
                                { value: 'side_by_side', label: 'Side-by-side' },
                              ]}
                              value={viewMode}
                              onChange={(val) =>
                                setActiveViewMode((prev) => ({ ...prev, [viewKey]: val }))
                              }
                            />

                            {/* Bookmark button */}
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleSaveDiff(deviceName, diffData)}
                            >
                              Bookmark Diff
                            </Button>
                          </div>
                        </div>

                        {/* Body Content based on View Mode */}
                        <div className="pt-4">
                          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
                            {/* Left: Device Network Topology Context (4 cols) */}
                            <div className="lg:col-span-4 space-y-4">
                              <DeviceContextCard
                                deviceName={deviceName}
                                context={diffData.context}
                              />
                            </div>

                            {/* Right: Diff Viewer (8 cols) */}
                            <div className="lg:col-span-8 min-w-0 space-y-4">
                              {viewMode === 'added_removed' && (
                                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                  {/* Added / New Configuration */}
                                  <div className="rounded-xl border border-success-200 bg-success-50/30 overflow-hidden">
                                    <div className="flex items-center justify-between border-b border-success-200 bg-success-100/60 px-4 py-2">
                                      <span className="text-theme-xs font-semibold text-success-800 flex items-center gap-1.5">
                                        <span>▲</span> NEW / ADDED CONFIGURATION
                                      </span>
                                      <Badge color="success" size="sm">
                                        +{diffData.added_lines?.length || 0} commands
                                      </Badge>
                                    </div>
                                    <div className="p-3">
                                      {diffData.added_lines && diffData.added_lines.length > 0 ? (
                                        <pre className="font-mono text-theme-xs leading-5 text-success-900 whitespace-pre overflow-x-auto">
                                          {diffData.added_lines.map((line, idx) => (
                                            <div key={idx} className="hover:bg-success-100/40 px-2 py-0.5 rounded">
                                              <span className="text-success-600 select-none mr-2">+</span>
                                              {line}
                                            </div>
                                          ))}
                                        </pre>
                                      ) : (
                                        <p className="text-theme-xs text-gray-400 italic py-2 px-3">
                                          (no new commands added)
                                        </p>
                                      )}
                                    </div>
                                  </div>

                                  {/* Removed Configuration */}
                                  <div className="rounded-xl border border-error-200 bg-error-50/30 overflow-hidden">
                                    <div className="flex items-center justify-between border-b border-error-200 bg-error-100/60 px-4 py-2">
                                      <span className="text-theme-xs font-semibold text-error-800 flex items-center gap-1.5">
                                        <span>▼</span> REMOVED CONFIGURATION
                                      </span>
                                      <Badge color="error" size="sm">
                                        -{diffData.removed_lines?.length || 0} commands
                                      </Badge>
                                    </div>
                                    <div className="p-3">
                                      {diffData.removed_lines && diffData.removed_lines.length > 0 ? (
                                        <pre className="font-mono text-theme-xs leading-5 text-error-900 whitespace-pre overflow-x-auto">
                                          {diffData.removed_lines.map((line, idx) => (
                                            <div key={idx} className="hover:bg-error-100/40 px-2 py-0.5 rounded">
                                              <span className="text-error-600 select-none mr-2">-</span>
                                              {line}
                                            </div>
                                          ))}
                                        </pre>
                                      ) : (
                                        <p className="text-theme-xs text-gray-400 italic py-2 px-3">
                                          (no commands removed)
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}

                              {viewMode === 'unified' && (
                                <DiffView lines={diffData.raw_diff ? diffData.raw_diff.split('\n') : []} />
                              )}

                              {viewMode === 'side_by_side' && (
                                <SideBySideDiffView
                                  rows={diffData.side_by_side || []}
                                  leftTitle="Previous Revision"
                                  rightTitle="Current Revision"
                                />
                              )}
                            </div>
                          </div>
                        </div>
                      </Card>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        /* Empty State */
        <Card>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 mb-4 ring-8 ring-brand-50/50">
              <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8 animate-pulse">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
                <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.6" />
                <circle cx="12" cy="12" r="1.5" fill="currentColor" />
              </svg>
            </div>
            <h3 className="text-theme-lg font-semibold text-gray-900 mb-1">
              {active ? 'Watching Fabric for Changes' : 'Watch Mode Paused'}
            </h3>
            <p className="max-w-md text-theme-sm text-gray-500 mb-6">
              {active
                ? `Currently monitoring ${selectedSwitches.length} switches in ${currentSite?.name || 'the fabric'}. When you make a change in the Netris Controller or on a switch, the affected switches and exact new/removed commands will stream here in real time.`
                : 'Watcher is paused. Click "Resume Stream" or "Check Now" to resume live monitoring.'}
            </p>
            <div className="flex items-center gap-3">
              <Button
                variant="primary"
                size="md"
                onClick={poll}
                disabled={polling}
              >
                {polling ? 'Scanning Fabric…' : 'Audit Switches Now'}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
