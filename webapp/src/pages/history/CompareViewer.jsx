import { useEffect, useState } from 'react'
import { getConfigDiff, getConfigSource, postSavedDiff } from '../../api'
import ConfigTree from '../../components/ConfigTree'
import DiffView from '../../components/DiffView'
import FitPre from '../../components/FitPre'
import SideBySideDiffView from '../../components/SideBySideDiffView'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import ErrorState from '../../components/ui/ErrorState'
import Input from '../../components/ui/Input'
import LoadingState from '../../components/ui/LoadingState'
import Toast from '../../components/ui/Toast'
import ToggleGroup from '../../components/ui/ToggleGroup'
import { describeSource } from './sourceOptions'

const VIEW_OPTIONS = [
  { value: 'diff', label: 'Diff' },
  { value: 'full', label: 'Full config' },
]

const DIFF_MODE_OPTIONS = [
  { value: 'inline', label: 'Inline' },
  { value: 'side-by-side', label: 'Side-by-side' },
]

export default function CompareViewer({ device, sourceA, sourceB }) {
  const [diffState, setDiffState] = useState({ loading: false, error: null, data: null })
  const [viewMode, setViewMode] = useState('diff')
  const [diffMode, setDiffMode] = useState('inline')
  const [fullState, setFullState] = useState({ loading: false, key: null, jsonA: null, jsonB: null, errorA: null, errorB: null })
  const [collapsedPaths, setCollapsedPaths] = useState(new Set())
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [saveLabel, setSaveLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveToast, setSaveToast] = useState(null)

  const key = `${sourceA.type}:${sourceA.ref}|${sourceB.type}:${sourceB.ref}`

  useEffect(() => {
    let cancelled = false
    setDiffState({ loading: true, error: null, data: null })
    setViewMode('diff')
    setDiffMode('inline')
    setShowSaveInput(false)
    setSaveToast(null)
    setCollapsedPaths(new Set())
    setFullState({ loading: false, key: null, jsonA: null, jsonB: null, errorA: null, errorB: null })

    getConfigDiff({
      device: device.name,
      mgmtAddress: device.mgmt_address,
      aType: sourceA.type,
      aRef: sourceA.ref,
      bType: sourceB.type,
      bRef: sourceB.ref,
    })
      .then((data) => !cancelled && setDiffState({ loading: false, error: null, data }))
      .catch((err) => !cancelled && setDiffState({ loading: false, error: err.message, data: null }))

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device?.name, key])

  useEffect(() => {
    if (viewMode !== 'full' || fullState.key === key) return
    let cancelled = false
    setFullState((s) => ({ ...s, loading: true }))

    Promise.allSettled([
      getConfigSource({ device: device.name, mgmtAddress: device.mgmt_address, sourceType: sourceA.type, ref: sourceA.ref, format: 'json' }),
      getConfigSource({ device: device.name, mgmtAddress: device.mgmt_address, sourceType: sourceB.type, ref: sourceB.ref, format: 'json' }),
    ]).then(([resA, resB]) => {
      if (cancelled) return
      setFullState({
        loading: false,
        key,
        jsonA: resA.status === 'fulfilled' ? resA.value.json : null,
        jsonB: resB.status === 'fulfilled' ? resB.value.json : null,
        errorA: resA.status === 'rejected' ? resA.reason.message : null,
        errorB: resB.status === 'rejected' ? resB.reason.message : null,
      })
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, key])

  function toggleCollapsed(path) {
    setCollapsedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  async function handleSave() {
    if (!diffState.data || !saveLabel.trim()) return
    setSaving(true)
    try {
      await postSavedDiff({
        device: device.name,
        label: saveLabel.trim(),
        source_a_desc: describeSource(sourceA),
        source_b_desc: describeSource(sourceB),
        diff: diffState.data.diff,
        text_a: diffState.data.text_a,
        text_b: diffState.data.text_b,
      })
      setSaving(false)
      setShowSaveInput(false)
      setSaveLabel('')
      setSaveToast({ message: 'Saved. Find it under Diff Examples.', color: 'success' })
    } catch (err) {
      setSaving(false)
      setSaveToast({ message: err.message, color: 'error' })
    }
  }

  if (diffState.loading) return <Card title="Comparison"><LoadingState label="Loading comparison…" /></Card>
  if (diffState.error) return <Card title="Comparison"><ErrorState message={diffState.error} /></Card>
  if (!diffState.data) return null

  const { text_a: textA, text_b: textB, diff, side_by_side: sideBySide } = diffState.data
  const bothJson = fullState.jsonA !== null && fullState.jsonB !== null

  return (
    <Card title="Comparison">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-theme-sm text-gray-500">
          {describeSource(sourceA)} <span className="text-gray-400">vs</span> {describeSource(sourceB)}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup options={VIEW_OPTIONS} value={viewMode} onChange={setViewMode} />
          {viewMode === 'diff' && <ToggleGroup options={DIFF_MODE_OPTIONS} value={diffMode} onChange={setDiffMode} />}
          <Button variant="outline" size="sm" onClick={() => setShowSaveInput((v) => !v)}>
            Save this diff
          </Button>
        </div>
      </div>

      {showSaveInput && (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Input label="Label" placeholder="e.g. before MLAG change" value={saveLabel} onChange={(e) => setSaveLabel(e.target.value)} />
          </div>
          <Button size="sm" disabled={!saveLabel.trim() || saving} onClick={handleSave}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowSaveInput(false)}>
            Cancel
          </Button>
        </div>
      )}

      {saveToast && (
        <div className="mb-4">
          <Toast message={saveToast.message} color={saveToast.color} onDismiss={() => setSaveToast(null)} />
        </div>
      )}

      {viewMode === 'diff' ? (
        diffMode === 'inline' ? (
          <DiffView lines={(diff || '').split('\n')} />
        ) : (
          <SideBySideDiffView rows={sideBySide} leftLabel={describeSource(sourceA)} rightLabel={describeSource(sourceB)} />
        )
      ) : fullState.loading ? (
        <LoadingState label="Loading full configuration…" />
      ) : bothJson ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-theme-xs font-medium text-gray-500">{describeSource(sourceA)}</p>
            <div className="max-h-[560px] overflow-y-auto overflow-x-hidden rounded-xl border border-gray-200 bg-white p-3">
              <ConfigTree data={fullState.jsonA} collapsedPaths={collapsedPaths} onToggle={toggleCollapsed} />
            </div>
          </div>
          <div>
            <p className="mb-2 text-theme-xs font-medium text-gray-500">{describeSource(sourceB)}</p>
            <div className="max-h-[560px] overflow-y-auto overflow-x-hidden rounded-xl border border-gray-200 bg-white p-3">
              <ConfigTree data={fullState.jsonB} collapsedPaths={collapsedPaths} onToggle={toggleCollapsed} />
            </div>
          </div>
        </div>
      ) : (
        <>
          {(fullState.errorA || fullState.errorB) && (
            <div className="mb-3">
              <ErrorState message="No structured view available for this snapshot — showing raw configuration text instead." />
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <FitPre text={textA} />
            <FitPre text={textB} />
          </div>
        </>
      )}
    </Card>
  )
}
