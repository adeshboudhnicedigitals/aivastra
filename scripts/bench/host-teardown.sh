#!/usr/bin/env bash
# Throwaway: removes everything host-setup.sh installed and restarts ComfyUI. Run with sudo.
#   sudo RUNNER_TOKEN=<removal token> bash host-teardown.sh   (token: .../actions/runners/remove-token)
set -uo pipefail
systemctl disable --now bench-runner bench-sampler 2>/dev/null
[ -n "${RUNNER_TOKEN:-}" ] && sudo -u ghrunner bash -c "cd /opt/bench-runner && ./config.sh remove --token $RUNNER_TOKEN"
rm -f /etc/systemd/system/bench-runner.service /etc/systemd/system/bench-sampler.service /etc/systemd/system/bench.slice
bash "$(dirname "$0")/parallel-down.sh" 2>/dev/null
rm -f /usr/local/bin/bench-tier /usr/local/bin/bench-sampler
rm -rf /opt/bench-runner /etc/docker/daemon.json
apt-get purge -y docker.io docker-compose-v2 containerd runc 2>/dev/null
rm -rf /var/lib/docker /var/lib/containerd
userdel -r ghrunner 2>/dev/null
echo "kept /var/lib/bench (samples.csv) until you copy it off; rm -rf it afterwards"
systemctl daemon-reload
systemctl unmask comfyui.service comfyui-7070.service 2>/dev/null
systemctl start comfyui-7070.service comfyui.service
systemctl is-active comfyui.service comfyui-7070.service
