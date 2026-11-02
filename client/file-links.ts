import type { PluginClientContext } from "@getpaseo/plugin/client";
import { Platform } from "react-native";
import {
  fileLinkRpc,
  getRouteContext,
  parseLocalHref,
  type FileLinkAction,
  type FileLinkFailure,
} from "../shared/file-links";
import type { App } from "../shared/open-with";
import { SETTINGS_ID, type OpenWithMenu } from "./menu";
import { messages } from "./messages";

// This plugin typechecks without the DOM library. Declare only what this module uses.
interface Style {
  [property: string]: string;
}

interface Element {
  readonly style: Style;
  readonly parentElement: Element | null;
  readonly offsetWidth: number;
  readonly offsetHeight: number;
  textContent: string | null;
  closest(selector: string): Element | null;
  contains(other: unknown): boolean;
  getBoundingClientRect(): { readonly left: number; readonly right: number; readonly top: number };
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  appendChild(child: Element): void;
  replaceChildren(...children: Element[]): void;
  remove(): void;
  addEventListener(type: string, listener: (event: DomEvent) => void): void;
}

interface DomEvent {
  readonly target: unknown;
  readonly key?: string;
  readonly clientX: number;
  readonly clientY: number;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

interface ComputedStyle {
  readonly color: string;
  readonly backgroundColor: string;
  readonly fontFamily: string;
}

interface ImageElement extends Element {
  readonly naturalWidth: number;
  readonly naturalHeight: number;
}

interface Canvas {
  width: number;
  height: number;
  getContext(type: "2d"): { drawImage(image: ImageElement, x: number, y: number): void } | null;
  toBlob(callback: (blob: Blob | null) => void, type: string): void;
}

interface Blob {
  readonly type: string;
}

declare class ClipboardItem {
  constructor(items: Record<string, Promise<Blob>>);
}

declare const document: {
  readonly body: Element;
  createElement(tag: "canvas"): Canvas;
  createElement(tag: string): Element;
  addEventListener(type: string, listener: (event: DomEvent) => void, capture: boolean): void;
  removeEventListener(type: string, listener: (event: DomEvent) => void, capture: boolean): void;
};
declare const window: {
  readonly innerWidth: number;
  readonly innerHeight: number;
  getComputedStyle(element: Element): ComputedStyle;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};
declare const location: { readonly pathname: string };
declare const navigator: {
  readonly clipboard: {
    writeText(text: string): Promise<void>;
    write(items: ClipboardItem[]): Promise<void>;
  };
};
declare function setTimeout(callback: () => void, ms: number): unknown;

type Resolution =
  | { ok: true; path: string; isDirectory: boolean }
  | { ok: false; reason: FileLinkFailure; path?: string; message?: string };

const EDGE = 8;
const ERROR_MS = 2000;

// The Lucide icons that the built-in apps use. Other names get AppWindow.
const LUCIDE: Record<string, string> = {
  GitFork:
    '<circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/><path d="M12 12v3"/>',
  Github:
    '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>',
  Code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  MousePointer2:
    '<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/>',
  SquareTerminal: '<path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>',
  AppWindow: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 4v4"/><path d="M2 8h20"/><path d="M6 4v4"/>',
  Settings2:
    '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
};

function lucideImage(name: string, color: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-opacity="0.7" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${LUCIDE[name] ?? LUCIDE.AppWindow}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function asElement(value: unknown): Element | null {
  return value && typeof value === "object" && "closest" in value ? (value as Element) : null;
}

interface MenuTarget {
  element: Element;
  /** Local file source, or null when the target has no file on disk. */
  href: string | null;
  image: ImageElement | null;
}

// Paseo shows markdown images from preview URLs and keeps the original sources here.
const IMAGE_SOURCES_ATTRIBUTE = "data-paseo-markdown-image-sources";

function findImage(target: Element): MenuTarget | null {
  const image = target.closest("img") as ImageElement | null;
  const sources = image?.closest(`[${IMAGE_SOURCES_ATTRIBUTE}]`)?.getAttribute(IMAGE_SOURCES_ATTRIBUTE);
  if (!image || !sources) {
    return null;
  }
  const src = image.getAttribute("src") ?? "";
  let source = src;
  try {
    source = (JSON.parse(sources) as Record<string, string>)[src] ?? src;
  } catch {
    // Keep the displayed URL.
  }
  return { element: image, href: parseLocalHref(source) ? source : null, image };
}

/** Assistant markdown links open in a new target; app navigation links do not. */
function findLink(target: Element): MenuTarget | null {
  const anchor = target.closest('a[href][target="_blank"]');
  const href = anchor?.getAttribute("href") ?? "";
  if (!anchor || !parseLocalHref(href)) {
    return null;
  }
  return { element: anchor, href, image: null };
}

function findTarget(event: DomEvent): MenuTarget | null {
  const target = asElement(event.target);
  return target ? (findImage(target) ?? findLink(target)) : null;
}

function imageToPng(image: ImageElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      reject(new Error("No 2D canvas"));
      return;
    }
    context.drawImage(image, 0, 0);
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No PNG"))), "image/png");
  });
}

