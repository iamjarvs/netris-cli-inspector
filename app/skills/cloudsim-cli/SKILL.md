---
name: cloudsim-cli
description: Query a CloudSim lab through its Netris controller and then jump from the controller (jump host) onto the Cumulus Linux switches to pull live data from one switch, a group, or the whole fabric. Use when the user says "use the CloudSim CLI", "check the switches in CloudSim", "ask Netris / the controller", "show BGP/EVPN/interfaces/config on the leafs", "compare two switches", "what changed in the config", or wants VPC/site/switch inventory from the Netris controller. Read-only by default.
---

# CloudSim CLI

CloudSim is a Netris-managed lab: NVIDIA Cumulus Linux switches (leaf / spine /
North-South `ns-*`) and HGX GPU servers behind one **controller / jump host**.
Two access paths, used together:

1. **Netris controller API (HTTPS)** — the source of truth for *what exists*:
   sites, switches and their mgmt IPs, VPCs, server clusters, V-Nets, links,
   and an audit log of every change made through Netris.
2. **SSH hop: laptop → controller → switch** — the source of truth for *live
   device state*: `nv show ...`, `vtysh`, `nv config ...` on each switch.

> Workflow: ask Netris what exists → pick the switches → hop through the
> controller and run read-only commands on them → summarise.

## 0. Get what you need from the user (never guess, never store)

| Needed | Default / note |
|---|---|
| Controller URL | e.g. `https://adam-ctl.netris.io` (no `www.`) |
| Netris username + password | **Ask the user.** Keep them only in shell env vars for the session. Never write them to a file, a script, a commit, or your reply. |
| SSH target for the jump host | `ubuntu@<controller-hostname>` — normally the **same host** as the Netris URL. Uses the user's existing SSH key; no password. |

```bash
export NETRIS_URL='https://adam-ctl.netris.io'
export NETRIS_USER='...'        # from the user
export NETRIS_PASSWORD='...'    # from the user; do not echo
export JUMP='ubuntu@adam-ctl.netris.io'
ssh -o BatchMode=yes -o ConnectTimeout=10 "$JUMP" 'hostname' # verify SSH works first
```

If the SSH check fails (permission denied / timeout), stop and tell the user —
they need to fix key access or VPN; don't try other credentials.

## 1. Query the Netris controller

Auth is a cookie session: `POST /api/auth` sets `connect.sid`. Lab certs are
self-signed, so use `-k`.

```bash
JAR=$(mktemp)
curl -sk -c "$JAR" -H 'Content-Type: application/json' \
  -d "$(jq -n --arg u "$NETRIS_USER" --arg p "$NETRIS_PASSWORD" '{user:$u,password:$p}')" \
  "$NETRIS_URL/api/auth" -o /dev/null -w '%{http_code}\n'      # expect 200
api() { curl -sk -b "$JAR" "$NETRIS_URL$1"; }                   # api /api/v2/sites | jq .
```

Failed login → report it and ask the user to re-check credentials; don't retry
in a loop (risk of lockout). Delete `$JAR` when done.

Responses are mostly `{"data": ..., "isSuccess": bool, "meta": {...}}`; some
legacy endpoints return bare JSON. Check `isSuccess`, not just HTTP status.

Endpoints verified against this lab:

| Question | Call |
|---|---|
| Sites | `GET /api/v2/sites` |
| Switches / all hardware | `GET /api/v2/hw?page=1&limit=200` (**`page` and `limit` must be sent together**; total in `meta.totalDocs`) |
| VPCs | `GET /api/v2/vpc` |
| Server clusters (+ member servers) | `GET /api/v2/server-cluster` |
| V-Nets | `GET /api/v2/vnet` |
| Physical links (switch port ↔ server NIC) | `GET /api/v2/link` |
| Who changed what, when | `GET /api/apilogs` — see below |

Useful `/api/v2/hw` fields per item: `name`, `type` (`switch`, server, softgate…),
`swRole` (`leaf`/`spine`/`super-spine`/`generic`), `site{id,name}`, `tenant`,
`nos`, `mainAddress`, **`mgmtAddress`** (matches the IP in the jump host's
alias file), `status`.

