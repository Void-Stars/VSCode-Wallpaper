# VSCode-Wallpaper

给 VS Code 加自定义静态 / 动态壁纸 —— 支持 **Wallpaper Engine 的 `scene.pkg` 实时渲染**、毛玻璃与浮层布局。

[English](README.md) | 简体中文

![demo](media/icon@4x.png)

## 功能

- **壁纸**：单张图片、视频、网页，或整个文件夹（乱序 + 定时轮播）。
- **Wallpaper Engine**：跟随**当前**壁纸，或从壁纸库里锁定一张。支持 `video`、`web` 和 **`scene.pkg`（WebGL2 实时渲染）**。
- **毛玻璃**：可调模糊 / 不透明度 / 饱和度，作用于标题栏、活动栏、侧栏、编辑器、面板、辅助栏、状态栏、标签页；每个区域可单独开关，还能分区微调亮度。
- **浮层布局**：打开 VS Code 官方的 *Modern UI*，再由本插件接管样式（卡片间距、统一圆角、接缝处理）。
- **壁纸自带设置面板**：读取当前 WE 壁纸 `general.properties`，在侧边栏生成对应控件（bool / slider / combo），例如**鼠标拖尾**、**壁纸视差**、**雨**、**音频条**。

## 安装

### 从插件市场

在扩展面板搜索 **VSCode-Wallpaper**，或：

```bash
code --install-extension VoidStar.vscode-wallpaper-glass
```

