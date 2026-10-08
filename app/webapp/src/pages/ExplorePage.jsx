import { useState } from 'react'
import { postShow } from '../api'
import CommandPicker from '../components/CommandPicker'
import PageBreadcrumb from '../components/layout/PageBreadcrumb'
import ResultPanel from '../components/ResultPanel'
import RoleBadge from '../components/RoleBadge'
import SiteSelect from '../components/SiteSelect'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import ErrorState from '../components/ui/ErrorState'
import Input from '../components/ui/Input'
import LoadingState from '../components/ui/LoadingState'
import { useSiteContext } from '../context/SiteContext'

export default function ExplorePage() {
  const { devices, devicesLoading, devicesError } = useSiteContext()
  const [selected, setSelected] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [command, setCommand] = useState('nv show system')
  const [run, setRun] = useState({ loading: false, error: null, results: null })

  function toggleDevice(name) {
    setSelected((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))
  }

  function handlePick(entry) {
    setSelectedId(entry?.id ?? '')
    if (entry) setCommand(entry.command)
  }

  async function handleRun() {
    if (selected.length === 0 || !command.trim()) return
    setRun({ loading: true, error: null, results: null })
    try {
      const data = await postShow(selected, command.trim())
      setRun({ loading: false, error: null, results: data.results })
    } catch (err) {
      setRun({ loading: false, error: err.message, results: null })
    }
  }

  return (
    <div>
      <PageBreadcrumb title="Explore" />

      <Card title="Run a command" description="Pick one or more devices from the selected site, then run a show command.">
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

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <CommandPicker selectedId={selectedId} onSelect={handlePick} />
            <Input
              label="Command"
              value={command}
              onChange={(e) => {
                setCommand(e.target.value)
                setSelectedId('')
              }}
            />
          </div>
          <Button onClick={handleRun} disabled={selected.length === 0 || !command.trim() || run.loading}>
            {run.loading ? 'Running…' : 'Run'}
          </Button>
        </div>
      </Card>

      <div className="h-6" />

      {run.loading && <LoadingState label="Running command…" />}
      {run.error && <ErrorState message={run.error} />}
      {run.results && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Object.entries(run.results).map(([device, result]) => (
            <ResultPanel key={device} title={device} result={result} />
          ))}
        </div>
      )}
    </div>
  )
}
