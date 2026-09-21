# cli-inspector — architecture plan

## Status: built and QA'd, 2026-09-16
Everything in this plan is implemented and verified live against the real lab
(not simulated data) — see the "How to run" section at the bottom. One design
decision changed from the original draft: SSH execution nests through the jump
host (`paramiko` → `exec_command` running a second `ssh` on `adam-ctl`) instead
of a laptop-side ProxyJump, so no key is ever distributed to a switch. Group
semantics also ended up sourced from Netris's own `swRole`/`site` fields rather
than hostname parsing, and the site picker probes real SSH reachability rather
than trusting Netris's static hardware inventory (this is why `Egg` shows as
unreachable despite Netris listing 52 switches for it — nothing there is
actually wired to this jump host's network).

## What this is
A read-focused CLI for exploring and auditing NVIDIA Cumulus Linux switches that
live behind the `adam-ctl` jump host: run show commands against one switch, a
group, or everything; compare two switches side by side; and inspect
configuration-change history with Juniper-style commit/diff/rollback visibility.

Scoped to Cumulus/NVUE for now, but the execution and inventory layers are kept
vendor-agnostic so another platform can be added later without a rewrite.

## Recon findings (from adam-ctl, 2026-09-16)

- **Jump host**: `ubuntu@adam-ctl.netris.io`, Ubuntu 24.04. Switch aliases live in
  `~/.cloudsim_aliases` (sourced from `.bashrc`), one `alias <name>='ssh -o
  StrictHostKeyChecking=no cumulus@<ip>'` line per switch. 18 real switches once
  `hgx-*` (GPU servers) and `mgmt-server`/`isp-server`/`ns-softgate-*` (non-Cumulus,
  all `root@`) are filtered out. **Filter rule: keep only aliases whose SSH user is
  `cumulus`** — that alone excludes everything that isn't a switch, no need to
  special-case `hgx` by name.
- **Auth**: every switch's `~/.ssh/authorized_keys` (checked on `leaf-pod00-su0-r0`)
  contains exactly one key — `adam-ctl`'s own `~/.ssh/id_rsa`. No agent is running
  on the jump host and there's no `~/.ssh/config` doing anything clever. A
  laptop-driven ProxyJump would need that same trust extended to the laptop's own
  key on every switch, which you'd rather avoid — so the execution layer instead
  nests SSH through the jump host (see "Execution layer" below) and never touches
  a switch's `authorized_keys` at all.
- **OS**: Cumulus Linux 5.15.1, full NVUE (`nv`) command set available.
- **`nv show <area> -o json`** works globally (`acl`, `bridge`, `evpn`, `interface`,
  `mlag`, `nve`, `platform`, `qos`, `router`, `service`, `system`, `vrf`,
  `maintenance`, `action`) — structured data, no screen-scraping needed for the
  explore/compare features.
- **`nv config`** has real primitives: `history`, `revision`, `diff [rev1] [rev2]
  -o {yaml,json,commands}`, `show -r <rev> -o commands`, `apply [rev]
  --confirm[=10m] -m "<message>"`, `patch`, `replace`, `revert` (revert not tested).
  `apply --confirm` is Cumulus's equivalent of Juniper's `commit confirmed` —
  worth surfacing later even though write-actions are out of scope for v1.
