import { spawn } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { posix, win32 } from "node:path";
import { PATH_TOKEN, splitArgs, type App, type Entry, type PresetId } from "../shared/open-with";

export interface Runtime {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** True for files and for Windows app execution aliases, which `existsSync` reports as missing. */
  exists(path: string): boolean;
}

export const nodeRuntime: Runtime = {
  platform: process.platform,
  env: process.env,
  exists(path) {
    if (existsSync(path)) return true;
    try {
      return lstatSync(path).isSymbolicLink();
    } catch {
      return false;
    }
  },
};

interface Preset {
  name: string;
  icon: string;
  /** Candidates in order. A bare name is looked up on PATH. */
  commands(runtime: Runtime): string[];
  /** Where to read the program icon when the command is a script. */
  iconFrom?(runtime: Runtime): string[];
}

const home = (runtime: Runtime) => runtime.env.HOME ?? runtime.env.USERPROFILE ?? "";

function winCandidates(runtime: Runtime, local: string[], programFiles: string[]): string[] {
  const out: string[] = [];
  if (runtime.env.LOCALAPPDATA) out.push(...local.map((p) => `${runtime.env.LOCALAPPDATA}\\${p}`));
  for (const root of [runtime.env.ProgramFiles, runtime.env["ProgramFiles(x86)"]]) {
    if (root) out.push(...programFiles.map((p) => `${root}\\${p}`));
  }
  return out;
}

function macApp(runtime: Runtime, app: string, binary: string): string[] {
  return [`/Applications/${app}.app/${binary}`, `${home(runtime)}/Applications/${app}.app/${binary}`];
}

export const PRESETS: Record<PresetId, Preset> = {
  fork: {
    name: "Fork",
    icon: "GitFork",
    commands: (r) =>
      r.platform === "win32"
        ? winCandidates(r, ["Fork\\current\\Fork.exe", "Fork\\Fork.exe"], [])
        : r.platform === "darwin"
          ? [...macApp(r, "Fork", "Contents/Resources/fork_cli"), "fork"]
          : [],
  },
  "github-desktop": {
    name: "GitHub Desktop",
    icon: "Github",
    commands: (r) =>
      r.platform === "win32"
        ? [...winCandidates(r, ["GitHubDesktop\\bin\\github.bat"], []), "github"]
        : r.platform === "darwin"
          ? [...macApp(r, "GitHub Desktop", "Contents/Resources/app/static/github.sh"), "github"]
          : ["github-desktop"],
    iconFrom: (r) => (r.platform === "win32" ? winCandidates(r, ["GitHubDesktop\\GitHubDesktop.exe"], []) : []),
  },
  vscode: {
    name: "VS Code",
    icon: "Code",
    commands: (r) =>
      r.platform === "win32"
        ? [
            ...winCandidates(r, ["Programs\\Microsoft VS Code\\Code.exe"], ["Microsoft VS Code\\Code.exe"]),
            "code",
          ]
        : r.platform === "darwin"
          ? [...macApp(r, "Visual Studio Code", "Contents/Resources/app/bin/code"), "code"]
          : ["code"],
  },
  cursor: {
    name: "Cursor",
    icon: "MousePointer2",
    commands: (r) =>
      r.platform === "win32"
        ? [...winCandidates(r, ["Programs\\cursor\\Cursor.exe"], ["Cursor\\Cursor.exe"]), "cursor"]
        : r.platform === "darwin"
          ? [...macApp(r, "Cursor", "Contents/Resources/app/bin/cursor"), "cursor"]
          : ["cursor"],
  },
  terminal: {
    name: "Terminal",
    icon: "SquareTerminal",
    commands: (r) =>
      r.platform === "win32"
        ? [
            ...(r.env.LOCALAPPDATA ? [`${r.env.LOCALAPPDATA}\\Microsoft\\WindowsApps\\wt.exe`] : []),
            "wt",
          ]
        : r.platform === "darwin"
          ? ["/usr/bin/open"]
          : ["x-terminal-emulator", "gnome-terminal", "konsole"],
  },
  "file-manager": {
    name: "File Manager",
    icon: "Folder",
    commands: (r) =>
      r.platform === "win32" ? ["explorer.exe"] : r.platform === "darwin" ? ["/usr/bin/open"] : ["xdg-open"],
  },
};