[市场页面](https://marketplace.visualstudio.com/items?itemName=VoidStar.vscode-wallpaper-glass)

### 从 VSIX（GitHub Releases 下载后双击，或）

```bash
code --install-extension vscode-wallpaper-glass-1.0.2.vsix --force
```

### 从源码

```bash
npm install
node esbuild.js
npx @vscode/vsce package --allow-missing-repository --skip-license
code --install-extension vscode-wallpaper-glass-1.0.0.vsix --force
```

> 装上新版本后**要重载两次窗口**：第一次让扩展重写 `workbench.html`，第二次才是页面真正读到它。

## 快速开始

1. 在活动栏打开 **VSCode-Wallpaper** 视图（或运行命令 `控制面板`）。
2. 打开**启用壁纸**。
3. 选来源：*文件* / *文件夹* / *跟随 Wallpaper Engine* / *WE 壁纸库*。
4. 按喜好调毛玻璃、布局、圆角。
5. 点**重载窗口**（`vsw.autoReload` 开着时面板会自动帮你重载）。

## 实现原理

VS Code 的工作台就是一个 `workbench.html` 页面，扩展往里面注入一小段运行时：

- 固定定位的 `#vsw-stage` 层（`z-index: 0`），里面放图片 / 视频 / iframe / canvas；
- 把工作台背景改透明的 CSS，并给各个面板加 `backdrop-filter`；
- 用内联 `!important` 背景覆盖，压过主题写在元素上的内联样式；
- 临时改写 `workbench.colorCustomizations` 并保存原值（还原时恢复）。

`scene.pkg` 由运行时挂载 [webwallgl](https://github.com/oneincase/webwallgl)（MIT，WebGL2）。pkg 字节被转成 base64 的 JS 文件、用 `<script src="vscode-file://…">` 加载 —— 因为在 VS Code 渲染进程里 `fetch`/`XHR` 访问不到 `http://127.0.0.1`，而自定义的 `vscode-file:` 协议也不支持 fetch。

## 设置项（节选）

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `vsw.enabled` | `false` | 总开关。 |
| `vsw.wallpaper.source` | `file` | `file` / `folder` / `wallpaperEngine`。 |
| `vsw.wallpaper.file` | `""` | 图片、视频或 `scene.pkg`。 |
| `vsw.wallpaper.folder` | `""` | 轮播用的文件夹。 |
| `vsw.wallpaper.sceneMode` | `live` | `live` 真渲染 `scene.pkg`；`preview` 退化为 `preview.gif/jpg`。 |
| `vsw.wallpaper.sceneProps` | `{}` | 每张壁纸的用户属性（在面板里调）。 |
| `vsw.glass.enabled` | `true` | 毛玻璃开关。 |
| `vsw.glass.blur` | `24` | 模糊半径（px）。 |
| `vsw.glass.opacity` | `0.5` | 面板底色不透明度。 |
| `vsw.glass.regions` | 8 个区域 | 哪些区域加玻璃。 |
| `vsw.layout.radius` | `0` | 窗口圆角。 |
| `vsw.layout.panelRadius` | `12` | 侧栏 / 编辑区圆角。 |
| `vsw.debug` | `false` | 在壁纸层显示调试日志框。 |

完整列表见 *设置 → 扩展 → VSCode-Wallpaper*。

## 直接修改 `settings.json`

所有选项都是普通的 VS Code 设置，可以不打开侧边栏面板，直接改配置文件。

**文件在哪**

| 系统 | 路径 |
| --- | --- |
| Windows | `%APPDATA%\Code\User\settings.json` |
| macOS | `~/Library/Application Support/Code/User/settings.json` |
| Linux | `~/.config/Code/User/settings.json` |

也可以在任意界面按 `Ctrl+Shift+P` → **Preferences: Open User Settings (JSON)** 打开。

**一份可直接抄的完整示例**

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

  // scene 壁纸自己的属性，键名来自该壁纸 project.json 里的 general.properties
  "vsw.sceneProps": {
    "y": false,
    "newproperty17": 0.06,
    "bgm": 0.5
  }
}
```

`vsw.wallpaper.source` 有三种取值：

- `file` —— `vsw.wallpaper.file` 指向单张图片 / 视频 / `scene.pkg`。
- `folder` —— `vsw.wallpaper.folder` 里的文件按 `intervalSec` 轮播，受 `shuffle`、`recursive` 影响。
- `wallpaperEngine` —— 跟随 Wallpaper Engine 当前选中的壁纸；想固定某一张就填 `weId`。

**改完之后**

保存文件 → 扩展会自动重新注入运行时 → 再重载一次窗口生效：
`Ctrl+Shift+P` → **Developer: Reload Window**，或点侧边栏面板里的「重载窗口」。
（`Ctrl+R` 在 VS Code 里**不是**重载窗口。）开着 `vsw.autoReload` 时扩展会自己完成重载。

**全部设置项**

| Setting | Default | Description |
| --- | --- | --- |
| `vsw.enabled` | `false` | 总开关。 |
| `vsw.wallpaper.source` | `file` | 壁纸来源：`file` / `folder` / `wallpaperEngine`。 |
| `vsw.wallpaper.file` | `""` | 单张壁纸路径，支持图片、视频、`scene.pkg`。 |
| `vsw.wallpaper.folder` | `""` | 轮播文件夹路径。 |
| `vsw.wallpaper.recursive` | `true` | 轮播时是否递归子目录。 |
| `vsw.wallpaper.intervalSec` | `300` | 轮播间隔（秒）。 |
| `vsw.wallpaper.shuffle` | `true` | 轮播时随机顺序。 |
| `vsw.wallpaper.fit` | `cover` | 填充方式：`cover` / `contain` / `fill`。 |
| `vsw.wallpaper.opacity` | `1` | 壁纸层整体不透明度（0–1）。 |
| `vsw.wallpaper.dim` | `0.25` | 壁纸压暗程度（0–1），越大越暗。 |
| `vsw.wallpaper.blur` | `0` | 壁纸本身的模糊半径（px）。 |
| `vsw.wallpaper.pauseOnBlur` | `true` | 窗口失焦时暂停视频播放。 |
| `vsw.glass.enabled` | `true` | 毛玻璃开关。 |
| `vsw.glass.blur` | `24` | 毛玻璃模糊半径（px）。 |
| `vsw.glass.opacity` | `0.55` | 面板底色不透明度（0–1）。 |
| `vsw.glass.saturation` | `1.4` | 毛玻璃饱和度倍数。 |
| `vsw.glass.border` | `true` | 面板是否描边。 |
| `vsw.glass.regions` | `["activitybar", "sidebar", "editor", "panel", "statusbar", "tabs"]` | 哪些区域应用毛玻璃。 |
| `vsw.layout.tabRadius` | `8` | 标签页圆角（px）。 |
| `vsw.layout.compactTabs` | `false` | 紧凑标签页。 |
| `vsw.layout.hideStatusbar` | `false` | 隐藏状态栏。 |
| `vsw.layout.hideActivityBar` | `false` | 隐藏活动栏。 |
| `vsw.layout.activityBarLocation` | `default` | 活动栏位置：`default` / `top` / `hidden`。 |
| `vsw.layout.sideBarLocation` | `left` | 侧边栏位置：`left` / `right`。 |
| `vsw.layout.borderless` | `true` | 去掉面板边框线。 |
| `vsw.autoReload` | `true` | 应用设置后自动重载窗口。 |
| `vsw.wallpaper.weId` | `""` | 锁定某张 Wallpaper Engine 壁纸的创意工坊 ID。 |
| `vsw.layout.radius` | `0` | 窗口四角圆角（px），0 为直角。 |
| `vsw.layout.radiusTopLeft` | `-1` | 单独设置左上角，`-1` 跟随 `radius`。 |
| `vsw.layout.radiusTopRight` | `-1` | 单独设置右上角，`-1` 跟随 `radius`。 |
| `vsw.layout.radiusBottomLeft` | `-1` | 单独设置左下角，`-1` 跟随 `radius`。 |
| `vsw.layout.radiusBottomRight` | `-1` | 单独设置右下角，`-1` 跟随 `radius`。 |
| `vsw.layout.gapTop` | `0` | 内容区顶部留白（px）。 |
| `vsw.layout.gapSide` | `0` | 内容区左右留白（px）。 |
| `vsw.layout.panelRadius` | `0` | 侧栏 / 编辑区圆角（px）。 |
| `vsw.layout.gapBottom` | `0` | 内容区底部留白（px）。 |
| `vsw.glass.editorDelta` | `0` | 编辑区亮度偏移（正数更亮）。 |
| `vsw.glass.barDelta` | `0` | 标题栏 / 状态栏亮度偏移。 |
| `vsw.wallpaper.sceneMode` | `live` | `live` 实时渲染 `scene.pkg`；`preview` 退回 `preview.gif/jpg`。 |
| `vsw.debug` | `false` | 在壁纸层左下角显示调试日志框。 |
| `vsw.sceneProps` | `{}` | scene 壁纸的用户属性（键名取自 project.json）。 |

## 已知限制

- Windows 上右上角三个窗口按钮由 Electron 的 `titleBarOverlay` 绘制，CSS 改不了。
- 很窄的元素没法和大面板做成同样的磨砂质感：`backdrop-filter` 取的是背后的平均值，44px 宽的活动栏一定比 300px 宽的侧栏更「平」。
- 依赖重度 GPU 效果的 scene 壁纸，可能比在 Wallpaper Engine 里慢一些。

## 开发

```bash
npm install
node esbuild.js        # src/extension.ts -> dist/extension.js，src/media/loader.ts -> dist/loader.js
npx tsc --noEmit       # 类型检查
```

`src/media/loader.ts` 是注入到工作台页面里的运行时，其余代码都跑在扩展宿主里。

## 致谢

- [webwallgl](https://github.com/oneincase/webwallgl) —— WebGL2 的 Wallpaper Engine 渲染器（MIT）。
- [vscode-background](https://github.com/shalldie/vscode-background) —— HTML 注入思路的启发。

## 许可证

MIT
