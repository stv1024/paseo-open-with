import { stat } from "node:fs/promises";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext, PluginSettings } from "@getpaseo/plugin/server";
import { appsRpc, launchRpc, mergeEntries, settingsSchema, type App } from "../shared/open-with";
import { buildCommand, describeEntry, launch, nodeRuntime, PRESETS, resolveCommand } from "./apps";
import { readIcons } from "./icons";
import type { PresetId } from "../shared/open-with";

type Paseo = PluginHandlerContext["paseo"];
type Settings = PluginSettings<typeof settingsSchema>;

async function storedEntries(settings: Settings) {
  const state = await settings.read();
  return mergeEntries(state.status === "ready" ? state.values.entries : []);
}

/** Where to read each app's icon: the program, or a sibling exe when the program is a script. */
function iconSource(app: App): string | null {
  if (app.preset && app.command === app.defaults.command) {
    const iconFrom = PRESETS[app.preset as PresetId].iconFrom?.(nodeRuntime);
    if (iconFrom) return resolveCommand(iconFrom, nodeRuntime);
  }
  return app.command && /\.exe$/i.test(app.command) ? app.command : null;
}

export async function listApps(settings: Settings): Promise<RpcOutput<typeof appsRpc>> {
  const apps = (await storedEntries(settings)).map((entry) => describeEntry(entry, nodeRuntime));
  const sources = apps.map(iconSource);
  const icons = await readIcons(sources.filter((s): s is string => s !== null));
  return {
    apps: apps.map((app, index) => {
      const image = sources[index] ? icons.get(sources[index]) : undefined;
      return image ? { ...app, image } : app;
    }),
  };
}

async function workspaceFolder(paseo: Paseo, workspaceId: string): Promise<string | null> {
  const ref = paseo.workspaces.ref(workspaceId);
  const workspace = await ref.refresh();
  return workspace?.workspaceDirectory ?? ref.directory ?? null;
}

export async function launchApp(
  input: RpcInput<typeof launchRpc>,
  settings: Settings,
  paseo: Paseo,
): Promise<RpcOutput<typeof launchRpc>> {
  const entry = (await storedEntries(settings)).find((e) => e.id === input.appId);
  if (!entry) return { ok: false, reason: "unknown-app" };
  const app = describeEntry(entry, nodeRuntime);
  if (!app.command) return { ok: false, reason: "not-installed" };

  const folder = await workspaceFolder(paseo, input.workspaceId).catch(() => null);
  if (!folder || !(await stat(folder).then((s) => s.isDirectory(), () => false))) {
    return { ok: false, reason: "no-folder" };
  }
  try {
    await launch(buildCommand(app, folder, nodeRuntime), folder);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: "failed", message: error instanceof Error ? error.message : String(error) };
  }
}