```bash
# Switch inventory: name, role, site, mgmt IP
api '/api/v2/hw?page=1&limit=200' | jq -r '.data[] | select(.type=="switch")
  | [.name,.swRole,.site.name,.mgmtAddress] | @tsv'
```

**Audit log** (`/api/apilogs`) — params `start`/`end` (epoch seconds) and
JSON-encoded `pagination` (`limit`/`offset`, *not* page), `filter`, `sort`:

```bash
NOW=$(date +%s)
curl -sk -b "$JAR" -G "$NETRIS_URL/api/apilogs" \
  --data-urlencode "start=$((NOW-3600))" --data-urlencode "end=$NOW" \
  --data-urlencode 'pagination={"limit":100,"offset":0}' \
  --data-urlencode 'filter={"method":["POST","PUT","PATCH","DELETE"]}' \
  --data-urlencode 'sort={"sortBy":"createdAt","order":"DESC"}' \
  | jq -r '.data[] | [.createdAt,.method,.url,.user] | @tsv'
```
Ignore UI noise (`/auth`, `topology/`, `/graphite`, `/users/options`).
`/api/eventlogs` returns 500 in this deployment — don't use it.

For anything not listed here (ACLs, eBGP, NAT, IPAM, L4LB…), use the
`netris-api` skill's references rather than guessing field names.

## 2. Jump from the controller into the switches

Switches are **not reachable from the laptop**, and none trust the user's key.
Every switch trusts only the controller's own key, so the hop must originate
*on* the controller (`ssh ubuntu@controller "ssh cumulus@<switch-ip> '<cmd>'"`).

### The alias file (how the jump host names switches)

On the controller, `~/.cloudsim_aliases` (sourced from `.bashrc`) has one
alias per device:

```
alias leaf-pod00-su0-r0='ssh -o StrictHostKeyChecking=no cumulus@10.253.0.1'
alias hgx-pod00-su0-h03='ssh ... root@10.254.x.x'
```

- **SSH user decides what it is**: `cumulus@` = Cumulus switch (what you want);
  `root@` = HGX GPU server, `mgmt-server`, `isp-server`, `ns-softgate-*`
  (not switches — skip them for switch commands).
- Names: `leaf-pod<P>-su<S>-r<R>`, `spine-<N>-pod<P>`, `ns-leaf-<N>`,
  `ns-oob-leaf-<N>`, `ns-spine-<N>`, `hgx-pod<P>-su<S>-h<HH>`.
- **Aliases don't expand over non-interactive SSH.** Don't run
  `ssh $JUMP leaf-pod00-su0-r0` — it fails. Resolve the alias to its IP (from
  the file, or from Netris `mgmtAddress`) and ssh to `cumulus@<ip>`. The
  bundled `scripts/fanout.sh` does this for you.

```bash
# List switch aliases + IPs on the controller
ssh "$JUMP" "sed -nE \"s/^alias ([^=]+)='.*cumulus@([0-9.]+).*'/\1 \2/p\" ~/.cloudsim_aliases"
```

### One switch

```bash
SW_IP=10.253.0.1   # leaf-pod00-su0-r0 — from the alias file or Netris mgmtAddress
ssh -o BatchMode=yes "$JUMP" "ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  -o BatchMode=yes -o ConnectTimeout=8 cumulus@$SW_IP 'nv show interface'"
```
Quote the inner command in single quotes; for anything containing single
quotes (e.g. `vtysh -c '...'`) use `fanout.sh` below, which base64-encodes it.

### Many switches (a group, or all)

```bash
# <skill-dir>/scripts/fanout.sh <jump> '<command>' [name-regex]
scripts/fanout.sh "$JUMP" "nv show system"                       # every switch
scripts/fanout.sh "$JUMP" "sudo vtysh -c 'show bgp summary'" '^leaf-pod00'
scripts/fanout.sh "$JUMP" "nv config show -r applied -o commands" '^spine'
```
One SSH connection, switches queried 8-way parallel from the controller
(`FANOUT_PARALLEL=n` to change). Output is `===== name ip exit=N =====`
blocks in completion order — sort/group by name when presenting. Match groups
with the name regex or, better, with Netris `swRole`/`site` (pull names from
`/api/v2/hw`, then pass `'^(a|b|c)$'`).

