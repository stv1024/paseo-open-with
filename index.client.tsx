import { ScrollView } from "react-native";
import type { PluginClientContext, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { installMenu, SETTINGS_ID } from "./client/menu";
import { messages } from "./client/messages";
import { SettingsScreen } from "./client/settings";

export default function contribute(client: PluginClientContext) {
  const menu = installMenu(client);
  const Settings = (props: PluginSurfaceProps) => (
    <ScrollView contentContainerStyle={{ padding: 18, maxWidth: 720 }}>
      <SettingsScreen {...props} onSaved={() => void menu.refresh()} />
    </ScrollView>
  );
  const removeSettings = client.addSettingsScreen({
    id: SETTINGS_ID,
    title: client.i18n.t(messages, "settings"),
    icon: "SquareArrowOutUpRight",
    Component: Settings,
  });
  return () => {
    removeSettings();
    menu.dispose();
  };
}
