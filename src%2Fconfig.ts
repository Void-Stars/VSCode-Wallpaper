import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as we from './we';
import { SceneHost } from './scene/host';
import { ensurePkgScript } from './scene/pkgcache';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mkv', '.mov', '.m4v']);

export interface VswRuntimeConfig {
  /** 是否在壁纸层左下角显示调试日志框（vsw.debug） */
  debug?: boolean;
  wallpaper: {
    kind: 'image' | 'video' | 'web' | 'scene' | 'none';
    /** kind === 'scene' 时，指向本机 scene 渲染服务的 iframe URL */
    scene: string;
    sceneHttp?: string;
    scenePreview?: string;
    /** 场景壁纸的用户属性当前值（传给引擎的 properties） */
    sceneProps?: Record<string, any>;
    /** 用户属性的定义（供侧边栏 GUI 生成控件） */
    scenePropDefs?: { key: string; type: string; label: string; value: any; options?: { value: string; text: string }[] }[];
    list: string[];
    fit: string;
    opacity: number;
    dim: number;
    blur: number;
    pauseOnBlur: boolean;
    intervalSec: number;
    shuffle: boolean;
  };
  glass: {
    enabled: boolean;
    blur: number;
    opacity: number;
    saturation: number;
    border: boolean;
    editorDelta: number;
    barDelta: number;
    regions: string[];
  };
  layout: {
    tabRadius: number;
    compactTabs: boolean;
    hideStatusbar: boolean;
    hideActivityBar: boolean;
    borderless: boolean;
    radius: number;
    radiusTopLeft: number;
    radiusTopRight: number;
    radiusBottomLeft: number;
    radiusBottomRight: number;
    gapTop: number;
    gapSide: number;
    panelRadius: number;
    gapBottom: number;
    floating?: boolean;
    debug?: boolean;
  };
  mode: string;
}

/**
 * VSCode 1.51+ 的 renderer 跑在 sandbox 里，file:// 被限制，
 * 本地资源必须换成 vscode-file://vscode-app/ 才能被加载。
 */
function toRendererUrl(fsPath: string): string {
  return vscode.Uri.file(fsPath).toString().replace(/^file:\/\//i, 'vscode-file://vscode-app');
}

function kindOf(file: string): 'image' | 'video' | 'web' | 'scene' | 'none' {
  if (/\.html?$/i.test(file)) return 'web';
  if (/\.pkg$/i.test(file)) return 'scene';

  const ext = path.extname(file).toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  return 'none';
}

function scanFolder(dir: string, recursive: boolean): string[] {
  const out: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 6) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (recursive) walk(full, depth + 1);
      } else {
        const ext = path.extname(e.name).toLowerCase();
        if (IMAGE_EXT.has(ext) || VIDEO_EXT.has(ext)) out.push(full);
      }
    }
  };
  walk(dir, 0);
  return out.sort();
}

export interface ResolveResult {
  cfg: VswRuntimeConfig;
  resolvedFrom: string;
}

