import {
  type AgentTelemetry,
  type FleetAgentTelemetryView,
  THERMAL_COLLAPSE_CLOCK_RATIO,
  THERMAL_COLLAPSE_MIN_TEMP_C,
} from '@aivastra/types';

type GpuSignals = FleetAgentTelemetryView['signals'][number];

/**
 * Derived, per-GPU signals. Computed on read so the thresholds can change without redeploying
 * agents. Every output is null when its inputs are unknown; nothing here ever invents a zero.
 */
export function deriveGpuSignals(telemetry: AgentTelemetry): GpuSignals[] {
  return telemetry.gpus.map((gpu) => {
    const { smClockMhz: clock, smClockMaxMhz: max, tempC } = gpu;
    const clockRatio = clock !== null && max !== null && max > 0 ? clock / max : null;
    const thermalCollapseNow =
      clockRatio === null || tempC === null
        ? null
        : clockRatio < THERMAL_COLLAPSE_CLOCK_RATIO && tempC >= THERMAL_COLLAPSE_MIN_TEMP_C;

    // Foreign load is only knowable when the box shows us which processes are using this GPU.
    // On a shared pod/VM the list can be empty while someone else holds the memory, so "no
    // visible apps" is unknown, not "all of it is foreign" and not "none of it is".
    const ours = telemetry.computeApps.filter((a) => a.gpuIndex === gpu.index);
    let foreignVramMib: number | null = null;
    if (gpu.vramUsedMib !== null && ours.length > 0 && ours.every((a) => a.vramMib !== null)) {
      const visible = ours.reduce((sum, a) => sum + (a.vramMib ?? 0), 0);
      // Visible usage above the device total is inconsistent data: say unknown.
      if (visible <= gpu.vramUsedMib) foreignVramMib = gpu.vramUsedMib - visible;
    }
    return {
      index: gpu.index,
      clockRatio: clockRatio === null ? null : Math.round(clockRatio * 1000) / 1000,
      thermalCollapseNow,
      foreignVramMib,
    };
  });
}
