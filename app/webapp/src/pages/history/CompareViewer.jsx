import { useEffect, useState } from 'react'
import { getConfigDiff, getConfigSource, postSavedDiff } from '../../api'
import DiffView from '../../components/DiffView'
import SideBySideDiffView from '../../components/SideBySideDiffView'
import StructuredViewer from '../../components/StructuredViewer'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import ErrorState from '../../components/ui/ErrorState'
import Input from '../../components/ui/Input'
import LoadingState from '../../components/ui/LoadingState'
import Toast from '../../components/ui/Toast'
import ToggleGroup from '../../components/ui/ToggleGroup'
import { describeSource } from './sourceOptions'

function viewOptions(kind) {
  return [
    { value: 'diff', label: 'Diff' },
    { value: 'full', label: kind === 'intent' ? 'Full intent' : 'Full config' },
  ]
}

const DIFF_MODE_OPTIONS = [
  { value: 'inline', label: 'Inline' },
  { value: 'side-by-side', label: 'Side-by-side' },
]

export default function CompareViewer({ device, sourceA, sourceB, kind = 'config' }) {
  const [diffState, setDiffState] = useState({ loading: false, error: null, data: null })
  const [viewMode, setViewMode] = useState('diff')
  const [diffMode, setDiffMode] = useState('inline')
  const [fullState, setFullState] = useState({ loading: false, key: null, jsonA: null, jsonB: null, errorA: null, errorB: null })
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [saveLabel, setSaveLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveToast, setSaveToast] = useState(null)

  const key = `${kind}|${sourceA.type}:${sourceA.ref}|${sourceB.type}:${sourceB.ref}`

  useEffect(() => {
    let cancelled = false
    setDiffState({ loading: true, error: null, data: null })
    setViewMode('diff')
    setDiffMode('inline')
    setShowSaveInput(false)
    setSaveToast(null)
    setFullState({ loading: false, key: null, jsonA: null, jsonB: null, errorA: null, errorB: null })

    getConfigDiff({
      device: device.name,
      mgmtAddress: device.mgmt_address,
      aType: sourceA.type,
      aRef: sourceA.ref,
      bType: sourceB.type,
      bRef: sourceB.ref,
      kind,
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
      getConfigSource({ device: device.name, mgmtAddress: device.mgmt_address, sourceType: sourceA.type, ref: sourceA.ref, format: 'json', kind }),
      getConfigSource({ device: device.name, mgmtAddress: device.mgmt_address, sourceType: sourceB.type, ref: sourceB.ref, format: 'json', kind }),
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

  async function handleSave() {
    if (!diffState.data || !saveLabel.trim()) return
    setSaving(true)
    try {
      await postSavedDiff({
        device: device.name,
        label: saveLabel.trim(),
        source_a_desc: describeSource(sourceA),
        source_b_desc: describeSource(sourceB),
        kind,
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
    <Card title={kind === 'intent' ? 'Intent comparison' : 'Comparison'}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-theme-sm text-gray-500">
          {describeSource(sourceA)} <span className="text-gray-400">vs</span> {describeSource(sourceB)}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup options={viewOptions(kind)} value={viewMode} onChange={setViewMode} />
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
        <LoadingState label={`Loading full ${kind === 'intent' ? 'intent' : 'configuration'}…`} />
      ) : (
        <>
          {(fullState.errorA || fullState.errorB) && (
            <div className="mb-3">
              <ErrorState message="No structured view available for this snapshot — showing raw text instead." />
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {[
              { source: sourceA, json: fullState.jsonA, text: textA, side: 'a' },
              { source: sourceB, json: fullState.jsonB, text: textB, side: 'b' },
            ].map(({ source, json, text, side }) => (
              <div key={side} className="min-w-0">
                <p className="mb-2 text-theme-xs font-medium text-gray-500">{describeSource(source)}</p>
                {bothJson ? (
                  <StructuredViewer data={json} filename={`${device.name}-${kind}-${describeSource(source)}`} maxHeight={560} />
                ) : (
                  <StructuredViewer text={text} filename={`${device.name}-${kind}-${describeSource(source)}`} maxHeight={560} />
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  )
}
