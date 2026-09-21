async function request(path, options) {
  let res
  try {
    res = await fetch(path, options)
  } catch {
    throw new Error('Could not reach the backend. Is the API server running?')
  }

  let body = null
  const text = await res.text()
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
  }

  if (!res.ok) {
    const message = body?.error || body?.message || `Request failed (${res.status} ${res.statusText})`
    throw new Error(message)
  }

  return body
}

function query(params) {
  const usp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') usp.set(key, value)
  }
  const qs = usp.toString()
  return qs ? `?${qs}` : ''
}

export function getHealth() {
  return request('/api/health')
}

export function getSites() {
  return request('/api/sites')
}

export function getDevices(siteId) {
  return request(`/api/devices${query({ site_id: siteId })}`)
}

export function getCatalog() {
  return request('/api/catalog')
}

export function postShow(targets, command) {
  return request('/api/show', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targets, command }),
  })
}

export function postCompare(deviceA, deviceB, command) {
  return request('/api/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_a: deviceA, device_b: deviceB, command }),
  })
}

export function getOnboxHistory(device, mgmtAddress) {
  return request(`/api/history/onbox${query({ device, mgmt_address: mgmtAddress })}`)
}

export function getArchiveHistory(device, limit = 20) {
  return request(`/api/history/archive${query({ device, limit })}`)
}

export function postArchiveSnapshot(targets) {
  return request('/api/archive/snapshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targets }),
  })
}

export function postRevisionsStatus(targets) {
  return request('/api/revisions/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targets }),
  })
}

export function postRevisionsApply(targets, value) {
  return request('/api/revisions/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targets, value }),
  })
}

export function getConfigSource({ device, mgmtAddress, sourceType, ref, format = 'text' }) {
  return request(
    `/api/config/source${query({ device, mgmt_address: mgmtAddress, source_type: sourceType, ref, format })}`,
  )
}

export function getConfigDiff({ device, mgmtAddress, aType, aRef, bType, bRef }) {
  return request(
    `/api/config/diff${query({
      device,
      mgmt_address: mgmtAddress,
      a_type: aType,
      a_ref: aRef,
      b_type: bType,
      b_ref: bRef,
    })}`,
  )
}

export function postSavedDiff(payload) {
  return request('/api/saved-diffs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function getSavedDiffs(device) {
  return request(`/api/saved-diffs${query({ device })}`)
}

export function getSavedDiff(device, id) {
  return request(`/api/saved-diffs/${encodeURIComponent(device)}/${encodeURIComponent(id)}`)
}

export function deleteSavedDiff(device, id) {
  return request(`/api/saved-diffs/${encodeURIComponent(device)}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export function getIsolationVpcs() {
  return request('/api/isolation/vpcs')
}

export function getIsolationVpc(vpcId) {
  return request(`/api/isolation/vpc/${vpcId}`)
}

export function getIsolationEvidence(vpcId) {
  return request(`/api/isolation/evidence${query({ vpc_id: vpcId })}`)
}

export function postIsolationPing(source, targetSu, targetHost) {
  return request('/api/isolation/ping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source,
      target_su: targetSu,
      target_host: targetHost,
    }),
  })
}
