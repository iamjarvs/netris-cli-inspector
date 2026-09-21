"""Rich-based rendering. No questionary here — this module only draws things,
menu.py decides when and what to ask the user.
"""

from __future__ import annotations

import difflib
import json
from typing import Optional

from rich import box
from rich.columns import Columns
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from .diff_utils import dumps_relaxed
from rich.text import Text

console = Console()


def print_banner(subtitle: Optional[str] = None, clear: bool = True) -> None:
    if clear:
        console.clear()
    banner = Text()
    banner.append("⚡ CLI INSPECTOR\n", style="bold cyan")
    banner.append("Cumulus / NVUE switch exploration & config history\n", style="italic white")
    if subtitle:
        banner.append(subtitle, style="dim")
    console.print(Panel(banner, border_style="cyan", box=box.ROUNDED, padding=(1, 2)))


def render_error(message: str) -> None:
    console.print(Panel(f"[bold red]{message}[/bold red]", border_style="red", title="Error"))


def render_sites(sites) -> None:
    table = Table(title="Netris Sites", box=box.ROUNDED)
    table.add_column("Site", style="cyan", no_wrap=True)
    table.add_column("Hardware Reachable?", style="white")
    for site in sites:
        status = "[green]yes[/green]" if site.has_hardware else "[dim]no[/dim]"
        table.add_row(site.name, status)
    console.print(table)


def render_device_table(devices, title: str = "Devices") -> None:
    table = Table(title=title, box=box.ROUNDED)
    table.add_column("Name", style="cyan", no_wrap=True)
    table.add_column("Role", style="magenta")
    table.add_column("Site", style="white")
    table.add_column("Mgmt IP", style="yellow")
    table.add_column("Status", style="green")
    for d in devices:
        status_style = "green" if d.status == "ok" else "red"
        table.add_row(d.name, d.role, d.site_name, d.mgmt_address, f"[{status_style}]{d.status}[/{status_style}]")
    console.print(table)


def _pretty(text: str) -> tuple[str, bool]:
    try:
        parsed = json.loads(text)
        return dumps_relaxed(parsed), True
    except (json.JSONDecodeError, TypeError):
        return text, False


def render_show_result(device: str, result) -> None:
    if not result.ok:
        body = result.error or result.stderr or "(no output)"
        console.print(Panel(body.strip(), title=f"[bold red]{device} — failed[/bold red]", border_style="red"))
        return
    pretty, _ = _pretty(result.stdout)
    console.print(Panel(pretty.strip() or "(empty)", title=f"[bold cyan]{device}[/bold cyan]", border_style="cyan"))


def render_show_results_many(results: dict) -> None:
    for device, result in results.items():
        render_show_result(device, result)


def to_display_text(raw: str) -> str:
    pretty, _ = _pretty(raw)
    return pretty


def render_compare_panels(device_a: str, result_a, device_b: str, result_b) -> None:
    def panel_for(device, result):
        if not result.ok:
            body = result.error or result.stderr or "(no output)"
            return Panel(body.strip(), title=f"[bold red]{device}[/bold red]", border_style="red", width=60)
        pretty, _ = _pretty(result.stdout)
        return Panel(pretty.strip() or "(empty)", title=f"[bold cyan]{device}[/bold cyan]", border_style="cyan", width=60)

    console.print(Columns([panel_for(device_a, result_a), panel_for(device_b, result_b)]))


def render_compare(device_a: str, result_a, device_b: str, result_b) -> None:
    render_compare_panels(device_a, result_a, device_b, result_b)
    if result_a.ok and result_b.ok:
        text_a, text_b = to_display_text(result_a.stdout), to_display_text(result_b.stdout)
        diff_lines = list(
            difflib.unified_diff(
                text_a.splitlines(), text_b.splitlines(), fromfile=device_a, tofile=device_b, lineterm=""
            )
        )
        if not diff_lines:
            console.print(Panel("[green]No differences.[/green]", title="Diff", border_style="green"))
        else:
            render_diff_text("\n".join(diff_lines), title=f"Diff: {device_a} vs {device_b}")


