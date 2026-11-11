#!/usr/bin/env bash
# Throwaway: N parallel runners (label `bench`) inside bench.slice, capped at CPUS cores total.
#   sudo RUNNER_TOKEN=<registration token> N=11 CPUS=8 bash parallel-up.sh
set -euo pipefail
: "${RUNNER_TOKEN:?set RUNNER_TOKEN}"
N=${N:-11}
CPUS=${CPUS:-8}
export REPO_URL=https://github.com/adeshboudhnicedigitals/aivastra
cd "$(dirname "$0")/parallel"

bench-tier "$CPUS"
# The pool must be only the containerised runners, or the host one steals a job.
systemctl stop bench-runner || true
docker build -t bench-runner:local .
for i in $(seq 1 "$N"); do
  RUNNER_NAME="par-$i" docker compose -p "benchpar$i" up -d
done
echo "started $N parallel runners at $CPUS CPUs. First run pulls images into each daemon: treat it as warm-up."
