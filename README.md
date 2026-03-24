<div align="center">

# ⚓ Port Pilot

**The smart, lightning-fast CLI & TUI for discovering and managing localhost ports.**

[![npm version](https://img.shields.io/npm/v/port-pilot?style=flat-square)](https://www.npmjs.com/package/port-pilot)
[![Node.js Version](https://img.shields.io/node/v/port-pilot?style=flat-square)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](http://makeapullrequest.com)

</div>

---

## 🚀 About Port Pilot

**Port Pilot** is a modern, developer-friendly developer tool that detects running processes on your localhost ports and lets you manage or terminate them effortlessly. It features an incredibly fast machine-readable CLI list output, and a stunning, terminal user interface (TUI) inspired by modern AI coding assistants.

Ever typed `lsof -i :3000`, scanned for the PID, and ran `kill -9`? **Never again.** 

Let Port Pilot do the heavy lifting in style. It securely maps open network ports back to the underlying node processes, containers, or native binaries, showing memory usage, absolute project paths, and allowing you to safely kill processes without breaking system stability.

## ✨ Features

- **Split-Panel TUI** — A gorgeous interactive UI featuring a process list and a detailed metadata panel.
- **Auto-Refresh** — Background polling that automatically reflects new or cleanly exited processes every 3 seconds (flicker-free).
- **Deep Process Introspection** — Extracts absolute file paths, memory usage (MB), and project root names associated with the ports.
- **Search & Filter** — Quickly isolate processes by pressing `/` and typing a port number, project name, or process label.
- **Sort Toggle** — Cycle sorts (port → memory → name) natively inside the TUI by pressing `s`.
- **System Protection** — Automatically protects Windows services and critical OS daemons (`svchost`, `lsass`, `System`) from accidental deletion.
- **Smart Security** — Redacts API keys, secrets, and auth tokens from process command lines before displaying them.
- **Quick Links** — Press `o` to instantly open the selected port in your default web browser!
- **Automation Ready** — Standard list commands optionally support `--json` for machine-readable output in CI/CD or scripts.

## 📦 Installation

Install globally via `npm` (requires Node.js `>= 18`):

```bash
npm install -g port-pilot
```

## 🛠️ Usage

### Interactive TUI

Just run the command to launch the dashboard:

```bash
port-pilot
# or explicitly:
port-pilot ui
```

#### TUI Keybindings
| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate processes |
| `/` | Search or filter by name/port |
| `s` | Cycle sort format (`port`, `memory`, `name`) |
| `o` | Open selected `localhost:port` in browser |
| `space`| Toggle multi-select (for batch killing) |
| `k` | Kill selected (prompts for confirmation) |
| `f` | Force kill selected (prompts for confirmation) |
| `r` | Manual refresh |
| `y` / `n` | Confirm / Cancel dialogs |
| `q` / `Esc`| Quit Port Pilot |

---

### Standard CLI Commands

If you just need a quick terminal output without the full TUI:

#### **List Ports**
```bash
port-pilot list
```
*Use `port-pilot list --json` to output a raw JSON array of processes and ports.*

#### **Kill a Port Directly**
```bash
port-pilot kill 3000
```
*Use `port-pilot kill 3000 -f` to force-kill without asking gracefully.*

#### **Open a Port in Browser**
```bash
port-pilot open 8080
```

## 🤝 Contributing

Contributions, issues, and feature requests are more than welcome! Feel free to check the [issues page](https://github.com/nijil71/port-fix/issues). 

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'feat: Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 License

Distributed under the MIT License. See `LICENSE` for more information.

---

<div align="center">
  Crafted with ❤️ for developers by <a href="https://github.com/nijil71">Nijil N M</a>.
</div>
