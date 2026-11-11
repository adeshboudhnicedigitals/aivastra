#!/usr/bin/env bash
# Throwaway: stop the parallel pool and bring the single host runner back. Run with sudo.
set -uo pipefail
for p in $(docker compose ls -q | grep '^benchpar'); do
  docker compose -p "$p" down -v
done
docker rmi bench-runner:local 2>/dev/null
systemctl start bench-runner
echo "pool removed; remove stale runners in GitHub: gh api repos/.../actions/runners"
