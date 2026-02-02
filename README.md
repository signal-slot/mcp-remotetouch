# mcp-remotetouch

An MCP server for remotely controlling a touchscreen on any Linux device over SSH.

Creates a virtual touch device via Linux `uinput` and injects tap, swipe, long press, and double tap events. **No installation required on the remote device** — the Python daemon is base64-encoded and sent as an SSH command argument, using only Python's standard library.

## Architecture

```
Dev Machine                              Remote Linux Device
┌──────────────────┐    SSH (persistent)  ┌──────────────────┐
│ MCP Server (TS)  │ ──────────────────> │ Python daemon    │
│ stdio transport   │    JSON-line proto  │ (stdlib only)     │
│                   │ <────────────────── │                  │
│ touch_tap         │                     │ /dev/uinput      │
│ touch_swipe       │                     │   ↓              │
│ touch_long_press  │                     │ Virtual touch    │
│ touch_double_tap  │                     │   ↓              │
│ touch_disconnect  │                     │ Linux Input      │
└──────────────────┘                     └──────────────────┘
```

## Prerequisites

### Dev Machine

- Node.js 18+
- SSH client

### Remote Device

- Any Linux device with a touchscreen (Raspberry Pi, SBC, embedded system, etc.)
- Python 3
- Access to `/dev/uinput`

Add the user to the `input` group on the remote device:

```bash
sudo usermod -aG input $USER
```

Re-login for the change to take effect.

## Installation

```bash
git clone https://github.com/signal-slot/mcp-remotetouch.git
cd mcp-remotetouch
npm install
npm run build
```

## Registering as an MCP Server

Add to Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "remotetouch": {
      "command": "node",
      "args": ["/path/to/mcp-remotetouch/build/index.js"],
      "env": {
        "REMOTETOUCH_SSH_HOST": "192.168.1.100",
        "REMOTETOUCH_SSH_USER": "pi",
        "REMOTETOUCH_SCREEN_WIDTH": "800",
        "REMOTETOUCH_SCREEN_HEIGHT": "480"
      }
    }
  }
}
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `REMOTETOUCH_SSH_HOST` | (required) | SSH host of the remote device |
| `REMOTETOUCH_SSH_USER` | `pi` | SSH username |
| `REMOTETOUCH_SSH_PORT` | `22` | SSH port |
| `REMOTETOUCH_SSH_KEY` | (none) | Path to SSH private key |
| `REMOTETOUCH_SCREEN_WIDTH` | `800` | Screen width in pixels |
| `REMOTETOUCH_SCREEN_HEIGHT` | `480` | Screen height in pixels |
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
| `screenWidth` | number? | Screen width in pixels |
| `screenHeight` | number? | Screen height in pixels |
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

### `touch_disconnect`

Disconnect a session and clean up the remote daemon.

| Parameter | Type | Description |
|---|---|---|
| `sessionId` | string | Session ID |

### `touch_list_sessions`

List all active sessions. No parameters.

## Usage

From Claude Desktop:

1. `touch_connect` to connect to the remote device
2. `touch_tap` to tap a coordinate on the screen
3. `touch_swipe` to scroll or swipe
4. `touch_disconnect` to end the session

## Troubleshooting

### Permission denied accessing /dev/uinput

The user on the remote device is not in the `input` group:

```bash
sudo usermod -aG input $USER
# Re-login for the change to take effect
```

Alternatively, set `REMOTETOUCH_USE_SUDO=true`.

### SSH connection fails

- Ensure SSH public key authentication is configured for the remote device (password authentication is not supported since the connection uses `BatchMode=yes`)
- Verify the hostname and port are correct

## License

MIT
