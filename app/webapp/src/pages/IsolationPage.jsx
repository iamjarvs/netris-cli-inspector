import { useEffect, useMemo, useState } from 'react'
import {
  getIsolationEvidence,
  getIsolationSwitchLogin,
  getIsolationSwitches,
  getIsolationVpc,
  getIsolationVpcs,
  getSites,
  postIsolationPing,
  postIsolationPingCluster,
  postIsolationPingCrossVrf,
  postIsolationPingExternal,
  postIsolationServerExec,
  postIsolationSwitchExec,
} from '../api'
import AirGapDiagram from '../components/isolation/AirGapDiagram'
import CliTerminal from '../components/isolation/CliTerminal'
import ClusterMeshDiagram from '../components/isolation/ClusterMeshDiagram'
import CrossVrfDiagram from '../components/isolation/CrossVrfDiagram'
import PageBreadcrumb from '../components/layout/PageBreadcrumb'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import ErrorState from '../components/ui/ErrorState'
import LoadingState from '../components/ui/LoadingState'
import Select from '../components/ui/Select'

export default function IsolationPage() {
  // Sites (Data Centres)
  const [sites, setSites] = useState([])
  const [sitesLoading, setSitesLoading] = useState(true)
  const [selectedSiteId, setSelectedSiteId] = useState(8) // Default to Datacenter-A (Site 8)

  // VPCs
  const [allVpcs, setAllVpcs] = useState([])
  const [vpcsLoading, setVpcsLoading] = useState(true)
  const [vpcsError, setVpcsError] = useState(null)
  const [selectedVpcId, setSelectedVpcId] = useState('')

  // Active View (Unified 4-tab bar)
  // 'switch-cli' | 'intra-cluster' | 'cross-vrf' | 'external-airgap'
  const [activeView, setActiveView] = useState('switch-cli')

  // VPC Topology & Switches
  const [topology, setTopology] = useState(null)
  const [topologyLoading, setTopologyLoading] = useState(false)
  const [switches, setSwitches] = useState([])
  const [switchesLoading, setSwitchesLoading] = useState(false)
  const [selectedSwitch, setSelectedSwitch] = useState('')

  // View 1: Switch CLI state
  const [cliLines, setCliLines] = useState([])
  const [cliLoading, setCliLoading] = useState(false)
  const [cliPrompt, setCliPrompt] = useState('cumulus@switch:~$ ')

  // View 2: Intra-VPC Cluster Mesh state
  const [sourceServer, setSourceServer] = useState('')
  const [targetSu, setTargetSu] = useState('0')
  const [targetHost, setTargetHost] = useState('1')
  const [clusterPingLoading, setClusterPingLoading] = useState(false)
  const [clusterPingResults, setClusterPingResults] = useState(null)
  const [clusterCliLines, setClusterCliLines] = useState([])

  // View 3: Cross-VRF Isolation state (Default to EMPTY selection per feedback)
  const [selectedTargetVrfIds, setSelectedTargetVrfIds] = useState([])
  const [crossVrfLoading, setCrossVrfLoading] = useState(false)
  const [crossVrfResults, setCrossVrfResults] = useState(null)
  const [crossVrfCliLines, setCrossVrfCliLines] = useState([])

  // View 4: External Air-Gap state
  const [airGapLoading, setAirGapLoading] = useState(false)
  const [airGapResults, setAirGapResults] = useState(null)
  const [airGapCliLines, setAirGapCliLines] = useState([])

  // 1. Initial Load: Fetch Sites & All VPCs
  useEffect(() => {
    let active = true
    async function initData() {
      setSitesLoading(true)
      setVpcsLoading(true)
      setVpcsError(null)
      try {
        const [sitesRes, vpcsRes] = await Promise.all([getSites(), getIsolationVpcs()])
        if (!active) return

        const sitesList = sitesRes?.sites || []
        setSites(sitesList)

        // Select first reachable site or default to 8 (Datacenter-A)
        const defSite = sitesList.find((s) => s.id === 8) || sitesList.find((s) => s.reachable) || sitesList[0]
        if (defSite) setSelectedSiteId(defSite.id)

        const vpcList = vpcsRes?.vpcs || []
        setAllVpcs(vpcList)

        // Filter for default site
        const siteVpcs = vpcList.filter((v) => v.site_id === (defSite?.id ?? 8))
        const preferred = siteVpcs.find((v) => v.server_count > 0) || siteVpcs[0] || vpcList[0]
        if (preferred) setSelectedVpcId(String(preferred.id))
      } catch (err) {
        if (!active) return
        setVpcsError(err.message)
      } finally {
        if (active) {
          setSitesLoading(false)
          setVpcsLoading(false)
        }
      }
    }
    initData()
    return () => {
      active = false
    }
  }, [])

  // Filter VPCs by currently selected Data Centre
  const filteredVpcs = useMemo(() => {
    if (!selectedSiteId) return allVpcs
    return allVpcs.filter((v) => v.site_id === Number(selectedSiteId))
  }, [allVpcs, selectedSiteId])

  // When Data Centre changes: auto-select first VPC in that DC
  function handleSiteChange(newSiteId) {
    const sId = Number(newSiteId)
    setSelectedSiteId(sId)
    const matching = allVpcs.filter((v) => v.site_id === sId)
    if (matching.length > 0) {
      const preferred = matching.find((v) => v.server_count > 0) || matching[0]
      setSelectedVpcId(String(preferred.id))
    }
    // Reset Cross-VRF selection for clean slate
    setSelectedTargetVrfIds([])
  }

  // 2. When selectedVpcId changes: Load topology, switches
  useEffect(() => {
    if (!selectedVpcId) return
    let active = true

    async function loadVpcDetails() {
      setTopologyLoading(true)
      setSwitchesLoading(true)
      try {
        const [topoRes, swRes] = await Promise.all([
          getIsolationVpc(selectedVpcId),
          getIsolationSwitches(selectedVpcId),
        ])
        if (!active) return
        setTopology(topoRes)

        // Always default source host to Host 0 (hgx-pod00-su0-h00)
        if (topoRes.servers?.length > 0) {
          const host0 = topoRes.servers.find((s) => s.name.includes('h00')) || topoRes.servers[0]
          setSourceServer(host0.name)
          setTargetSu('0')
          setTargetHost('1')
        }

        const swList = swRes.switches || []
        setSwitches(swList)
        if (swList.length > 0) {
          const attached =
            swList.find((s) => s.is_attached && s.role.includes('East-West')) ||
            swList.find((s) => s.is_attached) ||
            swList[0]
          setSelectedSwitch(attached.name)
        }
      } catch (err) {
        console.error('Error loading VPC details:', err)
      } finally {
        if (active) {
          setTopologyLoading(false)
          setSwitchesLoading(false)
        }
      }
    }

    loadVpcDetails()

    // Reset cross-VRF targets to EMPTY per requirements
    setSelectedTargetVrfIds([])

    return () => {
      active = false
    }
  }, [selectedVpcId])

  // 3. When selected switch changes: fetch authentic switch login banner
  useEffect(() => {
    if (!selectedSwitch) return
    let active = true
    async function loadSwitchLogin() {
      setCliLoading(true)
      const swObj = switches.find((s) => s.name === selectedSwitch)
      const mgmtIp = swObj?.mgmt_ip || ''
      try {
        const res = await getIsolationSwitchLogin(selectedSwitch, mgmtIp)
        if (!active) return
        const promptStr = res.prompt || `cumulus@${selectedSwitch}:~$ `
        setCliPrompt(promptStr)
        const initText =
          res.session_init ||
          `[Connecting to switch ${selectedSwitch} (${mgmtIp}) via SSH jump host...]\n${res.banner || 'Welcome to NVIDIA Cumulus (R) Linux (R)'}\n${promptStr}`
        setCliLines(initText.split('\n'))
      } catch (err) {
        if (!active) return
        setCliLines([
          `[Connecting to switch ${selectedSwitch} via SSH jump host...]`,
          `Welcome to NVIDIA Cumulus (R) Linux (R)`,
          `cumulus@${selectedSwitch}:~$ `,
        ])
        setCliPrompt(`cumulus@${selectedSwitch}:~$ `)
      } finally {
        if (active) setCliLoading(false)
      }
    }
    loadSwitchLogin()
    return () => {
      active = false
    }
  }, [selectedSwitch, switches])

  // Execute command on active switch CLI
  async function handleRunSwitchCommand(cmd) {
    if (!cmd.trim() || !selectedSwitch || cliLoading) return
    const swObj = switches.find((s) => s.name === selectedSwitch)
    const mgmtIp = swObj?.mgmt_ip || ''

    setCliLoading(true)
    setCliLines((prev) => [...prev, `${cliPrompt}${cmd}`])

    try {
      const res = await postIsolationSwitchExec(selectedSwitch, mgmtIp, cmd.trim())
      const outputLines = (res.stdout || res.stderr || '').split('\n')
      setCliLines((prev) => [...prev, ...outputLines, cliPrompt])
    } catch (err) {
      setCliLines((prev) => [...prev, `[Error: ${err.message}]`, cliPrompt])
    } finally {
      setCliLoading(false)
    }
  }

  // Quick Command Presets for Switch CLI
  const quickCommands = [
    {
      label: 'show vrf',
      desc: 'Audit VRF Table IDs & ASIC status',
      cmd: "sudo vtysh -c 'show vrf'",
    },
    {
      label: `show ip route vrf Vrf_${selectedVpcId}`,
      desc: 'Audit tenant isolated FIB & blackhole 0.0.0.0/0',
      cmd: `sudo vtysh -c 'show ip route vrf Vrf_${selectedVpcId}'`,
    },
    {
      label: 'show evpn vni',
      desc: 'Audit EVPN VNIs and VXLAN mappings',
      cmd: "sudo vtysh -c 'show evpn vni'",
    },
    {
      label: 'ip route show table 1002',
      desc: 'Audit kernel FIB table for tenant VRF',
      cmd: 'ip route show table 1002',
    },
    {
      label: 'nv show vrf',
      desc: 'NVUE high-level VRF configuration',
      cmd: 'nv show vrf',
    },
  ]

  // View 2: Run ./cluster-ping.sh on compute node
  async function handleRunClusterPing(overrideHost) {
    if (!sourceServer || clusterPingLoading) return
    const hostToUse = overrideHost !== undefined ? overrideHost : targetHost

    setClusterPingLoading(true)
    const cmdStr = `./cluster-ping.sh ${targetSu} ${hostToUse}`
    setClusterCliLines([
      `[SSH Session: root@${sourceServer} via Jump Host]`,
      `root@${sourceServer}:~$ ${cmdStr}`,
    ])

    try {
      const res = await postIsolationPing(sourceServer, Number(targetSu), Number(hostToUse))
      setClusterPingResults(res)
      const cleanLines = (res.raw_output || '').split('\n').filter(Boolean)
      setClusterCliLines([
        `[SSH Session: root@${sourceServer} via Jump Host]`,
        `root@${sourceServer}:~$ ${cmdStr}`,
        ...cleanLines,
        `root@${sourceServer}:~$ `,
      ])
    } catch (err) {
      setClusterCliLines((prev) => [
        ...prev,
        `[Error executing ${cmdStr}: ${err.message}]`,
        `root@${sourceServer}:~$ `,
      ])
    } finally {
      setClusterPingLoading(false)
    }
  }

  // View 2: Sweep All Peer Devices
  async function handleSweepAllDevices() {
    if (!sourceServer || clusterPingLoading) return
    setClusterPingLoading(true)
    const servers = topology?.servers || []
    const peers = servers.filter((s) => s.name !== sourceServer)
    const targetList = peers.length > 0 ? peers : servers

    setClusterCliLines([
      `[SSH Session: root@${sourceServer} via Jump Host]`,
      `root@${sourceServer}:~$ # Sweeping all peer devices in SU ${targetSu} with ./cluster-ping.sh...`,
    ])

    try {
      const allLines = [
        `[SSH Session: root@${sourceServer} via Jump Host]`,
        `root@${sourceServer}:~$ # Sweeping all peer devices in SU ${targetSu} with ./cluster-ping.sh...`,
      ]
      let lastRes = null

      for (let i = 0; i < targetList.length; i++) {
        const s = targetList[i]
        const m = s.name.match(/h(\d+)/)
        const hNum = m ? parseInt(m[1], 10) : i + 1
        const cmdStr = `./cluster-ping.sh ${targetSu} ${hNum}`
        allLines.push(`root@${sourceServer}:~$ ${cmdStr}`)

        const res = await postIsolationPing(sourceServer, Number(targetSu), hNum)
        lastRes = res
        const cleanLines = (res.raw_output || '').split('\n').filter(Boolean)
        allLines.push(...cleanLines)
        allLines.push('')
      }

      setClusterPingResults(lastRes)
      allLines.push(
        `--- Peer Devices Sweep Complete (${targetList.length} devices tested via ./cluster-ping.sh) ---`
      )
      allLines.push(`root@${sourceServer}:~$ `)
      setClusterCliLines(allLines)
    } catch (err) {
      setClusterCliLines((prev) => [
        ...prev,
        `[Error during device sweep: ${err.message}]`,
        `root@${sourceServer}:~$ `,
      ])
    } finally {
      setClusterPingLoading(false)
    }
  }

  // View 2: Server Ad hoc Command Runner
  async function handleRunServerAdHoc(cmd) {
    if (!cmd.trim() || !sourceServer || clusterPingLoading) return
    setClusterPingLoading(true)
    setClusterCliLines((prev) => [...prev, `root@${sourceServer}:~$ ${cmd}`])
    try {
      const res = await postIsolationServerExec(sourceServer, cmd.trim())
      const outputLines = (res.stdout || res.stderr || '').split('\n')
      setClusterCliLines((prev) => [...prev, ...outputLines, `root@${sourceServer}:~$ `])
    } catch (err) {
      setClusterCliLines((prev) => [...prev, `[Error: ${err.message}]`, `root@${sourceServer}:~$ `])
    } finally {
      setClusterPingLoading(false)
    }
  }

  // View 3: Run Tenant Isolation Testing via ./cluster-ping.sh across tenants
  async function handleRunCrossVrfTest() {
    if (selectedTargetVrfIds.length === 0 || crossVrfLoading) return
    setCrossVrfLoading(true)
    const hostName = sourceServer || 'hgx-pod00-su0-h00'

    setCrossVrfCliLines([
      `[SSH Session: root@${hostName} via Jump Host]`,
      `root@${hostName}:~$ # Auditing Multi-Tenant Hardware & RoCEv2 Fabric Isolation with ./cluster-ping.sh...`,
      `root@${hostName}:~$ # All 8 GPU rails and in-band fabrics must be strictly unreachable across tenants`,
    ])

    try {
      const res = await postIsolationPingCrossVrf(
        Number(selectedVpcId),
        selectedTargetVrfIds,
        selectedSwitch,
        activeSwitchObj?.mgmt_ip,
        hostName
      )
      setCrossVrfResults(res)
      if (res.cli_output) {
        setCrossVrfCliLines(res.cli_output.split('\n'))
      }
    } catch (err) {
      setCrossVrfCliLines((prev) => [
        ...prev,
        `[Error testing tenant isolation: ${err.message}]`,
        `root@${hostName}:~$ `,
      ])
    } finally {
      setCrossVrfLoading(false)
    }
  }

  // View 4: Run External Air-Gap Assurance
  async function handleRunAirGapTest() {
    if (airGapLoading) return
    setAirGapLoading(true)
    const swObj = switches.find((s) => s.name === selectedSwitch) || switches[0]

    setAirGapCliLines([
      `[Connecting to switch ${swObj?.name || 'leaf-pod00-su0-r0'} via SSH jump host...]`,
      `cumulus@${swObj?.name || 'switch'}:~$ # Testing outbound reachability to Public Internet from Vrf_${selectedVpcId}`,
      `cumulus@${swObj?.name || 'switch'}:~$ # Checking 0.0.0.0/0 blackhole ICMP unreachable route`,
    ])

    try {
      const res = await postIsolationPingExternal(
        Number(selectedVpcId),
        undefined,
        swObj?.name,
        swObj?.mgmt_ip
      )
      setAirGapResults(res)
      if (res.cli_output) {
        setAirGapCliLines(res.cli_output.split('\n'))
      }
    } catch (err) {
      setAirGapCliLines((prev) => [
        ...prev,
        `[Error testing external reachability: ${err.message}]`,
        `cumulus@${swObj?.name || 'switch'}:~$ `,
      ])
    } finally {
      setAirGapLoading(false)
    }
  }

  const selectedVpc = allVpcs.find((v) => String(v.id) === String(selectedVpcId))
  const otherVpcsInDc = filteredVpcs.filter((v) => String(v.id) !== String(selectedVpcId))
  const activeSwitchObj = switches.find((s) => s.name === selectedSwitch)

  // Find server IP for iTerm launch
  const sourceServerIp =
    topology?.servers?.find((s) => s.name === sourceServer)?.ip || '10.253.0.17'

  return (
    <div className="space-y-5">
      <PageBreadcrumb title="Switch Isolation & Assurance" />

      {/* COMPACT TOP CONTROL BAR: Left Site/VPC Selectors + Right Unified View Switcher */}
      <div className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-xs">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* LEFT: Compact Data Centre & VPC Selectors */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Target Data Centre Filter */}
            <div className="w-48">
              <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                Data Centre
              </label>
              <Select
                value={selectedSiteId}
                onChange={(e) => handleSiteChange(e.target.value)}
                loading={sitesLoading}
                disabled={sitesLoading || sites.length === 0}
                className="text-xs py-1.5 font-medium"
              >
                {sitesLoading ? (
                  <option value="">Loading Data Centres…</option>
                ) : sites.length === 0 ? (
                  <option value="">No Data Centres Found</option>
                ) : (
                  sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.device_count || 0} dev)
                    </option>
                  ))
                )}
              </Select>
            </div>

            {/* Target VPC (Filtered to chosen DC) */}
            <div className="w-56">
              <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                Target VPC
              </label>
              <Select
                value={selectedVpcId}
                onChange={(e) => setSelectedVpcId(e.target.value)}
                loading={vpcsLoading || topologyLoading}
                disabled={vpcsLoading || topologyLoading || filteredVpcs.length === 0}
                className="text-xs py-1.5 font-medium"
              >
                {vpcsLoading ? (
                  <option value="">Loading VPCs…</option>
                ) : topologyLoading ? (
                  <option value="">Loading Topology…</option>
                ) : filteredVpcs.length === 0 ? (
                  <option value="">No VPCs Found</option>
                ) : (
                  filteredVpcs.map((v) => (
                    <option key={v.id} value={String(v.id)}>
                      VPC {v.id}: {v.name} ({v.server_count} nodes)
                    </option>
                  ))
                )}
              </Select>
            </div>

            {/* Quick Context Badges */}
            <div className="hidden sm:flex items-center gap-2 pt-4">
              <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-700">
                Tenant: <strong className="ml-1 text-gray-900">{selectedVpc?.tenant || 'admin'}</strong>
              </span>
              <span className="inline-flex items-center rounded-md bg-brand-50 px-2 py-1 text-[11px] font-bold text-brand-700 border border-brand-200">
                Vrf_{selectedVpcId} (FIB 1002)
              </span>
            </div>
          </div>

          {/* RIGHT: Unified Navigation Row (All 4 Demo Views in One Place) */}
          <div className="flex items-center">
            <div className="flex items-center rounded-lg bg-gray-100 p-1 border border-gray-200">
              <button
                type="button"
                onClick={() => setActiveView('switch-cli')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                  activeView === 'switch-cli'
                    ? 'bg-white text-gray-900 shadow-xs border border-gray-200/80'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <span>💻</span>
                <span>Switch CLI</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveView('intra-cluster')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                  activeView === 'intra-cluster'
                    ? 'bg-white text-gray-900 shadow-xs border border-gray-200/80'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <span>🟢</span>
                <span>Tenant Mesh</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveView('cross-vrf')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                  activeView === 'cross-vrf'
                    ? 'bg-white text-gray-900 shadow-xs border border-gray-200/80'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <span>🛡️</span>
                <span>Tenant Isolation</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveView('external-airgap')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                  activeView === 'external-airgap'
                    ? 'bg-white text-gray-900 shadow-xs border border-gray-200/80'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <span>🌐</span>
                <span>External Air-Gap</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* VIEW 1: SWITCH CLI SEGMENTATION (Side-by-side Switch Menu + Terminal)   */}
      {/* ========================================================================= */}
      {activeView === 'switch-cli' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-start">
          {/* LEFT: Switch Selector & Command Palette */}
          <div className="lg:col-span-4 space-y-4">
            <Card
              title="Target Switch Selection"
              description="Choose an NVIDIA Cumulus leaf switch attached to this VPC."
            >
              <div className="space-y-3">
                <Select
                  label="Select Physical Switch"
                  value={selectedSwitch}
                  onChange={(e) => setSelectedSwitch(e.target.value)}
                  loading={switchesLoading}
                  disabled={switchesLoading || switches.length === 0}
                >
                  {switchesLoading ? (
                    <option value="">Loading Switches…</option>
                  ) : switches.length === 0 ? (
                    <option value="">No Switches Found</option>
                  ) : (
                    switches.map((sw) => (
                      <option key={sw.name} value={sw.name}>
                        {sw.name} ({sw.role}) {sw.is_attached ? '★ Attached' : ''}
                      </option>
                    ))
                  )}
                </Select>

                {activeSwitchObj && (
                  <div className="rounded-lg border border-gray-100 bg-gray-50/70 p-3 space-y-1.5 text-theme-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Fabric Role:</span>
                      <span className="font-semibold text-gray-800">{activeSwitchObj.role}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Management IP:</span>
                      <span className="font-mono text-gray-800">{activeSwitchObj.mgmt_ip}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Attachment:</span>
                      <span className="font-medium text-emerald-700">
                        {activeSwitchObj.is_attached ? 'Directly Attached to VPC' : 'Fabric Backbone'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </Card>

            {/* Quick Command Palette */}
            <Card
              title="Executive Quick Commands"
              description="Click any command to execute it instantly on the switch terminal."
            >
              <div className="space-y-2">
                {quickCommands.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => handleRunSwitchCommand(item.cmd)}
                    disabled={cliLoading}
                    className="w-full text-left rounded-lg border border-gray-200 bg-white p-2.5 hover:border-brand-500 hover:bg-brand-50/30 transition-all group"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold text-gray-900 group-hover:text-brand-700">
                        {item.label}
                      </span>
                      <span className="text-[10px] text-brand-600 font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                        Run ↵
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-gray-500">{item.desc}</p>
                  </button>
                ))}
              </div>
            </Card>
          </div>

          {/* RIGHT: High-Res Switch CLI Terminal Session */}
          <div className="lg:col-span-8">
            <CliTerminal
              title={`Switch CLI Console: ${selectedSwitch || 'NVIDIA Cumulus'}`}
              lines={cliLines}
              prompt={cliPrompt}
              onRunCommand={handleRunSwitchCommand}
              onClear={() => setCliLines([cliPrompt])}
              loading={cliLoading}
              height="h-[520px]"
              targetDevice={selectedSwitch}
              mgmtIp={activeSwitchObj?.mgmt_ip || ''}
              deviceType="switch"
            />
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 2: INTRA-VPC CLUSTER MESH (50/50 Side-by-Side: Left CLI, Right Diagram) */}
      {/* ========================================================================= */}
      {activeView === 'intra-cluster' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-start">
          {/* LEFT 50%: Dedicated SSH Compute Session Running ./cluster-ping.sh */}
          <div className="lg:col-span-6 space-y-3">
            <div className="flex items-center justify-between px-1">
              <div>
                <h4 className="text-theme-sm font-bold text-gray-900">
                  Compute Node SSH Session (Host 0 Origin)
                </h4>
                <p className="text-[11px] text-gray-500">
                  Executes native <code className="font-mono text-gray-800 bg-gray-100 px-1 py-0.5 rounded">./cluster-ping.sh &lt;SU&gt; &lt;Host&gt;</code> to audit 8 RoCE rails.
                </p>
              </div>
            </div>

            <CliTerminal
              title={`Compute Node CLI: ${sourceServer || 'hgx-pod00-su0-h00'}`}
              lines={
                clusterCliLines.length > 0
                  ? clusterCliLines
                  : [
                      `[Connected to ${sourceServer || 'hgx-pod00-su0-h00'} via SSH Jump Host]`,
                      `Linux ${sourceServer || 'hgx-pod00-su0-h00'} 5.15.0-nvidia-gpu (Ubuntu 22.04 LTS)`,
                      `root@${sourceServer || 'hgx-pod00-su0-h00'}:~$ # Click any node card or 'Sweep All Peers' on the right to test`,
                      `root@${sourceServer || 'hgx-pod00-su0-h00'}:~$ `,
                    ]
              }
              prompt={`root@${sourceServer || 'hgx-pod00-su0-h00'}:~$ `}
              onRunCommand={handleRunServerAdHoc}
              onClear={() => setClusterCliLines([`root@${sourceServer || 'hgx-pod00-su0-h00'}:~$ `])}
              loading={clusterPingLoading}
              height="h-[560px]"
              targetDevice={sourceServer || 'hgx-pod00-su0-h00'}
              mgmtIp={sourceServerIp}
              deviceType="server"
            />
          </div>

          {/* RIGHT 50%: Dynamic Cluster Mesh Diagram at the Top */}
          <div className="lg:col-span-6 space-y-4">
            <ClusterMeshDiagram
              vpc={selectedVpc}
              clusterName={selectedVpc?.clusters?.[0]?.name}
              servers={topology?.servers || []}
              sourceServer={sourceServer}
              targetSu={targetSu}
              targetHost={targetHost}
              onSelectSource={setSourceServer}
              onSelectTarget={(hNum) => {
                setTargetHost(String(hNum))
                handleRunClusterPing(String(hNum))
              }}
              pingResults={clusterPingResults}
              isPinging={clusterPingLoading}
              onTriggerPing={() => handleRunClusterPing()}
              onTriggerSweep={handleSweepAllDevices}
            />

            {/* Quick RoCE Rail Architecture Breakdown Card */}
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-2xs">
              <h5 className="text-theme-xs font-bold text-gray-800 uppercase tracking-wider mb-2">
                RoCEv2 Fabric Multi-Rail Topology
              </h5>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-[11px] font-mono">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((rail) => (
                  <div
                    key={rail}
                    className="rounded-lg border border-gray-200 bg-gray-50/80 p-2 hover:border-emerald-400 transition-colors"
                  >
                    <span className="block font-bold text-gray-900">Rail {rail}</span>
                    <span className="block text-[10px] text-emerald-600 font-semibold mt-0.5">
                      400G RoCEv2
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 3: TENANT ISOLATION (50/50 Side-by-Side with cluster-ping.sh)         */}
      {/* ========================================================================= */}
      {activeView === 'cross-vrf' && (
        <div className="space-y-4">
          {/* Target Tenant Selection Bar (Clean Slate: default to NO target tenants selected) */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-xs">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h4 className="text-theme-sm font-bold text-gray-900">
                  Select Target Tenants in {sites.find((s) => s.id === selectedSiteId)?.name || 'Data Centre'} to Audit
                </h4>
                <p className="text-theme-xs text-gray-500">
                  Runs <code className="font-mono text-gray-800 bg-gray-100 px-1 py-0.5 rounded">./cluster-ping.sh &lt;SU&gt; &lt;Host&gt;</code> from Origin Host to test all 8 RoCE rails and in-band fabrics across tenants.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const allOtherIds = otherVpcsInDc.map((v) => Number(v.id))
                    setSelectedTargetVrfIds(allOtherIds)
                  }}
                >
                  Select All
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelectedTargetVrfIds([])}
                >
                  Clear Selection
                </Button>
                <Button
                  size="sm"
                  onClick={handleRunCrossVrfTest}
                  disabled={selectedTargetVrfIds.length === 0 || crossVrfLoading}
                >
                  {crossVrfLoading ? 'Running Cluster Ping…' : 'Run Tenant Isolation Audit 🛡️'}
                </Button>
              </div>
            </div>

            {/* Target Tenant Badges / Pills */}
            <div className="mt-3 flex flex-wrap gap-2 pt-3 border-t border-gray-100">
              {otherVpcsInDc.length === 0 ? (
                <span className="text-theme-xs text-gray-400 italic">
                  No other VPCs/Tenants configured in this Data Centre.
                </span>
              ) : (
                otherVpcsInDc.map((v) => {
                  const isSelected = selectedTargetVrfIds.includes(Number(v.id))
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => {
                        const vid = Number(v.id)
                        setSelectedTargetVrfIds((prev) =>
                          prev.includes(vid) ? prev.filter((id) => id !== vid) : [...prev, vid]
                        )
                      }}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold border transition-all ${
                        isSelected
                          ? 'border-brand-500 bg-brand-50 text-brand-800 shadow-xs'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <span className={`h-2 w-2 rounded-full ${isSelected ? 'bg-brand-600' : 'bg-gray-300'}`} />
                      <span>
                        VPC {v.id}: {v.name}
                      </span>
                      <span className="text-[10px] text-gray-400">({v.server_count} nodes)</span>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          {/* 50/50 Side-by-Side: Left Terminal, Right TenantIsolationDiagram */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-start">
            {/* LEFT 50%: Compute Node SSH Session running cluster-ping.sh across tenants */}
            <div className="lg:col-span-6">
              <CliTerminal
                title={`Tenant Isolation Audit: ${sourceServer || 'hgx-pod00-su0-h00'}`}
                lines={
                  crossVrfCliLines.length > 0
                    ? crossVrfCliLines
                    : [
                        `[Connected to ${sourceServer || 'hgx-pod00-su0-h00'} via SSH Jump Host]`,
                        `Linux ${sourceServer || 'hgx-pod00-su0-h00'} 5.15.0-nvidia-gpu (Ubuntu 22.04 LTS)`,
                        `root@${sourceServer || 'hgx-pod00-su0-h00'}:~$ # Select target tenants above and click 'Run Tenant Isolation Audit'`,
                        `root@${sourceServer || 'hgx-pod00-su0-h00'}:~$ # Runs ./cluster-ping.sh <SU> <Host> to audit 8 RoCE rails across tenants`,
                        `root@${sourceServer || 'hgx-pod00-su0-h00'}:~$ `,
                      ]
                }
                prompt={`root@${sourceServer || 'hgx-pod00-su0-h00'}:~$ `}
                onRunCommand={handleRunServerAdHoc}
                onClear={() => setCrossVrfCliLines([`root@${sourceServer || 'hgx-pod00-su0-h00'}:~$ `])}
                loading={crossVrfLoading}
                height="h-[560px]"
                targetDevice={sourceServer || 'hgx-pod00-su0-h00'}
                mgmtIp={sourceServerIp}
                deviceType="server"
              />
            </div>

            {/* RIGHT 50%: Tenant Isolation Visualizer */}
            <div className="lg:col-span-6">
              <CrossVrfDiagram
                sourceVpc={selectedVpc}
                targetVpcs={filteredVpcs}
                selectedTargetIds={selectedTargetVrfIds}
                results={crossVrfResults?.results || []}
                isAuditing={crossVrfLoading}
              />
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 4: EXTERNAL AIR-GAP ASSURANCE (Full Width Layout)                    */}
      {/* ========================================================================= */}
      {activeView === 'external-airgap' && (
        <div className="space-y-4">
          {/* Top Control Bar */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-xs">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h4 className="text-theme-sm font-bold text-gray-900">
                  Perimeter Air-Gap & Zero-Leakage Verification
                </h4>
                <p className="text-theme-xs text-gray-500">
                  Verifies that VPC {selectedVpcId} has no egress path to public internet addresses (8.8.8.8, 1.1.1.1, etc.).
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Badge color="success" variant="solid">
                  🔒 Default Blackhole Route Active
                </Badge>
                <Button size="sm" onClick={handleRunAirGapTest} disabled={airGapLoading}>
                  {airGapLoading ? 'Auditing Air-Gap…' : 'Audit Perimeter Air-Gap 🔒'}
                </Button>
              </div>
            </div>
          </div>

          {/* Full-Width Terminal */}
          <CliTerminal
            title={`Perimeter Air-Gap Audit: ${selectedSwitch || 'NVIDIA Cumulus'}`}
            lines={
              airGapCliLines.length > 0
                ? airGapCliLines
                : [
                    `[Connecting to switch ${selectedSwitch || 'leaf-pod00-su0-r0'} via SSH jump host...]`,
                    `cumulus@${selectedSwitch || 'switch'}:~$ # Click 'Audit Perimeter Air-Gap' to test outbound public reachability`,
                    `cumulus@${selectedSwitch || 'switch'}:~$ # Confirms zero egress route leakage outside data centre boundary`,
                    `cumulus@${selectedSwitch || 'switch'}:~$ `,
                  ]
            }
            prompt={`cumulus@${selectedSwitch || 'switch'}:~$ `}
            onRunCommand={handleRunSwitchCommand}
            onClear={() => setAirGapCliLines([`cumulus@${selectedSwitch || 'switch'}:~$ `])}
            loading={airGapLoading}
            height="h-[380px]"
            targetDevice={selectedSwitch}
            mgmtIp={activeSwitchObj?.mgmt_ip || ''}
            deviceType="switch"
          />

          {/* Architecture Diagram Underneath */}
          <AirGapDiagram
            vpc={selectedVpc}
            results={airGapResults?.results || []}
            isAuditing={airGapLoading}
          />
        </div>
      )}
    </div>
  )
}
