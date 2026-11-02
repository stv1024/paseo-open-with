import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { fileLinkRpc, parseLocalHref } from "../shared/file-links";
import type { OpenResult } from "./open-with";

type FileLinkInput = RpcInput<typeof fileLinkRpc>;
type FileLinkOutput = RpcOutput<typeof fileLinkRpc>;
type PaseoApi = PluginHandlerContext["paseo"];

export interface Command {
  executable: string;
  args: string[];
  verbatim?: boolean;
  /** Wait for the exit code, and try the next command when it is not 0. */
  check?: boolean;
}

/** Opens a file or folder in an app from the Open With list. */
export type OpenApp = (appId: string, path: string, isDirectory: boolean) => Promise<OpenResult>;

class FileLinkError extends Error {
  constructor(
    readonly reason: "invalid" | "no-base",
    message: string,
  ) {
    super(message);
  }
}

function pathApi(platform: NodeJS.Platform) {
  return platform === "win32" ? win32 : posix;
}

/** Turns an href into an absolute path. `base` is only read for relative paths. */
export async function hrefToAbsolutePath(
  href: string,
  base: () => Promise<string | null>,
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  const local = parseLocalHref(href);
  if (!local) {
    throw new FileLinkError("invalid", "The link has no local path.");
  }
  const path = pathApi(platform);
  if (local.kind === "file-url") {
    try {
      return path.resolve(fileURLToPath(local.url, { windows: platform === "win32" }));
    } catch {
      throw new FileLinkError("invalid", "The file URL is not valid.");
    }
  }

  const raw = local.path;
  if (raw === "~" || /^~[\\/]/.test(raw)) {
    return path.resolve(homedir(), raw.slice(2));
  }
  if (path.isAbsolute(raw)) {
    return path.resolve(raw);
  }
  const root = await base();
  if (!root) {
    throw new FileLinkError("no-base", "The workspace folder is unknown.");
  }
  return path.resolve(root, raw);
}

/** The commands to try in order. `reveal` selects the file or folder in its parent folder. */
export function buildCommands(
  action: "reveal" | "open",
  filePath: string,
  platform: NodeJS.Platform = process.platform,
): Command[] {
  if (platform === "win32") {
    // explorer.exe needs the quotes inside the `/select,` argument, so pass it verbatim.
    const quoted = `"${filePath}"`;
    return [{ executable: "explorer.exe", args: [action === "reveal" ? `/select,${quoted}` : quoted], verbatim: true }];
  }
  if (platform === "darwin") {
    return [{ executable: "/usr/bin/open", args: action === "reveal" ? ["-R", filePath] : [filePath] }];
  }
  if (action === "open") {
    return [{ executable: "xdg-open", args: [filePath] }];
  }
  // Most Linux file managers select items through this D-Bus call. Others get the parent folder.
  const uri = "file://" + filePath.split("/").map(encodeURIComponent).join("/");
  return [
    {
      executable: "dbus-send",
      args: [
        "--session",
        "--print-reply",
        "--dest=org.freedesktop.FileManager1",
        "/org/freedesktop/FileManager1",
        "org.freedesktop.FileManager1.ShowItems",
        `array:string:${uri}`,
        "string:",
      ],
      check: true,
    },
    { executable: "xdg-open", args: [posix.dirname(filePath)] },
  ];
}

function run(command: Command): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      detached: !command.check,
      stdio: "ignore",
      shell: false,
      windowsVerbatimArguments: command.verbatim === true,
    });
    child.once("error", reject);
    if (command.check) {
      child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
      return;
    }
    // explorer.exe exits with code 1 even on success, so only a spawn failure counts.
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function runFirst(commands: Command[]): Promise<void> {
  let failure: unknown;
  for (const command of commands) {
    try {
      return await run(command);
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}

async function workspaceRoot(input: FileLinkInput, paseo: PaseoApi): Promise<string | null> {
  if (input.agentId) {
    const agent = paseo.agents.ref(input.agentId);
    await agent.refresh();
    if (agent.cwd) {
      return agent.cwd;
    }
  }
  if (input.workspaceId) {
    const workspace = await paseo.workspaces.ref(input.workspaceId).refresh();
    return workspace?.workspaceDirectory ?? null;
  }
  return null;
}

export async function actOnFileLink(
  input: FileLinkInput,
  paseo: PaseoApi,
  openApp: OpenApp,
): Promise<FileLinkOutput> {
  let filePath: string;
  try {
    filePath = await hrefToAbsolutePath(input.href, () => workspaceRoot(input, paseo));
  } catch (error) {
    return { ok: false, reason: error instanceof FileLinkError ? error.reason : "failed" };
  }

  let isDirectory: boolean;
  try {
    isDirectory = (await stat(filePath)).isDirectory();
  } catch {
    return { ok: false, reason: "not-found", path: filePath };
  }

  if (input.action === "app") {
    if (!input.appId) {
      return { ok: false, reason: "unknown-app", path: filePath };
    }
    const result = await openApp(input.appId, filePath, isDirectory);
    return result.ok ? { ok: true, path: filePath, isDirectory } : { ...result, path: filePath };
  }
  if (input.action !== "resolve") {
    try {
      await runFirst(buildCommands(input.action, filePath));
    } catch {
      return { ok: false, reason: "failed", path: filePath };
    }
  }
  return { ok: true, path: filePath, isDirectory };
}
