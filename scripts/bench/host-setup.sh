#!/usr/bin/env bash
# Throwaway: prepares the GPU5 box as a CI benchmark runner. Run with sudo.
#   sudo RUNNER_TOKEN=<registration token> bash host-setup.sh
# Token: gh api -X POST repos/adeshboudhnicedigitals/aivastra/actions/runners/registration-token --jq .token
# Undo everything with host-teardown.sh.
set -euo pipefail
: "${RUNNER_TOKEN:?set RUNNER_TOKEN}"
REPO_URL=https://github.com/adeshboudhnicedigitals/aivastra
RUNNER_DIR=/opt/bench-runner

# ComfyUI off: the box must be quiet or the numbers are meaningless.
systemctl stop comfyui.service comfyui-7070.service

apt-get update
apt-get install -y docker.io docker-compose-v2 libicu74 curl jq tar

id ghrunner >/dev/null 2>&1 || useradd -m -s /bin/bash ghrunner
usermod -aG docker ghrunner

# One slice holds the runner AND its docker containers, so a single CPU set and a
# single memory counter cover the whole CI workload.
cat >/etc/systemd/system/bench.slice <<'UNIT'
[Slice]
CPUAccounting=yes
MemoryAccounting=yes
AllowedCPUs=0-3
UNIT
mkdir -p /etc/docker
echo '{"cgroup-parent": "bench.slice"}' >/etc/docker/daemon.json
systemctl daemon-reload
systemctl enable --now docker
systemctl restart docker

mkdir -p /var/lib/bench
install -m 0755 "$(dirname "$0")/bench-tier.sh" /usr/local/bin/bench-tier
install -m 0755 "$(dirname "$0")/sampler.sh" /usr/local/bin/bench-sampler

cat >/etc/systemd/system/bench-sampler.service <<'UNIT'
[Unit]
Description=Bench slice CPU/RAM sampler
[Service]
ExecStart=/usr/local/bin/bench-sampler
Restart=always
[Install]
WantedBy=multi-user.target
UNIT

# Runner: latest release, registered with the single label `bench`.
mkdir -p "$RUNNER_DIR" && chown ghrunner "$RUNNER_DIR"
VER=$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | jq -r .tag_name | sed 's/^v//')
sudo -u ghrunner bash -c "cd $RUNNER_DIR && curl -fsSL -o r.tgz https://github.com/actions/runner/releases/download/v$VER/actions-runner-linux-x64-$VER.tar.gz && tar xzf r.tgz && rm r.tgz"
sudo -u ghrunner bash -c "cd $RUNNER_DIR && ./config.sh --unattended --url $REPO_URL --token $RUNNER_TOKEN --name gpu5-bench --labels bench --replace"

cat >/etc/systemd/system/bench-runner.service <<UNIT
[Unit]
Description=GitHub Actions bench runner
After=docker.service
[Service]
User=ghrunner
Slice=bench.slice
WorkingDirectory=$RUNNER_DIR
ExecStart=$RUNNER_DIR/run.sh
Restart=on-failure
[Install]
WantedBy=multi-user.target
UNIT

bench-tier 4   # start at 4 CPUs; switch with `sudo bench-tier 2|4|8`
systemctl daemon-reload
systemctl enable --now bench-sampler bench-runner
echo "ready: runner gpu5-bench online, tier $(cat /var/lib/bench/tier) CPUs"
