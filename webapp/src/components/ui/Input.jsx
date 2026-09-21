export default function Input({ label, hint, className = '', ...props }) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-theme-sm font-medium text-gray-700">{label}</span>}
      <input
        className={`h-11 w-full rounded-lg border appearance-none bg-transparent px-4 py-2.5 text-theme-sm text-gray-800 border-gray-300 shadow-theme-xs placeholder:text-gray-400 focus:outline-hidden focus:border-brand-300 focus:ring-3 focus:ring-brand-500/20 disabled:text-gray-500 disabled:bg-gray-100 disabled:cursor-not-allowed ${className}`}
        {...props}
      />
      {hint && <span className="mt-1.5 block text-theme-xs text-gray-500">{hint}</span>}
    </label>
  )
}
