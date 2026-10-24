#!/usr/bin/env bash
# Fallback supervisor for hosts without systemd (for example a container with tini as PID 1).
# Keeps `rahat-pi run` alive: restarts it after a crash or kill -9, stops after a clean exit.
#
# Usage: bash deploy/supervise.sh start | stop | status | logs | foreground
set -euo pipefail

repoDirectory="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Node 22.19+; set RAHAT_PI_NODE to use a binary that is not first on PATH.
nodeBinary="${RAHAT_PI_NODE:-$(command -v node)}"
dataDirectory="$repoDirectory/data"
supervisorPidFile="$dataDirectory/supervisor.pid"
servicePidFile="$dataDirectory/service.pid"
logFile="$dataDirectory/service.log"
restartDelaySeconds=2

isSupervisorRunning() {
  [[ -f "$supervisorPidFile" ]] && kill -0 "$(cat "$supervisorPidFile")" 2>/dev/null
}

runForeground() {
  cd "$repoDirectory"
  mkdir -p "$dataDirectory"
  echo $$ > "$supervisorPidFile"
  local servicePid=""
  # Forward SIGTERM/SIGINT so the service shuts down cleanly, then stop supervising.
  trap 'if [[ -n "$servicePid" ]]; then kill -TERM "$servicePid" 2>/dev/null || true; wait "$servicePid" || true; fi; rm -f "$supervisorPidFile" "$servicePidFile"; exit 0' TERM INT
  while true; do
    echo "[supervisor $(date -Is)] starting rahat-pi web (service + local web UI)"
    # One node process with tsx loaded in-process, so kill -9 hits the service directly.
    "$nodeBinary" --import tsx src/cli.ts web &
    servicePid=$!
    echo "$servicePid" > "$servicePidFile"
    local exitCode=0
    wait "$servicePid" || exitCode=$?
    servicePid=""
    if [[ "$exitCode" -eq 0 ]]; then
      # Clean exit means `rahat-pi stop` or a requested shutdown; restarting would clear the stop flag.
      echo "[supervisor $(date -Is)] service exited cleanly; not restarting"
      rm -f "$supervisorPidFile" "$servicePidFile"
      exit 0
    fi
    echo "[supervisor $(date -Is)] service exited with code $exitCode; restarting in ${restartDelaySeconds}s"
    sleep "$restartDelaySeconds"
  done
}

case "${1:-}" in
  start)
    if isSupervisorRunning; then
      echo "Already running (supervisor pid $(cat "$supervisorPidFile"))"
      exit 0
    fi
    mkdir -p "$dataDirectory"
    # Run through bash so a checkout without the executable bit (e.g. committed from Windows) still works.
    setsid nohup bash "$repoDirectory/deploy/supervise.sh" foreground >> "$logFile" 2>&1 < /dev/null &
    echo "Started. Logs: $logFile"
    ;;
  stop)
    if isSupervisorRunning; then
      kill -TERM "$(cat "$supervisorPidFile")"
      echo "Stop signal sent"
    else
      echo "Not running"
    fi
    ;;
  status)
    if isSupervisorRunning; then
      echo "Running: supervisor pid $(cat "$supervisorPidFile"), service pid $(cat "$servicePidFile" 2>/dev/null || echo '?')"
    else
      echo "Not running"
      exit 1
    fi
    ;;
  logs)
    tail -n 50 -f "$logFile"
    ;;
  foreground)
    runForeground
    ;;
  *)
    echo "Usage: $0 start | stop | status | logs | foreground" >&2
    exit 2
    ;;
esac
