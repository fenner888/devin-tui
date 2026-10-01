#!/bin/sh
# devin-tui launcher — runs the TSX entrypoint with the project's local tsx.
# Resolves symlinks so it works when linked onto PATH (npm link).
DIR="$(cd "$(dirname "$(realpath "$0")")/.." && pwd)"
if [ "$1" = "update" ]; then
	cd "$DIR" || exit 1
	echo "devin-tui: updating $DIR"
	git pull --ff-only && npm install --no-audit --no-fund || exit 1
	echo "devin-tui: now v$(node -p "require('./package.json').version") — restart any running devin-tui"
	exit 0
fi
exec "$DIR/node_modules/.bin/tsx" "$DIR/src/index.tsx" "$@"