An occasional switch failing with a connection reset under parallel load is
usually transient — retry just that one before reporting it as down.

## 3. Command cheat sheet (Cumulus Linux 5.x, NVUE)

All verified on the lab's switches.

| Want | Command |
|---|---|
| System / platform | `nv show system`, `nv show platform` |
| Interfaces | `nv show interface`, `sudo vtysh -c 'show interface brief'` |
| BGP sessions (per neighbour) | `sudo vtysh -c 'show bgp summary'` |
| BGP global settings | `nv show router bgp` |
| Routing table | `sudo vtysh -c 'show ip route'` (per VRF: `show ip route vrf <name>`) |
| VRFs | `nv show vrf`, `sudo vtysh -c 'show vrf'` |
| EVPN / VXLAN | `nv show evpn`, `nv show evpn vni`, `sudo vtysh -c 'show evpn vni'`, `nv show nve` |
| Bridge / MLAG / ACL / QoS / services | `nv show bridge`, `nv show mlag`, `nv show acl`, `nv show qos`, `nv show service` |
| Full applied config (flat `nv set` lines) | `nv config show -r applied -o commands` |
| Full config (JSON) | `nv config show -o json` |
| Config revision history | `nv config history` |
| Diff two revisions | `nv config diff <revA> <revB> -o commands` |

Gotchas:
- **Don't use `-o json` on composite `nv show` areas** (e.g. `nv show router`
  → "not supported for this resource"). Default table output works
  everywhere; use `-o json` only on config (`nv config show -o json`).
- `nv config history` lists revisions the switch has already **pruned** —
  diffing one returns `Unknown revision`. On-box history is not an audit
  trail; say so rather than reporting "no changes". `sudo ls /var/lib/nvue/meta`
  lists the revisions that are still fetchable.
- The Cumulus login banner goes to stderr; stdout is clean.
- Operational `vtysh` needs `sudo`; it's passwordless for `cumulus`.

## 4. Safety rules

- **Read-only.** `nv show`, `nv config show/history/diff`, `vtysh -c 'show ...'`,
  `ls`, `cat`, `ping` are fine. **Do not** run `nv set`, `nv unset`,
  `nv config apply/patch/replace/revert`, `systemctl restart`, `reboot`, edit
  files, or `POST/PUT/PATCH/DELETE` to Netris unless the user explicitly asks
  for that change on named devices — and then show the exact command and wait
  for a yes first. Switch config is normally owned by Netris; hand edits get
  overwritten and can break tenants.
- If a write is approved, prefer `nv config apply --confirm 10m` so it
  auto-reverts if the user loses access, and run it on one switch first.
- Fabric-wide commands hit every switch; state the scope you're about to run
  when it's `all`.
- Don't print credentials, `connect.sid` cookies, or switch passwords/keys.
- Report failures faithfully — unreachable devices, `exit != 0`, pruned
  revisions — instead of dropping them from the summary.

## 5. Presenting results

- Lead with the answer ("17/18 BGP sessions Established; `spine-1-pod00`
  has 2 neighbours in Active"), then a compact per-switch table, then raw
  output only if asked.
- Say which switches were queried and which failed.
- When comparing two switches, run the identical command on both and diff the
  outputs; call out meaningful differences, ignore timestamps/counters.

## 6. Known lab facts (verify — may drift)

- Netris manages two sites: **Datacenter-A** (the ~18 switches reachable from
  this controller: `leaf-pod00-*`, `spine-*-pod00`, `ns-*`) and **Egg**
  (`sw-egg-*`, mgmt on 172.16.7.x, **no route from this jump host** — expect
  timeouts; don't treat as failures of the lab).
- North-South switch `ns-leaf-0` = `10.3.0.1`; East-West leaf
  `leaf-pod00-su0-r0` = `10.253.0.1`. Use the alias file / Netris as the live
  source rather than trusting these.
- Reference implementation: this repo's `cli_inspector/` (`netris_client.py`,
  `executor.py`, `inventory.py`, `catalog.py`) does the same thing in Python.
