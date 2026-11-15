/**
 * 注入到 workbench.html 里的运行时。
 * 编译为 IIFE + minify，由扩展读成字符串内联进 HTML。
 *
 * 输入：window.__VSW_CONFIG__（由扩展在注入时写入的 JSON）
 * 职责：建壁纸层、套玻璃样式、应用布局微调。
 */

// 临时诊断：只要 loader 被执行，整页就会出现红色描边
try {
  document.documentElement.style.outline = '6px solid #ff2d2d';
  document.documentElement.style.outlineOffset = '-6px';
} catch {
  /* ignore */
}

/** 屏幕上的调试框只在「配置里开了 debug」时出现；平时只进 console */
let DEBUG_ONSCREEN = false;
export function setOnscreenDebug(on: boolean): void {
  DEBUG_ONSCREEN = on;
}

function vswDebug(msg: string): void {
  console.log('[vsw] ' + msg);
  if (!DEBUG_ONSCREEN) return;
  let box = document.getElementById('vsw-dbg');
  if (!box) {
    box = document.createElement('div');
    box.id = 'vsw-dbg';
    box.style.cssText =
      'position:fixed;left:8px;bottom:8px;z-index:2147483647;max-width:70vw;background:#111d;color:#fff;font:11px/1.4 monospace;padding:5px 8px;border-radius:4px;white-space:pre-wrap;pointer-events:none';
    document.body.appendChild(box);
  }
  box.textContent += msg + '\n';
  window.setTimeout(() => box?.remove(), 120000);
}

/** workbench.html 强制 Trusted Types；<script src> 必须用 policy 生成 TrustedScriptURL。 */
function trustedScriptUrl(url: string): string {
  const tt = (window as any).trustedTypes;
  if (!tt || typeof tt.createPolicy !== 'function') return url;
  try {
    const w = window as any;
    if (!w.__vswTTPolicy) {
      w.__vswTTPolicy = tt.createPolicy('vsw-pkg', { createScriptURL: (s: string) => s });
    }
    return w.__vswTTPolicy.createScriptURL(url);
  } catch {
    return url;
  }
}

interface WallpaperConfig {
  kind: 'image' | 'video' | 'web' | 'scene' | 'none';
  /** scene 壁纸的 iframe 地址 */
  scene?: string;
  sceneHttp?: string;
  scenePreview?: string;
  /** 场景壁纸的用户属性当前值，挂载时交给引擎 */
  sceneProps?: Record<string, any>;
  list: string[];
  fit: 'cover' | 'contain' | 'fill' | 'tile';
  opacity: number;
  dim: number;
  blur: number;
  pauseOnBlur: boolean;
  intervalSec: number;
  shuffle: boolean;
}

interface GlassConfig {
  enabled: boolean;
  blur: number;
  opacity: number;
  saturation: number;
  border: boolean;
  regions: string[];
  /** 代码区透明度相对 opacity 的偏移，负数=更透更亮，正数=更实更暗 */
  editorDelta: number;
  /** 标题栏 / 状态栏透明度偏移 */
  barDelta: number;
}

interface LayoutConfig {
  tabRadius: number;
  compactTabs: boolean;
  hideStatusbar: boolean;
  hideActivityBar: boolean;
  borderless: boolean;
  /** 四角圆角：-1 表示跟随 radius */
  radius: number;
  radiusTopLeft: number;
  radiusTopRight: number;
  radiusBottomLeft: number;
  radiusBottomRight: number;
  /** 内容区与上边栏之间的间距（px） */
  gapTop: number;
  /** 内容区与左右边缘的间距（px） */
  gapSide: number;
  panelRadius: number;
  gapBottom: number;
  /** modernUI 浮层卡片（官方 workbench.experimental.modernUI） */
  floating?: boolean;
}

interface VswConfig {
  wallpaper: WallpaperConfig;
  glass: GlassConfig;
  layout: LayoutConfig;
  mode: 'dark' | 'light';
}

declare global {
  interface Window {
    __VSW_CONFIG__?: VswConfig;
    __VSW_APPLIED__?: boolean;
  }
}

const STAGE_ID = 'vsw-stage';
const STYLE_ID = 'vsw-style';

function isLightTheme(): boolean {
  const c = document.body.classList;
  return c.contains('vscode-light') || c.contains('vscode-high-contrast-light');
}

