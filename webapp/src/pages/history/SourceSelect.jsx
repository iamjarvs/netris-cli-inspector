import Select from '../../components/ui/Select'
import { encodeSource } from './sourceOptions'

export default function SourceSelect({ label, value, onChange, fixedOptions = [], onboxOptions, archiveOptions }) {
  return (
    <Select label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select a source…</option>
      {fixedOptions.length > 0 && (
        <optgroup label="Fixed">
          {fixedOptions.map((o) => (
            <option key={encodeSource(o.type, o.ref)} value={encodeSource(o.type, o.ref)}>
              {o.label}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label="On-box revisions">
        {onboxOptions.length === 0 && <option disabled>No revisions</option>}
        {onboxOptions.map((o) => (
          <option key={encodeSource(o.type, o.ref)} value={encodeSource(o.type, o.ref)}>
            {o.label}
          </option>
        ))}
      </optgroup>
      <optgroup label="Archive snapshots">
        {archiveOptions.length === 0 && <option disabled>No snapshots</option>}
        {archiveOptions.map((o) => (
          <option key={encodeSource(o.type, o.ref)} value={encodeSource(o.type, o.ref)}>
            {o.label}
          </option>
        ))}
      </optgroup>
    </Select>
  )
}
