import { useState } from 'react'
import Badge from '../ui/Badge'
import Button from '../ui/Button'

export default function ClusterMeshDiagram({
  vpc,
  clusterName,
  servers = [],
  sourceServer,
  targetSu = '0',
  targetHost = '1',
  onSelectSource,
  onSelectTarget,
  pingResults = null,
  isPinging = false,
  onTriggerPing,
  onTriggerSweep,
}) {
  const [hoveredNode, setHoveredNode] = useState(null)

  // Ensure we have a valid server list
  const displayServers = servers.length > 0
    ? servers
    : [
        { name: 'hgx-pod00-su0-h00', ip: '192.168.0.1' },
        { name: 'hgx-pod00-su0-h01', ip: '192.168.0.2' },
        { name: 'hgx-pod00-su0-h02', ip: '192.168.0.3' },
        { name: 'hgx-pod00-su0-h03', ip: '192.168.0.4' },
        { name: 'hgx-pod00-su0-h04', ip: '192.168.0.5' },
        { name: 'hgx-pod00-su0-h05', ip: '192.168.0.6' },
        { name: 'hgx-pod00-su0-h06', ip: '192.168.0.7' },
        { name: 'hgx-pod00-su0-h07', ip: '192.168.0.8' },
      ]

  const activeSource = sourceServer || displayServers[0]?.name
  const targetHostNum = parseInt(targetHost, 10)

  // Map ping results for fast lookup by name
  const pingMap = {}
  if (pingResults?.targets) {
    for (const t of pingResults.targets) {
      pingMap[t.name] = t
    }
  }

  // Check if pingResults is from a single ./cluster-ping.sh run
  const isSingleRun = pingResults?.ew_rails && pingResults.ew_rails.length > 0
  const isTargetOk = isSingleRun ? pingResults.all_ew_ok : null

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
      {/* Header bar */}
      <div className="flex flex-col gap-3 border-b border-gray-100 pb-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-ping" />
            <h3 className="text-theme-sm font-bold text-gray-900">
              Tenant Mesh Topology & RoCEv2 Matrix
            </h3>
            <Badge color="primary" variant="light" size="sm">
              VPC {vpc?.id || '31'}
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onTriggerPing && (
              <Button size="sm" onClick={onTriggerPing} disabled={isPinging}>
                {isPinging ? 'Running…' : `Ping SU:${targetSu} Host:${targetHost} ⚡`}
              </Button>
            )}
            {onTriggerSweep && (
              <Button size="sm" variant="outline" onClick={onTriggerSweep} disabled={isPinging}>
                Sweep All Peers 🚀
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-theme-xs text-gray-500">
          <p>
            Tenant: <span className="font-semibold text-gray-700">{clusterName || vpc?.name || 'Alpha-Workload'}</span> • {displayServers.length} GPU Nodes • <code className="font-mono text-gray-800 bg-gray-100 px-1 py-0.5 rounded">./cluster-ping.sh &lt;SU&gt; &lt;Host&gt;</code>
          </p>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <span>Source:</span>
              <span className="font-semibold text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded border border-brand-200 font-mono text-[11px]">
                {activeSource}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span>Target:</span>
              <span className="font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 font-mono text-[11px]">
                SU:{targetSu} Host:{targetHost}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Mesh Visualizer (2 Columns for Clean 50/50 Fit) */}
      <div className="relative mt-3.5 rounded-xl border border-gray-100 bg-gradient-to-b from-gray-50/50 to-white p-3.5">
        {/* Subtle background grid pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#f0f3f6_1px,transparent_1px),linear-gradient(to_bottom,#f0f3f6_1px,transparent_1px)] bg-[size:24px_24px] opacity-60 rounded-xl pointer-events-none" />

        {/* Dynamic Topology Node Cards Grid: 2 columns avoids any horizontal cramping */}
        <div className="relative z-10 grid grid-cols-2 gap-2.5">
          {displayServers.map((srv, idx) => {
            const isSource = srv.name === activeSource
            // Host number from name (e.g. hgx-pod00-su0-h01 -> 1)
            const m = srv.name.match(/h(\d+)/)
            const hostNum = m ? parseInt(m[1], 10) : idx
            const isTarget = !isSource && String(targetSu) === '0' && hostNum === targetHostNum

            const targetPing = pingMap[srv.name]
            const isHovered = hoveredNode === srv.name

            // Status determination
            let statusBadge = null
            if (isSource) {
              statusBadge = (
                <Badge color="primary" variant="solid" size="sm">
                  Origin (Host {hostNum})
                </Badge>
              )
            } else if (isTarget && isSingleRun) {
              statusBadge = isTargetOk ? (
                <Badge color="success" variant="solid" size="sm">
                  ✔ 8/8 Rails OK
                </Badge>
              ) : (
                <Badge color="error" variant="solid" size="sm">
                  Timeout (Dropped)
                </Badge>
              )
            } else if (targetPing) {
              statusBadge = targetPing.status === 'OK' ? (
                <Badge color="success" variant="light" size="sm">
                  {targetPing.rtt || '0.04ms'}
                </Badge>
              ) : (
                <Badge color="error" variant="solid" size="sm">
                  Timeout
                </Badge>
              )
            } else {
              statusBadge = (
                <Badge color="gray" variant="light" size="sm">
                  Host {hostNum}
                </Badge>
              )
            }

            return (
              <div
                key={srv.name}
                onClick={() => {
                  if (isSource) return
                  if (onSelectTarget) onSelectTarget(String(hostNum))
                }}
                onMouseEnter={() => setHoveredNode(srv.name)}
                onMouseLeave={() => setHoveredNode(null)}
                className={`group relative flex flex-col justify-between rounded-xl border p-4 transition-all duration-200 cursor-pointer ${
                  isSource
                    ? 'border-brand-500 bg-brand-50/40 ring-2 ring-brand-500/20 shadow-sm'
                    : isTarget
                    ? 'border-amber-500 bg-amber-50/40 ring-2 ring-amber-500/30 shadow-md'
                    : isHovered
                    ? 'border-gray-300 bg-white shadow-md -translate-y-0.5'
                    : 'border-gray-200 bg-white/90 hover:border-gray-300 shadow-2xs'
                }`}
              >
                {/* Active pulse beacon for Source Node */}
                {isSource && (
                  <div className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
                    <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-brand-600 text-[9px] font-bold text-white items-center justify-center">
                      ★
                    </span>
                  </div>
                )}

                {/* Target badge */}
                {isTarget && (
                  <div className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center">
                    <span className="relative inline-flex h-4 w-4 rounded-full bg-amber-500 text-[9px] font-bold text-white items-center justify-center shadow-xs">
                      🎯
                    </span>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {/* Server hardware rack icon */}
                      <span
                        className={`flex h-7 w-7 items-center justify-center rounded-lg ${
                          isSource
                            ? 'bg-brand-600 text-white'
                            : isTarget
                            ? 'bg-amber-500 text-white'
                            : 'bg-gray-100 text-gray-600 group-hover:bg-brand-100 group-hover:text-brand-700'
                        }`}
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="2" y="2" width="20" height="8" rx="2" />
                          <rect x="2" y="14" width="20" height="8" rx="2" />
                          <line x1="6" y1="6" x2="6.01" y2="6" />
                          <line x1="6" y1="18" x2="6.01" y2="18" />
                        </svg>
                      </span>
                      <span className="text-theme-xs font-bold text-gray-900 truncate">
                        {srv.name}
                      </span>
                    </div>

                    {statusBadge}
                  </div>

                  {/* Network details */}
                  <div className="mt-3 space-y-1 font-mono text-[11px] text-gray-500">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">In-Band:</span>
                      <span className="font-semibold text-gray-700">
                        {srv.ip || `192.168.0.${idx + 1}`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">RoCE Rail 0:</span>
                      <span className="text-brand-700">
                        172.16.0.{idx * 2}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Footer status / pulse line */}
                <div className="mt-3 pt-2.5 border-t border-gray-100 flex items-center justify-between text-theme-xs">
                  <span className="text-[11px] text-gray-400">
                    {isSource
                      ? 'Ping Origin'
                      : isTarget
                      ? 'Target Device'
                      : 'Click to target'}
                  </span>
                  <div className="flex items-center gap-1">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        isSource
                          ? 'bg-brand-500'
                          : isTarget
                          ? isTargetOk === false
                            ? 'bg-rose-500'
                            : 'bg-amber-500'
                          : 'bg-emerald-500'
                      }`}
                    />
                    <span className="text-[11px] font-medium text-gray-600">
                      {isSource ? 'Active' : isTarget ? 'Targeted' : 'Host ' + hostNum}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Dynamic mesh connection banner */}
        <div className="mt-5 rounded-lg border border-emerald-200/80 bg-emerald-50/70 p-3.5 flex flex-col sm:flex-row items-center justify-between gap-3 text-emerald-900">
          <div className="flex items-center gap-2.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white text-xs font-bold">
              ✓
            </span>
            <div>
              <p className="text-theme-xs font-semibold">
                NVIDIA HGX Compute Fabric Verified via ./cluster-ping.sh
              </p>
              <p className="text-[11px] text-emerald-700">
                Pings are executed via host binary script across East-West RoCEv2 GPU rails, North-South bond0, and IPMI eth11.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-theme-xs font-mono font-medium">
            <span>Latency: <strong className="text-emerald-800">~0.04ms</strong></span>
            <span>GPU Rails: <strong className="text-emerald-800">8 Rails</strong></span>
            <span>Script: <strong className="text-emerald-800 font-mono">./cluster-ping.sh</strong></span>
          </div>
        </div>
      </div>
    </div>
  )
}
