#!/bin/bash
# 비전 step 왕복 실행. 첫 인자는 프로젝트(axse | radar).
#
# 자격증명은 SCENARIOFORGE_PROBE_MODEL_KEY 가 있으면 그것을 쓰고, 없으면
# Electron safeStorage 캐시에서 읽는다. 어느 경로든 값을 기록하지 않는다.
#
#   bash run-live.sh axse                        실제 모델 왕복
#   LIVE_RUN_FAKE_MODEL=1 bash run-live.sh radar  모델 없이 어댑터 자체 점검
#   LIVE_RUN_NEGATIVE=1 bash run-live.sh axse     도착 화면을 나타나지 않는 화면으로 바꿔 FAILED 확인
set -u
PROJECT="${1:-axse}"
export PATH=/opt/homebrew/bin:$PATH
REPO=/Users/a11769/Desktop/master-project
S="$(cd "$(dirname "$0")" && pwd)"
LOGS="$(mktemp -d)"

case "$PROJECT" in
  axse)
    FRONTEND="$REPO/test_project_source/axse-agents/frontend"
    STUB="$S/axse-stub-api.mjs"; CONFIG="$S/axse.vite.config.mjs"; URL="http://localhost:45180/"
    OUT_DEFAULT="$REPO/docs/validation/vision-execution-round-trip/PROBE-20260907-03" ;;
  radar)
    FRONTEND="/Users/a11769/Desktop/RA-DAR/FrontEnd"
    STUB="$S/radar-stub-api.mjs"; CONFIG="$S/radar.vite.config.mjs"; URL="http://localhost:45190/"
    OUT_DEFAULT="$REPO/docs/validation/vision-execution-round-trip/PROBE-20260907-04" ;;
  *) echo "unknown project: $PROJECT (expected axse or radar)" >&2; exit 2 ;;
esac

cleanup() { [ -n "${STUB_PID:-}" ] && kill "$STUB_PID" 2>/dev/null; [ -n "${VITE_PID:-}" ] && kill "$VITE_PID" 2>/dev/null; }
trap cleanup EXIT

node "$STUB" > "$LOGS/stub.log" 2>&1 & STUB_PID=$!
(cd "$FRONTEND" && ./node_modules/.bin/vite --config "$CONFIG" > "$LOGS/vite.log" 2>&1) & VITE_PID=$!
for _ in $(seq 1 40); do curl -s -o /dev/null "$URL" && break; sleep 1; done
curl -s -o /dev/null -w "dev server http=%{http_code}\n" "$URL"

LIVE_RUN_FIXTURE="$PROJECT" LIVE_RUN_OUT="${LIVE_RUN_OUT:-$OUT_DEFAULT}" \
  "$REPO/node_modules/.bin/electron" "$S/live-step-runner.mjs" 2>&1 \
  | grep -vE "ExperimentalWarning|trace-warnings|Security Warning|unsafe-eval|security risks|consult|^\s*$|^https://"
