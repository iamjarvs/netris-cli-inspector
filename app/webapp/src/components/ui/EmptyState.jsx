export default function EmptyState({ message = 'Nothing to show yet.' }) {
  return (
    <div className="flex items-center justify-center rounded-xl border border-dashed border-gray-200 py-10 text-theme-sm text-gray-500">
      {message}
    </div>
  )
}
