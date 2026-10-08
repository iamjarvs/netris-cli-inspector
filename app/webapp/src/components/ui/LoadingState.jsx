export default function LoadingState({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-theme-sm text-gray-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-brand-500" />
      {label}
    </div>
  )
}
