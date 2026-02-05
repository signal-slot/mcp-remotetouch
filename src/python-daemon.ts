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

# uinput constants
UI_SET_EVBIT  = 0x40045564
UI_SET_KEYBIT = 0x40045565
UI_DEV_CREATE = 0x5501
UI_DEV_DESTROY = 0x5502
EV_REP = 0x14

# Key code mapping: key name -> Linux keycode
KEY_MAP = {
    'a': 30, 'b': 48, 'c': 46, 'd': 32, 'e': 18, 'f': 33, 'g': 34, 'h': 35,
    'i': 23, 'j': 36, 'k': 37, 'l': 38, 'm': 50, 'n': 49, 'o': 24, 'p': 25,
    'q': 16, 'r': 19, 's': 31, 't': 20, 'u': 22, 'v': 47, 'w': 17, 'x': 45,
    'y': 21, 'z': 44,
    '1': 2, '2': 3, '3': 4, '4': 5, '5': 6, '6': 7, '7': 8, '8': 9, '9': 10, '0': 11,
    'enter': 28, 'tab': 15, 'space': 57, 'backspace': 14, 'escape': 1, 'delete': 111,
    'up': 103, 'down': 108, 'left': 105, 'right': 106,
    'home': 102, 'end': 107, 'pageup': 104, 'pagedown': 109, 'insert': 110,
    'ctrl': 29, 'shift': 42, 'alt': 56, 'meta': 125,
    'ctrl_r': 97, 'shift_r': 54, 'alt_r': 100,
    'f1': 59, 'f2': 60, 'f3': 61, 'f4': 62, 'f5': 63, 'f6': 64,
    'f7': 65, 'f8': 66, 'f9': 67, 'f10': 68, 'f11': 87, 'f12': 88,
    'minus': 12, 'equal': 13, 'leftbrace': 26, 'rightbrace': 27,
    'semicolon': 39, 'apostrophe': 40, 'grave': 41, 'backslash': 43,
    'comma': 51, 'dot': 52, 'slash': 53, 'capslock': 58,
}

# Character to (key_name, needs_shift) mapping for key_type
CHAR_MAP = {
    'a': ('a', False), 'b': ('b', False), 'c': ('c', False), 'd': ('d', False),
    'e': ('e', False), 'f': ('f', False), 'g': ('g', False), 'h': ('h', False),
    'i': ('i', False), 'j': ('j', False), 'k': ('k', False), 'l': ('l', False),
    'm': ('m', False), 'n': ('n', False), 'o': ('o', False), 'p': ('p', False),
    'q': ('q', False), 'r': ('r', False), 's': ('s', False), 't': ('t', False),
    'u': ('u', False), 'v': ('v', False), 'w': ('w', False), 'x': ('x', False),
    'y': ('y', False), 'z': ('z', False),
    'A': ('a', True), 'B': ('b', True), 'C': ('c', True), 'D': ('d', True),
    'E': ('e', True), 'F': ('f', True), 'G': ('g', True), 'H': ('h', True),
    'I': ('i', True), 'J': ('j', True), 'K': ('k', True), 'L': ('l', True),
    'M': ('m', True), 'N': ('n', True), 'O': ('o', True), 'P': ('p', True),
    'Q': ('q', True), 'R': ('r', True), 'S': ('s', True), 'T': ('t', True),
    'U': ('u', True), 'V': ('v', True), 'W': ('w', True), 'X': ('x', True),
    'Y': ('y', True), 'Z': ('z', True),
    '0': ('0', False), '1': ('1', False), '2': ('2', False), '3': ('3', False),
    '4': ('4', False), '5': ('5', False), '6': ('6', False), '7': ('7', False),
    '8': ('8', False), '9': ('9', False),
    ' ': ('space', False), '\\t': ('tab', False), '\\n': ('enter', False),
    '-': ('minus', False), '=': ('equal', False),
    '[': ('leftbrace', False), ']': ('rightbrace', False),
    ';': ('semicolon', False), "'": ('apostrophe', False),
    '\`': ('grave', False), '\\\\': ('backslash', False),
    ',': ('comma', False), '.': ('dot', False), '/': ('slash', False),
    '!': ('1', True), '@': ('2', True), '#': ('3', True), '$': ('4', True),
    '%': ('5', True), '^': ('6', True), '&': ('7', True), '*': ('8', True),
    '(': ('9', True), ')': ('0', True),
    '_': ('minus', True), '+': ('equal', True),
    '{': ('leftbrace', True), '}': ('rightbrace', True),
    ':': ('semicolon', True), '"': ('apostrophe', True),
    '~': ('grave', True), '|': ('backslash', True),
    '<': ('comma', True), '>': ('dot', True), '?': ('slash', True),
}

