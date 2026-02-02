export const PYTHON_DAEMON_SCRIPT = `
import sys
import os
import json
import struct
import fcntl
import time

# ioctl constants
UI_SET_EVBIT = 0x40045564
UI_SET_ABSBIT = 0x40045567
UI_SET_PROPBIT = 0x4004556e
UI_DEV_SETUP = 0x405c5503
UI_DEV_CREATE = 0x5501
UI_DEV_DESTROY = 0x5502

# Event types
EV_SYN = 0x00
EV_ABS = 0x03

# Sync codes
SYN_REPORT = 0x00

# ABS codes
ABS_MT_SLOT = 0x2f
ABS_MT_TRACKING_ID = 0x39
ABS_MT_POSITION_X = 0x35
ABS_MT_POSITION_Y = 0x36

# Input properties
INPUT_PROP_DIRECT = 0x01

# uinput_abs_setup struct: __u16 code, struct input_absinfo { __s32 value, min, max, fuzz, flat, resolution }
# = HiiiiiI -> but let's use the raw struct
# Actually uinput_abs_setup = __u16 + padding + input_absinfo(6 x __s32)
# struct uinput_abs_setup { __u16 code; __u16 pad; struct input_absinfo { __s32 value, minimum, maximum, fuzz, flat, resolution; }; };
UI_ABS_SETUP = 0x405c5504

UINPUT_MAX_NAME_SIZE = 80

def make_input_event(tv_sec, tv_usec, ev_type, code, value):
    # struct input_event uses struct timeval (long, long) + __u16 + __u16 + __s32
    # native long size handles 32/64 bit automatically
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
    syn_report(fd)

def touch_move(fd, slot, x, y):
    write_event(fd, EV_ABS, ABS_MT_SLOT, slot)
    write_event(fd, EV_ABS, ABS_MT_POSITION_X, x)
    write_event(fd, EV_ABS, ABS_MT_POSITION_Y, y)
    syn_report(fd)

def touch_up(fd, slot):
    write_event(fd, EV_ABS, ABS_MT_SLOT, slot)
    write_event(fd, EV_ABS, ABS_MT_TRACKING_ID, -1)
    syn_report(fd)

def setup_uinput(screen_width, screen_height):
    fd = os.open('/dev/uinput', os.O_WRONLY | os.O_NONBLOCK)

    # Enable EV_ABS
    fcntl.ioctl(fd, UI_SET_EVBIT, EV_ABS)

    # Enable ABS axes
    fcntl.ioctl(fd, UI_SET_ABSBIT, ABS_MT_SLOT)
    fcntl.ioctl(fd, UI_SET_ABSBIT, ABS_MT_TRACKING_ID)
    fcntl.ioctl(fd, UI_SET_ABSBIT, ABS_MT_POSITION_X)
    fcntl.ioctl(fd, UI_SET_ABSBIT, ABS_MT_POSITION_Y)

    # Set INPUT_PROP_DIRECT for touchscreen
    fcntl.ioctl(fd, UI_SET_PROPBIT, INPUT_PROP_DIRECT)

    # Setup ABS axes with uinput_abs_setup
    # struct uinput_abs_setup { __u16 code; __u16 pad; struct input_absinfo { __s32 value, minimum, maximum, fuzz, flat, resolution; }; };
    abs_setup_fmt = 'HH6i'

    # ABS_MT_SLOT: 0 to 9
    data = struct.pack(abs_setup_fmt, ABS_MT_SLOT, 0, 0, 0, 9, 0, 0, 0)
    fcntl.ioctl(fd, UI_ABS_SETUP, data)

    # ABS_MT_TRACKING_ID: 0 to 65535
    data = struct.pack(abs_setup_fmt, ABS_MT_TRACKING_ID, 0, 0, 0, 65535, 0, 0, 0)
    fcntl.ioctl(fd, UI_ABS_SETUP, data)

    # ABS_MT_POSITION_X: 0 to screen_width - 1
    data = struct.pack(abs_setup_fmt, ABS_MT_POSITION_X, 0, 0, 0, screen_width - 1, 0, 0, 0)
    fcntl.ioctl(fd, UI_ABS_SETUP, data)

    # ABS_MT_POSITION_Y: 0 to screen_height - 1
    data = struct.pack(abs_setup_fmt, ABS_MT_POSITION_Y, 0, 0, 0, screen_height - 1, 0, 0, 0)
    fcntl.ioctl(fd, UI_ABS_SETUP, data)

    # uinput_setup: char name[UINPUT_MAX_NAME_SIZE]; struct input_id { __u16 bustype, vendor, product, version; };
    # struct input_id: HHH H (bustype=0x03 USB, vendor=0x1234, product=0x5678, version=1)
    # struct uinput_setup: 80s HHHH I (ff_effects_max)
    name = b'mcp-remotetouch'
    setup_data = struct.pack('80sHHHHI', name.ljust(UINPUT_MAX_NAME_SIZE, b'\\x00'), 0x03, 0x1234, 0x5678, 1, 0)
    fcntl.ioctl(fd, UI_DEV_SETUP, setup_data)

    # Create the device
    fcntl.ioctl(fd, UI_DEV_CREATE)

    # Give udev time to create the device node
    time.sleep(0.2)

    return fd

def send_response(cmd_id, status, message=None):
    resp = {'id': cmd_id, 'status': status}
    if message is not None:
        resp['message'] = message
    sys.stdout.write(json.dumps(resp) + '\\n')
    sys.stdout.flush()

tracking_id_counter = 0

def next_tracking_id():
    global tracking_id_counter
    tracking_id_counter = (tracking_id_counter + 1) % 65536
    return tracking_id_counter

def handle_tap(fd, cmd):
    x = int(cmd['x'])
    y = int(cmd['y'])
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

    touch_down(fd, 0, tid, x1, y1)
    for i in range(1, steps + 1):
        t = i / steps
        cx = int(x1 + (x2 - x1) * t)
        cy = int(y1 + (y2 - y1) * t)
        time.sleep(duration_ms / 1000.0 / steps)
        touch_move(fd, 0, cx, cy)
    touch_up(fd, 0)

def handle_long_press(fd, cmd):
    x = int(cmd['x'])
    y = int(cmd['y'])
    duration_ms = cmd.get('duration_ms', 800)
    tid = next_tracking_id()
    touch_down(fd, 0, tid, x, y)
    time.sleep(duration_ms / 1000.0)
    touch_up(fd, 0)

def handle_double_tap(fd, cmd):
    x = int(cmd['x'])
    y = int(cmd['y'])
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
                    screen_width = cmd.get('screen_width', 800)
                    screen_height = cmd.get('screen_height', 480)
                    fd = setup_uinput(screen_width, screen_height)
                    send_response(cmd_id, 'ready', 'uinput device created')
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
                send_response(cmd_id, 'error', 'Permission denied accessing /dev/uinput. Ensure user is in the input group: sudo usermod -aG input $USER')
            except Exception as e:
                send_response(cmd_id, 'error', str(e))
    finally:
        if fd is not None:
            try:
                fcntl.ioctl(fd, UI_DEV_DESTROY)
                os.close(fd)
            except Exception:
                pass

if __name__ == '__main__':
    main()
`;
