#!/bin/bash
# Stage-A run on a fresh localnet: start the chain, run the end-to-end, stop everything.
#   ./run-stage-a.sh            backend run through the engine's public API (e2e-api.mjs)
#   ./run-stage-a.sh --web      web app run with Playwright and a virtual authenticator (e2e-web.mjs; extra args pass through)
#   ./run-stage-a.sh --all      both, the API run first
# Refuses to start when the machine is busy (1-minute load above 20).
set -u
cd "$(dirname "$0")"
MODE=api
case "${1:-}" in --web) MODE=web; shift ;; --all) MODE=all; shift ;; esac
load=$(sysctl -n vm.loadavg | awk '{print int($2)}')
if [ "$load" -gt 20 ]; then echo "load $load > 20: not starting"; exit 2; fi
lsof -ti tcp:8546 -sTCP:LISTEN >/dev/null && { echo "port 8546 busy: stop the running localnet first"; exit 2; }
LOG=$(mktemp -t localnet).log
node start.mjs > "$LOG" 2>&1 &
NET=$!
trap 'kill $NET 2>/dev/null; pkill -f "anvil --port 8546" 2>/dev/null' EXIT
for i in $(seq 1 180); do grep -q "localnet fully up" "$LOG" && break; sleep 1; done
grep -q "localnet fully up" "$LOG" || { echo "localnet failed to start"; tail -20 "$LOG"; exit 1; }
rc=0
if [ "$MODE" = api ] || [ "$MODE" = all ]; then node e2e-api.mjs || rc=1; fi
if [ "$MODE" = web ] || [ "$MODE" = all ]; then node e2e-web.mjs "$@" || rc=1; fi
exit $rc
