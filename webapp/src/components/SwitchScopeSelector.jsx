import { useEffect, useMemo, useRef, useState } from 'react'
import RoleBadge from './RoleBadge'
import Badge from './ui/Badge'
import Button from './ui/Button'
import { CheckIcon, ChevronDownIcon, CloseIcon, DevicesIcon } from './icons'

export default function SwitchScopeSelector({
  devices = [],
  selected = [],
  onChange,
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const popoverRef = useRef(null)

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (popoverRef.current && !popoverRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const totalCount = devices.length
  const selectedCount = selected.length
  const isAllSelected = totalCount > 0 && selectedCount === totalCount

  // Filtered devices based on search
  const filteredDevices = useMemo(() => {
    if (!search.trim()) return devices
    const q = search.toLowerCase()
    return devices.filter(
      (d) =>
        d.name?.toLowerCase().includes(q) ||
        d.mgmt_address?.toLowerCase().includes(q) ||
        d.role?.toLowerCase().includes(q)
    )
  }, [devices, search])

  // Count by role
  const leaves = useMemo(
    () => devices.filter((d) => (d.role || '').toLowerCase().includes('leaf')),
    [devices]
  )
  const spines = useMemo(
    () => devices.filter((d) => (d.role || '').toLowerCase().includes('spine')),
    [devices]
  )

  function handleToggleDevice(name) {
    if (selected.includes(name)) {
      onChange(selected.filter((n) => n !== name))
    } else {
      onChange([...selected, name])
    }
  }

  function handleSelectAll() {
    onChange(devices.map((d) => d.name))
  }

  function handleDeselectAll() {
    onChange([])
  }

  function handleSelectLeaves() {
    onChange(leaves.map((d) => d.name))
  }

  function handleSelectSpines() {
    onChange(spines.map((d) => d.name))
  }

  function handleSelectOnly(name) {
    onChange([name])
  }

  return (
    <div className="relative inline-block w-full" ref={popoverRef}>
      <label className="block text-theme-xs font-medium text-gray-700 mb-1.5">
        Switch Scope
      </label>

      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-11 w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2 text-theme-sm text-gray-800 shadow-theme-xs hover:border-gray-400 focus:border-brand-400 focus:outline-hidden focus:ring-3 focus:ring-brand-500/20"
      >
        <div className="flex items-center gap-2 min-w-0 truncate">
          <DevicesIcon className="h-4 w-4 shrink-0 text-brand-600" />
          <span className="truncate font-medium">
            {isAllSelected
              ? `All Switches (${totalCount})`
              : selectedCount === 0
              ? 'None Selected'
              : `${selectedCount} of ${totalCount} Switches`}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-1">
          <Badge
            color={
              isAllSelected ? 'primary' : selectedCount > 0 ? 'success' : 'error'
            }
            size="sm"
          >
            {selectedCount}/{totalCount}
          </Badge>
          <ChevronDownIcon
            className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${
              isOpen ? 'rotate-180 text-brand-600' : ''
            }`}
          />
        </div>
      </button>

      {/* Popover Menu */}
      {isOpen && (
        <div className="absolute left-0 z-50 mt-2 w-80 sm:w-96 rounded-xl border border-gray-200 bg-white shadow-xl ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-100">
          {/* Header */}
          <div className="border-b border-gray-100 p-3.5">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-theme-sm font-semibold text-gray-900">
                  Switch Scope Selector
                </h4>
                <p className="text-[11px] text-gray-500">
                  Reduce target devices to speed up live revision checks
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            {/* Search Input */}
            <div className="mt-2.5">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by name, IP, or role…"
                className="w-full rounded-md border border-gray-200 bg-gray-50/50 px-2.5 py-1.5 text-theme-xs text-gray-800 placeholder:text-gray-400 focus:border-brand-400 focus:bg-white focus:outline-hidden"
              />
            </div>

            {/* Quick Action Preset Pills */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={handleSelectAll}
                className="rounded bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-200"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={handleDeselectAll}
                className="rounded bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-200"
              >
                Deselect All
              </button>
              {leaves.length > 0 && (
                <button
                  type="button"
                  onClick={handleSelectLeaves}
                  className="rounded bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 hover:bg-brand-100 border border-brand-200/50"
                >
                  Leaves ({leaves.length})
                </button>
              )}
              {spines.length > 0 && (
                <button
                  type="button"
                  onClick={handleSelectSpines}
                  className="rounded bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 hover:bg-brand-100 border border-brand-200/50"
                >
                  Spines ({spines.length})
                </button>
              )}
            </div>
          </div>

          {/* Switch Checklist */}
          <div className="max-h-64 overflow-y-auto divide-y divide-gray-100 p-1">
            {filteredDevices.length === 0 ? (
              <div className="p-4 text-center text-theme-xs text-gray-400">
                No matching switches found
              </div>
            ) : (
              filteredDevices.map((d) => {
                const isChecked = selected.includes(d.name)
                return (
                  <div
                    key={d.name}
                    className={`group flex items-center justify-between px-3 py-2 rounded-lg transition-colors hover:bg-gray-50 cursor-pointer ${
                      isChecked ? 'bg-brand-50/30' : ''
                    }`}
                    onClick={() => handleToggleDevice(d.name)}
                  >
                    <label className="flex items-center gap-2.5 min-w-0 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}} // handled by div click
                        className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                      />
                      <div className="min-w-0">
                        <span className="font-mono text-theme-xs font-semibold text-gray-900 block truncate">
                          {d.name}
                        </span>
                        <span className="font-mono text-[10px] text-gray-500 block truncate">
                          {d.mgmt_address || 'No IP'}
                        </span>
                      </div>
                    </label>

                    <div className="flex items-center gap-2">
                      {d.role && <RoleBadge role={d.role} />}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleSelectOnly(d.name)
                        }}
                        className="opacity-0 group-hover:opacity-100 text-[10px] font-medium text-brand-600 hover:text-brand-800 bg-white border border-brand-200 px-1.5 py-0.5 rounded shadow-2xs transition-opacity"
                        title={`Monitor only ${d.name}`}
                      >
                        Only
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50/70 px-3.5 py-2.5 rounded-b-xl">
            <span className="text-[11px] text-gray-600 font-medium">
              <strong className="text-gray-900">{selectedCount}</strong> of{' '}
              {totalCount} selected
            </span>
            <Button
              variant="primary"
              size="xs"
              onClick={() => setIsOpen(false)}
            >
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
