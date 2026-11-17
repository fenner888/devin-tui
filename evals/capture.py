"""Mock-only PTY capture; no network or real agent invocation."""
import os, pty, fcntl, termios, struct, select, time, sys, signal

pid, fd = pty.fork()
if pid == 0:
    os.execvpe('node', ['node', '--import', 'tsx', 'src/index.tsx', '--agent', 'node --import tsx evals/hostile-agent.ts'], dict(os.environ))
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 36, 120, 0, 0))
data = bytearray()
start = time.monotonic()
ready = None
sent = set()
lifecycle = os.environ.get('EVAL_SCENARIO') == 'lifecycle'
next_permission = None
try:
    while True:
        now = time.monotonic()
        if ready is None:
            # The mock's Normal mode is drawn only after session/new completes.
            if b'Normal' in data:
                ready = now
            elif now - start >= 30:
                raise TimeoutError('Mock TUI readiness timeout: Normal mode not rendered within 30 seconds')
        if ready is not None:
            elapsed = now - ready
            if elapsed >= (14 if lifecycle else 6):
                break
            keys = [(0, b'synthetic test'), (.3, b'\r')]
            keys += [(10, b'next turn'), (10.3, b'\r')] if lifecycle else [(3, b'\x1b')]
            if lifecycle and b'LIFECYCLE_NEXT_PERMISSION' in data:
                if next_permission is None:
                    next_permission = now
                elif now - next_permission >= 1 and 'cancel-next' not in sent:
                    os.write(fd, b'\x1b')
                    sent.add('cancel-next')
            for at, key in keys:
                if elapsed >= at and at not in sent:
                    os.write(fd, key)
                    sent.add(at)
        if select.select([fd], [], [], .05)[0]:
            try:
                chunk = os.read(fd, 65536)
            except OSError:
                chunk = b''
            if not chunk:
                raise RuntimeError('Mock TUI exited before capture completed')
            data.extend(chunk)
finally:
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    os.waitpid(pid, 0)
    with open(sys.argv[1], 'wb') as out:
        out.write(data)
