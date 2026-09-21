export default function PageBreadcrumb({ title }) {
  return (
    <div className="mb-6 flex items-center justify-between">
      <h1 className="text-xl font-semibold text-gray-800">{title}</h1>
      <nav className="text-theme-sm text-gray-500">
        <span>Home</span>
        <span className="mx-1.5">/</span>
        <span className="text-gray-800">{title}</span>
      </nav>
    </div>
  )
}
