#!/usr/bin/env bash
# Throwaway: pin the whole bench slice (runner + containers) to N CPUs. Usage: sudo bench-tier 2|4|8
set -euo pipefail
n=${1:?usage: bench-tier N}
systemctl set-property --runtime bench.slice "AllowedCPUs=0-$((n - 1))"
echo "$n" >/var/lib/bench/tier
echo "bench.slice pinned to $n CPUs (0-$((n - 1)))"
