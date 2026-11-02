# Changelog

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
