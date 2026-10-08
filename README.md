> **[WARNING] Demonstration Code Only**
> This repository contains unsupported demonstration code for architectural illustration. It is a **possible implementation pattern**, not an official Netris product or supported tool. Use at your own risk.

# Cumulus Switch CLI Inspector & Config Audit

Interactive CLI and web dashboard for exploring NVIDIA Cumulus switches, running live NVUE show commands, comparing configs, and tracking git revision history.

---

## 1. What This Is
A lightweight web application and CLI wrapper to inspect Cumulus Linux switches safely.
- Integrates with **NVIDIA Cumulus Linux**.
- Provides a fast, read-only dashboard to view interface status, BGP adjacencies, and EVPN routes.
- Tracks configuration changes over time via a local git repository cache.

---

## 2. How It Works (Under the Hood)

1. **Initialization:** The app reads target switches from `config.json`.
2. **Authentication:** Connects to the Cumulus switches via SSH/NVUE API.
3. **Execution:** Executes read-only commands (e.g., `nv show interface`, `nv show router bgp`) and parses the JSON output.
4. **Dashboard:** Renders the parsed output into a clean, searchable React frontend.
5. **Audit Trail:** Periodically pulls the `frr.conf` and `interfaces` files, committing them to a local git repo to track diffs.

---

## 3. How to Run It (Quickstart)

### Prerequisites
- Python 3.10+
- SSH access to Cumulus switches

### Steps
1. **Clone the repository:**
   ```bash
   git clone https://github.com/iamjarvs/netris-cli-inspector.git
   cd netris-cli-inspector
   ```
2. **Configure environment:**
   ```bash
   cp config.example.json config.json
   # Edit config.json with your switch IPs and credentials
   ```
3. **Start the tool:**
   ```bash
   ./start.sh
   ```
4. **Stop the tool:**
   ```bash
   ./stop.sh
   ```

---

## 4. How to Build Your Own Experience (For Developers)

- **`config.example.json`:** Core configuration.
- **`app/webserver.py`:** The FastAPI backend endpoints.
- **`app/cli_inspector/`:** The SSH/NVUE client wrappers.
- **`app/webapp/`:** The React frontend.

**Extending this code:**
To add a new dashboard widget for OSPF, simply add a new route in `app/webserver.py` that calls the corresponding `nv show router ospf` command via the client, and create a new React component in `app/webapp/` to render the JSON response.
