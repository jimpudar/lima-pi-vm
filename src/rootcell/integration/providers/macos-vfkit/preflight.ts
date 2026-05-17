import { commandExists, runCapture } from "../../../process.ts";

export function preflightMacOsVfkitIntegration(): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("macos-vfkit integration tests require macOS");
  }
  if (process.arch !== "arm64") {
    throw new Error("macos-vfkit integration tests currently require Apple Silicon arm64 hosts");
  }
  if (!hypervisorFrameworkAvailable()) {
    throw new Error("macos-vfkit integration tests require Hypervisor.framework support (sysctl kern.hv_support=1); this runner likely does not support nested virtualization");
  }
  for (const tool of [
    { command: "vfkit", envVar: "ROOTCELL_VFKIT" },
    { command: "python3", envVar: "ROOTCELL_PYTHON" },
    { command: "zstd", envVar: "ROOTCELL_ZSTD" },
    { command: "ssh" },
    { command: "curl" },
  ] as const) {
    if (!toolAvailable(tool.command, tool.envVar)) {
      throw new Error(`macos-vfkit integration tests require '${tool.command}' on PATH or ${tool.envVar ?? "a configured override"}`);
    }
  }
  return Promise.resolve();
}

function hypervisorFrameworkAvailable(): boolean {
  const result = runCapture("sysctl", ["-n", "kern.hv_support"], { allowFailure: true });
  return result.status === 0 && result.stdout.trim() === "1";
}

function toolAvailable(command: string, envVar?: string): boolean {
  return (envVar !== undefined && process.env[envVar] !== undefined && process.env[envVar].length > 0)
    || commandExists(command);
}
