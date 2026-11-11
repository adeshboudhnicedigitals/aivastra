#!/usr/bin/env bash
# Throwaway: 1 Hz sample of the bench slice. CSV: epoch,cpus,slice_mem_bytes,slice_cpu_usec,sys_mem_used_kb
set -u
CG=/sys/fs/cgroup/bench.slice
OUT=/var/lib/bench/samples.csv
[ -s "$OUT" ] || echo "epoch,cpus,slice_mem_bytes,slice_cpu_usec,sys_mem_used_kb" >"$OUT"
while true; do
  mem=$(cat $CG/memory.current 2>/dev/null || echo 0)
  cpu=$(awk '/^usage_usec/{print $2}' $CG/cpu.stat 2>/dev/null || echo 0)
  used=$(awk '/MemTotal/{t=$2}/MemAvailable/{a=$2}END{print t-a}' /proc/meminfo)
  echo "$(date +%s),$(cat /var/lib/bench/tier 2>/dev/null || echo 0),$mem,$cpu,$used" >>"$OUT"
  sleep 1
done
