import type { PluginServerContext } from "@getpaseo/plugin/server";
import { appsRpc, launchRpc, openWithSettings } from "./shared/open-with";
import { launchApp, listApps } from "./server/open-with";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(openWithSettings);
  server.handle(appsRpc, () => listApps(settings));
  server.handle(launchRpc, (input, { paseo }) => launchApp(input, settings, paseo));
  return () => {};
}
