# fleet-agent

Read-only telemetry agent for one GPU box. Python 3 stdlib only, outbound HTTPS only, no inbound
port, no commands accepted. Contract: `packages/types/src/fleet-agent.ts`. Design:
`docs/fleet-agent-design.md`.

    python3 -I -m unittest discover -s tests          # tests, against recorded w7 outputs
    python3 fleet_agent.py --config c.json --print    # one payload to stdout, sends nothing

The agent reports as its **box** (e.g. `w6`, the name vps-sync uses), not as a dispatcher worker:
config `workerId` holds the box id. The GPU dashboard's Boxes page lists every enrolled box whether or
not the dispatcher uses it; the dispatcher only adds a label. v0.2 adds the NVIDIA driver version
(read from `/proc/driver/nvidia/version`, no extra process).

## Install

Installed and kept current by the private `vps-sync` repo, never by hand:

1. Once, ever: on the dashboard's Boxes page, Setup, create an enrolment token (SUPER_ADMIN; shown
   once), then on your machine `bash fleet-converge.sh --set-enroll-token` and paste it.
2. Per box: `bash fleet-converge.sh --apply --agent w6` (or `--baseline w8` for a new box). It
   registers the box with `POST /v1/fleet/enroll`, links the worker named in `boxes/fleet.txt`, and
   pipes the box's agent key straight into the box; converge.sh installs the file, the unit, a config
   naming that box's ComfyUI unit and port, and the key (owner `aivastra-agent`, mode 600), runs one
   `--print` dry run as the agent user, then enables the service.
3. The box appears on the Boxes page within about 15 s.

Remove: `fleet-converge.sh --apply --remove-agent w6`, then revoke the key on the dashboard. Re-enrolling
a box revokes its old key automatically.
