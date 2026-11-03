# fleet-agent

Read-only telemetry agent for one GPU box. Python 3 stdlib only, outbound HTTPS only, no inbound
port, no commands accepted (v0.1). Contract: `packages/types/src/fleet-agent.ts`. Design:
`docs/fleet-agent-design.md`.

    python3 -I -m unittest discover -s tests          # tests, against recorded w7 outputs
    python3 fleet_agent.py --config c.json --print    # one payload to stdout, sends nothing

Install on a box (w7 first, shadow mode, see design section 10):
1. Create an agent key in the dashboard (Worker > Agent). The plaintext is shown once.
2. `sudo useradd -r -s /usr/sbin/nologin aivastra-agent`
3. `sudo install -d /opt/aivastra-agent && sudo install -m 755 fleet_agent.py /opt/aivastra-agent/`
4. Write the key to `/etc/aivastra-agent.key` (root:aivastra-agent, mode 640 is NOT enough: the agent
   refuses group/other-readable keys, so use owner aivastra-agent, mode 600).
5. Copy `config.example.json` to `/etc/aivastra-agent.json`, set workerId, unit and ComfyUI port.
6. `sudo install -m 644 systemd/aivastra-agent.service /etc/systemd/system/ && sudo systemctl enable --now aivastra-agent`
7. `journalctl -u aivastra-agent -f`; the worker's Agent panel should show a heartbeat within 15 s.

Remove: `systemctl disable --now aivastra-agent`, delete the files, revoke the key in the dashboard.
