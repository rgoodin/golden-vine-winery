#!/usr/bin/env bash
#
# Cron-invokable wrapper for document-workspace-service's audit-only
# detection - the SharePoint counterpart to
# services/integration-service's scripts/ops/run-scheduled-audit.sh,
# built per docs/devex/phase-6-iteration-review.md Finding 4. This
# wrapper is entirely target-agnostic (it only shells out to
# `npm run detect-unprocessed-events` and records the outcome), so it
# is a deliberate, mechanical duplicate of the ServiceNow version, not
# a rewrite - there was nothing SharePoint-specific left to solve here.
#
# This script NEVER passes --recover. Audit-only, read-only, same scope
# boundary as the ServiceNow version and the same reasoning (ADR 0007).
#
# Usage (manual):
#   ./scripts/ops/run-scheduled-audit.sh
#
# Usage (cron - NOT installed by this script; a standing schedule is a
# separate, deliberate decision, same as it was for integration-service
# - see docs/devex/observations.md OB-0031):
#   0 * * * * /path/to/services/document-workspace-service/scripts/ops/run-scheduled-audit.sh >> /path/to/services/document-workspace-service/.audit-cron.log 2>&1
#
# Exit codes surfaced to the caller (e.g. cron's own failure handling):
#   0  - audit ran successfully (regardless of how many GAPs it found)
#   1  - the audit script itself failed (thrown error, e.g. auth failure)
#   2  - the audit script detected a sweep anomaly (Salesforce side)
#   75 - this invocation was skipped because a previous run is still in progress

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOCK_FILE="$PROJECT_DIR/.audit-run.lock"
JSONL_LOG="$PROJECT_DIR/.audit-runs.jsonl"
RUN_OUTPUT_LOG="$PROJECT_DIR/.audit-last-run.log"

# See integration-service's equivalent wrapper (FL-0028) for why this is
# hardcoded rather than dynamically discovered from cron's minimal PATH.
NODE_BIN_DIR="/home/rgoodin/.nvm/versions/node/v22.18.0/bin"
export PATH="$NODE_BIN_DIR:$PATH"

now_iso() { date -u +"%Y-%m-%dT%H:%M:%S.%3NZ"; }
now_epoch_ms() { date +%s%3N; }

WRAPPER_STARTED_AT="$(now_iso)"
START_EPOCH_MS="$(now_epoch_ms)"

append_jsonl() {
  echo "$1" >> "$JSONL_LOG"
}

# --- skip-if-running ---
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  END_EPOCH_MS="$(now_epoch_ms)"
  append_jsonl "$(cat <<JSON
{"wrapperStartedAt":"$WRAPPER_STARTED_AT","wrapperFinishedAt":"$(now_iso)","durationMs":$((END_EPOCH_MS - START_EPOCH_MS)),"status":"skipped","reason":"previous audit run still in progress","exitCode":75}
JSON
)"
  echo "SKIPPED - a previous scheduled audit run is still in progress (lock: $LOCK_FILE)."
  exit 75
fi

# --- run the real, unmodified audit-only CLI - no --recover, ever ---
cd "$PROJECT_DIR"
set +e
npm run detect-unprocessed-events > "$RUN_OUTPUT_LOG" 2>&1
EXIT_CODE=$?
set -e

cat "$RUN_OUTPUT_LOG"

END_EPOCH_MS="$(now_epoch_ms)"
DURATION_MS=$((END_EPOCH_MS - START_EPOCH_MS))

RUN_SUMMARY_LINE="$(grep -o 'RUN_SUMMARY: .*' "$RUN_OUTPUT_LOG" | sed 's/^RUN_SUMMARY: //' | tail -n1)" || true

if [ "$EXIT_CODE" -eq 0 ] && [ -n "$RUN_SUMMARY_LINE" ]; then
  STATUS="ok"
elif [ "$EXIT_CODE" -eq 2 ]; then
  STATUS="sweep_anomaly"
else
  STATUS="failed"
fi

append_jsonl "$(cat <<JSON
{"wrapperStartedAt":"$WRAPPER_STARTED_AT","wrapperFinishedAt":"$(now_iso)","durationMs":$DURATION_MS,"status":"$STATUS","exitCode":$EXIT_CODE,"scriptRunSummary":${RUN_SUMMARY_LINE:-null}}
JSON
)"

exit "$EXIT_CODE"
