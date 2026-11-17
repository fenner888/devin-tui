"""Mock-only PTY capture; no network or real agent invocation."""
import os, pty, fcntl, termios, struct, select, time, sys, signal

pid, fd = pty.fork()
if pid == 0:
    os.execvpe('node', ['node', '--import', 'tsx', 'src/index.tsx', '--agent', 'node --import tsx evals/hostile-agent.ts'], dict(os.environ))
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 36, 120, 0, 0))
data = bytearray()
start = time.monotonic()
sent = set()
while time.monotonic() - start < 9:
    elapsed = time.monotonic() - start
    for at, key in [(3, b'synthetic test'), (3.3, b'\r'), (6, b'\x1b')]:
        if elapsed >= at and at not in sent:
            os.write(fd, key)
            sent.add(at)
    if select.select([fd], [], [], .05)[0]:
        try:
            data.extend(os.read(fd, 65536))
        except OSError:
            break
os.kill(pid, signal.SIGTERM)
os.waitpid(pid, 0)
with open(sys.argv[1], 'wb') as out:
    out.write(data)
