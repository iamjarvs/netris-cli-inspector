const lightVariants = {
  primary: 'bg-brand-50 text-brand-700',
  success: 'bg-success-50 text-success-600',
  error: 'bg-error-50 text-error-600',
  warning: 'bg-warning-50 text-warning-600',
  info: 'bg-info-50 text-info-600',
  gray: 'bg-gray-100 text-gray-600',
}

const solidVariants = {
  primary: 'bg-brand-600 text-white',
  success: 'bg-success-500 text-white',
  error: 'bg-error-500 text-white',
  warning: 'bg-warning-500 text-white',
  info: 'bg-info-500 text-white',
  gray: 'bg-gray-500 text-white',
}

export default function Badge({ color = 'gray', variant = 'light', size = 'sm', children }) {
  const classes = variant === 'solid' ? solidVariants[color] : lightVariants[color]
  const sizeClasses = size === 'sm' ? 'px-2.5 py-0.5 text-theme-xs' : 'px-3 py-1 text-theme-sm'
  return (
    <span className={`inline-flex items-center justify-center gap-1 rounded-full font-medium ${sizeClasses} ${classes}`}>
      {children}
    </span>
  )
}
