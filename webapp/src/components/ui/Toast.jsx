const colorClasses = {
  success: 'bg-success-50 text-success-600 border-success-50',
  error: 'bg-error-50 text-error-600 border-error-50',
  info: 'bg-info-50 text-info-600 border-info-50',
}

export default function Toast({ message, color = 'info', onDismiss }) {
  if (!message) return null
  return (
    <div className={`flex items-center justify-between gap-4 rounded-lg border px-4 py-3 text-theme-sm shadow-theme-sm ${colorClasses[color]}`}>
      <span>{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="text-current opacity-60 hover:opacity-100" aria-label="Dismiss">
          ✕
        </button>
      )}
    </div>
  )
}
