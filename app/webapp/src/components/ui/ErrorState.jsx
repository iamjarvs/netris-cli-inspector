export default function ErrorState({ message = 'Something went wrong.' }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-error-50 bg-error-25 px-4 py-3 text-theme-sm text-error-600">
      <svg className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="none">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11a.75.75 0 00-1.5 0v4a.75.75 0 001.5 0V7zm-.75 7a.9.9 0 100-1.8.9.9 0 000 1.8z"
          fill="currentColor"
        />
      </svg>
      <span className="whitespace-pre-line">{message}</span>
    </div>
  )
}
