#!/bin/bash
# 비전 그라운딩 재측정. 키는 SCENARIOFORGE_PROBE_MODEL_KEY 환경변수로만 받고
# 파일·로그·결과에 기록하지 않는다.
set -u
if [ -z "${SCENARIOFORGE_PROBE_MODEL_KEY:-}" ]; then
  echo "SCENARIOFORGE_PROBE_MODEL_KEY is required" >&2
  exit 2
fi
export PATH=/opt/homebrew/bin:$PATH
REPO=/Users/a11769/Desktop/master-project
S="$(cd "$(dirname "$0")" && pwd)"
ELECTRON="$REPO/node_modules/.bin/electron"

echo "=== key check ==="
"$ELECTRON" "$S/check-cap.mjs" 2>&1 | tail -2

for target in axse ra-dar; do
  case "$target" in
    axse) dir="$S/axse" ;;
    ra-dar) dir="$S/radar" ;;
  esac
  for space in native 768; do
    if [ "$space" = "768" ]; then
      export GROUNDING_SHORT_SIDE=768
    else
      unset GROUNDING_SHORT_SIDE
    fi
    echo "=== $target / $space ==="
    GROUNDING_CAPTURE_DIR="$dir" \
    GROUNDING_RESULT_PATH="$S/rerun-$target-$space.json" \
    GROUNDING_PROJECT="$target" \
      "$ELECTRON" "$S/probe-grounding.mjs" 2>&1 | grep -vE "ExperimentalWarning|trace-warnings" | tail -12
  done
done
echo "=== done. results in $S/rerun-*.json ==="