- **Important gap**: `nv config history` still *lists* old revision IDs, but two
  revisions from the previous day already errored `Unknown revision` when diffed.
  The switch prunes/garbage-collects revisions on its own schedule — **it is not a
  durable audit trail**. This is why the plan below adds an independent archive
  layer rather than trusting on-box history alone (matches your "git-backed
  archive" answer).
- Jump host has Python 3.12.3, git 2.43.0, 16 cores — plenty for orchestration if
  any part ever needs to run there instead of the laptop.

## Decisions already made (your answers)
- **Language**: Python.
- **Runs from**: your laptop — but see the revised execution model below.
  ProxyJump was the original idea, but it requires the laptop's own key to
  authenticate the *final* hop to every switch, which means distributing a key
  to 18 devices. You'd rather not do that, so the design now uses **command
  nesting through the jump host** instead: the laptop authenticates once to
  `adam-ctl` (with whatever access you already use to reach it), and the actual
  switch-facing SSH happens *from adam-ctl*, using the key it already has. No
  switch's `authorized_keys` is ever touched.
- **Long-term config history**: independent git-backed local archive, not just
  on-box `nv config history`.
- **Inventory**: auto-derived from the jump host's alias file, not a hand-maintained
  YAML.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ CLI (Typer)                                                  │
│  devices | show | run | compare | snapshot | config history  │
│                                          | config diff        │
└───────────────┬───────────────────────────────────┬─────────┘
                │                                    │
      ┌─────────▼─────────┐                ┌─────────▼─────────┐
      │ Inventory layer    │                │ Archive layer      │
      │ parse .cloudsim_   │                │ git repo per       │
      │ aliases → devices, │                │ snapshot, keyed by │
      │ infer role/pod tags│                │ device+timestamp   │
      └─────────┬──────────┘                └─────────┬──────────┘
                │                                       │
      ┌─────────▼─────────────────────────────────────▼─────────┐
      │ Execution layer                                          │
      │ ONE outer SSH connection laptop → adam-ctl (Control-      │
      │ Master/ControlPersist so it's reused across commands).    │
      │ Over that connection, pipe a small stateless Python       │
      │ "agent" script to `python3 -` on adam-ctl via stdin. The   │
      │ agent reads a JSON job list (device IPs + command),       │
      │ fans out `ssh cumulus@<ip> '<command>'` itself — from the  │
      │ jump host, using its own already-trusted key — with       │
      │ bounded concurrency (it has 16 cores and LAN latency to    │
      │ every switch), and streams back one NDJSON line per        │
      │ device. Nothing is installed or left behind on adam-ctl    │
      │ or on any switch.                                          │
      └───────────────────────────────────────────────────────────┘
```

### Why nest SSH through the jump host instead of ProxyJump
Every switch trusts exactly one key, and it lives only on `adam-ctl`. Rather than
extend that trust to the laptop (ProxyJump's requirement, and the thing you want
to avoid), the laptop treats `adam-ctl` as the execution point: it authenticates
once to the jump host — the same way you already do by hand — and asks the jump
host to do the switch-facing SSH itself. This is exactly the pattern used for all
the recon in this plan (`ssh ubuntu@adam-ctl.netris.io "ssh cumulus@<ip> '...'"`),
just generalized: instead of one nested command per call, the laptop sends a
whole batch of {device, command} jobs at once and the jump host fans them out in
parallel on its own LAN, which is also faster than the laptop opening N
individual double-hop connections over the internet one at a time.

Passing jobs as JSON (not interpolating command text into nested shell strings)
sidesteps the quoting/escaping mess that stacks up when you nest shells three
deep (laptop shell → ssh → remote bash → ssh → switch bash) — the agent builds
each `ssh` call as an argument list (`subprocess.run(["ssh", ..., f"cumulus@{ip}",
command], shell=False)`), so arbitrary `nv` command text can't break out of the
wrapper.

Because the agent is sent fresh over stdin on every invocation rather than
installed as a file, there's no version-skew between the CLI and the "remote"
code, and no persistent footprint on the jump host to clean up or worry about.

### Inventory & grouping
Parse `.cloudsim_aliases` for lines where the SSH target user is `cumulus`.
Two naming shapes observed, so two regexes feeding one tag model:
- `leaf-pod(\d+)-su(\d+)-r(\d+)` → role=leaf, pod, unit, rack
- `spine-(\d+)-pod(\d+)` → role=spine, index, pod
- `ns-(oob-)?leaf-(\d+)` / `ns-spine-(\d+)` → role, fabric=ns, oob flag
Anything that matches neither pattern still gets imported (role=unknown) rather
than dropped, so a naming-convention drift doesn't silently lose a device.
Groups (`leaf`, `spine`, `pod00`, `ns`, `all`) fall out of these tags automatically.

### Explore / show / compare (Phase 1)
- `inspector devices [--group leaf|spine|pod00|ns]` — list inventory + tags.
- `inspector show <target> <nv show args...>` — target is one device name, a
  group, or `all`; fans out concurrently, prints per-device, `-o json` parsed and
  pretty-printed where NVUE supports it, raw text otherwise.
- `inspector run <target> "<raw command>"` — escape hatch for anything not wrapped.
- `inspector compare <deviceA> <deviceB> <nv show args...>` — runs the same
  command on both, renders side-by-side columns, and a highlighted diff view for
  the JSON case (structural diff, not line diff, so key reordering doesn't show
  as noise).

### Config history & rollback inspection (Phase 2)
- `inspector snapshot [--group|--all]` — pulls `nv config show -r applied -o
  commands` per device (flat `nv set ...` lines — diffs beautifully like a
  Juniper `set` config) and commits it into a local archive repo only if it
  changed. One git repo (`~/.cli-inspector/archive/`), one file per device,
  commit message carries device, timestamp, and the on-box rev id/user/message
  from `nv config revision` when that's still available.
- `inspector config history <device>` — merges the archive's `git log` for that
  device's file with whatever `nv config history` still has on-box, so you get
  full history from the archive plus rich native metadata for anything recent
  enough to survive on-box GC.
- `inspector config diff <device> [<rev-or-commit-1> [<rev-or-commit-2>]]` —
  defaults to on-box `nv config diff` when both revisions are still resident;
  transparently falls back to `git diff` between two archive snapshots when the
  device has already pruned them. Same command, same output shape, regardless of
  which source served it.
- Rollback stays **read-only in v1**: the tool shows you exactly what a rollback
  would change (a diff), it doesn't push config. Actually applying a prior
  revision is a write action with real blast radius (wrong switch, wrong
  revision, mid-day production impact) — better done deliberately by hand with
  `nv config apply <rev> --confirm 10m -m "..."` using the diff the tool just
  showed you. A guided `inspector config rollback` write-path is a reasonable
  Phase 3 addition once the read-only tool has proven itself, gated behind an
  explicit `--apply` flag and NVUE's own `--confirm` safety timer.

## Phase 0 — bootstrap (do before writing any Python)
1. **No key distribution needed** — this was the point of moving to the nested
   execution model. Nothing to provision on switches, nothing to provision on
   the jump host either, since the agent is shipped over stdin each run.
2. Add one `Host adam-ctl` block to the laptop's own `~/.ssh/config` with
   `ControlMaster auto`, `ControlPersist 10m`, `ControlPath ~/.ssh/cm-%r@%h:%p` —
   so repeated CLI invocations in a session reuse one authenticated connection
   to the jump host instead of paying a fresh handshake every time.
3. **Already validated end-to-end** while writing this plan: a ~20-line agent
   script piped as `ssh ubuntu@adam-ctl.netris.io python3 - <json-jobs-arg>`
   successfully fanned a 2-device `nv show system -o json` job out concurrently
   (`ThreadPoolExecutor`) and returned clean NDJSON, e.g.:
   `{"name": "leaf-pod00-su0-r0", "ok": true, "stdout": "{...nv json...}",
   "stderr": "Welcome to NVIDIA Cumulus...\n"}`. One gotcha worth documenting so
   it isn't rediscovered later: **SSH joins all remote-command argv elements
   into a single string that the remote shell re-parses**, so the JSON job-list
   argument must be shell-quoted locally (`shlex.quote`) before being handed to
   `ssh`, or the remote shell mangles it on word boundaries. NVUE's login banner
   goes to stderr, not stdout, so stdout stays clean JSON — no banner-stripping
   needed.

## UX direction: match `switch-isolation-cli`
You pointed at `/Users/adam/.gemini/antigravity/scratch/netris-demo-tools/switch-isolation-cli`
as the interaction style to match. Read through it — this changes the CLI's shape:
- **`questionary`** for every menu: arrow-key `select`, type-to-filter (`use_search_filter=True`),
  `checkbox` for multi-device selection, with the same teal/cyan `custom_style` (qmark/pointer/
  highlighted in `#00d7af`, answers in `#00ffff`) for visual consistency with your other tool.
- **`rich`** for all output: `Panel`/`Table`/`Tree` for structured results, `console.status(...,
  spinner="dots")` while a fetch is in flight, `Progress` bars for multi-device fan-out.
- Same module split: a data layer (Netris API client, switch executor) completely separate from
  a `ui.py` render layer, orchestrated by a thin top-level menu loop — not a Typer
  argument-driven CLI as originally sketched. Scriptable non-interactive subcommands can still
  exist alongside the interactive menu for automation/CI use, but the interactive menu is the
  primary experience.
- Execution layer simplifies to match `switch_inspector.py`'s proven pattern: one `paramiko`
  `SSHClient` to `adam-ctl` (key-based, not the sibling tool's stored jump password — key auth
  already works for you), then `jump.exec_command()` per switch command, fanned out with a
  `ThreadPoolExecutor` for groups/all. Same nested-SSH-through-the-jump-host idea as the earlier
  stdin-agent design, just simpler and reusing an already-working pattern. Worth doing properly
  where the sibling tool cut a corner: `shlex.quote` the inner command before interpolating it
  into the nested `ssh ... "<cmd>"` string, since our commands come from free-form user input,
  not a fixed hardcoded string.

## Netris as the inventory/grouping source of truth
Answers the "group semantics" question directly, no hostname parsing needed:
- `GET /api/v2/hw` (paginate with `page`+`limit`, both required together) returns every
  hardware unit with `swRole` (`leaf`/`spine`/`generic`/`super-spine`), `site`, `tenant`, `nos`,
  `mainAddress`, and **`mgmtAddress` — confirmed to match the jump-host alias IPs exactly**
  (e.g. `leaf-pod00-su0-r0` → `mgmtAddress: 10.253.0.1`, same IP the alias uses). So Netris can
  be the single source of truth for both "what switches exist" and "how do I reach them,"
  making the alias-file parsing from Phase 0 optional/secondary rather than primary.
- **Scope surprise**: Netris currently manages **70 switches across two sites** — `Datacenter-A`
  (the 18 switches this jump host reaches: `leaf-pod00-*`, `spine-*-pod00`, `ns-*`) and `Egg`
  (52 more switches, `sw-egg-*`, on a `172.16.7.x` mgmt range this jump host has no route to at
  all). Open question below — is Egg in scope, and if so, is there a different jump host for it?
- Auth: `POST /api/auth` with `{"user","password"}` sets a `connect.sid` cookie session — no
  browser involved, this is plain API auth (validated live against `adam-ctl.netris.io`,
  note: **no `www.`** — that prefix doesn't resolve).

## Netris API log as a snapshot trigger — confirmed live, 2026-09-16
- `/api/eventlogs` returned HTTP 500 for every date format tried (plain dates, ISO, unix
  seconds) — either broken in this deployment or needs an undocumented param. Not reliable;
  don't build on it without more digging.
- `/api/apilogs` **works** and is a genuine audit trail: every API call with `method`, `url`,
  `user`, request `body`, and `createdAt`, filterable by HTTP method and paginated with
  `limit`/`offset` (not `page`) inside a JSON-encoded `pagination` param. This is the snapshot
  trigger.
- **Live-tested mechanism, confirmed with a real change**: pushed a server-cluster
  create/delete/create sequence via the Netris UI against `leaf-pod00-su0-r0` (baseline
  revision `2049`). Result:
  - **Netris does not push one atomic `nv config apply` per logical UI action.** A single burst
    of user activity produced **4 separate NVUE revisions over ~16 minutes**, each tied to one
    resource-level Netris API call (tear down `Vrf_72`, tear down `Vrf_34` + its ACLs, stand up
    `Vrf_73` with full EVPN/BGP config) — confirmed by diffing each revision pair
    (`nv config diff <rev> <rev>`) and matching the resulting `nv set`/`unset` commands against
    the API call bodies from the same window.
  - **Lag from API call to NVUE apply landing on the switch was consistently ~50–90 seconds**
    across all 4 events (e.g. the confirmed test: `POST /api/v2/server-cluster` "test" at
    10:06:29 UTC → revision `2946` applied at 10:07:53 UTC, 84s later).
  - **Only switches actually affected by the change get a new revision.** An earlier cluster
    create in the same session produced zero revisions on `leaf-pod00-su0-r0` — its servers
    aren't wired to this leaf, so Netris never touched its config. Snapshotting still needs to
    fan out to (at minimum) every device in the affected site, not just one target switch, since
    we can't cheaply predict from an API log body alone which switch(es) will be touched.
  - Confirms the earlier GC finding matters in practice, not just in theory: revision `2049`,
    only ~22 hours old at this point, was **already pruned** (`Unknown revision` on
    `nv config diff`) even though `nv config history` still listed it.

### Snapshot trigger design (final)
A single logical Netris change can span multiple revisions separated by minutes, so a fixed
"wait N seconds after one API call" trigger would risk snapshotting mid-burst. Use a
**debounced watcher** instead:
1. Poll `/api/apilogs` on a short interval (~15s), fetching only entries newer than the last
   poll (`createdAt` cursor), filtered to write methods on config-relevant paths (`hw`,
   `server-cluster`, `vnet`, `ebgp`, `acl`, `nat`, `ipam`, `link`, `ports`, `reservation`,
   `l4lb`) — excluding the observed UI noise (`/auth`, `topology/*`, `/graphite`,
   `/users/options`).
2. On any matching entry, mark the site "dirty" and reset a quiet-period timer (~2–3 minutes,
   tunable — long enough to cover the ~16-minute worst case we saw would need a higher bound in
   practice; start at 3 min and tune from real usage).
3. Once the quiet period elapses with no further matching entries, run
   `inspector snapshot --site <site>` (or `--all` if site resolution isn't wired up yet) once —
   this naturally collapses an entire burst of related revisions into one archive commit,
   matching how the user actually thinks about "the change I just made," while individual NVUE
   revisions remain available on-box for a short window if finer-grained forensic detail is
   needed.
4. Keep a coarse periodic full snapshot (e.g. every 30–60 min) as a safety net independent of
   apilogs — covers a manual CLI change made directly on a switch (bypassing Netris entirely) or
   any gap in the watcher itself.
5. This watcher is a long-running process (`inspector watch`, systemd unit or just left running
   in a terminal) — separate from the interactive menu CLI, though it shares the same archive
   and execution-layer code.

## Open questions
- ~~What is "the automation controller"?~~ **Answered: it's Netris.** Folded in
  above — snapshots should eventually correlate with `/api/apilogs` entries.
- ~~Group semantics~~ **Answered: pull `swRole`/`site`/`tenant` from Netris's
  own `/api/v2/hw`** rather than inventing tags — see above.
- ~~Is the `Egg` site in scope?~~ **Answered: no** — it has no real reachable
  hardware from this jump host, confirmed by a live SSH probe, not just an
  assumption. The site picker (CLI and web) shows it disabled with that reason
  rather than silently omitting it, in case that ever changes.
- ~~Snapshot cadence~~ **Answered: debounced `/api/apilogs` watcher, confirmed
  live** — see above.

## What got built
1. **Interactive CLI** (`cli_inspector/`, entry point `main.py`) — questionary
   + rich, matching the `switch-isolation-cli` sibling tool's style. Site
   picker, device/group/all-device show commands, two-device compare with
   structural diff, on-box NVUE history, and the full archive workflow
   (snapshot/history/diff).
2. **Watcher daemon** (`cli_inspector/watcher.py`, entry point `watch.py`) —
   debounced `/api/apilogs` polling that collapses a burst of related NVUE
   revisions into one archive commit per device, plus a periodic safety-net
   snapshot. Long-running; run it in its own terminal or as a systemd unit.
3. **Web dashboard** (`cli_inspector/webserver.py` + `webapp/`) — Flask REST
   API over the same inventory/executor/archive modules, and a React/Tailwind
   SPA (TailAdmin v2 shell, Coral palette) with Devices/Explore/Compare/History
   pages. Shares the same archive as the CLI — a snapshot taken from one shows
   up in the other's history immediately.

All three were exercised against the real lab (not mocked): real switches,
real Netris API, real git commits. One real bug was found and fixed by
actually clicking through the dashboard rather than just reading the code — a
React duplicate-key warning on the on-box history table, since `nv config
history` can legitimately list `"startup"` as a rev_id more than once.

## How to run
- **Interactive CLI**: `./run.sh` (or `.venv/bin/python main.py`).
- **Watcher**: `.venv/bin/python watch.py` — leave running in its own
  terminal/session.
- **Web dashboard**: in one terminal, `.venv/bin/python webserver.py` (Flask,
  port 8743); in another, `cd webapp && npm run dev` (Vite, port 5173, proxies
  `/api` to the Flask server). Open `http://localhost:5173`.
- All three read the same `config.json` (copy `config.example.json`, fill in
  your Netris password) and the same archive at `archive_dir`
  (`~/.cli-inspector/archive` by default) — a real one already exists there
  from this session's testing, seeded with all 18 Datacenter-A switches.

## Not built (deliberately out of scope for this pass)
- **Write-path rollback** (actually applying a prior revision) — the tool
  shows you the diff, applying it back is still a deliberate manual
  `nv config apply <rev> --confirm` step. Revisit once the read-only tool has
  been in daily use for a while.
- **Multi-site support beyond the reachability check** — if `Egg` (or a future
  site) ever becomes reachable, the picker will pick it up automatically, but
  nothing has been tested against a second reachable site.
