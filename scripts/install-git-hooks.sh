#!/bin/sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
git config core.hooksPath .githooks
chmod +x .githooks/post-commit 2>/dev/null || true
chmod +x scripts/changelog-record-commit.mjs 2>/dev/null || true
echo "Hooks Git ativos em .githooks (post-commit → changelog)."
