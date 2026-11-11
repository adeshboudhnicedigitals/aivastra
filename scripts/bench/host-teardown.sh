#!/usr/bin/env bash
# Throwaway: removes everything host-setup.sh / parallel-up.sh put on the box and restarts ComfyUI.
#   sudo bash host-teardown.sh
# Runner registrations are removed from GitHub separately (gh api -X DELETE .../actions/runners/<id>).
set -uo pipefail

# 1. Parallel pool first, while docker still exists.
if command -v docker >/dev/null; then
  for p in $(docker compose ls -a -q 2>/dev/null | grep '^benchpar'); do
    docker compose -p "$p" down -v
  done
  docker rmi bench-runner:local 2>/dev/null
fi

# 2. Services, then their unit files, then reload so nothing lingers in memory.
systemctl disable --now bench-runner bench-sampler 2>/dev/null
rm -f /etc/systemd/system/bench-runner.service /etc/systemd/system/bench-sampler.service \
  /etc/systemd/system/bench.slice
systemctl daemon-reload

# 3. Files, runner user, docker (was not installed before this test).
rm -f /usr/local/bin/bench-tier /usr/local/bin/bench-sampler
rm -rf /opt/bench-runner /var/lib/bench /etc/docker/daemon.json
userdel -r ghrunner 2>/dev/null
systemctl disable --now docker docker.socket containerd 2>/dev/null
apt-get purge -y docker.io docker-compose-v2 containerd runc
rm -rf /var/lib/docker /var/lib/containerd

# 4. ComfyUI back to how it was before the test.
systemctl unmask comfyui.service comfyui-7070.service 2>/dev/null
systemctl start comfyui-7070.service comfyui.service
echo "comfyui: $(systemctl is-active comfyui.service comfyui-7070.service | paste -sd' ')"
echo "left behind: apt dependencies of docker (run 'apt-get autoremove' only if you have reviewed its list), libicu74"
