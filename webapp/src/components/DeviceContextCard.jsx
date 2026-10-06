import React, { useState, useEffect } from 'react'
import Badge from './ui/Badge'
import { ChevronDownIcon } from './icons'
import { getDeviceContext } from '../api'

export default function DeviceContextCard({ context: initialContext, deviceName }) {
  const [context, setContext] = useState(initialContext || null)
  const [loading, setLoading] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (initialContext) {
      setContext(initialContext)
      return
    }
    if (!deviceName) return
    let active = true
    async function fetchCtx() {
      setLoading(true)
      try {
        const res = await getDeviceContext(deviceName)
        if (active && res?.context) {
          setContext(res.context)
        }
      } catch (err) {
        console.error('Failed to load device context for', deviceName, err)
      } finally {
        if (active) setLoading(false)
      }
    }
    fetchCtx()
    return () => {
      active = false
    }
  }, [initialContext, deviceName])

  if (loading && !context) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 text-theme-xs text-gray-500 animate-pulse">
        Loading network topology context for <span className="font-mono text-gray-800">{deviceName}</span>…
      </div>
    )
  }

  if (!context) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4 text-theme-xs text-gray-500">
        No device topology context available for <span className="font-mono">{deviceName}</span>.
      </div>
    )
  }

  const {
    default_loopback,
    router_id,
    asn,
    vrfs = [],
    vlan_to_vrf = {},
  } = context

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-2xs overflow-hidden text-theme-xs">
      {/* Header */}
      <div
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-between px-3.5 py-2.5 bg-gray-50/80 border-b border-gray-200 cursor-pointer select-none hover:bg-gray-100/60 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-brand-50 text-brand-600 text-[10px] font-bold">
            ⚙
          </span>
          <span className="font-semibold text-gray-900 tracking-tight">
            Device Network Context
          </span>
          <Badge color="gray" size="sm">
            {vrfs.length} VRFs
          </Badge>
        </div>
        <ChevronDownIcon
          className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${
            collapsed ? '-rotate-90' : ''
          }`}
        />
      </div>

      {!collapsed && (
        <div className="p-3.5 space-y-4">
          {/* Underlay / Default VRF Section */}
          <div>
            <span className="block text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">
              Default VRF (Underlay)
            </span>
            <div className="rounded-lg bg-gray-50 p-2.5 border border-gray-200/80 space-y-1.5 font-mono text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-gray-500 font-sans">Loopback IP (lo):</span>
                <span className="font-semibold text-gray-900 bg-white px-2 py-0.5 rounded border border-gray-200 shadow-3xs">
                  {default_loopback || 'None'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500 font-sans">Router ID:</span>
                <span className="text-gray-800">{router_id || '—'}</span>
              </div>
              {asn && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-500 font-sans">BGP ASN:</span>
                  <span className="text-gray-800">{asn}</span>
                </div>
              )}
            </div>
          </div>

          {/* VRFs & Tenant Loopbacks */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                VRFs & Loopback IPs
              </span>
              <span className="text-[10px] text-gray-400 font-mono">
                {vrfs.length} configured
              </span>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {vrfs.map((vrf) => (
                <div
                  key={vrf.name}
                  className="rounded-lg border border-gray-200/90 bg-white p-2.5 shadow-3xs hover:border-brand-200 transition-colors"
                >
                  <div className="flex items-center justify-between gap-1 mb-1.5">
                    <span className="font-bold text-gray-900 font-mono text-[12px] flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-brand-500" />
                      {vrf.name}
                    </span>
                    {vrf.vni && (
                      <span className="text-[10px] font-mono text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                        VNI: {vrf.vni}
                      </span>
                    )}
                  </div>

                  {/* VRF Loopback */}
                  <div className="flex items-center justify-between text-[11px] text-gray-600 mb-1">
                    <span>VRF Loopback:</span>
                    <span className={`font-mono ${vrf.loopback ? 'font-semibold text-gray-900' : 'text-gray-400 italic'}`}>
                      {vrf.loopback || 'none'}
                    </span>
                  </div>

                  {/* Associated VLANs */}
                  {vrf.vlans && vrf.vlans.length > 0 && (
                    <div className="mt-1.5 pt-1.5 border-t border-gray-100">
                      <div className="text-[10px] text-gray-400 uppercase font-semibold mb-1">
                        Member VLANs:
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {vrf.vlans.map((vl, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 rounded bg-brand-50/60 px-1.5 py-0.5 font-mono text-[10px] text-brand-800 border border-brand-200/50"
                            title={vl.ip ? `IP: ${vl.ip}` : 'No SVI IP'}
                          >
                            <strong>{vl.vlan}</strong>
                            {vl.ip && <span className="text-gray-500">({vl.ip.split('/')[0]})</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Services (e.g. DHCP Relay) */}
                  {vrf.services && vrf.services.length > 0 && (
                    <div className="mt-1.5 pt-1.5 border-t border-gray-100">
                      {vrf.services.map((srv, sIdx) => {
                        const isObj = typeof srv === 'object'
                        const label = isObj ? `${srv.type}: ${srv.server}` : String(srv)
                        const downstream = isObj && srv.downstream ? `(on ${srv.downstream})` : ''
                        return (
                          <div
                            key={sIdx}
                            className="flex items-center gap-1 text-[10px] font-mono text-success-800 bg-success-50/60 px-1.5 py-0.5 rounded border border-success-200/50"
                          >
                            <span>⚡</span>
                            <span>{label} {downstream}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Quick VLAN <-> VRF Mapping Pills */}
          {Object.keys(vlan_to_vrf).length > 0 && (
            <div>
              <span className="block text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">
                VLAN ⇄ VRF Mappings
              </span>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(vlan_to_vrf).map(([vlan, vrf]) => (
                  <span
                    key={vlan}
                    className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 font-mono text-[10px] text-gray-700 border border-gray-200"
                  >
                    <strong className="text-gray-900">{vlan}</strong>
                    <span className="text-gray-400">⇄</span>
                    <span className="text-brand-700 font-medium">{vrf}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