/** Arguments that differ by platform for one preset, where `{path}` alone is not enough. */
function presetArgs(preset: PresetId, runtime: Runtime): string {
  if (preset === "terminal") {
    if (runtime.platform === "win32") return `-d "${PATH_TOKEN}"`;
    if (runtime.platform === "darwin") return `-a Terminal "${PATH_TOKEN}"`;
    return `--working-directory="${PATH_TOKEN}"`;
  }
  return `"${PATH_TOKEN}"`;
}

function isAbsolute(path: string, platform: NodeJS.Platform) {
  return platform === "win32" ? win32.isAbsolute(path) : posix.isAbsolute(path);
}

/** Finds a candidate on disk or on PATH, like a shell would. */
export function resolveCommand(candidates: readonly string[], runtime: Runtime): string | null {
  const windows = runtime.platform === "win32";
  const pathValue = runtime.env.PATH ?? runtime.env.Path ?? "";
  const dirs = pathValue.split(windows ? ";" : ":").filter(Boolean);
  for (const raw of candidates) {
    const candidate = expandEnv(raw, runtime);
    if (isAbsolute(candidate, runtime.platform)) {
      if (runtime.exists(candidate)) return candidate;
      continue;
    }
    const extensions =
      windows && !win32.extname(candidate) ? [".exe", ".cmd", ".bat", ".com"] : [""];
    for (const dir of dirs) {
      for (const extension of extensions) {
        const full = (windows ? win32 : posix).join(dir, candidate + extension);
        if (runtime.exists(full)) return full;
      }
    }
  }
  return null;
}

/** Expands `%NAME%` on Windows and a leading `~` everywhere. */
export function expandEnv(value: string, runtime: Runtime): string {
  let out = value.trim();
  if (out === "~" || out.startsWith("~/") || out.startsWith("~\\")) out = home(runtime) + out.slice(1);
  if (runtime.platform === "win32") {
    out = out.replace(/%([^%]+)%/g, (match, name: string) => {
      const key = Object.keys(runtime.env).find((k) => k.toLowerCase() === name.toLowerCase());
      return key ? (runtime.env[key] ?? match) : match;
    });
  }
  return out;
}

/** The menu entry after merging stored fields over the preset. */
export function describeEntry(entry: Entry, runtime: Runtime): App {
  const preset = entry.preset ? PRESETS[entry.preset as PresetId] : undefined;
  const defaults = {
    name: preset?.name ?? "",
    icon: preset?.icon ?? "AppWindow",
    command: preset ? resolveCommand(preset.commands(runtime), runtime) : null,
    args: preset ? presetArgs(entry.preset as PresetId, runtime) : `"${PATH_TOKEN}"`,
  };
  const command = entry.command ? resolveCommand([entry.command], runtime) : defaults.command;
  return {
    id: entry.id,
    preset: entry.preset,
    enabled: entry.enabled,
    name: entry.name || defaults.name || entry.command || entry.id,
    icon: entry.icon || defaults.icon,
    command,
    args: entry.args || defaults.args,
    defaults,
  };
}

export interface Command {
  executable: string;
  args: string[];
  /** Windows batch files run through cmd.exe, which needs its own quoting. */
  shell: boolean;
}

const CMD_SPECIAL = /[\s"&|^<>()!%]/;

function quoteForCmd(value: string): string {
  if (!value || CMD_SPECIAL.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function buildCommand(app: App, folder: string, runtime: Runtime): Command {
  if (!app.command) throw new Error(`${app.name} is not installed`);
  const args = splitArgs(app.args).map((arg) => arg.split(PATH_TOKEN).join(folder));
  const script = runtime.platform === "win32" && /\.(cmd|bat)$/i.test(app.command);
  if (script) {
    return { executable: quoteForCmd(app.command), args: args.map(quoteForCmd), shell: true };
  }
  return { executable: app.command, args, shell: false };
}

/** Keys the daemon sets for itself. Child apps must not inherit them. */
const DAEMON_ENV = ["PASEO_NODE_ENV", "PASEO_DESKTOP_MANAGED", "PASEO_SUPERVISED", "ELECTRON_RUN_AS_NODE", "ELECTRON_NO_ATTACH_CONSOLE"];

export function launch(command: Command, cwd: string, runtime: Runtime = nodeRuntime): Promise<void> {
  const env = { ...runtime.env };
  for (const key of DAEMON_ENV) delete env[key];
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      cwd,
      env,
      detached: true,
      stdio: "ignore",
      shell: command.shell,
      windowsHide: command.shell,
    });
    child.once("error", reject);
    // explorer.exe exits with code 1 even on success, so only a spawn failure counts.
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