def render_diff_text(diff_text: str, title: str = "Diff") -> None:
    if not diff_text.strip():
        console.print(Panel("[dim]No changes.[/dim]", title=title, border_style="dim"))
        return
    text = Text()
    for line in diff_text.splitlines():
        if line.startswith("+++") or line.startswith("---"):
            text.append(line + "\n", style="bold white")
        elif line.startswith("@@"):
            text.append(line + "\n", style="bold yellow")
        elif line.startswith("+"):
            text.append(line + "\n", style="green")
        elif line.startswith("-"):
            text.append(line + "\n", style="red")
        else:
            text.append(line + "\n", style="dim")
    console.print(Panel(text, title=title, border_style="cyan", box=box.ROUNDED))


def render_config_revisions(device: str, revisions, limit: int = 15, pruned_ids: set[str] | None = None) -> None:
    table = Table(title=f"On-box NVUE revision history: {device}", box=box.ROUNDED)
    table.add_column("Rev ID", style="cyan")
    table.add_column("Apply Date", style="white")
    table.add_column("Type", style="magenta")
    table.add_column("User", style="yellow")
    table.add_column("Message", style="dim")
    if pruned_ids is not None:
        table.add_column("Status", style="white")
    for rev in revisions[:limit]:
        row = [rev.rev_id, rev.apply_date, rev.rev_type, rev.user, rev.message]
        if pruned_ids is not None:
            row.append("[red]pruned[/red]" if rev.rev_id in pruned_ids else "[green]live[/green]")
        table.add_row(*row)
    console.print(table)


def render_archive_history(device: str, entries) -> None:
    table = Table(title=f"Archive snapshot history: {device}", box=box.ROUNDED)
    table.add_column("Commit", style="cyan", no_wrap=True)
    table.add_column("Date", style="white")
    table.add_column("Subject", style="yellow")
    if not entries:
        console.print(Panel(f"[dim]No archive snapshots yet for {device}.[/dim]", border_style="dim"))
        return
    for entry in entries:
        table.add_row(entry["commit"][:10], entry["date"], entry["subject"])
    console.print(table)


def render_snapshot_result(device: str, committed: bool) -> None:
    if committed:
        console.print(f"[bold green]✔[/bold green] {device}: snapshot committed (config changed).")
    else:
        console.print(f"[dim]· {device}: no change since last snapshot.[/dim]")


def render_side_by_side_diff(rows: list[dict], title: str = "Diff", left_label: str = "Before", right_label: str = "After") -> None:
    if not rows or all(r["type"] == "equal" for r in rows):
        console.print(Panel("[dim]No differences.[/dim]", title=title, border_style="dim"))
        return
    table = Table(title=title, box=box.ROUNDED, show_lines=False, pad_edge=False)
    table.add_column(left_label, style="white", overflow="fold", ratio=1)
    table.add_column(right_label, style="white", overflow="fold", ratio=1)
    for row in rows:
        left = row["left"] or ""
        right = row["right"] or ""
        if row["type"] == "equal":
            table.add_row(f"[dim]{left}[/dim]", f"[dim]{right}[/dim]")
        elif row["type"] == "delete":
            table.add_row(f"[red]{left}[/red]", "")
        elif row["type"] == "insert":
            table.add_row("", f"[green]{right}[/green]")
        else:
            table.add_row(f"[red]{left}[/red]", f"[green]{right}[/green]")
    console.print(table)


def render_nv_command_diff(text: str, title: str = "Config diff (nv set/unset)") -> None:
    if not text.strip():
        console.print(Panel("[dim]No differences between these revisions.[/dim]", title=title, border_style="dim"))
        return
    body = Text()
    for line in text.splitlines():
        if line.startswith("nv unset"):
            body.append(line + "\n", style="red")
        elif line.startswith("nv set"):
            body.append(line + "\n", style="green")
        else:
            body.append(line + "\n", style="dim")
    console.print(Panel(body, title=title, border_style="cyan", box=box.ROUNDED))