export async function buildRuntimeConfig(
  sceneHost: SceneHost,
  context: vscode.ExtensionContext,
): Promise<ResolveResult> {
  const c = vscode.workspace.getConfiguration('vsw');
  const source = c.get<string>('wallpaper.source', 'file');
  const fit = c.get<string>('wallpaper.fit', 'cover');
  const opacity = c.get<number>('wallpaper.opacity', 1);
  const dim = c.get<number>('wallpaper.dim', 0.25);
  const blur = c.get<number>('wallpaper.blur', 0);
  const pauseOnBlur = c.get<boolean>('wallpaper.pauseOnBlur', true);
  const intervalSec = c.get<number>('wallpaper.intervalSec', 300);
  const shuffle = c.get<boolean>('wallpaper.shuffle', true);
  const recursive = c.get<boolean>('wallpaper.recursive', true);

  let list: string[] = [];
  let kind: 'image' | 'video' | 'web' | 'scene' | 'none' = 'none';
  let resolvedFrom = '';

  if (source === 'wallpaperEngine') {
    const dir = we.findWallpaperEngine();
    if (!dir) {
      resolvedFrom = '没找到 Wallpaper Engine 安装目录';
    } else {
      const weId = c.get<string>('wallpaper.weId', '');
      const r = weId ? we.resolveById(weId) : we.resolveCurrent(dir);
      resolvedFrom = r.note;
      if (r.file && fs.existsSync(r.file)) {
        list = [r.file];
        kind = r.kind;
      }
    }
  } else if (source === 'folder') {
    const dir = c.get<string>('wallpaper.folder', '');
    if (dir && fs.existsSync(dir)) {
      list = scanFolder(dir, recursive);
      if (list.length) {
        kind = kindOf(list[0]);
        if (kind === 'none') kind = 'image';
        // 混放图片和视频时，优先展示图片（视频按第一个视频算）
        const firstVideo = list.find(f => kindOf(f) === 'video');
        const firstImage = list.find(f => kindOf(f) === 'image');
        const firstScene = list.find(f => kindOf(f) === 'scene');
        if (firstScene) {
          kind = 'scene';
          list = [firstScene];
        } else if (firstImage) {
          kind = 'image';
          list = list.filter(f => kindOf(f) === 'image');
        } else if (firstVideo) {
          kind = 'video';
          list = list.filter(f => kindOf(f) === 'video');
        }
        resolvedFrom = `${list.length} 个文件`;
      } else {
        resolvedFrom = '文件夹里没有可用的图片或视频';
      }
    } else {
      resolvedFrom = '文件夹不存在';
    }
  } else {
    const f = c.get<string>('wallpaper.file', '');
    if (f && fs.existsSync(f)) {
      list = [f];
      kind = kindOf(f);
      resolvedFrom = path.basename(f);
      if (kind === 'none') resolvedFrom = `不支持的扩展名：${path.extname(f)}`;
    } else {
      resolvedFrom = f ? '文件不存在' : '还没选壁纸';
    }
  }

  let sceneUrl = '';
  let sceneHttp = '';
  let scenePreview = '';
  let scenePropDefs: we.SceneProp[] = [];
  let sceneProps: Record<string, any> = {};
  if (kind === 'scene') {
    // sceneMode=preview（默认）：不启引擎，直接用同目录 preview.gif/jpg 当壁纸。
    // 引擎在 VSCode renderer 里能 mount、canvas 有像素但成画是黑的（已知问题），
    // 有 preview.gif 就是动的，比黑屏强。改 live 才走真渲染。
    const sceneMode = c.get<string>('wallpaper.sceneMode', 'live');
    if (sceneMode !== 'live') {
      const d0 = path.dirname(list[0] || '');
      let pv = '';
      for (const name of ['preview.gif', 'preview.jpg', 'preview.png']) {
        const cand = path.join(d0, name);
        if (fs.existsSync(cand)) { pv = cand; break; }
      }
      if (pv) {
        kind = kindOf(pv) === 'video' ? 'video' : 'image';
        list = [pv];
        resolvedFrom = `scene 预览图 · ${path.basename(d0)}`;
      }
    }
    if (!list[0]) {
      kind = 'none';
      resolvedFrom = 'scene 壁纸没有可用的 scene.pkg';
    } else {
      // 首选：把 pkg 转成 JS 文件、用 <script src="vscode-file:..."> 搬进页面
      // （VSCode renderer 里 fetch 拿不到 http://127.0.0.1，也 fetch 不了 vscode-file）
      const pkgJs = await ensurePkgScript(context, list[0]);
      if (pkgJs) {
        sceneUrl = toRendererUrl(pkgJs);
        resolvedFrom = `scene · ${path.basename(path.dirname(list[0]))}`;
      }
      // 兜底：本地 HTTP（部分环境可用）
      // 静态兜底：同目录的 preview.gif / preview.jpg（scene 渲染不出来时至少不是黑屏）
      const dir = path.dirname(list[0]);
      for (const name of ['preview.gif', 'preview.jpg', 'preview.png']) {
        const cand = path.join(dir, name);
        if (fs.existsSync(cand)) { scenePreview = toRendererUrl(cand); break; }
      }
      const url = await sceneHost.register(list[0], path.basename(path.dirname(list[0])), fit);
      if (url) sceneHttp = url;
      // 用户属性：project.json 里 bool/slider/combo 那些（鼠标拖尾、壁纸视差、雨、音频条…）
      scenePropDefs = we.readSceneProps(dir);
      const override = c.get<Record<string, any>>('sceneProps', {}) || {};
      for (const d of scenePropDefs) {
        const v = override[d.key];
        sceneProps[d.key] = v === undefined ? d.value : v;
      }
      if (!sceneUrl && !sceneHttp) {
        kind = 'none';
        resolvedFrom = 'scene 渲染准备失败（既没生成 pkg 脚本，也起不了本地服务）';
      }
    }
  }

  return {
    resolvedFrom,
    cfg: {
      wallpaper: {
        kind,
        scene: sceneUrl,
        sceneProps,
        scenePropDefs,
        sceneHttp,
        scenePreview,
        list: kind === 'scene' ? [] : list.map(toRendererUrl),
        fit,
        opacity,
        dim,
        blur,
        pauseOnBlur,
        intervalSec,
        shuffle,
      },
      glass: {
        enabled: c.get<boolean>('glass.enabled', true),
        blur: c.get<number>('glass.blur', 24),
        opacity: c.get<number>('glass.opacity', 0.55),
        saturation: c.get<number>('glass.saturation', 1.4),
        border: c.get<boolean>('glass.border', true),
        editorDelta: c.get<number>('glass.editorDelta', 0),
        barDelta: c.get<number>('glass.barDelta', 0),
        regions: c.get<string[]>('glass.regions', [
          'titlebar',
          'activitybar',
          'sidebar',
          'auxiliarybar',
          'editor',
          'panel',
          'statusbar',
          'tabs',
        ]),
      },
      layout: {
        tabRadius: c.get<number>('layout.tabRadius', 8),
        compactTabs: c.get<boolean>('layout.compactTabs', false),
        hideStatusbar: c.get<boolean>('layout.hideStatusbar', false),
        hideActivityBar: c.get<boolean>('layout.hideActivityBar', false),
        borderless: c.get<boolean>('layout.borderless', true),
      radius: c.get<number>('layout.radius', 0),
      radiusTopLeft: c.get<number>('layout.radiusTopLeft', -1),
      radiusTopRight: c.get<number>('layout.radiusTopRight', -1),
      radiusBottomLeft: c.get<number>('layout.radiusBottomLeft', -1),
      radiusBottomRight: c.get<number>('layout.radiusBottomRight', -1),
      gapTop: c.get<number>('layout.gapTop', 12),
      gapSide: c.get<number>('layout.gapSide', 0),
      panelRadius: c.get<number>('layout.panelRadius', 0),
      gapBottom: c.get<number>('layout.gapBottom', 8),
      // 注意：c 是 getConfiguration('vsw')，c.get('workbench.xxx') 会去找 vsw.workbench.xxx（永远不存在）。
      // 这个 bug 让扩展自动注入时 floating 恒为 false，浮层/圆角/间距全丢，只有手工 _inject_final.py 注入才对。
      floating: vscode.workspace
        .getConfiguration()
        .get<boolean>('workbench.experimental.modernUI', false),
      },
      mode: 'auto',
      debug: c.get<boolean>('debug', false),
    },
  };
}
