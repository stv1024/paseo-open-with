import type { ComponentType } from "react";
import { Image } from "react-native";
import type {
  PluginButtonBehavior,
  PluginButtonIconProps,
  PluginButtonMenuEntry,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { appsRpc, launchRpc, type App } from "../shared/open-with";
import { messages } from "./messages";

export const SETTINGS_ID = "open-with";
const REFRESH_MS = 10 * 60 * 1000;

const imageIcons = new Map<string, ComponentType<PluginButtonIconProps>>();

/** One component per image, so menus keep a stable icon identity across refreshes. */
function imageIcon(uri: string): ComponentType<PluginButtonIconProps> {
  let icon = imageIcons.get(uri);
  if (!icon) {
    icon = ({ size }: PluginButtonIconProps) => <Image source={{ uri }} style={{ width: size, height: size }} />;
    imageIcons.set(uri, icon);
  }
  return icon;
}

export interface OpenWithMenu {
  /** Reads the app list again and rebuilds every menu. */
  refresh(): Promise<void>;
  dispose(): void;
}

export function installMenu(client: PluginClientContext): OpenWithMenu {
  const buttons = new Map<string, PluginButtonRegistration>();
  let apps: App[] = [];
  let disposed = false;

  const open = async (workspaceId: string, app: App) => {
    const result = await client.rpc(launchRpc, { workspaceId, appId: app.id });
    if (result.ok) return;
    const text =
      result.reason === "not-installed"
        ? client.i18n.t(messages, "notInstalled", { name: app.name })
        : result.reason === "no-folder"
          ? client.i18n.t(messages, "noFolder")
          : client.i18n.t(messages, "failed", { name: app.name });
    // Paseo shows a rejected press as an error.
    throw new Error(result.message ? `${text}: ${result.message}` : text);
  };

  const behavior = (workspaceId: string): PluginButtonBehavior => {
    const items: PluginButtonMenuEntry[] = apps
      .filter((app) => app.enabled && app.command)
      .map((app) => ({
        kind: "item",
        id: app.id,
        title: app.name,
        icon: app.image ? imageIcon(app.image) : app.icon,
        behavior: { kind: "action", onPress: () => open(workspaceId, app) },
      }));
    if (items.length === 0) {
      items.push({ kind: "item", id: "none", title: client.i18n.t(messages, "noApps"), disabled: true, behavior: { kind: "action", onPress() {} } });
    }
    items.push(
      { kind: "separator", id: "settings-separator" },
      {
        kind: "item",
        id: "settings",
        title: client.i18n.t(messages, "edit"),
        icon: "Settings2",
        behavior: { kind: "action", onPress: () => client.openSettings(SETTINGS_ID) },
      },
    );
    return { kind: "menu", items };
  };

  const addButton = (workspaceId: string) => {
    if (disposed || buttons.has(workspaceId)) return;
    buttons.set(
      workspaceId,
      client.addHeaderButton({
        id: "open-with",
        workspaceId,
        button: { title: client.i18n.t(messages, "button"), icon: "SquareArrowOutUpRight", behavior: behavior(workspaceId) },
      }),
    );
  };

  const removeButton = (workspaceId: string) => {
    buttons.get(workspaceId)?.remove();
    buttons.delete(workspaceId);
  };

  const refresh = async () => {
    try {
      apps = (await client.rpc(appsRpc, {})).apps;
    } catch (error) {
      console.error("[open-with] cannot read apps", error);
      return;
    }
    if (disposed) return;
    for (const [workspaceId, button] of buttons) button.update({ behavior: behavior(workspaceId) });
  };

  const unsubscribe = client.paseo.workspaces.subscribe((update) => {
    if (update.kind === "upsert") addButton(update.workspace.id);
    else removeButton(update.id);
  });

  void (async () => {
    await refresh();
    let cursor: string | undefined;
    do {
      const page = await client.paseo.workspaces.list({ page: { limit: 200, cursor } });
      page.entries.forEach((workspace) => addButton(workspace.id));
      cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
    } while (cursor && !disposed);
  })().catch((error: unknown) => console.error("[open-with] cannot list workspaces", error));

  // Picks up apps installed or removed while Paseo stays open.
  const timer = setInterval(() => void refresh(), REFRESH_MS);

  return {
    refresh,
    dispose() {
      disposed = true;
      clearInterval(timer);
      unsubscribe();
      buttons.forEach((button) => button.remove());
      buttons.clear();
    },
  };
}
