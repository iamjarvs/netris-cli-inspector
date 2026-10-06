export default function Select({
  label,
  className = '',
  options,
  children,
  loading = false,
  disabled = false,
  ...props
}) {
  const isDisabled = disabled || loading

  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-theme-sm font-medium text-gray-700">{label}</span>}
      <div className="relative">
        <select
          disabled={isDisabled}
          className={`h-11 w-full rounded-lg border appearance-none px-4 py-2.5 pr-10 text-theme-sm transition-colors shadow-theme-xs focus:outline-hidden focus:border-brand-300 focus:ring-3 focus:ring-brand-500/20 ${
            isDisabled
              ? 'bg-gray-100 text-gray-500 border-gray-200 cursor-not-allowed select-none'
              : 'bg-white text-gray-800 border-gray-300 cursor-pointer'
          } ${className}`}
          {...props}
        >
          {options
            ? options.map((opt) => (
                <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                  {opt.label}
                </option>
              ))
            : children}
        </select>
        <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3.5 text-gray-400">
          {loading ? (
            <svg className="h-4 w-4 animate-spin text-brand-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          ) : (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      </div>
    </label>
  )
}

