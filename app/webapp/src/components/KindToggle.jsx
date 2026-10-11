import { KIND_OPTIONS, useViewKind } from '../context/ViewKindContext'
import ToggleGroup from './ui/ToggleGroup'

export default function KindToggle() {
  const { kind, setKind } = useViewKind()
  return (
    <div>
      <span className="mb-1.5 block text-theme-sm font-medium text-gray-700">Show</span>
      <ToggleGroup options={KIND_OPTIONS} value={kind} onChange={setKind} />
    </div>
  )
}
