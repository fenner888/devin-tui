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
            if elapsed >= 6:
                break
            for at, key in [(0, b'synthetic test'), (.3, b'\r'), (3, b'\x1b')]:
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
