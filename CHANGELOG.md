# Changelog

## 0.2.4

- Fix the file link menu that showed "Workspace folder not found" about one
  second after a right-click, with Show in Folder and Open turned gray. Paseo
  loads the plugin once for each connected host. A remote host often loads it
  before its relay connects, so its first `hosts.list` call failed, and that
  copy then answered right-clicks on every host. Its menu covered the menu of
  the right host and looked for the file on the wrong computer. Now the copy
  tries again until the host answers, and until then it lets the other copies
  answer. Update the plugin on every host, because each host sends its own copy.

## 0.2.3

- Start `.cmd` and `.bat` apps on Windows (for example GitHub Desktop) through
  `cmd.exe /d /s /c` with one quoted command line, instead of
  `spawn(..., { shell: true })`. Node.js no longer prints the DEP0190
  warning in the plugin log. Paths with spaces, `&`, and parentheses still
  reach the app as one argument.
- The header button, its menu items, and the settings tab follow a change of
  the app language at once. Before, they kept the language that was active when
  the plugin loaded.
- Update the Paseo SDK used for type checks to 0.16.1. The plugin still runs on
  Paseo 0.13.2 and later.

## 0.2.2

- Fix the missing Open With button on workspaces created after the plugin loads
  (for example a new worktree workspace). The first workspace list call now
  subscribes, so the update handler receives new and removed workspaces
  ([#2](https://github.com/stv1024/paseo-open-with/issues/2)).

## 0.2.1

- Fix the Terminal app on Linux with Konsole. Konsole now gets `--workdir`, and
  gnome-terminal keeps `--working-directory`. `x-terminal-emulator` gets no
  option and starts in the folder. Before, Konsole exited at once and nothing
  opened ([#1](https://github.com/stv1024/paseo-open-with/issues/1)).

## 0.2.0

- Includes the File Links plugin. Right-click a local file link or image in an
  agent reply to show it in its folder, open it, copy its path, or copy the image.
  Remove File Links (`paseo plugin remove file-links`), or file links get two menus.
- New **Open With ›** submenu on file links. It uses the same app list as the
  header menu. Fork and GitHub Desktop get the git repository that holds the
  file, and the terminal gets its folder.
- **Show in Folder** on a folder link now selects the folder in its parent
  folder, the same as on a file link.
- On Linux, **Show in Folder** selects the file through the
  `org.freedesktop.FileManager1` D-Bus interface, and opens the folder when no
  file manager answers.
- New promo image and file link screenshots on the plugin page.

## 0.1.1

- Add screenshots of the menu and the settings to the plugin page.

## 0.1.0

- A button in the workspace header opens the workspace folder in another app.
- Built-in apps: Fork, GitHub Desktop, VS Code, Cursor, a terminal, and the file
  manager. The menu shows only the apps it finds, with their own icons on Windows.
- **Edit apps…** adds any program with its arguments, changes the path of a
  built-in app, turns apps off, and changes their order. Settings belong to each
  daemon.
- English and Simplified Chinese.