def render_full_text(title: str, text: str) -> None:
    console.print(Panel(text.strip() or "(empty)", title=title, border_style="cyan", box=box.ROUNDED))


def render_saved_diffs(items: list[dict]) -> None:
    if not items:
        console.print(Panel("[dim]No saved diffs yet.[/dim]", border_style="dim"))
        return
    table = Table(title="Saved diffs", box=box.ROUNDED)
    table.add_column("Label", style="cyan")
    table.add_column("Device", style="white")
    table.add_column("Saved", style="dim")
    table.add_column("A", style="yellow")
    table.add_column("B", style="yellow")
    for item in items:
        table.add_row(item["label"], item["device"], item["timestamp"], item["source_a"], item["source_b"])
    console.print(table)


def render_revision_status(statuses: dict) -> None:
    table = Table(title="NVUE_MAX_REVISIONS (retention setting)", box=box.ROUNDED)
    table.add_column("Device", style="cyan", no_wrap=True)
    table.add_column("Configured (file)", style="white")
    table.add_column("Running (live)", style="white")
    table.add_column("Service", style="white")
    for device, s in statuses.items():
        if not s.ok:
            table.add_row(device, "[red]error[/red]", "[red]error[/red]", f"[red]{s.error}[/red]")
            continue
        mismatch = s.configured != s.running
        running_style = "yellow" if mismatch else "white"
        note = "  [dim](restart pending)[/dim]" if mismatch else ""
        table.add_row(
            device,
            str(s.configured),
            f"[{running_style}]{s.running}[/{running_style}]{note}",
            "[green]active[/green]" if s.service_active else "[red]inactive[/red]",
        )
    console.print(table)


def render_revision_apply_results(results: dict) -> None:
    table = Table(title="Apply results", box=box.ROUNDED)
    table.add_column("Device", style="cyan", no_wrap=True)
    table.add_column("Previous → Requested", style="white")
    table.add_column("Verified running", style="white")
    table.add_column("Service", style="white")
    table.add_column("Status", style="white")
    ok_count = 0
    for device, r in results.items():
        if r.ok:
            ok_count += 1
        table.add_row(
            device,
            f"{r.previous} → {r.requested}" if r.previous is not None else f"— → {r.requested}",
            str(r.verified) if r.verified is not None else "—",
            "[green]active[/green]" if r.service_active else "[red]inactive[/red]",
            "[bold green]✔ success[/bold green]" if r.ok else f"[bold red]✘ {r.error}[/bold red]",
        )
    console.print(table)
    console.print(f"\n[bold]{ok_count}[/bold] / {len(results)} succeeded.")


def render_snapshot_summary(results: dict) -> None:
    changed = [d for d, c in results.items() if c]
    unchanged = [d for d, c in results.items() if not c]
    console.print(f"\n[bold]{len(changed)}[/bold] changed, [dim]{len(unchanged)}[/dim] unchanged, out of {len(results)} devices.")


# -- Switch Isolation & Assurance UI -------------------------------------------

def render_vpc_list(vpcs: list[dict]) -> None:
    table = Table(title="Available VPCs", box=box.ROUNDED)
    table.add_column("ID", style="cyan", justify="right")
    table.add_column("VPC Name", style="bold white")
    table.add_column("Tenant", style="magenta")
    table.add_column("Servers", justify="right", style="yellow")
    table.add_column("Cluster", style="green")
    for v in vpcs:
        clusters = ", ".join(c["name"] for c in v.get("clusters", [])) or "(none)"
        table.add_row(
            str(v["id"]),
            v["name"],
            v.get("tenant") or "default",
            str(v.get("server_count", 0)),
            clusters,
        )
    console.print(table)


