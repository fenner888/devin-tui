#!/bin/sh
# devin-tui launcher — runs the TSX entrypoint with the project's local tsx.
# Resolves symlinks so it works when linked onto PATH (npm link).
DIR="$(cd "$(dirname "$(realpath "$0")")/.." && pwd)"
case "$1" in
update | upgrade | --update)
	fail() {
		echo "devin-tui update: $*" >&2
		exit 1
	}
	cd "$DIR" || fail "cannot cd to $DIR"
	command -v git >/dev/null 2>&1 || fail "git is not installed"
	git rev-parse --git-dir >/dev/null 2>&1 ||
		fail "$DIR is not a git clone — reinstall: git clone https://github.com/fenner888/devin-tui.git && cd devin-tui && npm install && npm link"
	old="$(node -p "require('./package.json').version" 2>/dev/null)"
	echo "devin-tui: updating $DIR (v$old)"
	branch="$(git symbolic-ref --short -q HEAD)"
	[ "$branch" = main ] ||
		fail "clone is on '${branch:-a detached HEAD}', not main — run: git -C \"$DIR\" checkout main"
	# npm install can rewrite the lockfile; that is not a user edit and would block the pull
	git checkout -q -- package-lock.json 2>/dev/null
	git pull -q --ff-only --autostash origin main ||
		fail "git pull failed — check: git -C \"$DIR\" status"
	npm ci --no-audit --no-fund --loglevel=error ||
		npm install --no-audit --no-fund --loglevel=error ||
		fail "npm install failed in $DIR"
	new="$(node -p "require('./package.json').version")"
	if [ "$old" = "$new" ]; then
		echo "devin-tui: already up to date (v$new)"
	else
		echo "devin-tui: updated v$old → v$new — restart any running devin-tui"
	fi
	exit 0
	;;
--version | -v | version)
	node -p "'devin-tui v' + require('$DIR/package.json').version"
	exit 0
	;;
esac
exec "$DIR/node_modules/.bin/tsx" "$DIR/src/index.tsx" "$@"
