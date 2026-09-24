#!/bin/sh
# devin-tui launcher — runs the TSX entrypoint with the project's local tsx.
# Resolves symlinks so it works when linked onto PATH (npm link).
DIR="$(cd "$(dirname "$(realpath "$0")")/.." && pwd)"
exec "$DIR/node_modules/.bin/tsx" "$DIR/src/index.tsx" "$@"
