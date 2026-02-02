export const PYTHON_DAEMON_SCRIPT = `
import sys
import os
import json
import struct
import time
import glob
import re

# Event types
EV_SYN = 0x00
EV_KEY = 0x01
EV_ABS = 0x03

# Sync codes
SYN_REPORT = 0x00

# Key codes
BTN_TOUCH = 0x14a

# ABS codes
ABS_X = 0x00
ABS_Y = 0x01
ABS_MT_SLOT = 0x2f
ABS_MT_TRACKING_ID = 0x39
ABS_MT_POSITION_X = 0x35
ABS_MT_POSITION_Y = 0x36

# EVIOCGABS ioctl: _IOR('E', 0x40 + abs_code, struct input_absinfo)
# struct input_absinfo = 6 x __s32 = 24 bytes
# _IOR('E', N, 24) = (2 << 30) | (24 << 16) | (ord('E') << 8) | N
def EVIOCGABS(abs_code):
    return (2 << 30) | (24 << 16) | (ord('E') << 8) | (0x40 + abs_code)

def make_input_event(tv_sec, tv_usec, ev_type, code, value):
    return struct.pack('llHHi', tv_sec, tv_usec, ev_type, code, value)

def write_event(fd, ev_type, code, value):
    now = time.time()
    sec = int(now)
    usec = int((now - sec) * 1000000)
    os.write(fd, make_input_event(sec, usec, ev_type, code, value))

def syn_report(fd):
    write_event(fd, EV_SYN, SYN_REPORT, 0)

def touch_down(fd, slot, tracking_id, x, y):
    write_event(fd, EV_ABS, ABS_MT_SLOT, slot)
    write_event(fd, EV_ABS, ABS_MT_TRACKING_ID, tracking_id)
    write_event(fd, EV_ABS, ABS_MT_POSITION_X, x)
    write_event(fd, EV_ABS, ABS_MT_POSITION_Y, y)
    write_event(fd, EV_ABS, ABS_X, x)
    write_event(fd, EV_ABS, ABS_Y, y)
    write_event(fd, EV_KEY, BTN_TOUCH, 1)
    syn_report(fd)

def touch_move(fd, slot, x, y):
    write_event(fd, EV_ABS, ABS_MT_SLOT, slot)
    write_event(fd, EV_ABS, ABS_MT_POSITION_X, x)
    write_event(fd, EV_ABS, ABS_MT_POSITION_Y, y)
    write_event(fd, EV_ABS, ABS_X, x)
    write_event(fd, EV_ABS, ABS_Y, y)
    syn_report(fd)

def touch_up(fd, slot):
    write_event(fd, EV_ABS, ABS_MT_SLOT, slot)
    write_event(fd, EV_ABS, ABS_MT_TRACKING_ID, -1)
    write_event(fd, EV_KEY, BTN_TOUCH, 0)
    syn_report(fd)

def detect_screen_resolution():
    """Detect screen resolution from framebuffer or DRM."""
    # Try framebuffer first
    try:
        with open('/sys/class/graphics/fb0/virtual_size', 'r') as f:
            parts = f.read().strip().split(',')
            if len(parts) == 2:
                return int(parts[0]), int(parts[1])
    except Exception:
        pass

    # Try DRM
    try:
        import glob as g
        for mode_path in g.glob('/sys/class/drm/*/modes'):
            with open(mode_path, 'r') as f:
                line = f.readline().strip()
                if 'x' in line:
                    parts = line.split('x')
                    return int(parts[0]), int(parts[1])
    except Exception:
        pass

    return None, None

def find_touchscreen():
    """Find the physical touchscreen event device by scanning /proc/bus/input/devices."""
    try:
        with open('/proc/bus/input/devices', 'r') as f:
            content = f.read()
    except Exception:
        return None

    for block in content.split('\\n\\n'):
        lines = block.strip().split('\\n')
        name = ''
        handlers = ''
        props = ''
        evbits = ''
        absbits = ''
        for line in lines:
            if line.startswith('N: Name='):
                name = line.split('=', 1)[1].strip('"')
            elif line.startswith('H: Handlers='):
                handlers = line.split('=', 1)[1]
            elif line.startswith('B: PROP='):
                props = line.split('=', 1)[1]
            elif line.startswith('B: EV='):
                evbits = line.split('=', 1)[1]
            elif line.startswith('B: ABS='):
                absbits = line.split('=', 1)[1]

        # Skip virtual devices (mcp-remotetouch)
        if 'mcp-remotetouch' in name:
            continue

        # Check for INPUT_PROP_DIRECT (bit 1 in PROP)
        try:
            prop_val = int(props.strip(), 16)
        except (ValueError, IndexError):
            prop_val = 0
        if not (prop_val & 0x02):
            continue

        # Check that it has ABS_MT_POSITION_X (bit 0x35) in ABS bitmask
        try:
            abs_parts = absbits.strip().split()
            abs_val = 0
            for i, part in enumerate(reversed(abs_parts)):
                abs_val |= int(part, 16) << (i * 32)
        except (ValueError, IndexError):
            abs_val = 0
        if not (abs_val & (1 << ABS_MT_POSITION_X)):
            continue

        # Extract event device number
        m = re.search(r'event(\\d+)', handlers)
        if m:
            return '/dev/input/event' + m.group(1)

    return None

import fcntl

def get_abs_range(fd, abs_code):
    """Get the min/max range of an ABS axis using EVIOCGABS ioctl."""
    try:
        buf = bytearray(24)
        fcntl.ioctl(fd, EVIOCGABS(abs_code), buf)
        value, minimum, maximum, fuzz, flat, resolution = struct.unpack('6i', buf)
        return minimum, maximum
    except Exception:
        return None, None

def open_touch_device(screen_width, screen_height):
    """Open the physical touchscreen device for event injection."""
    dev_path = find_touchscreen()
    if dev_path is None:
        raise RuntimeError('No physical touchscreen device found')

    fd = os.open(dev_path, os.O_WRONLY)

    # Read the actual ABS ranges from the device
    rd_fd = os.open(dev_path, os.O_RDONLY)
    x_min, x_max = get_abs_range(rd_fd, ABS_MT_POSITION_X)
    y_min, y_max = get_abs_range(rd_fd, ABS_MT_POSITION_Y)
    os.close(rd_fd)

    if x_max is None or y_max is None:
        x_max = screen_width - 1
        y_max = screen_height - 1
        x_min = 0
        y_min = 0

    return fd, dev_path, x_min, x_max, y_min, y_max

def send_response(cmd_id, status, message=None, screen_width=None, screen_height=None):
    resp = {'id': cmd_id, 'status': status}
    if message is not None:
        resp['message'] = message
    if screen_width is not None:
        resp['screen_width'] = screen_width
    if screen_height is not None:
        resp['screen_height'] = screen_height
    sys.stdout.write(json.dumps(resp) + '\\n')
    sys.stdout.flush()

tracking_id_counter = 0

def next_tracking_id():
    global tracking_id_counter
    tracking_id_counter = (tracking_id_counter + 1) % 65536
    return tracking_id_counter

# Coordinate mapping globals
dev_x_min = 0
dev_x_max = 0
dev_y_min = 0
dev_y_max = 0
scr_w = 0
scr_h = 0

def map_x(x):
    """Map screen coordinate to device coordinate."""
    return dev_x_min + int(x * (dev_x_max - dev_x_min) / (scr_w - 1))

def map_y(y):
    """Map screen coordinate to device coordinate."""
    return dev_y_min + int(y * (dev_y_max - dev_y_min) / (scr_h - 1))

def handle_tap(fd, cmd):
    x = map_x(int(cmd['x']))
    y = map_y(int(cmd['y']))
    duration_ms = cmd.get('duration_ms', 50)
    tid = next_tracking_id()
    touch_down(fd, 0, tid, x, y)
    time.sleep(duration_ms / 1000.0)
    touch_up(fd, 0)

def handle_swipe(fd, cmd):
    x1 = int(cmd['x'])
    y1 = int(cmd['y'])
    x2 = int(cmd['x2'])
    y2 = int(cmd['y2'])
    duration_ms = cmd.get('duration_ms', 300)
    steps = cmd.get('steps', max(int(duration_ms / 15), 2))
    tid = next_tracking_id()

    touch_down(fd, 0, tid, map_x(x1), map_y(y1))
    for i in range(1, steps + 1):
        t = i / steps
        cx = int(x1 + (x2 - x1) * t)
        cy = int(y1 + (y2 - y1) * t)
        time.sleep(duration_ms / 1000.0 / steps)
        touch_move(fd, 0, map_x(cx), map_y(cy))
    touch_up(fd, 0)

def handle_long_press(fd, cmd):
    x = map_x(int(cmd['x']))
    y = map_y(int(cmd['y']))
    duration_ms = cmd.get('duration_ms', 800)
    tid = next_tracking_id()
    touch_down(fd, 0, tid, x, y)
    time.sleep(duration_ms / 1000.0)
    touch_up(fd, 0)

def handle_double_tap(fd, cmd):
    x = map_x(int(cmd['x']))
    y = map_y(int(cmd['y']))
    tid = next_tracking_id()
    touch_down(fd, 0, tid, x, y)
    time.sleep(0.05)
    touch_up(fd, 0)
    time.sleep(0.1)
    tid = next_tracking_id()
    touch_down(fd, 0, tid, x, y)
    time.sleep(0.05)
    touch_up(fd, 0)

def main():
    global dev_x_min, dev_x_max, dev_y_min, dev_y_max, scr_w, scr_h
    fd = None
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                cmd = json.loads(line)
            except json.JSONDecodeError as e:
                sys.stderr.write('Invalid JSON: ' + str(e) + '\\n')
                continue

            cmd_id = cmd.get('id', '?')
            cmd_type = cmd.get('type', '')

            try:
                if cmd_type == 'init':
                    scr_w = cmd.get('screen_width', 0)
                    scr_h = cmd.get('screen_height', 0)
                    if scr_w <= 0 or scr_h <= 0:
                        det_w, det_h = detect_screen_resolution()
                        if det_w and det_h:
                            scr_w = det_w
                            scr_h = det_h
                        else:
                            scr_w = scr_w or 800
                            scr_h = scr_h or 480
                    fd, dev_path, dev_x_min, dev_x_max, dev_y_min, dev_y_max = open_touch_device(scr_w, scr_h)
                    send_response(cmd_id, 'ready', 'injecting into ' + dev_path, scr_w, scr_h)
                elif cmd_type == 'shutdown':
                    send_response(cmd_id, 'ok', 'shutting down')
                    break
                elif fd is None:
                    send_response(cmd_id, 'error', 'device not initialized, send init first')
                elif cmd_type == 'tap':
                    handle_tap(fd, cmd)
                    send_response(cmd_id, 'ok')
                elif cmd_type == 'swipe':
                    handle_swipe(fd, cmd)
                    send_response(cmd_id, 'ok')
                elif cmd_type == 'long_press':
                    handle_long_press(fd, cmd)
                    send_response(cmd_id, 'ok')
                elif cmd_type == 'double_tap':
                    handle_double_tap(fd, cmd)
                    send_response(cmd_id, 'ok')
                else:
                    send_response(cmd_id, 'error', 'unknown command: ' + cmd_type)
            except PermissionError:
                send_response(cmd_id, 'error', 'Permission denied. Run with sudo or ensure user is in the input group: sudo usermod -aG input $USER')
            except Exception as e:
                send_response(cmd_id, 'error', str(e))
    finally:
        if fd is not None:
            try:
                os.close(fd)
            except Exception:
                pass

if __name__ == '__main__':
    main()
`;
