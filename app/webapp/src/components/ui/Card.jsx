export default function Card({ title, description, action, children, className = '' }) {
  return (
    <div className={`rounded-2xl border border-gray-200 bg-white ${className}`}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-4 px-6 py-5">
          <div>
            {title && <h3 className="text-base font-medium text-gray-800">{title}</h3>}
            {description && <p className="mt-1 text-theme-sm text-gray-500">{description}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={`${title || action ? 'border-t border-gray-100' : ''} p-4 sm:p-6`}>{children}</div>
    </div>
  )
}
