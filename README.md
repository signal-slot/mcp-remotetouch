# mcp-remotetouch

An MCP server for remotely controlling a touchscreen on any Linux device over SSH.

Injects tap, swipe, long press, double tap, and keyboard events directly into the device. The daemon auto-detects the touchscreen and screen resolution. Keyboard input is injected via a virtual keyboard device created through `/dev/uinput`. **No installation required on the remote device** — the Python daemon is sent via stdin over SSH, using only Python's standard library.

## Architecture

### Stdio mode (default)

```
Dev Machine                              Remote Linux Device
┌──────────────────┐    SSH (persistent)  ┌──────────────────┐
│ MCP Server (TS)  │ ──────────────────> │ Python daemon    │
│ stdio transport   │    JSON-line proto  │ (stdlib only)     │
│                   │ <────────────────── │                  │
│ touch_tap         │                     │ Auto-detect      │
│ touch_swipe       │                     │ touchscreen      │
│ touch_long_press  │                     │   ↓              │
│ touch_double_tap  │                     │ /dev/input/eventN│
│ key_press         │                     │   ↓              │
│ key_type          │                     │ /dev/uinput (kbd)│
│ touch_disconnect  │                     │   ↓              │
│                   │                     │ Linux Input      │
└──────────────────┘                     └──────────────────┘
```

The daemon scans `/proc/bus/input/devices` to find the physical touchscreen (by checking `INPUT_PROP_DIRECT` and `ABS_MT_POSITION_X`), then injects events directly into it. This works reliably with containerized compositors (e.g., Torizon with Qt EGLFS) where virtual uinput devices may not be detected.

### HTTP server mode (`--server`)

```
AI Agent (remote) ──HTTP/SSE──> Express + StreamableHTTPServerTransport
                                         │
                                   McpServer (per MCP session)
                                         │
                                SshTouchSessionManager (shared)
                                         │
                                   SSH ──> Linux Device
```

## Prerequisites

### Dev Machine

- Node.js 18+
- SSH client

### Remote Device

- Any Linux device with a touchscreen (Raspberry Pi, SBC, embedded system, etc.)
- Python 3
- Read/write access to `/dev/input/eventN` (the touchscreen device)
- Write access to `/dev/uinput` (for keyboard input — optional, touch works without it)

Add the user to the `input` group on the remote device:

```bash
sudo usermod -aG input $USER
```

Re-login for the change to take effect. Alternatively, use the `useSudo` option.

## Installation

```bash
npm install -g mcp-remotetouch
```

Or run directly with `npx`:

```bash
npx mcp-remotetouch
```

## Usage

