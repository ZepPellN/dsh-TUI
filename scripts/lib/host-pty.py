#!/usr/bin/env python3
"""Linux/macOS PTY transport, not a host substitute. JSON-lines on stdio.

Execs the supplied real CLI argv. Only its own child process group is killed
on EOF/stop/failure; terminal bytes and normal exit status are returned verbatim.
"""
import base64
import errno
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios
import time


def emit(event):
    print(json.dumps(event), flush=True)


pid, master = pty.fork()
if pid == 0:
    os.execv(sys.argv[1], sys.argv[1:])

emit({'processGroup': pid})
fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 32, 110, 0, 0))
pending = b''
status = None
try:
    while status is None:
        readable, _, _ = select.select([master, sys.stdin.buffer], [], [], 0.05)
        if master in readable:
            try:
                data = os.read(master, 65536)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                data = b''
            if data:
                emit({'data': base64.b64encode(data).decode('ascii')})
        if sys.stdin.buffer in readable:
            chunk = os.read(sys.stdin.fileno(), 65536)
            if not chunk:
                break
            pending += chunk
            while b'\n' in pending:
                line, pending = pending.split(b'\n', 1)
                command = json.loads(line)
                if 'write' in command:
                    os.write(master, command['write'].encode('utf-8'))
                    emit({'inputWritten': command['write'], 'at': time.monotonic_ns() / 1000000})
                if 'resize' in command:
                    cols, rows = command['resize']
                    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
                if command.get('stop'):
                    os.killpg(pid, signal.SIGTERM)
        ended, value = os.waitpid(pid, os.WNOHANG)
        if ended:
            status = value
finally:
    signals = []
    # The exec'd launcher can exit before its child finishes. Its exit is not
    # proof that the owned PTY process group has stopped writing to HOME.
    try:
        os.killpg(pid, signal.SIGTERM)
        signals.append('SIGTERM')
    except ProcessLookupError:
        pass
    if status is None:
        # Bound teardown even if the host failed before its own exit funnel.
        for _ in range(100):
            ended, value = os.waitpid(pid, os.WNOHANG)
            if ended:
                status = value
                break
            select.select([], [], [], 0.02)
    # Escalate the GROUP even if the launcher was already reaped. A stubborn
    # descendant must not outlive the bridge and recreate removed scratch.
    try:
        os.killpg(pid, signal.SIGKILL)
        signals.append('SIGKILL')
    except ProcessLookupError:
        pass
    if status is None:
        _, status = os.waitpid(pid, 0)
    os.close(master)
    emit({'teardown': {'processGroup': pid, 'signals': signals, 'leaderReaped': status is not None}})
emit({'exitCode': os.waitstatus_to_exitcode(status)})
