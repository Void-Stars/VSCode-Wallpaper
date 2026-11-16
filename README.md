# VSCode-Wallpaper

Custom static / animated wallpapers for VS Code — with **real Wallpaper Engine `scene.pkg` rendering**, frosted glass, and floating panels.

English | [简体中文](README.zh-CN.md)

![demo](media/icon@4x.png)

## Features

- **Wallpapers**: single image, video, web page, or a whole folder (shuffle + auto-rotate).
- **Wallpaper Engine**: follows your *current* WE wallpaper, or pins one from your library. Supports `video`, `web` and **`scene.pkg` (WebGL2 real‑time rendering)**.
- **Frosted glass**: adjustable blur / opacity / saturation applied to title bar, activity bar, sidebar, editor, panel, auxiliary bar, status bar and tabs — each region can be toggled, brightness offsets per area are configurable.
- **Floating panels**: turns on VS Code's official *Modern UI* and lets this extension style it (card gaps, unified corner radius, seamless joins).
- **Wallpaper settings panel**: reads the `general.properties` of the current WE wallpaper and renders controls (bool / slider / combo) right inside the sidebar, e.g. *mouse trail*, *parallax*, *rain*, *audio bars*.

## Install

### From a VSIX (local build)

```bash
code --install-extension vscode-wallpaper-glass-1.0.0.vsix --force
```

### From source

```bash
npm install
node esbuild.js
npx @vscode/vsce package --allow-missing-repository --skip-license
code --install-extension vscode-wallpaper-glass-1.0.0.vsix --force
```

> Reload the window **twice** after installing a new version: the first reload lets the extension rewrite `workbench.html`, the second one is what actually loads it.

## Quick start

1. Open the **VSCode-Wallpaper** view in the activity bar (or run `VSCode-Wallpaper: 控制面板`).
2. Toggle **Enable wallpaper** on.
3. Pick a source: *file* / *folder* / *follow Wallpaper Engine* / *WE library*.
4. Adjust glass, layout, corners to taste.
5. Hit **Reload window** (the panel does it for you when `vsw.autoReload` is on).

## How it works

VS Code's workbench is a single `workbench.html` page. The extension injects a small runtime into it:

- a fixed `#vsw-stage` layer at `z-index: 0` holding the image / video / iframe / canvas;
- CSS that makes the workbench background transparent and applies `backdrop-filter` to panel parts;
- inline `!important` background overrides that beat the theme's inline styles;
- `workbench.colorCustomizations` snapshotted and temporarily set to transparent (restored on revert).

For `scene.pkg` the runtime mounts [webwallgl](https://github.com/oneincase/webwallgl) (MIT, WebGL2). The pkg bytes are delivered as a base64 JS file loaded through `<script src="vscode-file://…">`, because in the VS Code renderer `fetch`/`XHR` cannot reach `http://127.0.0.1` and the custom `vscode-file:` scheme is not fetchable.

## Settings (highlights)

| Setting | Default | Description |
| --- | --- | --- |
| `vsw.enabled` | `false` | Master switch. |
| `vsw.wallpaper.source` | `file` | `file` / `folder` / `wallpaperEngine`. |
| `vsw.wallpaper.file` | `""` | Image, video or `scene.pkg`. |
| `vsw.wallpaper.folder` | `""` | Folder to rotate through. |
| `vsw.wallpaper.sceneMode` | `live` | `live` renders `scene.pkg`; `preview` falls back to `preview.gif/jpg`. |
| `vsw.wallpaper.sceneProps` | `{}` | Per-wallpaper user properties (edited from the panel). |
| `vsw.glass.enabled` | `true` | Frosted glass on/off. |
| `vsw.glass.blur` | `24` | Blur radius (px). |
| `vsw.glass.opacity` | `0.5` | Panel tint opacity. |
| `vsw.glass.regions` | 8 regions | Which parts get glass. |
| `vsw.layout.radius` | `0` | Window corner radius. |
| `vsw.layout.panelRadius` | `12` | Sidebar / editor corner radius. |
| `vsw.debug` | `false` | Draw the debug log box over the wallpaper layer. |

The full list lives in *Settings → Extensions → VSCode-Wallpaper*.

## Known limitations

- Window control buttons (minimize / maximize / close) are drawn by Electron's `titleBarOverlay` on Windows and cannot be styled by CSS.
- A very narrow element cannot share the same frosted look as a wide one: `backdrop-filter` averages what is behind it, so a 44 px activity bar always looks flatter than a 300 px sidebar.
- `scene` wallpapers that rely on heavy GPU effects may run slower than in Wallpaper Engine itself.

## Development

```bash
npm install
node esbuild.js        # bundles src/extension.ts -> dist/extension.js, src/media/loader.ts -> dist/loader.js
npx tsc --noEmit       # type check
```

`src/media/loader.ts` is the injected runtime (runs inside the workbench page), everything else runs in the extension host.

## Credits

- [webwallgl](https://github.com/oneincase/webwallgl) — WebGL2 Wallpaper Engine renderer (MIT).
- Inspired by [vscode-background](https://github.com/shalldie/vscode-background) for the HTML injection approach.

## License

MIT
