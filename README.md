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
- **Sticky areas keep a glass backdrop**: the editor's sticky-scroll signature, the breadcrumb bar and the explorer's pinned rows all get a frosted panel, so scrolled content no longer shows through them. Their blur is 1.8× the normal panels' because what scrolls behind them is text, not wallpaper.

## Install

### From the Marketplace

Search for **VSCode-Wallpaper** in the Extensions view, or:

```bash
code --install-extension VoidStar.vscode-wallpaper-glass
```

[Marketplace page](https://marketplace.visualstudio.com/items?itemName=VoidStar.vscode-wallpaper-glass)

### From a VSIX

Grab the latest `.vsix` from [Releases](https://github.com/Void-Stars/VSCode-Wallpaper/releases) and double-click it, or:

```bash
code --install-extension vscode-wallpaper-glass-1.1.0.vsix --force
```

### From source

```bash
npm install
node esbuild.js
npx @vscode/vsce package --allow-missing-repository --skip-license
code --install-extension vscode-wallpaper-glass-1.1.0.vsix --force
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

## Editing `settings.json` by hand

Every option is a normal VS Code setting, so you can skip the panel entirely.

**Where the file is**

| Platform | Path |
| --- | --- |
| Windows | `%APPDATA%\Code\User\settings.json` |
| macOS | `~/Library/Application Support/Code/User/settings.json` |
| Linux | `~/.config/Code/User/settings.json` |

Or, from anywhere: `Ctrl+Shift+P` → **Preferences: Open User Settings (JSON)**.

**A complete example**

```jsonc
{
  "vsw.enabled": true,
  "vsw.wallpaper.source": "wallpaperEngine",
  "vsw.wallpaper.weId": "3401773707",
  "vsw.wallpaper.sceneMode": "live",
  "vsw.wallpaper.dim": 0.25,
  "vsw.wallpaper.fit": "cover",

  "vsw.glass.enabled": true,
  "vsw.glass.blur": 26,
  "vsw.glass.opacity": 0.5,
  "vsw.glass.saturation": 1.45,
  "vsw.glass.regions": ["titlebar", "activitybar", "sidebar", "auxiliarybar",
                         "editor", "panel", "statusbar", "tabs"],

  "vsw.layout.radius": 0,
  "vsw.layout.panelRadius": 12,
  "vsw.layout.gapTop": 4,
  "vsw.layout.tabRadius": 8,

  // scene wallpapers expose their own properties; keys come from project.json
  "vsw.sceneProps": {
    "y": false,
    "newproperty17": 0.06,
    "bgm": 0.5
  }
}
```

`vsw.wallpaper.source` accepts three values:

- `file` — `vsw.wallpaper.file` points at one image / video / `scene.pkg`.
- `folder` — `vsw.wallpaper.folder` is rotated every `intervalSec`, honouring `shuffle` and `recursive`.
- `wallpaperEngine` — follows the currently selected Wallpaper Engine wallpaper; set `weId` to pin one item instead.

**After editing**

Save the file. The extension re-injects the runtime automatically, then reload the window once —
`Ctrl+Shift+P` → **Developer: Reload Window**, or click **Reload window** in the sidebar panel.
(`Ctrl+R` does *not* reload the VS Code window.) With `vsw.autoReload` on, the extension does the reload for you.

**All settings**

| Setting | Default | Description |
| --- | --- | --- |
| `vsw.enabled` | `false` | Master switch. |
| `vsw.wallpaper.source` | `file` | Wallpaper source: `file` / `folder` / `wallpaperEngine`. |
| `vsw.wallpaper.file` | `""` | Path to one wallpaper — image, video or `scene.pkg`. |
| `vsw.wallpaper.folder` | `""` | Folder to rotate through. |
| `vsw.wallpaper.recursive` | `true` | Recurse into subfolders while rotating. |
| `vsw.wallpaper.intervalSec` | `300` | Rotation interval in seconds. |
| `vsw.wallpaper.shuffle` | `true` | Randomise rotation order. |
| `vsw.wallpaper.fit` | `cover` | How the wallpaper fills: `cover` / `contain` / `fill`. |
| `vsw.wallpaper.opacity` | `1` | Opacity of the whole wallpaper layer (0–1). |
| `vsw.wallpaper.dim` | `0.25` | How much the wallpaper is darkened (0–1). |
| `vsw.wallpaper.blur` | `0` | Blur applied to the wallpaper itself (px). |
| `vsw.wallpaper.pauseOnBlur` | `true` | Pause video playback when the window loses focus. |
| `vsw.glass.enabled` | `true` | Frosted glass on/off. |
| `vsw.glass.blur` | `24` | Frosted glass blur radius (px). |
| `vsw.glass.opacity` | `0.55` | Panel tint opacity (0–1). |
| `vsw.glass.saturation` | `1.4` | Saturation multiplier for the glass. |
| `vsw.glass.border` | `true` | Draw a hairline border around panels. |
| `vsw.glass.regions` | `["activitybar", "sidebar", "editor", "panel", "statusbar", "tabs"]` | Which workbench regions get glass. |
| `vsw.layout.tabRadius` | `8` | Tab corner radius (px). |
| `vsw.layout.compactTabs` | `false` | Compact tabs. |
| `vsw.layout.hideStatusbar` | `false` | Hide the status bar. |
| `vsw.layout.hideActivityBar` | `false` | Hide the activity bar. |
| `vsw.layout.activityBarLocation` | `default` | Activity bar position: `default` / `top` / `hidden`. |
| `vsw.layout.sideBarLocation` | `left` | Side bar position: `left` / `right`. |
| `vsw.layout.borderless` | `true` | Remove panel border lines. |
| `vsw.autoReload` | `true` | Reload the window automatically after applying. |
| `vsw.wallpaper.weId` | `""` | Pin one Wallpaper Engine workshop item by ID. |
| `vsw.layout.radius` | `0` | Window corner radius (px); 0 = square. |
| `vsw.layout.radiusTopLeft` | `-1` | Top-left corner only; `-1` follows `radius`. |
| `vsw.layout.radiusTopRight` | `-1` | Top-right corner only; `-1` follows `radius`. |
| `vsw.layout.radiusBottomLeft` | `-1` | Bottom-left corner only; `-1` follows `radius`. |
| `vsw.layout.radiusBottomRight` | `-1` | Bottom-right corner only; `-1` follows `radius`. |
| `vsw.layout.gapTop` | `0` | Top padding of the content area (px). |
| `vsw.layout.gapSide` | `0` | Left/right padding of the content area (px). |
| `vsw.layout.panelRadius` | `0` | Sidebar / editor corner radius (px). |
| `vsw.layout.gapBottom` | `0` | Bottom padding of the content area (px). |
| `vsw.glass.editorDelta` | `0` | Brightness offset for the editor (higher = lighter). |
| `vsw.glass.barDelta` | `0` | Brightness offset for title/status bars. |
| `vsw.wallpaper.sceneMode` | `live` | `live` renders `scene.pkg`; `preview` falls back to `preview.gif/jpg`. |
| `vsw.debug` | `false` | Draw a debug log box over the wallpaper layer. |
| `vsw.sceneProps` | `{}` | User properties for a scene wallpaper (keys come from project.json). |

## Known limitations

- Window control buttons (minimize / maximize / close) are drawn by Electron's `titleBarOverlay` on Windows and cannot be styled by CSS.
- A very narrow element cannot share the same frosted look as a wide one: `backdrop-filter` averages what is behind it, so a 44 px activity bar always looks flatter than a 300 px sidebar.
- `scene` wallpapers that rely on heavy GPU effects may run slower than in Wallpaper Engine itself.

## Changelog

### 1.1.0

Added

- Frosted backdrop for every sticky area: editor sticky-scroll signature, breadcrumb bar, explorer pinned rows. Blur is larger here (1.8×) so text scrolling underneath gets blurred out while the wallpaper still shows through.

Fixed

- **Submenus did not open.** Any custom CSS on the menu container (even just `overflow: hidden` for rounded corners, or `border` / `box-shadow`) made second-level submenus render as a sliver of shadow. Menu styling is now limited to a single `background-color`.
- **Disabling the extension left everything behind.** `activate()` wrapped the whole apply/clear routine in `if (enabled)`, so the `revertPatch()` branch inside could never run — turning the wallpaper off and restarting did nothing. Now the clear path is always reachable, and toggling `vsw.enabled` takes effect on reload.
- Menu backdrop flashing while switching editor tabs (the background was re-applied on a 1.2 s timer; now it is replayed on the next frame when VS Code rewrites it).

### 1.0.0 – 1.0.1

First public release: image / video / web wallpapers, Wallpaper Engine `video` / `web` / `scene.pkg`, frosted glass, Modern UI floating panels, per-wallpaper scene properties panel.

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
