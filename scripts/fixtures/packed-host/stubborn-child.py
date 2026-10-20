"""Owned PTY shutdown fixture: launcher exits on TERM, child ignores TERM/HUP."""
import json
import os
import signal
import sys
import time

child = os.fork()
if child == 0:
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    signal.signal(signal.SIGHUP, signal.SIG_IGN)
    with open(sys.argv[1], 'w') as heartbeat:
        print(json.dumps({'writer': os.getpid(), 'group': os.getpgrp()}), flush=True)
        while True:
            heartbeat.write('.')
            heartbeat.flush()
            time.sleep(0.01)
signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
while True:
    time.sleep(0.1)