def setup_uinput_keyboard():
    """Create a virtual keyboard device via /dev/uinput."""
    uinput_fd = os.open('/dev/uinput', os.O_WRONLY | os.O_NONBLOCK)
    # Enable EV_KEY and EV_REP event types
    fcntl.ioctl(uinput_fd, UI_SET_EVBIT, EV_KEY)
    fcntl.ioctl(uinput_fd, UI_SET_EVBIT, EV_REP)
    # Enable all keycodes in KEY_MAP
    for keycode in KEY_MAP.values():
        fcntl.ioctl(uinput_fd, UI_SET_KEYBIT, keycode)
    # Write uinput_user_dev struct: 80-byte name + 1036 bytes of zeros = 1116 bytes
    name = b'mcp-remotetouch-kbd'
    dev_struct = name + b'\\x00' * (80 - len(name))  # name[80]
    dev_struct += struct.pack('HH', 0x03, 0x01)  # id: bustype=BUS_VIRTUAL, vendor
    dev_struct += struct.pack('HH', 0x01, 0x01)  # id: product, version
    dev_struct += b'\\x00' * (1116 - len(dev_struct))  # ff_effects_max + absmin/max/fuzz/flat
    os.write(uinput_fd, dev_struct)
    fcntl.ioctl(uinput_fd, UI_DEV_CREATE)
    time.sleep(0.2)  # Wait for device to be registered
    return uinput_fd

def destroy_uinput_keyboard(uinput_fd):
    """Destroy the virtual keyboard device."""
    try:
        fcntl.ioctl(uinput_fd, UI_DEV_DESTROY)
    except Exception:
        pass
    try:
        os.close(uinput_fd)
    except Exception:
        pass

def kbd_write_event(uinput_fd, ev_type, code, value):
    """Write an input event to the uinput keyboard device."""
    now = time.time()
    sec = int(now)
    usec = int((now - sec) * 1000000)
    os.write(uinput_fd, struct.pack('llHHi', sec, usec, ev_type, code, value))

def kbd_syn(uinput_fd):
    kbd_write_event(uinput_fd, EV_SYN, SYN_REPORT, 0)

def handle_key_press(uinput_fd, cmd):
    """Handle key_press command: press a key with optional modifiers."""
    key = cmd.get('key', '').lower()
    modifiers = cmd.get('modifiers', [])
    keycode = KEY_MAP.get(key)
    if keycode is None:
        raise ValueError('Unknown key: ' + cmd.get('key', ''))
    # Press modifier keys
    mod_codes = []
    for mod in modifiers:
        mc = KEY_MAP.get(mod.lower())
        if mc is None:
            raise ValueError('Unknown modifier: ' + mod)
        mod_codes.append(mc)
        kbd_write_event(uinput_fd, EV_KEY, mc, 1)
        kbd_syn(uinput_fd)
    # Press and release main key
    kbd_write_event(uinput_fd, EV_KEY, keycode, 1)
    kbd_syn(uinput_fd)
    time.sleep(0.02)
    kbd_write_event(uinput_fd, EV_KEY, keycode, 0)
    kbd_syn(uinput_fd)
    # Release modifiers in reverse order
    for mc in reversed(mod_codes):
        kbd_write_event(uinput_fd, EV_KEY, mc, 0)
        kbd_syn(uinput_fd)

def handle_key_type(uinput_fd, cmd):
    """Handle key_type command: type a string of text character by character."""
    text = cmd.get('text', '')
    shift_code = KEY_MAP['shift']
    for ch in text:
        entry = CHAR_MAP.get(ch)
        if entry is None:
            continue  # Skip unmapped characters
        key_name, needs_shift = entry
        keycode = KEY_MAP[key_name]
        if needs_shift:
            kbd_write_event(uinput_fd, EV_KEY, shift_code, 1)
            kbd_syn(uinput_fd)
        kbd_write_event(uinput_fd, EV_KEY, keycode, 1)
        kbd_syn(uinput_fd)
        time.sleep(0.01)
        kbd_write_event(uinput_fd, EV_KEY, keycode, 0)
        kbd_syn(uinput_fd)
        if needs_shift:
            kbd_write_event(uinput_fd, EV_KEY, shift_code, 0)
            kbd_syn(uinput_fd)
        time.sleep(0.01)

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
    kbd_fd = None
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
                    # Best-effort keyboard setup — touch works even if uinput fails
                    try:
                        kbd_fd = setup_uinput_keyboard()
                        kbd_msg = ' (keyboard: ok)'
                    except Exception as ke:
                        kbd_fd = None
                        kbd_msg = ' (keyboard: unavailable - ' + str(ke) + ')'
                    send_response(cmd_id, 'ready', 'injecting into ' + dev_path + kbd_msg, scr_w, scr_h)
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
                elif cmd_type == 'key_press':
                    if kbd_fd is None:
                        send_response(cmd_id, 'error', 'keyboard not available: /dev/uinput not accessible')
                    else:
                        handle_key_press(kbd_fd, cmd)
                        send_response(cmd_id, 'ok')
                elif cmd_type == 'key_type':
                    if kbd_fd is None:
                        send_response(cmd_id, 'error', 'keyboard not available: /dev/uinput not accessible')
                    else:
                        handle_key_type(kbd_fd, cmd)
                        send_response(cmd_id, 'ok')
                else:
                    send_response(cmd_id, 'error', 'unknown command: ' + cmd_type)
            except PermissionError:
                send_response(cmd_id, 'error', 'Permission denied. Run with sudo or ensure user is in the input group: sudo usermod -aG input $USER')
            except Exception as e:
                send_response(cmd_id, 'error', str(e))
    finally:
        if kbd_fd is not None:
            destroy_uinput_keyboard(kbd_fd)
        if fd is not None:
            try:
                os.close(fd)
            except Exception:
                pass

if __name__ == '__main__':
    main()
`;