function esc(s: string): string {
  return s.replace(/[()'"\\]/g, m => '\\' + m);
}

/** VSCode 1.51+ 的 renderer 在 sandbox 里，file:// 被限制，必须用 vscode-file://vscode-app/ */
function mediaUrl(p: string): string {
  if (/^(vscode-file|data|blob|https?):/i.test(p)) return p;
  return fileUrl(p);
}

function fileUrl(p: string): string {
  let s = p.replace(/\\/g, '/');
  if (/^[a-zA-Z]:/.test(s)) s = '/' + s;
  if (!s.startsWith('/')) s = '/' + s;
  return 'file://' + encodeURI(s).replace(/#/g, '%23').replace(/\?/g, '%3F');
}

/** CSS 变量覆盖 + 各区域毛玻璃 */
function buildGlassCss(cfg: GlassConfig, light: boolean): string {
  if (!cfg.enabled) return '';

  const baseRgb = light ? '255,255,255' : '22,22,26';
  const alpha = Math.max(0.05, Math.min(1, cfg.opacity));
  const b = Math.max(0, Math.round(cfg.blur));
  const sat = Math.max(0.5, cfg.saturation);

  const bg = `rgba(${baseRgb},${alpha})`;
  const barDelta = typeof cfg.barDelta === 'number' ? cfg.barDelta : 0;
  const bgStrong = `rgba(${baseRgb},${Math.max(0, Math.min(1, alpha + barDelta))})`;
  const edge = cfg.border
    ? (light ? '1px solid rgba(255,255,255,0.65)' : '1px solid rgba(255,255,255,0.10)')
    : 'none';

  const menuBg = `rgba(${baseRgb}, 0.72)`;
  const menuBorder = light ? 'rgba(0, 0, 0, 0.10)' : 'rgba(255, 255, 255, 0.10)';
  const menuBlur = Math.max(0, Math.round(b * 0.8));

  // 不模糊，只上底色（标题栏/状态栏/标签栏用：给它们加 blur 会建立
  // containing block，把下拉菜单的 fixed 定位搞坏）
  const glassPlain = () => `
    background-color: ${bg} !important;
    background-image: none !important;`;

  const glass = () => `
    background-color: ${bg} !important;
    background-image: none !important;
    backdrop-filter: blur(${b}px) saturate(${sat});
    -webkit-backdrop-filter: blur(${b}px) saturate(${sat});`;

  // 活动栏：透明度与侧栏相同，但模糊几乎为零。44px 宽的窄条一旦套上 26px 模糊，
  // 采样范围覆盖整条宽度，必然糊成一块均匀色，和侧栏的磨砂观感对不上。
  const glassBar = () => `
    background-color: ${bg} !important;
    background-image: none !important;
    backdrop-filter: blur(${Math.max(0, Math.round(b * 0.08))}px) saturate(${Math.min(2, sat + 0.12)});
    -webkit-backdrop-filter: blur(${Math.max(0, Math.round(b * 0.08))}px) saturate(${Math.min(2, sat + 0.12)});`;

  const regions = new Set(cfg.regions.map(r => r.toLowerCase()));

  const parts: string[] = [];

  // 顶层 CSS 变量：让所有派生色跟着变透明
  parts.push(`
body.vscode-light, body.vscode-high-contrast-light {
  --vscode-sideBar-background: ${bg};
  --vscode-activityBar-background: ${bg};
  --vscode-panel-background: ${bg};
  --vscode-terminal-background: transparent;
  --vscode-statusBar-background: ${bgStrong};
  --vscode-editor-background: transparent;
  --vscode-editorGroupHeader-tabsBackground: transparent;
  --vscode-titleBar-activeBackground: transparent;
  --vscode-titleBar-inactiveBackground: transparent;
}
body.vscode-dark, body.vscode-high-contrast {
  --vscode-sideBar-background: ${bg};
  --vscode-activityBar-background: ${bg};
  --vscode-panel-background: ${bg};
  --vscode-terminal-background: transparent;
  --vscode-statusBar-background: ${bgStrong};
  --vscode-editor-background: transparent;
  --vscode-editorGroupHeader-tabsBackground: transparent;
  --vscode-titleBar-activeBackground: transparent;
  --vscode-titleBar-inactiveBackground: transparent;
}`);

  if (regions.has('activitybar')) {
    parts.push(`
.monaco-workbench .part.activitybar,
.monaco-workbench .activitybar {
  ${glassBar()}
  /* 不再画右边框：活动栏与侧栏之间会出现一条若隐若现的白线 */
  border-right: none !important;
}`);
  }
  if (regions.has('sidebar')) {
    parts.push(`
.monaco-workbench .part.sidebar,
.monaco-workbench .sidebar {
  ${glass()}
}`);
  }
  if (regions.has('auxiliarybar')) {
    parts.push(`
.monaco-workbench .part.auxiliarybar,
.monaco-workbench .auxiliarybar {
  ${glass()}
}`);
  }
  if (regions.has('editor')) {
    parts.push(`
.monaco-workbench .part.editor,
.monaco-workbench .part.editor > .content,
.monaco-workbench .editor-group-container,
.monaco-workbench .editor-group-container > .title,
.monaco-workbench .monaco-editor,
.monaco-workbench .monaco-editor-background,
.monaco-workbench .monaco-editor .margin {
  background-color: transparent !important;
  background-image: none !important;
}
.monaco-workbench .part.editor,
.monaco-workbench .editor-group-container {
  backdrop-filter: blur(${Math.round(b * 0.35)}px);
  -webkit-backdrop-filter: blur(${Math.round(b * 0.35)}px);
}
/* 编辑器区域只让背景透出来，正文仍然不糊 */
.monaco-workbench .part.editor > .content .monaco-editor .view-lines {
  backdrop-filter: none;
}`);
  }
  if (regions.has('panel')) {
    parts.push(`
.monaco-workbench .part.panel,
.monaco-workbench .panel {
  ${glass()}
}`);
  }
  if (regions.has('statusbar')) {
    parts.push(`
.monaco-workbench .part.statusbar,
.monaco-workbench .statusbar {
  ${glassPlain()}
}`);
  }
  if (regions.has('titlebar')) {
    parts.push(`
.monaco-workbench .part.titlebar,
.monaco-workbench .titlebar {
  ${glassPlain()}
}`);
  }
  if (regions.has('tabs')) {
    parts.push(`
.monaco-workbench .tabs-and-actions-container,
.monaco-workbench .editor-group-container > .title {
  ${glassPlain()}
}
.monaco-workbench .tabs-and-actions-container .tab {
  background-color: transparent !important;
}`);
  }

  parts.push(`
/* 下拉菜单 / 右键菜单：玻璃质感。
   只给菜单本体加 blur，外面那层 .context-view 是定位包装层，绝不能碰，
   否则它内部的 fixed/absolute 会相对它定位（就是之前菜单跑位的成因）。 */
.monaco-menu-container,
.context-view .monaco-menu,
.context-view .monaco-menu-container,
.monaco-workbench .monaco-menu {
  background-color: ${menuBg} !important;
  background-image: none !important;
  backdrop-filter: blur(${menuBlur}px) saturate(${sat}) !important;
  -webkit-backdrop-filter: blur(${menuBlur}px) saturate(${sat}) !important;
  border: 1px solid ${menuBorder} !important;
  border-radius: 8px !important;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45) !important;
  overflow: hidden !important;
}
.context-view .monaco-menu .monaco-action-bar,
.context-view .monaco-menu .actions-container,
.monaco-workbench .monaco-menu .monaco-action-bar {
  background-color: transparent !important;
  background-image: none !important;
}
/* 下拉框 / 快速输入 / 悬浮提示 / 补全：跟随菜单的玻璃，但同样不加在包装层 */
.quick-input-widget,
.monaco-select-box-dropdown-container,
.suggest-widget,
.monaco-hover,
.monaco-editor .parameter-hints-widget,
.monaco-dialog-box {
  background-color: ${menuBg} !important;
  background-image: none !important;
  backdrop-filter: blur(${menuBlur}px) saturate(${sat}) !important;
  -webkit-backdrop-filter: blur(${menuBlur}px) saturate(${sat}) !important;
  border: 1px solid ${menuBorder} !important;
  border-radius: 8px !important;
}
/* 标题栏里所有子块都不许自己叠底色，否则会在这条玻璃上糊出几块不透明的方块 */
/* 只清底色。background-image 不能一刀切 —— 左上角的 VSCode 图标是图片，
   清掉就会「图标不见了」。图片只在明确是纯色容器的元素上清。 */
.monaco-workbench .part.titlebar *:not(.codicon) {
  background-color: transparent !important;
}
.monaco-workbench .part.titlebar .titlebar-container,
.monaco-workbench .part.titlebar .titlebar-left,
.monaco-workbench .part.titlebar .titlebar-center,
.monaco-workbench .part.titlebar .titlebar-right,
.monaco-workbench .part.titlebar .menubar,
.monaco-workbench .part.titlebar .window-controls-container,
.monaco-workbench .part.titlebar .window-controls {
  background-image: none !important;
}
.monaco-workbench .part.titlebar .action-item:hover,
.monaco-workbench .part.titlebar .menubar-menu-button:hover {
  background-color: rgba(255, 255, 255, 0.10) !important;
  border-radius: 6px !important;
}
/* 窗口按钮区不自己叠底，让标题栏的玻璃透上来 */
.monaco-workbench .part.titlebar .window-controls-container,
.monaco-workbench .part.titlebar .window-controls,
.monaco-workbench .part.titlebar .window-controls > ul,
.monaco-workbench .part.titlebar .window-controls > ul > li,
.monaco-workbench .part.titlebar .window-controls .action-item,
.monaco-workbench .part.titlebar .window-controls .codicon {
  background-color: transparent !important;
  background-image: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
.monaco-workbench .part.titlebar .window-controls .action-item:hover {
  background-color: rgba(255, 255, 255, 0.12) !important;
  border-radius: 6px !important;
}`);

  return parts.join('\n');
}

function buildLayoutCss(cfg: LayoutConfig): string {
  const out: string[] = [];
  const r = Math.max(0, Math.min(20, cfg.tabRadius));

  if (r > 0) {
    out.push(`
.monaco-workbench .tabs-and-actions-container .tab {
  border-radius: ${r}px ${r}px 0 0 !important;
  margin-right: ${Math.max(1, Math.round(r / 4))}px;
  overflow: hidden;
}`);
  }
  if (cfg.compactTabs) {
    out.push(`
.monaco-workbench .tabs-and-actions-container {
  height: 28px !important;
}
.monaco-workbench .tabs-and-actions-container .tab {
  height: 28px !important;
  line-height: 28px !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
}`);
  }
  if (cfg.hideStatusbar) {
    out.push(`.monaco-workbench .part.statusbar { display: none !important; }`);
  }
  if (cfg.hideActivityBar) {
    out.push(`.monaco-workbench .part.activitybar { display: none !important; }`);
  }

  // 非浮层模式的分区圆角：侧栏左缘、辅助栏右缘保持直角，其余圆角
  const panelR = Math.max(0, Math.min(48, cfg.panelRadius || 0));
  if (cfg.borderless && panelR > 0 && !cfg.floating) {
    out.push(`
.monaco-workbench .part.sidebar {
  border-radius: 0 ${panelR}px ${panelR}px 0 !important;
  overflow: hidden !important;
}
.monaco-workbench .part.editor {
  border-radius: ${panelR}px !important;
  overflow: hidden !important;
}
.monaco-workbench .part.auxiliarybar {
  border-radius: ${panelR}px 0 0 ${panelR}px !important;
  overflow: hidden !important;
}
.monaco-workbench .part.activitybar {
  border-radius: 0 !important;
}`);
  }

  // ---------- modernUI 浮层 ----------
  if (cfg.floating) {
    const cr = Math.max(0, Math.min(48, panelR));
    const M = 'var(--modern-ui-floating-card-outer-margin)';

    // 全局圆角变量：活动栏/侧栏/编辑器/辅助栏/面板共用一个值，半径必然一致
    out.push(`.monaco-workbench.floating-panels{--vscode-cornerRadius-large:${cr}px !important;` +
      `--vscode-cornerRadius-medium:${Math.max(0, cr - 2)}px !important;--modern-ui-floating-card-outer-margin:4px;}`);

    // 活动栏与侧栏拼成一整块：中间不画缝、相邻圆角归零
    out.push(`
.monaco-workbench.floating-panels .part.activitybar.left,
.monaco-workbench.floating-panels .part.sidebar.left {
  border-color: transparent !important;
  outline: none !important;
  box-shadow: none !important;
  background-image: none !important;
  --modern-ui-floating-card-seam-left-color: transparent;
  --modern-ui-floating-card-seam-right-color: transparent;
}
.monaco-workbench.floating-panels .part.activitybar.left {
  margin-right: 0 !important;
  border-top-right-radius: 0 !important;
  border-bottom-right-radius: 0 !important;
}
.monaco-workbench.floating-panels .part.sidebar.left {
  border-top-left-radius: 0 !important;
  border-bottom-left-radius: 0 !important;
}
.monaco-workbench.floating-panels .part.editor,
.monaco-workbench.floating-panels .part.auxiliarybar,
.monaco-workbench.floating-panels .part.panel {
  border-color: transparent !important;
}
/* 侧栏收起时活动栏右缘就是卡片外缘：恢复圆角与外边距 */
.monaco-workbench.floating-panels.nosidebar .part.activitybar.left {
  border-top-right-radius: var(--vscode-cornerRadius-large) !important;
  border-bottom-right-radius: var(--vscode-cornerRadius-large) !important;
  margin-right: ${M} !important;
}
/* 卡片内部必须裁剪：编辑器 view-lines 会一直画到底，盖掉下方留白 */
.monaco-workbench.floating-panels .part.sidebar,
.monaco-workbench.floating-panels .part.auxiliarybar,
.monaco-workbench.floating-panels .monaco-grid-view .part.editor {
  overflow: hidden !important;
}
/* 上下间距对齐：官方只在窗口贴屏幕顶边时补偿，这里常开，上下都用 outer-margin */
.monaco-workbench.floating-panels .part.sidebar,
.monaco-workbench.floating-panels .part.auxiliarybar,
.monaco-workbench.floating-panels .part.activitybar,
.monaco-workbench.floating-panels .monaco-grid-view .part.editor {
  margin-top: ${M} !important;
  height: calc(100% - (${M} * 2)) !important;
}`);
  }

  // ---------- 通用：去掉原生边框、投影、分割线 ----------
  out.push(`
.monaco-workbench .part.sidebar,
.monaco-workbench .part.auxiliarybar,
.monaco-workbench .part.panel,
.monaco-workbench .part.activitybar,
.monaco-workbench .editor-group-container > .title,
.monaco-workbench .part.sidebar > .composite.title,
.monaco-workbench .part.auxiliarybar > .composite.title {
  border-color: transparent !important;
  box-shadow: none !important;
}
/* nosidebar 时官方给活动栏加了 shadow-md，展开时没有，两种状态看着不一样 */
.monaco-workbench.nosidebar .part.activitybar,
.monaco-workbench.floating-panels.nosidebar .part.activitybar {
  box-shadow: none !important;
}`);

  // ---------- 窗口四角圆角 ----------
  const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d);
  const pick = (v: number) => {
    const vv = num(v, -1);
    return vv < 0 ? Math.max(0, num(cfg.radius, 0)) : Math.max(0, vv);
  };
  const tl = pick(cfg.radiusTopLeft);
  const tr = pick(cfg.radiusTopRight);
  const br = pick(cfg.radiusBottomRight);
  const bl = pick(cfg.radiusBottomLeft);
  if (tl || tr || br || bl) {
    out.push(`
.monaco-workbench {
  border-radius: ${tl}px ${tr}px ${br}px ${bl}px !important;
  overflow: hidden !important;
}
.monaco-workbench .part.titlebar {
  border-radius: ${tl}px ${tr}px 0 0 !important;
}
.monaco-workbench .part.statusbar {
  border-radius: 0 0 ${br}px ${bl}px !important;
}`);
  }

  return out.join('\n');
}

function buildStageCss(w: WallpaperConfig): string {
  const fit = w.fit || 'cover';
  const objFit = fit === 'tile' ? 'cover' : fit;
  const op = Math.max(0.05, Math.min(1, w.opacity));
  const dim = Math.max(0, Math.min(0.9, w.dim));
  const blur = Math.max(0, w.blur || 0);

  return `
#${STAGE_ID} {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  opacity: ${op};
  contain: layout style;
}
#${STAGE_ID} .vsw-media {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: ${objFit};
  ${blur > 0 ? `filter: blur(${blur}px); transform: scale(1.06);` : ''}
  ${fit === 'tile'
        ? `object-fit: cover; background-repeat: repeat; background-size: 360px auto; background-position: center;`
        : ''}
}
#${STAGE_ID} .vsw-web {
  border: 0;
  background: transparent;
}
#${STAGE_ID} .vsw-media.is-tile {
  opacity: 0;
}
#${STAGE_ID} .vsw-tile {
  position: absolute;
  inset: 0;
  background-repeat: repeat;
  background-size: 420px auto;
  background-position: center;
  ${blur > 0 ? `filter: blur(${blur}px);` : ''}
}
#${STAGE_ID} .vsw-dim {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, ${dim});
  pointer-events: none;
}
#${STAGE_ID} .vsw-grad {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(1200px 800px at 15% 10%, rgba(120,90,255,0.30), transparent 60%),
    radial-gradient(1000px 700px at 85% 90%, rgba(0,180,200,0.22), transparent 60%),
    linear-gradient(160deg, #0f1117, #161a24 55%, #0d1017);
}

body.vsw-on {
  background: transparent !important;
  --vscode-menu-background: rgba(18, 20, 26, 0.72);
  --vscode-menu-border: rgba(255, 255, 255, 0.10);
  --vscode-editorWidget-background: rgba(18, 20, 26, 0.72);
  --vscode-editorSuggestWidget-background: rgba(18, 20, 26, 0.72);
  --vscode-quickInput-background: rgba(18, 20, 26, 0.72);
  --vscode-input-background: rgba(255, 255, 255, 0.06);
}
body.vsw-on .monaco-workbench {
  position: relative;
  z-index: 1;
  background: transparent !important;
}
/* 启动时的编辑区占位背景也要透明，否则闪一下白块 */
body.vsw-on .monaco-workbench .watermark,
body.vsw-on .monaco-workbench .editor-group-container > .title .title-label {
  background: transparent !important;
}
`;
}


/**
 * VSCode 会把主题色直接写成元素 inline style，CSS 里的 !important 也压不住。
 * 这里用 element.style.setProperty(..., 'important') 反压回去，并且定时重放
 * （切主题、换面板位置时 VSCode 会重写，所以需要一直盯着）。
 */
const GLASS_TARGETS: Record<string, string[]> = {
  titlebar: [
    '.monaco-workbench .part.titlebar',
    '.monaco-workbench .part.titlebar .window-controls-container',
    '.monaco-workbench .part.titlebar .window-controls',
  ],
  activitybar: ['.monaco-workbench .part.activitybar', '.monaco-workbench .activitybar'],
  sidebar: ['.monaco-workbench .part.sidebar'],
  auxiliarybar: ['.monaco-workbench .part.auxiliarybar'],
  editor: [
    '.monaco-workbench .editor-group-container',
    '.monaco-workbench .editor-container',
    '.monaco-workbench .monaco-editor-background',
    '.monaco-workbench .monaco-editor .margin',
  ],
  panel: ['.monaco-workbench .part.panel'],
  tabs: ['.monaco-workbench .tabs-and-actions-container'],
  statusbar: ['.monaco-workbench .part.statusbar'],
};


/** 这些层如果带着主题底色，叠起来会变成不透明；统一清成透明 */
const INNER_SELECTORS = [
  '.monaco-workbench .part > .content',
  '.monaco-workbench .monaco-grid-view',
  '.monaco-workbench .split-view-view',
  '.monaco-workbench .monaco-list',
  '.monaco-workbench .monaco-list-rows',
  '.monaco-workbench .explorer-folders-view',
  '.monaco-workbench .welcomePage',
  '.monaco-workbench .editor-group-watermark',
  '.monaco-workbench .empty-editor',
  '.monaco-workbench .editor-instance',
  '.monaco-workbench .monaco-editor .overflow-guard',
  '.monaco-workbench .tabs-container',
  '.monaco-workbench .part.panel .pane-body',
  '.monaco-workbench .part.auxiliarybar .pane-body',
  // 标题栏内部（自绘标题栏：左侧菜单、中间标题、右侧按钮区）
  '.monaco-workbench .part.titlebar > .titlebar-container',
  '.monaco-workbench .part.titlebar .titlebar-left',
  '.monaco-workbench .part.titlebar .titlebar-center',
  '.monaco-workbench .part.titlebar .titlebar-right',
  '.monaco-workbench .part.titlebar .window-controls-container',
  '.monaco-workbench .part.titlebar .window-controls',
  '.monaco-workbench .part.titlebar .window-controls > ul',
  '.monaco-workbench .part.titlebar .window-controls > ul > li',
  '.monaco-workbench .part.titlebar .window-icon',
  '.monaco-workbench .part.titlebar .menubar',
  '.monaco-workbench .part.titlebar .menubar-menu-button',
  '.monaco-workbench .part.titlebar .window-title',
  '.monaco-workbench .part.titlebar .titlebar-controls',
  '.monaco-workbench .part.titlebar .command-center',
  // 右侧 Copilot / 聊天面板内部
  '.monaco-workbench .part.auxiliarybar .pane-header',
  '.monaco-workbench .part.auxiliarybar .monaco-scrollable-element',
  '.monaco-workbench .part.auxiliarybar .monaco-list-rows',
  '.monaco-workbench .part.auxiliarybar .monaco-list-row',
  '.monaco-workbench .part.auxiliarybar [class*="chat"]',
  '.monaco-workbench .part.auxiliarybar [class*="Chat"]',
  '.monaco-workbench .part.auxiliarybar [class*="session"]',
  '.monaco-workbench .part.auxiliarybar [class*="interactive"]',
  '.monaco-workbench .part.auxiliarybar .chat-view-container',
  '.monaco-workbench .part.auxiliarybar .chat-editor-container',
  '.monaco-workbench .part.auxiliarybar .interactive-session',
  // 侧栏头部、编辑器边框等零碎底
  '.monaco-workbench .part.sidebar .pane-header',
  '.monaco-workbench .part.sidebar .monaco-scrollable-element',
  '.monaco-workbench .part.sidebar .composite',
  '.monaco-workbench .part.activitybar .content',
];

function enforceGlass(g: GlassConfig, light: boolean): void {
  if (!g.enabled) return;
  const base = light ? '244,246,250' : '18,20,26';
  const alpha = Math.max(0, Math.min(1, g.opacity));
  const tint = `rgba(${base},${alpha})`;
  const edD = typeof g.editorDelta === 'number' ? g.editorDelta : 0;
  const barD = typeof g.barDelta === 'number' ? g.barDelta : 0;
  const soft = `rgba(${base},${Math.max(0, Math.min(1, alpha + edD))})`;
  const strong = `rgba(${base},${Math.max(0, Math.min(1, alpha + barD))})`;

  const want = new Set(g.regions.map(r => r.toLowerCase()));
  for (const key of Object.keys(GLASS_TARGETS)) {
    if (!want.has(key)) continue;
    const color = key === 'editor' ? soft
      : (key === 'titlebar' || key === 'statusbar' ? strong : tint);
    for (const sel of GLASS_TARGETS[key]) {
      const nodes = document.querySelectorAll(sel);
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i] as HTMLElement;
        if (!el.style) continue;
        if (el.style.getPropertyValue('background-color') !== color ||
            el.style.getPropertyPriority('background-color') !== 'important') {
          el.style.setProperty('background-color', color, 'important');
          el.style.setProperty('background-image', 'none', 'important');
        }
      }
    }
  }

  // 内层一律透明，否则多层 50% 叠起来等于不透明
  for (const sel of INNER_SELECTORS) {
    const nodes = document.querySelectorAll(sel);
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i] as HTMLElement;
      if (!el.style) continue;
      const cur = el.style.getPropertyValue('background-color');
      if (cur === 'transparent' && el.style.getPropertyPriority('background-color') === 'important') continue;
      el.style.setProperty('background-color', 'transparent', 'important');
      el.style.setProperty('background-image', 'none', 'important');
    }
  }

  // 顶层的主题变量也一起改，派生色（滑块、边框、输入框）才会跟着透
  const root = document.body.style;
  const vars: Array<[string, string]> = [
    ['--vscode-sideBar-background', tint],
    ['--vscode-activityBar-background', tint],
    ['--vscode-panel-background', tint],
    ['--vscode-statusBar-background', tint],
    ['--vscode-titleBar-activeBackground', tint],
    ['--vscode-titleBar-inactiveBackground', tint],
    ['--vscode-editor-background', soft],
    ['--vscode-editorGroupHeader-tabsBackground', tint],
    ['--vscode-tab-activeBackground', soft],
    ['--vscode-tab-inactiveBackground', 'transparent'],
    ['--vscode-terminal-background', 'transparent'],
  ];
  for (const [k, v] of vars) {
    root.setProperty(k, v, 'important');
  }
}

