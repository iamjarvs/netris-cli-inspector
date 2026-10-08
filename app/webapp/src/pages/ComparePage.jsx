import { useState } from 'react'
import { postCompare } from '../api'
import CommandPicker from '../components/CommandPicker'
import DiffView from '../components/DiffView'
import PageBreadcrumb from '../components/layout/PageBreadcrumb'
import ResultPanel from '../components/ResultPanel'
import SideBySideDiffView from '../components/SideBySideDiffView'
import SiteSelect from '../components/SiteSelect'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import ErrorState from '../components/ui/ErrorState'
import Input from '../components/ui/Input'
import LoadingState from '../components/ui/LoadingState'
import Select from '../components/ui/Select'
import ToggleGroup from '../components/ui/ToggleGroup'
import { useSiteContext } from '../context/SiteContext'

const DIFF_MODE_OPTIONS = [
  { value: 'inline', label: 'Inline' },
  { value: 'side-by-side', label: 'Side-by-side' },
]

export default function ComparePage() {
  const { devices, devicesLoading, devicesError } = useSiteContext()
  const [deviceA, setDeviceA] = useState('')
  const [deviceB, setDeviceB] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [command, setCommand] = useState('nv show system')
  const [showDiff, setShowDiff] = useState(true)
  const [diffMode, setDiffMode] = useState('inline')
  const [run, setRun] = useState({ loading: false, error: null, data: null })

  function handlePick(entry) {
    setSelectedId(entry?.id ?? '')
    if (entry) setCommand(entry.command)
  }

  async function handleCompare() {
    if (!deviceA || !deviceB || !command.trim()) return
    setRun({ loading: true, error: null, data: null })
    try {
      const data = await postCompare(deviceA, deviceB, command.trim())
      setRun({ loading: false, error: null, data })
    } catch (err) {
      setRun({ loading: false, error: err.message, data: null })
    }
  }

  return (
    <div>
      <PageBreadcrumb title="Compare" />

      <Card title="Compare two devices" description="Run the same command on two devices and see a structural diff.">
        {devicesError && <ErrorState message={devicesError} />}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SiteSelect />
          <Select label="Device A" value={deviceA} onChange={(e) => setDeviceA(e.target.value)} disabled={devicesLoading}>
            <option value="">Select a device…</option>
            {devices.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select label="Device B" value={deviceB} onChange={(e) => setDeviceB(e.target.value)} disabled={devicesLoading}>
            <option value="">Select a device…</option>
            {devices.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name}
              </option>
            ))}
          </Select>
          <CommandPicker selectedId={selectedId} onSelect={handlePick} />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <Input
            label="Command"
            value={command}
            onChange={(e) => {
              setCommand(e.target.value)
              setSelectedId('')
            }}
          />
          <Button onClick={handleCompare} disabled={!deviceA || !deviceB || !command.trim() || run.loading}>
            {run.loading ? 'Comparing…' : 'Compare'}
          </Button>
        </div>
      </Card>

      <div className="h-6" />

      {run.loading && <LoadingState label="Comparing devices…" />}
      {run.error && <ErrorState message={run.error} />}

      {run.data && (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ResultPanel title={run.data.device_a} result={run.data.result_a} />
            <ResultPanel title={run.data.device_b} result={run.data.result_b} />
          </div>
          <div className="h-6" />

          <Card
            title="Diff"
            action={
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-theme-sm text-gray-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500/30"
                    checked={showDiff}
                    onChange={(e) => setShowDiff(e.target.checked)}
                  />
                  Show diff
                </label>
                {showDiff && <ToggleGroup options={DIFF_MODE_OPTIONS} value={diffMode} onChange={setDiffMode} />}
              </div>
            }
          >
            {showDiff &&
              (diffMode === 'inline' ? (
                <DiffView lines={run.data.diff_lines} />
              ) : (
                <SideBySideDiffView
                  rows={run.data.side_by_side}
                  leftLabel={run.data.device_a}
                  rightLabel={run.data.device_b}
                />
              ))}
          </Card>
        </>
      )}
    </div>
  )
}
