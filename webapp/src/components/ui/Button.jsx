const variantClasses = {
  primary: 'bg-brand-600 text-white shadow-theme-xs hover:bg-brand-700 disabled:bg-brand-300 disabled:cursor-not-allowed',
  outline: 'bg-white text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed',
}

const sizeClasses = {
  sm: 'px-4 py-2 text-theme-sm',
  md: 'px-5 py-3 text-theme-sm',
}

export default function Button({ variant = 'primary', size = 'md', className = '', children, ...props }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
