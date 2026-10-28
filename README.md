# Open With for Paseo

A [Paseo](https://paseo.sh) plugin that opens the workspace folder in another app,
in two clicks from the workspace header.

Paseo's own "Open in" button has a fixed list of editors, and you cannot add an
app such as Fork. Open With has a menu that you can change: add any program, turn
apps off, and put them in your order.

## Install

Requires **Paseo 0.13.2 or later**.

```bash
paseo plugin install https://github.com/stv1024/paseo-open-with
```

If the button does not show, reload the Paseo window (**Ctrl+R**, or **Cmd+R** on macOS).

## Use

Click the button in the workspace header, then click an app.

Built-in apps:

| App | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Fork | `%LOCALAPPDATA%\Fork` | `/Applications/Fork.app` | - |
| GitHub Desktop | `%LOCALAPPDATA%\GitHubDesktop` | `/Applications/GitHub Desktop.app` | `github-desktop` |
| VS Code | user or system install, or `code` | `/Applications/Visual Studio Code.app`, or `code` | `code` |
| Cursor | user or system install, or `cursor` | `/Applications/Cursor.app`, or `cursor` | `cursor` |
| Terminal | Windows Terminal (`wt`) | Terminal.app | `x-terminal-emulator`, `gnome-terminal`, `konsole` |
| File Manager | File Explorer | Finder | `xdg-open` |

The menu shows only the apps it finds. Apps on `PATH` are found too.

## Add an app

Choose **Edit apps…** at the bottom of the menu. Then choose **Add app** and fill in:

| Field | Example |
| --- | --- |
| Program | `C:\Program Files\Sublime Merge\sublime_merge.exe` |
| Arguments | `"{path}"` |
| Name | `Sublime Merge` |
| Icon | a [Lucide](https://lucide.dev/icons) icon name, used when Paseo cannot read the program icon |

`{path}` is the workspace folder. Arguments split on spaces. Double quotes keep a
value with spaces together, and backslashes stay as they are. `%VAR%` (Windows) and
a leading `~` in the program path are expanded. A program name without a folder is
looked up on `PATH`.

To change a built-in app, click it and fill in only the fields to change. **Reset**
returns it to the defaults.

Settings are saved per daemon, so each computer keeps its own list.

## How it works

The daemon finds the apps, reads their icons (Windows only), and starts the app
with the workspace folder. So the app opens on the computer that runs the daemon.
A launch error shows as a toast.

## Develop

```bash
npm install
npm run typecheck
npm test
paseo plugin install .
```

### Release

Releases go to npm as `paseo-open-with` through
[`.github/workflows/release.yml`](.github/workflows/release.yml), with npm Trusted
Publishing (no npm token). Bump `version` in `package.json`, add a `CHANGELOG.md`
section, then commit, tag and push:

```bash
npm run typecheck && npm test && npm run pack:npm   # check the packed file list
git push origin main
git tag -a v0.1.0 -m "Open With 0.1.0" && git push origin v0.1.0
```

The tag push publishes the tarball. Then create the GitHub release from the tag.
The official registry opens a bump PR for each new npm version.

## License

MIT