def render_isolation_topology(topo: dict) -> None:
    table = Table(title=f"Physical Fabric Attachment — VPC {topo['vpc_id']}", box=box.ROUNDED)
    table.add_column("Compute Server", style="bold cyan")
    table.add_column("Host Port", style="white")
    table.add_column("Switch", style="magenta")
    table.add_column("Switch Port", style="yellow")
    table.add_column("Fabric Plane", style="green")

    server_links = topo.get("server_links", {})
    if not server_links:
        console.print("[yellow]No physical switch links found for this VPC.[/yellow]")
        return

    for server, links in server_links.items():
        if not links:
            table.add_row(server, "—", "—", "—", "[dim]No active links[/dim]")
        for l in links:
            table.add_row(
                server,
                l.get("host_port", ""),
                l.get("switch_name", ""),
                l.get("switch_port", ""),
                l.get("fabric_role", ""),
            )
    console.print(table)


def render_isolation_evidence(evidence: dict) -> None:
    target_vrf = evidence.get("target_vrf", "")

    # North-South EVPN VNIs
    ns = evidence.get("ns_switch", {})
    ns_table = Table(title=f"North-South Leaf ({ns.get('name', 'ns-leaf-0')}) — EVPN VNI Table", box=box.ROUNDED)
    ns_table.add_column("VNI", style="cyan", justify="right")
    ns_table.add_column("Type", style="white")
    ns_table.add_column("Interface", style="yellow")
    ns_table.add_column("Tenant VRF", style="bold")
    ns_table.add_column("VLAN", style="white")
    ns_table.add_column("Isolation Status", style="bold")

    for v in ns.get("vnis", []):
        is_target = v.get("is_target_vpc", False)
        status_text = "[bold green]✔ Dedicated Tenant VNI[/bold green]" if is_target else "[dim]Other Tenant[/dim]"
        vrf_style = "bold green" if is_target else "dim"
        ns_table.add_row(
            str(v.get("vni", "")),
            v.get("type", ""),
            v.get("interface", ""),
            f"[{vrf_style}]{v.get('tenant_vrf', '')}[/{vrf_style}]",
            str(v.get("vlan", "")),
            status_text,
        )
    console.print(ns_table)
    console.print()

    # East-West Pure VRF Routes
    ew = evidence.get("ew_switch", {})
    ew_table = Table(title=f"East-West Leaf ({ew.get('name', 'leaf-pod00-su0-r0')}) — FIB Routing ({target_vrf})", box=box.ROUNDED)
    ew_table.add_column("Code", style="white")
    ew_table.add_column("Subnet Prefix", style="bold cyan")
    ew_table.add_column("Next Hop", style="yellow")
    ew_table.add_column("VRF Domain", style="green")

    routes = ew.get("routes", [])
    if routes:
        for r in routes[:20]:  # Show top 20 routes
            ew_table.add_row(
                r.get("code", ""),
                r.get("prefix", ""),
                r.get("via", "kernel"),
                target_vrf,
            )
        if len(routes) > 20:
            ew_table.add_row("...", f"[dim]+{len(routes) - 20} more routes[/dim]", "...", target_vrf)
        console.print(ew_table)
    else:
        console.print(Panel("[yellow]No active VRF routes found on East-West switch.[/yellow]", border_style="yellow"))


def render_ping_results(res: dict) -> None:
    table = Table(title=f"Cluster Ping: {res['source']} ➔ {res['target']}", box=box.ROUNDED)
    table.add_column("Target Interface", style="cyan")
    table.add_column("IP Address", style="yellow")
    table.add_column("Ping Status", style="bold")

    for r in res.get("ew_rails", []):
        status_color = "green" if r["status"] == "OK" else "red"
        table.add_row(f"RoCE {r['rail']}", r["ip"], f"[{status_color}]{r['status']}[/{status_color}]")

    ns = res.get("ns_bond", {})
    ns_color = "green" if ns.get("status") == "OK" else "red"
    table.add_row("North-South bond0", ns.get("ip", ""), f"[{ns_color}]{ns.get('status', 'FAIL')}[/{ns_color}]")

    ipmi = res.get("ipmi", {})
    ipmi_color = "green" if ipmi.get("status") == "OK" else "red"
    table.add_row("IPMI / BMC eth11", ipmi.get("ip", ""), f"[{ipmi_color}]{ipmi.get('status', 'FAIL')}[/{ipmi_color}]")

    console.print(table)
