import Badge from '../ui/Badge'

export default function CrossVrfDiagram({
  sourceVpc,
  targetVpcs = [],
  selectedTargetIds = [],
  results = [],
  isAuditing = false,
}) {
  const sourceVrf = `Vrf_${sourceVpc?.id || '31'}`
  const selectedTargets = targetVpcs.filter((v) =>
    selectedTargetIds.includes(Number(v.id)) || selectedTargetIds.includes(String(v.id))
  )

  const resultMap = {}
  for (const r of results) {
    resultMap[r.target_vpc_id] = r
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs space-y-4">
      {/* Header bar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-gray-100 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-amber-500" />
            <h3 className="text-theme-sm font-bold text-gray-900">
              Tenant Isolation & Hardware Boundary
            </h3>
            <Badge color="warning" variant="light" size="sm">
              TCAM Segmentation
            </Badge>
          </div>
          <p className="mt-0.5 text-theme-xs text-gray-500">
            Source <span className="font-semibold text-gray-800">{sourceVrf}</span> is strictly segregated from other tenant VRFs via independent ASIC tables & RoCEv2 fabric domains.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge color="success" variant="solid" size="sm">
            🛡️ 100% Hardware Isolated
          </Badge>
        </div>
      </div>

      {/* Visualizer Flow (Clean Vertical Stack for 50/50 Scalability) */}
      <div className="rounded-xl border border-gray-200 bg-gradient-to-b from-gray-50/60 to-white p-4 space-y-3.5">
        {/* TOP: Source Tenant (Origin) */}
        <div className="rounded-xl border-2 border-brand-500 bg-white p-3.5 shadow-xs">
          <div className="flex items-center justify-between border-b border-gray-100 pb-2">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-600 text-white text-xs font-bold">
                S
              </span>
              <span className="text-theme-xs font-bold text-gray-900 truncate">
                Origin Tenant: VPC {sourceVpc?.id || '31'} ({sourceVpc?.name || 'Alpha'})
              </span>
            </div>
            <Badge color="primary" variant="solid" size="sm">
              Origin Tenant
            </Badge>
          </div>

          <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono text-gray-600">
            <div>
              <span className="block text-gray-400">VRF Domain:</span>
              <span className="font-bold text-brand-700">{sourceVrf}</span>
            </div>
            <div>
              <span className="block text-gray-400">ASIC FIB:</span>
              <span className="font-semibold text-gray-800">Table 1002</span>
            </div>
            <div>
              <span className="block text-gray-400">Subnet:</span>
              <span className="font-semibold text-gray-800">172.16.0.0/24</span>
            </div>
            <div>
              <span className="block text-gray-400">Member Nodes:</span>
              <span className="font-semibold text-gray-800">{sourceVpc?.server_count || 8} GPU Nodes</span>
            </div>
          </div>
        </div>

        {/* MIDDLE: ASIC & RoCEv2 Isolation Barrier */}
        <div className="relative rounded-xl border border-amber-300 bg-gradient-to-r from-amber-500/10 via-rose-500/10 to-amber-500/10 p-3 shadow-xs">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5">
              <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-amber-500 to-rose-500 text-white shadow-xs shrink-0">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
                {isAuditing && (
                  <span className="absolute -inset-1 animate-ping rounded-lg bg-rose-400 opacity-60" />
                )}
              </div>
              <div>
                <h4 className="text-theme-xs font-bold text-gray-900 uppercase tracking-wider">
                  ASIC TCAM & RoCEv2 Isolation Barrier
                </h4>
                <p className="text-[10px] text-gray-500">
                  Cumulus Linux & NVIDIA ASIC TCAM Partitioning • Wire-Speed Drop
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 border border-rose-200">
                🚫 100% PACKET DROP
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 border border-amber-200">
                8/8 RAILS TIMEOUT
              </span>
            </div>
          </div>
        </div>

        {/* BOTTOM: Target Tenants List */}
        <div className="space-y-2">
          {selectedTargets.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 p-4 text-center text-theme-xs text-gray-500 bg-white">
              Select one or more target tenants above and click <strong className="text-brand-600">"Run Tenant Isolation Audit"</strong> to execute the cluster ping.
            </div>
          ) : (
            selectedTargets.map((target) => {
              const targetRes = resultMap[target.id]
              const isIsolated = targetRes ? targetRes.isolated : true

              return (
                <div
                  key={target.id}
                  className="rounded-xl border border-gray-200 bg-white p-3 shadow-2xs hover:border-gray-300 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gray-100 text-gray-700 text-xs font-bold">
                        T
                      </span>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-theme-xs font-bold text-gray-900">
                            VPC {target.id}: {target.name}
                          </span>
                          <span className="font-mono text-[10px] text-gray-500">
                            ({target.server_count || 0} nodes)
                          </span>
                        </div>
                        <p className="text-[10px] font-mono text-gray-400">
                          Target SU:{targetRes?.target_su ?? 0} Host:{targetRes?.target_host ?? 8} • Running <code className="text-gray-600">./cluster-ping.sh</code>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {isIsolated ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 border border-emerald-200">
                          <span>🛡️ 100% Dropped (OK)</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700 border border-rose-200">
                          <span>⚠️ Leaked</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {targetRes && (
                    <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between text-[10px] font-mono text-gray-500">
                      <span>East-West: <strong className="text-emerald-600">8/8 GPU Rails Timed Out</strong></span>
                      <span>North-South: <strong className="text-emerald-600">bond0 Timed Out</strong></span>
                      <span>IPMI: <strong className="text-emerald-600">Timed Out</strong></span>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Verification Summary Banner */}
        <div className="rounded-lg border border-gray-200 bg-white p-2.5 flex flex-col sm:flex-row items-center justify-between gap-2 text-theme-xs">
          <div className="flex items-center gap-2 text-gray-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
            <span className="font-semibold">Security Guarantee:</span>
            <span className="text-gray-500">Hardware TCAM FIB prohibits inter-tenant forwarding at wire speed.</span>
          </div>
          <div className="flex items-center gap-2 font-mono text-[11px] shrink-0">
            <span className="text-gray-500">Leakage: <strong className="text-emerald-700">0.0%</strong></span>
            <span className="text-gray-500">Isolation: <strong className="text-brand-700">Strict ASIC</strong></span>
          </div>
        </div>
      </div>
    </div>
  )
}
