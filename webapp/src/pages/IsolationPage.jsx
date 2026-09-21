import { useEffect, useState } from 'react'
import {
  getIsolationEvidence,
  getIsolationVpc,
  getIsolationVpcs,
  postIsolationPing,
} from '../api'
import PageBreadcrumb from '../components/layout/PageBreadcrumb'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import ErrorState from '../components/ui/ErrorState'
import Input from '../components/ui/Input'
import LoadingState from '../components/ui/LoadingState'
import Select from '../components/ui/Select'
import ToggleGroup from '../components/ui/ToggleGroup'

export default function IsolationPage() {
  const [vpcs, setVpcs] = useState([])
  const [vpcsLoading, setVpcsLoading] = useState(true)
  const [vpcsError, setVpcsError] = useState(null)
  const [selectedVpcId, setSelectedVpcId] = useState('')

  const [activeTab, setActiveTab] = useState('topology')

  // Stage 1: Topology
  const [topology, setTopology] = useState(null)
  const [topologyLoading, setTopologyLoading] = useState(false)
  const [topologyError, setTopologyError] = useState(null)

  // Stage 2: Hardware Evidence
  const [evidence, setEvidence] = useState(null)
  const [evidenceLoading, setEvidenceLoading] = useState(false)
  const [evidenceError, setEvidenceError] = useState(null)

  // Stage 3: Ping
  const [sourceServer, setSourceServer] = useState('')
  const [targetSu, setTargetSu] = useState('0')
  const [targetHost, setTargetHost] = useState('1')
  const [pingMode, setPingMode] = useState('intra')
  const [pingState, setPingState] = useState({ loading: false, error: null, result: null })

  // Initial load: VPCs
  useEffect(() => {
    let active = true
    async function loadVpcs() {
      setVpcsLoading(true)
      setVpcsError(null)
      try {
        const res = await getIsolationVpcs()
        if (!active) return
        const list = res.vpcs ?? []
        setVpcs(list)
        if (list.length > 0) {
          // Prefer VPC with member servers e.g. 31
          const withServers = list.find((v) => v.server_count > 0) || list[0]
          setSelectedVpcId(String(withServers.id))
        }
      } catch (err) {
        if (!active) return
        setVpcsError(err.message)
      } finally {
        if (active) setVpcsLoading(false)
      }
    }
    loadVpcs()
    return () => {
      active = false
    }
  }, [])

  // When selectedVpcId changes, fetch topology
  useEffect(() => {
    if (!selectedVpcId) return
    let active = true
    async function loadTopology() {
      setTopologyLoading(true)
      setTopologyError(null)
      try {
        const res = await getIsolationVpc(selectedVpcId)
        if (!active) return
        setTopology(res)
        if (res.servers?.length > 0) {
          setSourceServer(res.servers[0].name)
        }
      } catch (err) {
        if (!active) return
        setTopologyError(err.message)
      } finally {
        if (active) setTopologyLoading(false)
      }
    }
    loadTopology()
    return () => {
      active = false
    }
  }, [selectedVpcId])

  // When switching to evidence tab or changing VPC, load hardware evidence
  useEffect(() => {
    if (activeTab !== 'evidence' || !selectedVpcId) return
    let active = true
    async function loadEvidence() {
      setEvidenceLoading(true)
      setEvidenceError(null)
      try {
        const res = await getIsolationEvidence(selectedVpcId)
        if (!active) return
        setEvidence(res)
      } catch (err) {
        if (!active) return
        setEvidenceError(err.message)
      } finally {
        if (active) setEvidenceLoading(false)
      }
    }
    loadEvidence()
    return () => {
      active = false
    }
  }, [activeTab, selectedVpcId])

  const selectedVpc = vpcs.find((v) => String(v.id) === String(selectedVpcId))

  function handlePingPreset(mode) {
    setPingMode(mode)
    if (mode === 'intra') {
      setTargetSu('0')
      setTargetHost('1')
    } else if (mode === 'cross') {
      // Point outside the VPC e.g. SU 1 Host 0
      setTargetSu('1')
      setTargetHost('0')
    }
  }

  async function handleRunPing() {
    if (!sourceServer) return
    setPingState({ loading: true, error: null, result: null })
    try {
      const res = await postIsolationPing(sourceServer, Number(targetSu), Number(targetHost))
      setPingState({ loading: false, error: null, result: res })
    } catch (err) {
      setPingState({ loading: false, error: err.message, result: null })
    }
  }

  return (
    <div>
      <PageBreadcrumb title="Switch Isolation & Assurance" />

      {/* VPC Selector Card */}
      <Card
        title="Target VPC Environment"
        description="Select a multi-tenant VPC to audit physical leaf switch ASIC tables, EVPN VNI boundaries, and fabric isolation."
      >
        {vpcsLoading && <LoadingState label="Loading Netris VPC environments…" />}
        {vpcsError && <ErrorState message={vpcsError} />}
        {!vpcsLoading && !vpcsError && (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
              <Select
                label="Active Netris VPC"
                value={selectedVpcId}
                onChange={(e) => setSelectedVpcId(e.target.value)}
                options={vpcs.map((v) => ({
                  value: String(v.id),
                  label: `VPC-${v.id} (${v.name}) — ${v.server_count} nodes`,
                }))}
              />
            </div>
            <div>
              <span className="block text-theme-xs font-medium text-gray-500">Tenant Identity</span>
              <span className="mt-1 block text-theme-sm font-semibold text-gray-800">
                {selectedVpc?.tenant || 'default'}
              </span>
            </div>
            <div>
              <span className="block text-theme-xs font-medium text-gray-500">Compute Cluster</span>
              <span className="mt-1 block text-theme-sm font-semibold text-brand-600">
                {selectedVpc?.clusters?.map((c) => c.name).join(', ') || 'None assigned'}
              </span>
            </div>
          </div>
        )}

        {/* Stepper Navigation */}
        <div className="mt-6 border-t border-gray-100 pt-5">
          <ToggleGroup
            value={activeTab}
            onChange={setActiveTab}
            options={[
              { label: '1. VPC Topology & Port Mapping', value: 'topology' },
              { label: '2. Live Switch Hardware Evidence', value: 'evidence' },
              { label: '3. Ping & Traffic Verification', value: 'ping' },
            ]}
          />
        </div>
      </Card>

      <div className="h-6" />

      {/* TAB 1: VPC Topology & Switch Port Mapping */}
      {activeTab === 'topology' && (
        <div>
          {topologyLoading && <LoadingState label="Resolving physical switch links for compute servers…" />}
          {topologyError && <ErrorState message={topologyError} />}
          {!topologyLoading && !topologyError && topology && (
            <Card
              title={`Physical Port Attachment — VPC ${selectedVpcId}`}
              description="Maps tenant compute servers across both East-West (GPU RoCEv2) and North-South fabric planes."
            >
              {topology.servers?.length === 0 ? (
                <EmptyState message="No member servers allocated to this VPC." />
              ) : (
                <div className="overflow-hidden rounded-xl border border-gray-200">
                  <div className="max-w-full overflow-x-auto">
                    <table className="min-w-full">
                      <thead className="border-b border-gray-100 bg-gray-50">
                        <tr>
                          <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Host Server</th>
                          <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Host Port</th>
                          <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Switch Name</th>
                          <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Switch Port</th>
                          <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Fabric Plane</th>
                          <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">IPv4</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {Object.entries(topology.server_links || {}).flatMap(([server, links]) => {
                          if (!links || links.length === 0) {
                            return [
                              <tr key={server}>
                                <td className="px-5 py-3.5 text-theme-sm font-medium text-gray-900">{server}</td>
                                <td colSpan={5} className="px-5 py-3.5 text-theme-sm text-gray-400">
                                  No active physical switch links detected
                                </td>
                              </tr>,
                            ]
                          }
                          return links.map((link, idx) => (
                            <tr key={`${server}-${idx}`}>
                              <td className="px-5 py-3.5 text-theme-sm font-medium text-gray-900">{server}</td>
                              <td className="px-5 py-3.5 text-theme-sm text-gray-700">{link.host_port}</td>
                              <td className="px-5 py-3.5 text-theme-sm font-medium text-brand-700">{link.switch_name}</td>
                              <td className="px-5 py-3.5 text-theme-sm text-gray-700">{link.switch_port}</td>
                              <td className="px-5 py-3.5 text-theme-sm">
                                <Badge
                                  color={link.fabric_role.includes('East-West') ? 'primary' : 'info'}
                                  variant="light"
                                >
                                  {link.fabric_role}
                                </Badge>
                              </td>
                              <td className="px-5 py-3.5 text-theme-sm text-gray-600 font-mono text-xs">{link.ipv4 || '—'}</td>
                            </tr>
                          ))
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      {/* TAB 2: Live Switch Hardware Evidence */}
      {activeTab === 'evidence' && (
        <div>
          {evidenceLoading && <LoadingState label="Executing live vtysh audit on North-South and East-West switches…" />}
          {evidenceError && <ErrorState message={evidenceError} />}
          {!evidenceLoading && !evidenceError && evidence && (
            <div className="space-y-6">
              {/* North-South EVPN VNIs Card */}
              <Card
                title={`North-South Leaf (${evidence.ns_switch?.name}) — EVPN VNI Table`}
                description="Audits vtysh 'show evpn vni'. Highlights tenant-isolated VNIs dedicated exclusively to this VPC."
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      setEvidenceLoading(true)
                      try {
                        const res = await getIsolationEvidence(selectedVpcId)
                        setEvidence(res)
                      } finally {
                        setEvidenceLoading(false)
                      }
                    }}
                  >
                    Refresh Audit
                  </Button>
                }
              >
                <div className="overflow-hidden rounded-xl border border-gray-200">
                  <div className="max-w-full overflow-x-auto">
                    <table className="min-w-full">
                      <thead className="border-b border-gray-100 bg-gray-50">
                        <tr>
                          <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">VNI</th>
                          <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Type</th>
                          <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Interface</th>
                          <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Tenant VRF</th>
                          <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">VLAN</th>
                          <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Hardware Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {(evidence.ns_switch?.vnis || []).map((vni) => (
                          <tr
                            key={vni.vni}
                            className={vni.is_target_vpc ? 'bg-success-50/40' : undefined}
                          >
                            <td className="px-5 py-3.5 text-theme-sm font-semibold font-mono text-gray-900">{vni.vni}</td>
                            <td className="px-5 py-3.5 text-theme-sm text-gray-700">{vni.type}</td>
                            <td className="px-5 py-3.5 text-theme-sm font-mono text-xs text-gray-600">{vni.interface}</td>
                            <td className="px-5 py-3.5 text-theme-sm font-medium">
                              <span className={vni.is_target_vpc ? 'font-bold text-success-700' : 'text-gray-600'}>
                                {vni.tenant_vrf}
                              </span>
                            </td>
                            <td className="px-5 py-3.5 text-theme-sm text-gray-700">{vni.vlan || '—'}</td>
                            <td className="px-5 py-3.5 text-theme-sm">
                              {vni.is_target_vpc ? (
                                <Badge color="success" variant="solid">
                                  ✔ Dedicated Tenant VNI
                                </Badge>
                              ) : (
                                <Badge color="gray" variant="light">
                                  Other Tenant
                                </Badge>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </Card>

              {/* East-West Pure VRF Routing Table Card */}
              <Card
                title={`East-West Leaf (${evidence.ew_switch?.name}) — Pure VRF Routing Table (${evidence.target_vrf})`}
                description="Audits vtysh 'show ip route vrf'. Confirms isolated FIB table entries restricted strictly to this tenant domain."
              >
                <div className="overflow-hidden rounded-xl border border-gray-200">
                  <div className="max-w-full overflow-x-auto">
                    <table className="min-w-full">
                      <thead className="border-b border-gray-100 bg-gray-50">
                        <tr>
                          <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Protocol</th>
                          <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Subnet Prefix</th>
                          <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Next Hop / Gateway</th>
                          <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">VRF Table</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {(evidence.ew_switch?.routes || []).slice(0, 25).map((route, idx) => (
                          <tr key={`${route.prefix}-${idx}`}>
                            <td className="px-5 py-3.5 text-theme-sm font-semibold text-gray-700">{route.code}</td>
                            <td className="px-5 py-3.5 text-theme-sm font-mono font-medium text-brand-700">{route.prefix}</td>
                            <td className="px-5 py-3.5 text-theme-sm font-mono text-xs text-gray-600">{route.via || 'directly connected'}</td>
                            <td className="px-5 py-3.5 text-theme-sm">
                              <Badge color="primary" variant="light">
                                {route.vrf}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                {(evidence.ew_switch?.routes || []).length > 25 && (
                  <p className="mt-3 text-theme-xs text-gray-400">
                    Showing top 25 of {evidence.ew_switch.routes.length} routes in FIB.
                  </p>
                )}
              </Card>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: Ping & Traffic Verification */}
      {activeTab === 'ping' && (
        <div className="space-y-6">
          <Card
            title="Cluster Ping & Multi-Tenant Traffic Verification"
            description="Executes line-rate RoCEv2 tests across GPU rails from inside tenant compute servers via the jump host."
          >
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              <div>
                <Select
                  label="Source Server (Ping Origin)"
                  value={sourceServer}
                  onChange={(e) => setSourceServer(e.target.value)}
                  options={(topology?.servers || []).map((s) => ({
                    value: s.name,
                    label: s.name,
                  }))}
                />
              </div>
              <div className="sm:col-span-2">
                <span className="mb-1.5 block text-theme-sm font-medium text-gray-700">Test Preset</span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={pingMode === 'intra' ? 'primary' : 'outline'}
                    size="sm"
                    onClick={() => handlePingPreset('intra')}
                  >
                    Intra-VPC Health (Expect OK)
                  </Button>
                  <Button
                    variant={pingMode === 'cross' ? 'primary' : 'outline'}
                    size="sm"
                    onClick={() => handlePingPreset('cross')}
                  >
                    Cross-VPC Isolation (Expect DROP)
                  </Button>
                  <Button
                    variant={pingMode === 'custom' ? 'primary' : 'outline'}
                    size="sm"
                    onClick={() => handlePingPreset('custom')}
                  >
                    Custom SU/Host Target
                  </Button>
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-4 sm:items-end">
              <div>
                <Input
                  label="Target SU (Scalable Unit)"
                  value={targetSu}
                  onChange={(e) => {
                    setTargetSu(e.target.value)
                    setPingMode('custom')
                  }}
                />
              </div>
              <div>
                <Input
                  label="Target Host Index"
                  value={targetHost}
                  onChange={(e) => {
                    setTargetHost(e.target.value)
                    setPingMode('custom')
                  }}
                />
              </div>
              <div className="sm:col-span-2">
                <Button onClick={handleRunPing} disabled={!sourceServer || pingState.loading}>
                  {pingState.loading ? 'Running cluster-ping.sh…' : 'Execute Ping Test'}
                </Button>
              </div>
            </div>
          </Card>

          {pingState.loading && <LoadingState label="Executing cluster-ping.sh over jump host…" />}
          {pingState.error && <ErrorState message={pingState.error} />}

          {pingState.result && (
            <Card
              title={`Verification Results: ${pingState.result.source} ➔ ${pingState.result.target}`}
              description="Reports per-rail connectivity across East-West RoCE fabric, North-South bond0, and IPMI management."
            >
              {/* Outcome summary banner */}
              <div
                className={`mb-6 rounded-xl border p-4 ${
                  pingMode === 'intra'
                    ? pingState.result.all_ew_ok
                      ? 'border-success-200 bg-success-50 text-success-800'
                      : 'border-warning-200 bg-warning-50 text-warning-800'
                    : !pingState.result.all_ew_ok
                    ? 'border-success-200 bg-success-50 text-success-800'
                    : 'border-error-200 bg-error-50 text-error-800'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">
                    {pingMode === 'intra'
                      ? pingState.result.all_ew_ok
                        ? '✔'
                        : '⚠️'
                      : !pingState.result.all_ew_ok
                      ? '🛡️'
                      : '✘'}
                  </span>
                  <div>
                    <h4 className="font-semibold text-theme-sm">
                      {pingMode === 'intra'
                        ? pingState.result.all_ew_ok
                          ? 'Intra-VPC Cluster Fabric Fully Connected'
                          : 'Partial Connectivity Detected'
                        : !pingState.result.all_ew_ok
                        ? 'Hardware Multi-Tenant Isolation Verified (Packets Dropped)'
                        : 'Isolation Breach: Packets reached target across VPC!'}
                    </h4>
                    <p className="text-theme-xs opacity-90">
                      {pingMode === 'intra'
                        ? 'All RoCEv2 GPU rails communicate cleanly within the allocated VPC cluster.'
                        : 'Traffic across VPC boundary is strictly dropped by switch hardware ACLs and FIB separation.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Per-rail table */}
              <div className="overflow-hidden rounded-xl border border-gray-200">
                <table className="min-w-full">
                  <thead className="border-b border-gray-100 bg-gray-50">
                    <tr>
                      <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Fabric Target</th>
                      <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Target IP</th>
                      <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Ping Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {(pingState.result.ew_rails || []).map((rail) => (
                      <tr key={rail.rail}>
                        <td className="px-5 py-3.5 text-theme-sm font-medium text-gray-900">
                          East-West RoCE {rail.rail}
                        </td>
                        <td className="px-5 py-3.5 text-theme-sm font-mono text-xs text-gray-600">{rail.ip}</td>
                        <td className="px-5 py-3.5 text-theme-sm">
                          <Badge color={rail.status === 'OK' ? 'success' : 'error'} variant="solid">
                            {rail.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td className="px-5 py-3.5 text-theme-sm font-medium text-gray-900">North-South bond0</td>
                      <td className="px-5 py-3.5 text-theme-sm font-mono text-xs text-gray-600">
                        {pingState.result.ns_bond?.ip || '—'}
                      </td>
                      <td className="px-5 py-3.5 text-theme-sm">
                        <Badge
                          color={pingState.result.ns_bond?.status === 'OK' ? 'success' : 'error'}
                          variant="solid"
                        >
                          {pingState.result.ns_bond?.status || 'FAIL'}
                        </Badge>
                      </td>
                    </tr>
                    <tr>
                      <td className="px-5 py-3.5 text-theme-sm font-medium text-gray-900">IPMI / BMC eth11</td>
                      <td className="px-5 py-3.5 text-theme-sm font-mono text-xs text-gray-600">
                        {pingState.result.ipmi?.ip || '—'}
                      </td>
                      <td className="px-5 py-3.5 text-theme-sm">
                        <Badge
                          color={pingState.result.ipmi?.status === 'OK' ? 'success' : 'error'}
                          variant="solid"
                        >
                          {pingState.result.ipmi?.status || 'FAIL'}
                        </Badge>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
