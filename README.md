# ⚓ Port Pilot

A fast CLI tool to discover and manage localhost ports. Ships with an interactive TUI inspired by modern AI CLIs.

## Install

```bash
npm install -g port-pilot
```

## Usage

### Interactive TUI (default)

```bash
port-pilot        # launches TUI
port-pilot ui     # explicit
```

### CLI Commands

```bash
port-pilot list             # table output
port-pilot list --json      # machine-readable JSON
port-pilot kill <port>      # kill process on port
port-pilot kill <port> -f   # force kill
port-pilot open <port>      # open localhost:port in browser
```

## TUI Keybindings

| Key | Action |
|-----|--------|
| `↑ / ↓` | Navigate |
| `/` | Search / filter by name or port |
| `s` | Cycle sort: port → memory → name |
| `o` | Open selected port in browser |
| `space` | Toggle multi-select |
| `k` | Kill selected (with confirmation) |
| `f` | Force kill selected |
| `r` | Manual refresh |
| `q` | Quit |

## Features

- **Split-panel layout** — process list + detail panel
- **Auto-refresh** every 3 seconds with flicker-free rendering
- **Search & filter** — type `/` then filter by port number, process, or project name
- **Sort toggle** — cycle between port, memory, and name
- **Multi-select** — `space` to select, then batch kill
- **System process protection** — blocks kills on `svchost`, `lsass`, etc.
- **Sensitive data redaction** — tokens/keys in CMD lines are masked
- **Open in browser** — quickly launch `localhost:<port>`
- **JSON output** — `port-pilot list --json` for scripting

## License

MIT
