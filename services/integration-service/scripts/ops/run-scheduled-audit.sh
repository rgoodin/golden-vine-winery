#!/usr/bin/env bash
#
# Cron-invokable wrapper for Tier 1's mandatory audit-only detection
# (ADR 0005, ADR 0007). This is the smallest scheduling mechanism this
# project uses: an existing OS mechanism (cron + flock), not a new
# framework introduced for this one capability - see
# docs/decisions/0007-tier1-scheduled-recovery-operational-contract.md.
#
# This script NEVER passes --recover. It runs
# `npm run detect-unprocessed-events` with no arguments - audit-only,
# read-only, exactly ADR 0007's scope for this Enablement round.
# Scheduled recovery is a distinct, later decision, not built here.
#
# Responsibilities this wrapper owns (things the TS script itself
# cannot know, because they are properties of the *invocation*, not the
# audit logic):
#   - skip-if-running (ADR 0007 §3), via flock - not a correctness
#     mechanism (the reclaim gate already prevents double-recovery
#     regardless of overlap - see the ADR), but a load/observability one.
#   - wall-clock start/end/duration and the run's actual exit code,
#     since a run that fails before the TS script prints its own
#     RUN_SUMMARY line (e.g. a Salesforce/ServiceNow auth failure) still
#     needs to be recorded as a failure.
#   - one structured JSONL line per invocation attempt - including
#     skipped ones - appended to a durable, reviewable log
#     (.audit-runs.jsonl), satisfying ADR 0007 §6's minimum
#     observability requirement.
#
# Usage (manual):
#   ./scripts/ops/run-scheduled-audit.sh
#
# Usage (cron - PROVISIONAL cadence for evidence-gathering only, not a
# chosen production cadence per ADR 0007 §1; edit the schedule field
# directly, do not treat "*/15" below as a recommendation):
#   */15 * * * * /path/to/services/integration-service/scripts/ops/run-scheduled-audit.sh >> /path/to/services/integration-service/.audit-cron.log 2>&1
#
# Exit codes surfaced to the caller (e.g. cron's own failure handling):
#   0  - audit ran successfully (regardless of how many GAPs it found)
#   1  - the audit script itself failed (thrown error, e.g. auth failure)
#   2  - the audit script detected a sweep anomaly (ADR 0007 §4 / FL-0026)
#   75 - this invocation was skipped because a previous run is still in progress

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOCK_FILE="$PROJECT_DIR/.audit-run.lock"
JSONL_LOG="$PROJECT_DIR/.audit-runs.jsonl"
RUN_OUTPUT_LOG="$PROJECT_DIR/.audit-last-run.log"

# cron's PATH is minimal and will not include an nvm-installed Node -
# confirmed directly (FL-0028), not assumed: under a minimal PATH, this
# system resolves a *different*, older `node` (/usr/bin/node, v18 - no
# `node:sqlite` support) rather than failing to find one at all, which
# is worse than a missing-command error because it fails deep inside
# idempotencyStore.ts instead of at the obvious place. Dynamically
# re-discovering "node" from whatever ambient PATH the wrapper happens
# to run under is exactly as unreliable as the problem it's meant to
# solve - it just finds *a* node, not necessarily the right one. This
# path is therefore hardcoded, deliberately, and MUST be updated if this
# script moves to a different machine or this project's Node version
# changes - `nvm which <version>`'s directory is the value to use.
NODE_BIN_DIR="/home/rgoodin/.nvm/versions/node/v22.18.0/bin"
export PATH="$NODE_BIN_DIR:$PATH"

now_iso() { date -u +"%Y-%m-%dT%H:%M:%S.%3NZ"; }
now_epoch_ms() { date +%s%3N; }

WRAPPER_STARTED_AT="$(now_iso)"
START_EPOCH_MS="$(now_epoch_ms)"

append_jsonl() {
  # $1 = one already-complete JSON object (single line, no trailing newline needed)
  echo "$1" >> "$JSONL_LOG"
}

# --- skip-if-running (ADR 0007 §3) ---
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

# Pull the TS script's own RUN_SUMMARY line if it printed one (it only
# does so on a fully successful run - see detect-unprocessed-events.ts).
# A failed/anomalous run has no such line at all - grep finding nothing
# is an expected outcome here, not a wrapper-script error, so it must
# not be allowed to trip `set -e`/`pipefail` and skip the logging below.
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