function pickOrder(list: string[], shuffle: boolean): string[] {
  const arr = list.slice();
  if (!shuffle) return arr;
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function mount(cfg: VswConfig): void {
  setOnscreenDebug(!!(cfg as any).debug);
  if (window.__VSW_APPLIED__) return;
  window.__VSW_APPLIED__ = true;

  const light = cfg.mode === 'light' || isLightTheme();

  // ---------- 样式 ----------
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent =
    buildStageCss(cfg.wallpaper) +
    buildGlassCss(cfg.glass, light) +
    buildLayoutCss(cfg.layout);

  // ---------- 壁纸层 ----------
  let stage = document.getElementById(STAGE_ID);
  if (!stage) {
    stage = document.createElement('div');
    stage.id = STAGE_ID;
    (document.body || document.documentElement).insertBefore(
      stage,
      (document.body || document.documentElement).firstChild
    );
  }
  while (stage.firstChild) { stage.removeChild(stage.firstChild); }

  const w = cfg.wallpaper;
  const files = (w.list || []).filter(Boolean);

  const grad = document.createElement('div');
  grad.className = 'vsw-grad';

  // scene 壁纸走 iframe，不需要 list，别被 files.length === 0 拦到兜底渐变
  if (w.kind === 'none' || (files.length === 0 && w.kind !== 'scene')) {
    stage.appendChild(grad);
  } else if (w.kind === 'image') {
    const img = document.createElement('img');
    img.className = 'vsw-media';
    img.alt = '';
    img.decoding = 'async';
    img.src = mediaUrl(files[0]);
    img.onerror = () => {
      img.remove();
      if (!stage!.querySelector('.vsw-grad')) stage!.appendChild(grad);
    };
    stage.appendChild(img);

    if (files.length > 1) {
      let i = 0;
      const order = pickOrder(files, w.shuffle);
      window.setInterval(() => {
        i = (i + 1) % order.length;
        img.src = mediaUrl(order[i]);
      }, Math.max(5, w.intervalSec) * 1000);
    }
  } else if (w.kind === 'scene' && w.scene) {
    // scene.pkg：引擎直接在主文档里跑（iframe 在过去经受过拦截，改用内联引擎 + canvas）
    const host = document.createElement('div');
    host.className = 'vsw-media vsw-scene';
    // 用 Shadow DOM 隔离：workbench.html 的全局 CSS 会命中引擎内部的 class
    //（引擎把场景容器解析成「只有音频容器」、画不出内容，就是被外部样式污染的表现）
    stage.appendChild(host);
    const fail = (m: string) => {
      host.remove();
      vswDebug('scene 渲染失败: ' + m);
      // 引擎起不来就退回静态预览图，总比整块黑屏强
      if (w.scenePreview) {
        const im = new Image();
        im.className = 'vsw-media';
        im.src = w.scenePreview;
        stage!.replaceChildren(dim, im);
        vswDebug('scene: 已回退到预览图 ' + w.scenePreview.slice(-24));
        return;
      }
      if (!stage!.querySelector('.vsw-grad')) stage!.appendChild(grad);
    };
    void (async () => {
      const G = (window as any).WebWallGL;
      if (!G) return fail('引擎未注入（dist/webwallgl.global.min.js）');
      try {
        const grab = async (u?: string): Promise<ArrayBuffer | null> => {
          if (!u) return null;
          try {
            vswDebug('scene: fetch ' + u);
            const r = await fetch(u, { cache: 'no-store' });
            vswDebug('scene: http ' + r.status);
            if (!r.ok) return null;
            return await r.arrayBuffer();
          } catch (e) {
            vswDebug('scene: fetch 失败 ' + ((e as any)?.name || '') + ' ' + u);
            return null;
          }
        };
        // 先 <script src> 把 base64 搬进来再解码；不行再退回本地 HTTP fetch
        const viaScript = await new Promise<Uint8Array | null>(resolve => {
          if (!w.scene) return resolve(null);
          vswDebug('scene: script ' + w.scene);
          const sc = document.createElement('script');
          // workbench.html 的 CSP 带 require-trusted-types-for 'script'，
          // 直接赋 src 会被拦（Failed to set the 'src' property … requires 'TrustedScriptURL'）
          sc.src = trustedScriptUrl(w.scene);
          sc.onload = () => {
            const b64 = (window as any).__VSW_PKG__;
            (window as any).__VSW_PKG__ = undefined;
            if (typeof b64 !== 'string' || !b64) return resolve(null);
            try {
              const bin = atob(b64);
              const out = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
              vswDebug('scene: decoded ' + out.byteLength);
              resolve(out);
            } catch (err) {
              vswDebug('scene: decode 失败 ' + (err as Error)?.message);
              resolve(null);
            }
          };
          sc.onerror = () => resolve(null);
          document.head.appendChild(sc);
        });
        const ab = viaScript
          ? (viaScript.buffer as ArrayBuffer)
          : (await grab(w.scene)) || (await grab(w.sceneHttp));
        if (!ab) return fail('取不到 scene.pkg（script / vscode-file / 本地 HTTP 都失败）');
        vswDebug('scene: bytes ' + ab.byteLength);
        vswDebug('scene: mounting, size=' + host.clientWidth + 'x' + host.clientHeight);
        const wp = await G.mount(host, {
          source: G.bytesSource(ab, null, 'vsw-scene'),
          fit: w.fit,
          // 用户属性（鼠标拖尾、壁纸视差、雨、音频条…）—— 键名就是 project.json 里的 key
          ...(w.sceneProps && Object.keys(w.sceneProps).length ? { properties: w.sceneProps } : {}),
          // 引擎的诊断回调：缺纹理、脚本报错都从这里出来，否则画面空白时无从下手
          onDiagnostic: (msg: string, lvl: string) => vswDebug('scene diag(' + (lvl || 'i') + '): ' + String(msg).slice(0, 120)),
        });
        (window as any).__vswScene = wp;
        vswDebug('scene: mounted ' + typeof wp);
        // 画布尺寸自己再兜一次：引擎有时沿用 0 尺寸的首帧
        const cv = host.querySelector('canvas') as HTMLCanvasElement | null;
        if (cv) {
          cv.style.setProperty('width', '100%', 'important');
          cv.style.setProperty('height', '100%', 'important');
          cv.style.setProperty('display', 'block', 'important');
        }
        if (cv) {
          cv.style.width = '100%';
          cv.style.height = '100%';
          cv.style.position = 'absolute';
          cv.style.inset = '0';
          // 引擎默认从 canvas 自己的 pointer 事件取指针，但壁纸层在 pointer-events:none 的
          // stage 里、又被工作台盖着，收不到事件 → 视差/鼠标拖尾不会动。这里手动喂。
          const pushPointer = (e: MouseEvent) => {
            const inst: any = wp;
            if (!inst || typeof inst.pushPointer !== 'function') return;
            const r = host.getBoundingClientRect();
            if (!r.width || !r.height) return;
            const u = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
            const v = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
            try { inst.pushPointer(u, v, (e.buttons & 1) ? 1 : 0); } catch { /* 忽略 */ }
          };
          document.addEventListener('mousemove', pushPointer, { passive: true });
          window.addEventListener('blur', () => {
            try { (wp as any)?.pushPointer?.(0.5, 0.5, 0); } catch { /* 忽略 */ }
          });
          vswDebug('scene: 已接管指针（视差/拖尾可用）');
          vswDebug('scene: canvas ' + cv.width + 'x' + cv.height);
        }
      } catch (e) {
        const er = e as any;
        const cause = er?.cause && (er.cause.code || er.cause.message) ? er.cause.code || er.cause.message : '';
        fail((er?.name || 'Error') + ': ' + (er?.message || String(e)) + (cause ? ' | cause=' + cause : ''));
      }
    })();
  } else if (w.kind === 'web') {
    const fr = document.createElement('iframe');
    fr.className = 'vsw-media vsw-web';
    fr.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-pointer-lock');
    fr.setAttribute('scrolling', 'no');
    fr.src = mediaUrl(files[0]);
    fr.onerror = () => {
      fr.remove();
      if (!stage!.querySelector('.vsw-grad')) stage!.appendChild(grad);
    };
    stage.appendChild(fr);
  } else if (w.kind === 'video') {
    const v = document.createElement('video');
    v.className = 'vsw-media';
    v.autoplay = true;
    v.loop = true;
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.setAttribute('muted', '');
    v.src = mediaUrl(files[0]);
    v.onerror = () => {
      v.remove();
      if (!stage!.querySelector('.vsw-grad')) stage!.appendChild(grad);
    };
    stage.appendChild(v);
    v.play().catch(() => {
      /* 自动播放被拦时静默 */
    });

    if (w.pauseOnBlur) {
      const pause = () => {
        if (!v.paused) v.pause();
      };
      const resume = () => {
        if (document.visibilityState === 'visible') {
          v.play().catch(() => undefined);
        }
      };
      window.addEventListener('blur', pause);
      window.addEventListener('focus', resume);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') pause();
        else resume();
      });
    }

    if (files.length > 1) {
      let i = 0;
      const order = pickOrder(files, w.shuffle);
      window.setInterval(() => {
        i = (i + 1) % order.length;
        v.src = mediaUrl(order[i]);
        v.play().catch(() => undefined);
      }, Math.max(5, w.intervalSec) * 1000);
    }
  }

  // 平铺模式
  if (w.fit === 'tile' && files.length > 0) {
    const tile = document.createElement('div');
    tile.className = 'vsw-tile';
    tile.style.backgroundImage = `url("${mediaUrl(files[0])}")`;
    stage.appendChild(tile);
  }

  const dim = document.createElement('div');
  dim.className = 'vsw-dim';
  stage.appendChild(dim);

  // ---------- 等 workbench 起来再打标记 ----------
  const addOn = () => document.body.classList.add('vsw-on');
  if (document.querySelector('.monaco-workbench')) {
    addOn();
  } else {
    const mo = new MutationObserver(() => {
      if (document.querySelector('.monaco-workbench')) {
        addOn();
        mo.disconnect();
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    window.setTimeout(addOn, 3000); // 兜底
  }

  // 主题切换时（浅/深）重算玻璃底色
  const themeObserver = new MutationObserver(() => {
    const nowLight = isLightTheme();
    if (nowLight !== light) {
      const s = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
      if (s) {
        s.textContent =
          buildStageCss(cfg.wallpaper) +
          buildGlassCss(cfg.glass, nowLight) +
          buildLayoutCss(cfg.layout);
      }
    }
  });
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  enforceGlass(cfg.glass, light);
  /**
   * 用 inline !important 覆盖 CSS 变量：VSCode 自己的主题变量写在样式表里，
   * 我们写在 body 的 style 上且带 important，才能压住它并且不被后续主题刷新覆盖。
   */
  function enforceVars(g: GlassConfig, light: boolean): void {
    if (!g.enabled) return;
    const base = light ? '244,246,250' : '18,20,26';
    const a = Math.max(0, Math.min(1, g.opacity));
    const pairs: Array<[string, string]> = [
      ['--vscode-menu-background', `rgba(${base},0.72)`],
      ['--vscode-menu-border', light ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.10)'],
      ['--vscode-menu-selectionBackground', 'rgba(255,255,255,0.12)'],
      ['--vscode-menu-separatorBackground', 'rgba(255,255,255,0.08)'],
      ['--vscode-editorWidget-background', `rgba(${base},0.72)`],
      ['--vscode-editorWidget-border', light ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.10)'],
      ['--vscode-quickInput-background', `rgba(${base},0.72)`],
      ['--vscode-input-background', 'rgba(255,255,255,0.06)'],
      ['--vscode-titleBar-activeBackground', 'transparent'],
      ['--vscode-titleBar-inactiveBackground', 'transparent'],
      ['--vscode-editor-background', `rgba(${base},${Math.max(0, Math.min(1, a + (typeof g.editorDelta === 'number' ? g.editorDelta : 0)))})`],
    ];
    for (const [k, v] of pairs) {
      document.body.style.setProperty(k, v, 'important');
    }
  }

  window.setInterval(() => enforceGlass(cfg.glass, isLightTheme()), 1200);
  window.setInterval(() => enforceVars(cfg.glass, isLightTheme()), 1200);
  enforceVars(cfg.glass, isLightTheme());

}

function boot(): void {
  const cfg = window.__VSW_CONFIG__;
  if (!cfg) return;
  if (document.body) {
    mount(cfg);
  } else {
    document.addEventListener('DOMContentLoaded', () => mount(cfg), { once: true });
  }
}

boot();

export {};
