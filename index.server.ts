import type { PluginServerContext } from "@getpaseo/plugin/server";
import { appsRpc, launchRpc, openWithSettings } from "./shared/open-with";
import { fileLinkRpc } from "./shared/file-links";
import { launchApp, listApps, openInApp } from "./server/open-with";
import { actOnFileLink } from "./server/file-links";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(openWithSettings);
  server.handle(appsRpc, () => listApps(settings));
  server.handle(launchRpc, (input, { paseo }) => launchApp(input, settings, paseo));
  server.handle(fileLinkRpc, (input, { paseo }) =>
    actOnFileLink(input, paseo, (appId, path, isDirectory) => openInApp(appId, path, isDirectory, settings)),
  );
  return () => {};
}