function isTransparent(color: string): boolean {
  return color === "transparent" || /rgba\(.*,\s*0\)$/.test(color);
}

function luminance(color: string): number | null {
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length < 3) {
    return null;
  }
  const [r, g, b] = channels.map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) {
    return 21;
  }
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function themeFrom(anchor: Element) {
  const text = anchor.parentElement?.parentElement ?? anchor;
  const textStyle = window.getComputedStyle(text);
  let background = "rgb(32, 32, 32)";
  for (let node: Element | null = anchor; node; node = node.parentElement) {
    const color = window.getComputedStyle(node).backgroundColor;
    if (!isTransparent(color)) {
      background = color;
      break;
    }
  }
  // An image has no text color of its own, so its inherited color can be unreadable.
  let foreground = textStyle.color;
  if (contrast(foreground, background) < 4.5) {
    foreground = (luminance(background) ?? 0) < 0.5 ? "rgb(236, 236, 236)" : "rgb(28, 28, 28)";
  }
  return { foreground, background, fontFamily: textStyle.fontFamily };
}

export function installFileLinkMenu(client: PluginClientContext, openWith: OpenWithMenu): () => void {
  if (Platform.OS !== "web") {
    return () => {};
  }

  let closeMenu: (() => void) | null = null;
  type Key = "reveal" | "open" | "openWith" | "copyPath" | "copyImage" | "fileNotFound" | "cannotOpen" | "noFolder" | "edit";
  const t = (key: Key) => client.i18n.t(messages, key);

  const failureText = (reason: FileLinkFailure, app?: App) => {
    if (app && reason === "not-installed") return client.i18n.t(messages, "notInstalled", { name: app.name });
    if (app && reason !== "not-found") return client.i18n.t(messages, "failed", { name: app.name });
    return reason === "not-found" ? t("fileNotFound") : reason === "no-base" ? t("noFolder") : t("cannotOpen");
  };

  const showMenu = (event: DomEvent, { element, href, image }: MenuTarget) => {
    closeMenu?.();
    const { agentId, workspaceId } = getRouteContext(location.pathname);
    const route = { agentId, workspaceId };
    const call = (action: FileLinkAction, appId?: string): Promise<Resolution> =>
      href
        ? client
            .rpc(fileLinkRpc, { href, action, appId, ...route })
            .catch((): Resolution => ({ ok: false, reason: "failed" }))
        : Promise.resolve({ ok: false, reason: "invalid" });
    const resolution = call("resolve");

    const theme = themeFrom(element);
    const hover = `color-mix(in srgb, ${theme.foreground} 10%, transparent)`;
    const panel = () => {
      const box = document.createElement("div");
      box.setAttribute("role", "menu");
      Object.assign(box.style, {
        position: "fixed",
        zIndex: "2147483647",
        minWidth: "160px",
        padding: "4px",
        borderRadius: "8px",
        border: `1px solid color-mix(in srgb, ${theme.foreground} 16%, transparent)`,
        background: theme.background,
        color: theme.foreground,
        fontFamily: theme.fontFamily,
        fontSize: "13px",
        lineHeight: "18px",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.28)",
        userSelect: "none",
        left: "0px",
        top: "0px",
        visibility: "hidden",
      });
      return box;
    };
    const place = (box: Element, left: number, top: number) => {
      box.style.left = `${Math.max(EDGE, Math.min(left, window.innerWidth - box.offsetWidth - EDGE))}px`;
      box.style.top = `${Math.max(EDGE, Math.min(top, window.innerHeight - box.offsetHeight - EDGE))}px`;
      box.style.visibility = "visible";
    };

    const menu = panel();
    let submenu: Element | null = null;
    const closeSubmenu = () => {
      submenu?.remove();
      submenu = null;
    };

    const row = (label: string, icon?: string) => {
      const item = document.createElement("div");
      Object.assign(item.style, {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "6px 10px",
        borderRadius: "5px",
        whiteSpace: "nowrap",
      });
      if (icon) {
        const image = document.createElement("img");
        image.setAttribute("src", icon);
        Object.assign(image.style, { width: "16px", height: "16px", flex: "none" });
        item.appendChild(image);
      }
      const text = document.createElement("span");
      text.textContent = label;
      item.appendChild(text);
      return item;
    };

    const separator = () => {
      const line = document.createElement("div");
      Object.assign(line.style, {
        height: "1px",
        margin: "4px 6px",
        background: `color-mix(in srgb, ${theme.foreground} 16%, transparent)`,
      });
      return line;
    };

    const showError = (text: string) => {
      closeSubmenu();
      const item = row(text);
      item.style.opacity = "0.7";
      menu.replaceChildren(item);
      setTimeout(close, ERROR_MS);
    };

    const highlight = (item: Element) => {
      item.addEventListener("mouseenter", () => {
        item.style.background = hover;
      });
      item.addEventListener("mouseleave", () => {
        item.style.background = "transparent";
      });
    };

    const button = (label: string, run: () => Promise<void>, icon?: string) => {
      const item = row(label, icon);
      item.setAttribute("role", "menuitem");
      item.style.cursor = "pointer";
      highlight(item);
      item.addEventListener("mouseenter", () => {
        if (item.parentElement === menu) closeSubmenu();
      });
      item.addEventListener("click", (clickEvent) => {
        clickEvent.stopPropagation();
        void run();
      });
      return item;
    };

    const act = (action: "reveal" | "open" | "app", app?: App) => async () => {
      const result = await call(action, app?.id);
      if (result.ok) {
        close();
      } else {
        showError(failureText(result.reason, app));
      }
    };

    const copy = async (write: () => Promise<void>) => {
      try {
        await write();
        close();
      } catch {
        showError(t("cannotOpen"));
      }
    };

    const copyPath = async () => {
      const result = await resolution;
      const local = parseLocalHref(href ?? "");
      const path = result.path ?? (local?.kind === "path" ? local.path : (href ?? ""));
      await copy(() => navigator.clipboard.writeText(path));
    };

    // Pass the PNG as a promise so the write starts inside the click.
    const copyImage = (target: ImageElement) => () =>
      copy(() => navigator.clipboard.write([new ClipboardItem({ "image/png": imageToPng(target) })]));

    // The file manager is already in the menu as Show in Folder.
    const apps = openWith.apps().filter((app) => app.enabled && app.command && app.preset !== "file-manager");

    const openSubmenu = (anchor: Element) => {
      if (submenu) return;
      const box = panel();
      for (const app of apps) {
        box.appendChild(button(app.name, act("app", app), app.image ?? lucideImage(app.icon, theme.foreground)));
      }
      box.appendChild(separator());
      const edit = async () => {
        close();
        client.openSettings(SETTINGS_ID);
      };
      box.appendChild(button(t("edit"), edit, lucideImage("Settings2", theme.foreground)));
      document.body.appendChild(box);
      submenu = box;
      const edges = menu.getBoundingClientRect();
      const right = edges.right + 2;
      const left = right + box.offsetWidth > window.innerWidth - EDGE ? edges.left - box.offsetWidth - 2 : right;
      // Line up the first app with the Open With row.
      place(box, left, anchor.getBoundingClientRect().top - 5);
    };

    const openWithRow = (() => {
      if (!href || apps.length === 0) return null;
      const item = row(t("openWith"));
      const arrow = document.createElement("span");
      arrow.textContent = "›";
      Object.assign(arrow.style, { marginLeft: "auto", paddingLeft: "16px", opacity: "0.6" });
      item.appendChild(arrow);
      item.setAttribute("role", "menuitem");
      item.setAttribute("aria-haspopup", "menu");
      item.style.cursor = "default";
      highlight(item);
      item.addEventListener("mouseenter", () => openSubmenu(item));
      item.addEventListener("click", (clickEvent) => {
        clickEvent.stopPropagation();
        openSubmenu(item);
      });
      return item;
    })();

    const fileActions = href
      ? [button(t("reveal"), act("reveal")), button(t("open"), act("open")), ...(openWithRow ? [openWithRow] : [])]
      : [];
    const fileItems = href ? [...fileActions, button(t("copyPath"), copyPath)] : [];
    const items = image ? [...fileItems, button(t("copyImage"), copyImage(image))] : fileItems;
    for (const item of items) {
      menu.appendChild(item);
    }

    void resolution.then((result) => {
      if (!href || result.ok || closeMenu !== close) {
        return;
      }
      closeSubmenu();
      for (const item of fileActions) {
        item.style.opacity = "0.4";
        item.style.pointerEvents = "none";
      }
      const note = row(failureText(result.reason));
      note.style.opacity = "0.7";
      menu.replaceChildren(note, ...items);
    });

    document.body.appendChild(menu);
    place(menu, event.clientX, event.clientY);

    const onPointerDown = (downEvent: DomEvent) => {
      if (!menu.contains(downEvent.target) && !submenu?.contains(downEvent.target)) {
        close();
      }
    };
    const onKeyDown = (keyEvent: DomEvent) => {
      if (keyEvent.key === "Escape") {
        close();
      }
    };
    const onViewportChange = () => close();

    function close() {
      if (closeMenu !== close) {
        return;
      }
      closeMenu = null;
      closeSubmenu();
      menu.remove();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("wheel", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("blur", onViewportChange);
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("wheel", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("blur", onViewportChange);
    closeMenu = close;
  };

  // The app loads this plugin once per connected host, and every copy sees the same
  // right-click. Only the copy whose host owns the open page may answer.
  // undefined: not known yet. null: the host did not say, so answer every route.
  let ownServerId: string | null | undefined;
  void client.paseo.hosts.list().then(
    (directory) => {
      ownServerId = directory.self.serverId;
    },
    () => {
      ownServerId = null;
    },
  );

  const onContextMenu = (event: DomEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    const { serverId } = getRouteContext(location.pathname);
    if (serverId && ownServerId !== null && serverId !== ownServerId) {
      return;
    }
    const target = findTarget(event);
    if (!target) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    showMenu(event, target);
  };

  document.addEventListener("contextmenu", onContextMenu, true);
  return () => {
    document.removeEventListener("contextmenu", onContextMenu, true);
    closeMenu?.();
  };
}
