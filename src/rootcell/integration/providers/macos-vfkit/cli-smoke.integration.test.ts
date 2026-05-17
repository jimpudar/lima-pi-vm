import { randomBytes } from "node:crypto";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { describe, expect, test } from "vitest";
import { deriveVmNames } from "../../../instance.ts";
import { CLI_SMOKE_INSTANCE_PREFIX, findRepoDir } from "../../common/fixtures.ts";
import { selectedIntegrationProvider } from "../../common/provider-spec.ts";
import { macOsVfkitIntegrationProvider, readJson, removeVfkitInstanceState, vfkitPrivateLinkStatePath, vfkitStatePath } from "./provider.ts";

const MACOS_UNIX_SOCKET_PATH_LIMIT = 104;
const SOCKET_PATH_HEADROOM = 8;
const VFKIT_SOCKET_PATH_LIMIT_WITH_HEADROOM = MACOS_UNIX_SOCKET_PATH_LIMIT - SOCKET_PATH_HEADROOM;
const ROOTCELL_START_TIMEOUT_MS = 30 * 60_000;
const ROOTCELL_COMMAND_TIMEOUT_MS = 3 * 60_000;
const ROOTCELL_CLEANUP_TIMEOUT_MS = 5 * 60_000;
const TEST_TIMEOUT_MS = ROOTCELL_START_TIMEOUT_MS + 10 * 60_000;

const shouldRun = selectedIntegrationProvider().id === macOsVfkitIntegrationProvider.id;

describe.skipIf(!shouldRun)("macos-vfkit CLI smoke", { concurrent: false }, () => {
  test("starts a fresh instance through ./rootcell and enforces egress policy", async () => {
    await macOsVfkitIntegrationProvider.preflight();

    const repoDir = findRepoDir(import.meta.url);
    const instance = randomSmokeInstance();

    try {
      const start = runRootcell(repoDir, ["--instance", instance, "--", "true"], ROOTCELL_START_TIMEOUT_MS);
      expect(start.status).toBe(0);

      const list = captureRootcell(repoDir, ["list", "--instance", instance]);
      expect(list.status, list.stderr).toBe(0);
      expectRunningVms(list.stdout, instance);
      expectVfkitSocketPathsHaveHeadroom(repoDir, instance);

      const allowed = runRootcell(repoDir, [
        "--instance",
        instance,
        "--",
        "curl",
        "-fsS",
        "--connect-timeout",
        "5",
        "--max-time",
        "20",
        "-o",
        "/dev/null",
        "https://github.com",
      ]);
      expect(allowed.status).toBe(0);

      const denied = runRootcell(repoDir, [
        "--instance",
        instance,
        "--",
        "curl",
        "-fsS",
        "--connect-timeout",
        "3",
        "--max-time",
        "8",
        "-o",
        "/dev/null",
        "https://evil.com",
      ]);
      expect(denied.status).not.toBe(0);
    } finally {
      await removeSmokeInstance(repoDir, instance);
    }
  }, TEST_TIMEOUT_MS);
});

function randomSmokeInstance(): string {
  return `${CLI_SMOKE_INSTANCE_PREFIX}${randomBytes(4).toString("hex")}`;
}

function runRootcell(
  repoDir: string,
  args: readonly string[],
  timeout = ROOTCELL_COMMAND_TIMEOUT_MS,
): { readonly status: number } {
  const result = spawnSync("./rootcell", [...args], {
    cwd: repoDir,
    stdio: "inherit",
    timeout,
  });
  return { status: commandStatus(result) };
}

function captureRootcell(
  repoDir: string,
  args: readonly string[],
): { readonly status: number; readonly stdout: string; readonly stderr: string } {
  const result = spawnSync("./rootcell", [...args], {
    cwd: repoDir,
    encoding: "utf8",
    timeout: ROOTCELL_COMMAND_TIMEOUT_MS,
  });
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  return {
    status: commandStatus(result),
    stdout,
    stderr: result.error instanceof Error && stderr.length === 0 ? result.error.message : stderr,
  };
}

function expectRunningVms(output: string, instance: string): void {
  const rows = output.split(/\r?\n/)
    .slice(1)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.trim().split(/\s+/));
  const names = deriveVmNames(instance);

  expect(rows).toHaveLength(2);
  expect(rows).toEqual(expect.arrayContaining([
    [instance, names.agentVm, "running"],
    [instance, names.firewallVm, "running"],
  ]));
}

function expectVfkitSocketPathsHaveHeadroom(repoDir: string, instance: string): void {
  const names = deriveVmNames(instance);
  const agent = readJson(vfkitStatePath(repoDir, names.agentVm, instance));
  const firewall = readJson(vfkitStatePath(repoDir, names.firewallVm, instance));
  const privateLink = readJson(vfkitPrivateLinkStatePath(repoDir, instance));

  for (const path of [
    agent.restSocketPath,
    firewall.restSocketPath,
    privateLink.agentSocketPath,
    privateLink.firewallSocketPath,
  ]) {
    expect(typeof path).toBe("string");
    if (typeof path !== "string") {
      throw new Error(`expected vfkit socket path to be a string, got ${String(path)}`);
    }
    expect(path.length).toBeLessThan(VFKIT_SOCKET_PATH_LIMIT_WITH_HEADROOM);
  }
}

async function removeSmokeInstance(repoDir: string, instance: string): Promise<void> {
  runRootcell(repoDir, ["remove", "--instance", instance], ROOTCELL_CLEANUP_TIMEOUT_MS);
  await removeVfkitInstanceState(repoDir, instance);
  const list = captureRootcell(repoDir, ["list", "--instance", instance]);
  if (list.status === 0) {
    const names = deriveVmNames(instance);
    expect(list.stdout).toContain(`${instance}  ${names.agentVm}`);
    expect(list.stdout).toContain("missing");
  }
}

function commandStatus(result: SpawnSyncReturns<string | Buffer>): number {
  if (result.status !== null) {
    return result.status;
  }
  if (result.error instanceof Error && "code" in result.error && result.error.code === "ETIMEDOUT") {
    return 124;
  }
  if (result.signal === "SIGINT") {
    return 130;
  }
  if (result.signal === "SIGTERM") {
    return 143;
  }
  return 1;
}
