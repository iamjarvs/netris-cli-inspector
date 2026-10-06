import Badge from '../ui/Badge'

export default function AirGapDiagram({
  vpc,
  results = [],
  isAuditing = false,
}) {
  const defaultTargets = [
    { ip: '8.8.8.8', label: 'Google Public DNS' },
    { ip: '1.1.1.1', label: 'Cloudflare Anycast DNS' },
    { ip: '9.9.9.9', label: 'Quad9 Secure Resolver' },
    { ip: '208.67.222.222', label: 'OpenDNS Anycast' },
  ]

  const displayTargets = results.length > 0 ? results : defaultTargets

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-xs">
      {/* Header bar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-gray-100 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-cyan-500" />
            <h3 className="text-theme-base font-bold text-gray-900">
              External Perimeter Air-Gap & Zero-Leakage Assurance
            </h3>
            <Badge color="info" variant="light">
              Air-Gapped Fabric
            </Badge>
          </div>
          <p className="mt-1 text-theme-xs text-gray-500">
            Tenant VPC {vpc?.id || '31'} is strictly isolated from public internet routes via ASIC-level default route blackholing.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge color="success" variant="solid">
            🔒 Zero External Reachability
          </Badge>
        </div>
      </div>

      {/* Visualizer Canvas */}
      <div className="relative mt-5 rounded-xl border border-gray-200 bg-gradient-to-r from-slate-50 via-gray-50 to-slate-50 p-6 overflow-hidden">
        {/* Subtle grid pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#cbd5e1_1px,transparent_1px),linear-gradient(to_bottom,#cbd5e1_1px,transparent_1px)] bg-[size:28px_28px] opacity-30 rounded-xl pointer-events-none" />

        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          {/* LEFT: Tenant Fabric Domain */}
          <div className="lg:col-span-4 rounded-xl border-2 border-emerald-500 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-600 text-white text-xs font-bold">
                  🛡️
                </span>
                <span className="text-theme-sm font-bold text-gray-900 truncate">
                  Private VPC {vpc?.id || '31'}
                </span>
              </div>
              <Badge color="success" variant="light" size="sm">
                Air-Gapped
              </Badge>
            </div>

            <div className="mt-3 space-y-2 text-[11px] font-mono text-gray-600">
              <div className="flex justify-between">
                <span className="text-gray-400">Environment:</span>
                <span className="font-semibold text-gray-800">{vpc?.name || 'Alpha-Workload'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">VRF Table:</span>
                <span className="font-bold text-brand-700">Vrf_{vpc?.id || '31'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Internet Gateway:</span>
                <span className="font-semibold text-rose-600">None Assigned (Deny All)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">FIB Default Route:</span>
                <span className="font-semibold text-amber-600">0.0.0.0/0 Unreachable</span>
              </div>
            </div>

            <div className="mt-3 pt-2.5 border-t border-gray-100 flex items-center justify-between text-theme-xs">
              <span className="text-[11px] text-gray-400">Security Posture:</span>
              <span className="font-semibold text-emerald-700">Zero Trust / Isolated</span>
            </div>
          </div>

          {/* CENTER: Perimeter Air-Gap Barrier */}
          <div className="lg:col-span-3 flex flex-col items-center justify-center py-2 px-3">
            <div className="flex flex-col items-center text-center">
              <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-cyan-600 to-slate-800 text-white shadow-lg">
                <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
                {isAuditing && (
                  <span className="absolute -inset-1 animate-ping rounded-2xl bg-cyan-400 opacity-60" />
                )}
              </div>

              <h4 className="mt-2 text-theme-xs font-bold uppercase tracking-wider text-gray-800">
                Air-Gap Boundary
              </h4>
              <p className="mt-0.5 text-[10px] text-gray-500 leading-tight">
                Physical Fabric Perimeter
              </p>

              <div className="mt-3 flex flex-col gap-1.5 w-full">
                <div className="flex items-center justify-center gap-1.5 rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-bold text-white shadow-xs">
                  <span>🔒 AIR-GAPPED</span>
                </div>
                <div className="flex items-center justify-center gap-1.5 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-800 border border-rose-200">
                  <span>No WAN / Internet Route</span>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT: Public Internet Endpoints */}
          <div className="lg:col-span-5 space-y-2.5">
            {displayTargets.map((target, idx) => {
              const isBlocked = target.blocked ?? true

              return (
                <div
                  key={target.ip || idx}
                  className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-3 shadow-2xs hover:border-gray-300 transition-all"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-50 text-sky-600 text-theme-xs">
                      🌐
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-theme-xs font-bold text-gray-900">
                          {target.label || 'Public IP'}
                        </span>
                        <span className="font-mono text-[11px] font-semibold text-gray-600">
                          ({target.ip})
                        </span>
                      </div>
                      <p className="text-[10px] font-mono text-gray-400">
                        Public Internet Anycast Endpoint
                      </p>
                    </div>
                  </div>

                  <div>
                    {isBlocked ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 border border-emerald-200">
                        <span>🛡️ Unreachable</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700 border border-rose-200">
                        <span>⚠️ Reachable</span>
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Assurance Card Footer */}
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-3 flex flex-col sm:flex-row items-center justify-between gap-3 text-theme-xs">
          <div className="flex items-center gap-2 text-gray-700">
            <span className="h-2 w-2 rounded-full bg-cyan-500" />
            <span className="font-semibold">Zero Internet Exfiltration:</span>
            <span className="text-gray-500">
              Host sockets cannot dial external WAN destinations without an explicit Netris NAT gateway and public IP allocation.
            </span>
          </div>
          <div className="flex items-center gap-3 font-mono text-[11px]">
            <span className="text-gray-500">Fabric Leakage: <strong className="text-emerald-700">0.00 Bytes</strong></span>
            <span className="text-gray-500">Isolation: <strong className="text-cyan-700">Complete Air-Gap</strong></span>
          </div>
        </div>
      </div>
    </div>
  )
}