Add to your MCP client configuration (e.g. Claude Desktop's `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "remotetouch": {
      "command": "npx",
      "args": ["mcp-remotetouch"],
      "env": {}
    }
  }
}
```

Screen resolution is auto-detected from the device. You can override it with `REMOTETOUCH_SCREEN_WIDTH` and `REMOTETOUCH_SCREEN_HEIGHT` if needed.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `REMOTETOUCH_SSH_HOST` | (none) | SSH host of the remote device |
| `REMOTETOUCH_SSH_USER` | `pi` | SSH username |
| `REMOTETOUCH_SSH_PORT` | `22` | SSH port |
| `REMOTETOUCH_SSH_KEY` | (none) | Path to SSH private key |
| `REMOTETOUCH_SCREEN_WIDTH` | auto-detected | Screen width in pixels |
| `REMOTETOUCH_SCREEN_HEIGHT` | auto-detected | Screen height in pixels |
| `REMOTETOUCH_USE_SUDO` | `false` | Run daemon with sudo |

## Tools

### `touch_connect`

Connect to a remote Linux device via SSH and start the touch daemon. Returns a session ID.

| Parameter | Type | Description |
|---|---|---|
| `host` | string? | SSH host |
| `user` | string? | SSH username |
| `port` | number? | SSH port |
| `sshKey` | string? | Path to SSH private key |
| `screenWidth` | number? | Screen width (auto-detected if omitted) |
| `screenHeight` | number? | Screen height (auto-detected if omitted) |
| `useSudo` | boolean? | Run with sudo |

### `touch_tap`

Tap at the given coordinates.

| Parameter | Type | Description |
|---|---|---|
| `sessionId` | string | Session ID |
| `x` | number | X coordinate |
| `y` | number | Y coordinate |
| `duration_ms` | number? | Tap duration (default: 50ms) |

### `touch_swipe`

Swipe from (x1, y1) to (x2, y2).

| Parameter | Type | Description |
|---|---|---|
| `sessionId` | string | Session ID |
| `x1` | number | Start X coordinate |
| `y1` | number | Start Y coordinate |
| `x2` | number | End X coordinate |
| `y2` | number | End Y coordinate |
| `duration_ms` | number? | Swipe duration (default: 300ms) |
| `steps` | number? | Number of interpolation steps |

### `touch_long_press`

Long press at the given coordinates.

| Parameter | Type | Description |
|---|---|---|
| `sessionId` | string | Session ID |
| `x` | number | X coordinate |
| `y` | number | Y coordinate |
| `duration_ms` | number? | Press duration (default: 800ms) |

### `touch_double_tap`

Double tap at the given coordinates.

| Parameter | Type | Description |
|---|---|---|
| `sessionId` | string | Session ID |
| `x` | number | X coordinate |
| `y` | number | Y coordinate |

### `key_press`

Press a key with optional modifier keys. Requires `/dev/uinput` access on the remote device.

| Parameter | Type | Description |
|---|---|---|
| `sessionId` | string | Session ID |
| `key` | string | Key name (e.g. `enter`, `a`, `tab`, `f1`, `up`, `space`) |
| `modifiers` | string[]? | Modifier keys to hold (e.g. `["ctrl"]`, `["ctrl", "shift"]`) |

### `key_type`

Type a string of text by simulating individual key presses. Requires `/dev/uinput` access on the remote device.

| Parameter | Type | Description |
|---|---|---|
| `sessionId` | string | Session ID |
| `text` | string | Text to type (e.g. `Hello, World!`) |

### `touch_disconnect`

Disconnect a session and clean up the remote daemon.

| Parameter | Type | Description |
|---|---|---|
| `sessionId` | string | Session ID |

### `touch_list_sessions`

List all active sessions. No parameters.

## HTTP Server Mode

Instead of running as a stdio MCP server, you can run `mcp-remotetouch` as an HTTP server that AI agents can connect to remotely over HTTP.

### Starting the server

```bash
# Default: listen on 0.0.0.0:3000
npx mcp-remotetouch --server

# Custom port and host
npx mcp-remotetouch --server --port 8080 --host 127.0.0.1
```

### CLI arguments

| Argument | Default | Description |
|---|---|---|
| `--server` | (off) | Enable HTTP server mode |
| `--port <N>` | `3000` (or `REMOTETOUCH_PORT` env) | HTTP listen port |
| `--host <addr>` | `0.0.0.0` | Bind address |

Without `--server`, the process runs in stdio mode (the default, backward-compatible behavior).

## Workflow

A typical session from Claude Desktop:


1. `touch_connect` — connect to the remote device
2. `touch_tap` / `touch_swipe` / `touch_long_press` / `touch_double_tap` — interact with the screen
3. `key_press` / `key_type` — send keyboard input
4. `touch_disconnect` — end the session

## Troubleshooting

### Permission denied

The user on the remote device needs access to `/dev/input/eventN`. Either:

- Add the user to the `input` group: `sudo usermod -aG input $USER` (re-login required)
- Or set `REMOTETOUCH_USE_SUDO=true`

### No physical touchscreen device found

The daemon could not find a touchscreen in `/proc/bus/input/devices`. Verify:

- The device has a touchscreen connected and its driver is loaded
- The device shows `INPUT_PROP_DIRECT` and has `ABS_MT_POSITION_X` capability

### Keyboard input not available

The `key_press` and `key_type` tools require write access to `/dev/uinput`. If keyboard is reported as unavailable:

- Add a udev rule to grant access:
  ```bash
  echo 'KERNEL=="uinput", GROUP="input", MODE="0660"' | sudo tee /etc/udev/rules.d/99-uinput.rules
  sudo udevadm control --reload-rules && sudo udevadm trigger
  ```
- Ensure the user is in the `input` group: `sudo usermod -aG input $USER` (re-login required)
- Or set `REMOTETOUCH_USE_SUDO=true`

Touch tools continue to work even if `/dev/uinput` is not accessible.

### SSH connection fails

- Ensure SSH public key authentication is configured for the remote device (password authentication is not supported since the connection uses `BatchMode=yes`)
- Verify the hostname and port are correct

## License

MIT
