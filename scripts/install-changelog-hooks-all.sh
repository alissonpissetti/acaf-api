#!/bin/sh
# Instala o hook post-commit em todos os repositórios acaf-* no mesmo nível da API.
set -e
API_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKSPACE_ROOT="$(cd "$API_ROOT/.." && pwd)"
API_SCRIPT="$API_ROOT/scripts/changelog-record-commit.mjs"
CHANGELOG_FILE="$API_ROOT/changelog/changelog.json"

if [ ! -f "$API_SCRIPT" ]; then
  echo "Script não encontrado: $API_SCRIPT" >&2
  exit 1
fi

install_repo() {
  REPO="$1"
  if [ ! -d "$REPO/.git" ]; then
    return 0
  fi
  mkdir -p "$REPO/.githooks"
  cat > "$REPO/.githooks/post-commit" <<'HOOK'
#!/bin/sh
ROOT="$(git rev-parse --show-toplevel)"
API_ROOT="$(cd "$ROOT/../acaf-api" 2>/dev/null && pwd)"
SCRIPT="${API_ROOT}/scripts/changelog-record-commit.mjs"
CHANGELOG="${API_ROOT}/changelog/changelog.json"
if [ ! -f "$SCRIPT" ] && [ -f "$ROOT/scripts/changelog-record-commit.mjs" ]; then
  SCRIPT="$ROOT/scripts/changelog-record-commit.mjs"
  CHANGELOG="$ROOT/changelog/changelog.json"
fi
if [ -f "$SCRIPT" ]; then
  CHANGELOG_FILE="$CHANGELOG" node "$SCRIPT" 2>/dev/null || true
fi
HOOK
  chmod +x "$REPO/.githooks/post-commit"
  (cd "$REPO" && git config core.hooksPath .githooks)
  echo "Hook ativo: $REPO"
}

install_repo "$API_ROOT"

for dir in "$WORKSPACE_ROOT"/acaf-*; do
  [ -d "$dir" ] || continue
  install_repo "$dir"
done

echo "Changelog central: $CHANGELOG_FILE"
