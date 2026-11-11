#!/bin/bash
set -euo pipefail
cd /home/runner
# The dind sidecar shares this netns; wait for its daemon before taking jobs.
until docker info >/dev/null 2>&1; do sleep 1; done
if [ ! -f .runner ]; then
  ./config.sh --unattended --url "$REPO_URL" --token "$RUNNER_TOKEN" \
    --name "$RUNNER_NAME" --labels "$LABELS" --replace
fi
exec ./run.sh
