export default function ToggleGroup({ options, value, onChange }) {
  return (
    <div className="inline-flex items-center rounded-lg border border-gray-300 bg-white p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`rounded-md px-3 py-1.5 text-theme-sm font-medium transition ${
            value === opt.value ? 'bg-brand-50 text-brand-700' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
