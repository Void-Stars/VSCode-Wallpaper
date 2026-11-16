import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface WallpaperEngineItem {
  id: string;
  title: string;
  type: string;
  dir: string;
  preview?: string;
  playable?: string;
}

export interface ResolvedWallpaper {
  kind: 'image' | 'video' | 'web' | 'scene' | 'none';
  file: string;
  note: string;
}

const WE_REG_KEY = 'HKCU\\Software\\WallpaperEngine';
const WORKSHOP_APPID = '431960';

function tryDirs(): string[] {
  const out: string[] = [];
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  out.push(path.join(pf86, 'Steam', 'steamapps', 'common', 'wallpaper_engine'));
  return out;
}

/** 从注册表读 Wallpaper Engine 安装路径，失败则用默认路径 */
export function findWallpaperEngine(): string | undefined {
  try {
    const { execFileSync } = require('child_process') as typeof import('child_process');
    const out = execFileSync('reg', ['query', WE_REG_KEY, '/v', 'installPath'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 4000,
    });
    const m = out.match(/installPath\s+REG_\w+\s+(.+)/i);
    if (m && m[1]) {
      let p = m[1].trim().replace(/\\+$/, '');
      // 注册表里常指向 wallpaper64.exe
      if (/\.exe$/i.test(p)) p = path.dirname(p);
      if (fs.existsSync(path.join(p, 'config.json'))) return p;
      if (fs.existsSync(p)) return p;
    }
  } catch {
    /* 忽略，走默认路径 */
  }
  for (const d of tryDirs()) {
    if (fs.existsSync(path.join(d, 'config.json'))) return d;
  }
  return undefined;
}

interface WeConfig {
  selected?: string;
}

export function readWeConfig(weDir: string): any | undefined {
  try {
    const raw = fs.readFileSync(path.join(weDir, 'config.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** 当前 Wallpaper Engine 在主显示器上选的壁纸文件 */
export function currentWallpaperFile(weDir: string): string | undefined {
  const cfg = readWeConfig(weDir);
  const sel = cfg?.Home?.general?.wallpaperconfig?.selectedwallpapers;
  if (!sel) return undefined;
  const prefer = ['Monitor0', 'Monitor1', 'Monitor2'];
  for (const k of prefer) {
    const f = sel[k]?.file;
    if (typeof f === 'string' && f) return f;
  }
  for (const k of Object.keys(sel)) {
    const f = sel[k]?.file;
    if (typeof f === 'string' && f) return f;
  }
  return undefined;
}

function readProjectJson(dir: string): any | undefined {
  for (const name of ['project.json', 'Project.json']) {
    const p = path.join(dir, name);
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      /* next */
    }
  }
  return undefined;
}

/** 把一个 workshop 目录解析成可展示的壁纸 */
export function describeWallpaperDir(dir: string): WallpaperEngineItem | undefined {
  if (!fs.existsSync(dir)) return undefined;
  const proj = readProjectJson(dir);
  const id = path.basename(dir);
  const type = String(proj?.type ?? '').toLowerCase();
  const title = String(proj?.title ?? id);

  const previewName = proj?.preview as string | undefined;
  let preview: string | undefined;
  if (previewName) {
    const p = path.join(dir, previewName);
    if (fs.existsSync(p)) preview = p;
  }
  if (!preview) {
    for (const cand of ['preview.jpg', 'preview.png', 'preview.gif', 'preview.webp']) {
      const p = path.join(dir, cand);
      if (fs.existsSync(p)) {
        preview = p;
        break;
      }
    }
  }

  let playable: string | undefined;
  if (type === 'video' || type === 'videowallpaper') {
    if (proj?.file) {
      const p = path.join(dir, String(proj.file));
      if (fs.existsSync(p)) playable = p;
    }
    if (!playable) {
      try {
        const hit = fs
          .readdirSync(dir)
          .find(f => /\.(mp4|webm|mkv|mov)$/i.test(f));
        if (hit) playable = path.join(dir, hit);
      } catch {
        /* ignore */
      }
    }
  } else if (type === 'web') {
    const idx = path.join(dir, 'index.html');
    if (fs.existsSync(idx)) playable = idx;
  }

  return { id, title, type, dir, preview, playable };
}

/** 当前壁纸 → 可直接给 workbench 用的图片或视频 */
export function resolveCurrent(weDir: string): ResolvedWallpaper {
  const file = currentWallpaperFile(weDir);
  if (!file) return { kind: 'none', file: '', note: 'Wallpaper Engine 里还没有选中的壁纸' };

  const norm = file.replace(/\\/g, '/');
  const ext = path.extname(norm).toLowerCase();

  if (/\.(mp4|webm|mkv|mov)$/i.test(ext)) {
    if (fs.existsSync(norm)) return { kind: 'video', file: norm, note: '视频壁纸' };
  }
  if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(ext)) {
    if (fs.existsSync(norm)) return { kind: 'image', file: norm, note: '图片壁纸' };
  }
  if (ext === '.pkg') {
    const dir = path.dirname(norm);
    const item = describeWallpaperDir(dir);
    // scene 壁纸优先交给 WebWallGL 实时渲染，没有 pkg 才退回视频/预览图
    const pkg = path.join(dir, 'scene.pkg');
    if (fs.existsSync(pkg)) {
      return { kind: 'scene', file: pkg, note: `${item?.title ?? '场景壁纸'}（WebGL 实时渲染）` };
    }
    if (item?.playable && /\.(mp4|webm)$/i.test(item.playable)) {
      return { kind: 'video', file: item.playable, note: `${item.title}（视频）` };
    }
    if (item?.preview) {
      return { kind: 'image', file: item.preview, note: `${item.title}（场景壁纸，用预览图代替）` };
    }
    return { kind: 'none', file: '', note: `${item?.title ?? '场景壁纸'} 没有可用素材` };
  }
  if (ext === '.html') {
    const item = describeWallpaperDir(path.dirname(norm));
    return {
      kind: item?.preview ? 'image' : 'none',
      file: item?.preview ?? '',
      note: '网页壁纸，用预览图代替',
    };
  }
  return { kind: 'none', file: '', note: `不认识的壁纸类型：${file}` };
}

/** 解析 Steam 库位置 */
function steamLibraries(): string[] {
  const sets = new Set<string>();
  const roots: string[] = [];
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  roots.push(path.join(pf86, 'Steam'));
  roots.push(path.join(pf, 'Steam'));
  for (const drive of ['C', 'D', 'E', 'F', 'G', 'H']) {
    roots.push(`${drive}:\\SteamLibrary`);
    roots.push(`${drive}:\\Steam`);
    roots.push(`${drive}:\\Program Files (x86)\\Steam`);
  }
  for (const r of roots) {
    const vdf = path.join(r, 'steamapps', 'libraryfolders.vdf');
    if (fs.existsSync(vdf)) {
      sets.add(path.join(r, 'steamapps'));
      try {
        const txt = fs.readFileSync(vdf, 'utf8');
        const re = /"path"\s+"([^"]+)"/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(txt))) {
          const p = m[1].replace(/\\\\/g, '\\');
          sets.add(path.join(p, 'steamapps'));
        }
      } catch {
        /* ignore */
      }
    } else if (fs.existsSync(path.join(r, 'steamapps'))) {
      sets.add(path.join(r, 'steamapps'));
    }
  }
  return [...sets];
}

/** 列出所有 Wallpaper Engine 壁纸 */
export function listLibrary(): WallpaperEngineItem[] {
  const items: WallpaperEngineItem[] = [];
  const seen = new Set<string>();
  for (const sa of steamLibraries()) {
    const root = path.join(sa, 'workshop', 'content', WORKSHOP_APPID);
    if (!fs.existsSync(root)) continue;
    let dirs: string[] = [];
    try {
      dirs = fs.readdirSync(root).filter(d => fs.statSync(path.join(root, d)).isDirectory());
    } catch {
      continue;
    }
    for (const d of dirs) {
      const full = path.join(root, d);
      if (seen.has(full)) continue;
      seen.add(full);
      const item = describeWallpaperDir(full);
      if (item) items.push(item);
    }
  }
  items.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'));
  return items;
}

const MEDIA_RE = /\.(mp4|webm|mkv|mov)$/i;

/** 在目录里（含一层子目录）找第一个视频文件 */
function findMedia(dir: string, re: RegExp): string | undefined {
  try {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      let st: import('fs').Stats;
      try { st = fs.statSync(full); } catch { continue; }
      if (st.isFile() && re.test(name)) return full;
      if (st.isDirectory()) {
        try {
          for (const sub of fs.readdirSync(full)) {
            const sf = path.join(full, sub);
            try { if (fs.statSync(sf).isFile() && re.test(sub)) return sf; } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  return undefined;
}

/** 按壁纸 id（工坊目录名）解析出可播放的东西 */
export function resolveById(id: string): ResolvedWallpaper {
  const hit = listLibrary().find(it => it.id === id);
  if (!hit) return { kind: 'none', file: '', note: `壁纸库里没找到 ${id}` };

  const t = (hit.type || '').toLowerCase();
  if (t === 'video' || t === 'videowallpaper') {
    if (hit.playable && /\.(mp4|webm|mkv|mov)$/i.test(hit.playable)) {
      return { kind: 'video', file: hit.playable.replace(/\\/g, '/'), note: `${hit.title}（视频）` };
    }
    if (hit.preview) return { kind: 'image', file: hit.preview.replace(/\\/g, '/'), note: `${hit.title}（视频，退化为预览图）` };
    return { kind: 'none', file: '', note: `${hit.title} 里没有视频文件` };
  }
  if (t === 'web' && hit.playable && /\.html?$/i.test(hit.playable)) {
    return { kind: 'web', file: hit.playable.replace(/\\/g, '/'), note: `${hit.title}（网页）` };
  }
  if (t.includes('scene')) {
    // 场景壁纸：有 scene.pkg 就交给 WebWallGL 实时渲染（图层/效果/粒子/SceneScript 全还原）；
    // 没有 pkg 时才退化为目录内视频或预览图。
    const pkg = path.join(hit.dir, 'scene.pkg');
    if (fs.existsSync(pkg)) {
      return { kind: 'scene', file: pkg.replace(/\\/g, '/'), note: `${hit.title}（WebGL 实时渲染）` };
    }
    const pickVideo = findMedia(hit.dir, MEDIA_RE);
    if (pickVideo) {
      return { kind: 'video', file: pickVideo.replace(/\\/g, '/'), note: `${hit.title}（场景壁纸，用目录内视频）` };
    }
    if (hit.preview) {
      return { kind: 'image', file: hit.preview.replace(/\\/g, '/'), note: `${hit.title}（场景壁纸，仅静态预览）` };
    }
    return { kind: 'none', file: '', note: `${hit.title} 没有可用素材` };
  }
  if (hit.preview) {
    return { kind: 'image', file: hit.preview.replace(/\\/g, '/'), note: `${hit.title}（${t || '预览图'}）` };
  }
  return { kind: 'none', file: '', note: `${hit.title} 里没有预览图` };
}

/** Wallpaper Engine 用户属性（project.json 的 general.properties）里能在 GUI 上调的那些 */
export interface SceneProp {
  key: string;
  type: 'bool' | 'slider' | 'combo';
  label: string;
  value: boolean | number | string;
  /** slider 的显示范围（WE 不提供 min/max，用启发式） */
  min?: number;
  max?: number;
  step?: number;
  /** combo 的选项（WE 里常是 "0=关闭;1=样式一" 这种字符串） */
  options?: { value: string; text: string }[];
}

function stripHtml(s: string): string {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/** 读某个 scene 壁纸目录下 project.json 的用户属性；只保留 GUI 里能操作的 bool/slider/combo */
export function readSceneProps(dir: string): SceneProp[] {
  const pj = path.join(dir, 'project.json');
  if (!fs.existsSync(pj)) return [];
  let doc: any;
  try {
    doc = JSON.parse(fs.readFileSync(pj, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return [];
  }
  const props = doc?.general?.properties;
  if (!props || typeof props !== 'object') return [];
  const out: SceneProp[] = [];
  for (const [key, raw] of Object.entries<any>(props)) {
    const t = String(raw?.type || '').toLowerCase();
    const label = stripHtml(raw?.text) || key;
    // 纯说明性 text（那些 <img>/<h3> 段落）和 color 太杂，先不上
    if (t === 'bool') {
      out.push({ key, type: 'bool', label, value: !!raw.value });
    } else if (t === 'slider') {
      const v = Number(raw.value);
      out.push({
        key,
        type: 'slider',
        label,
        value: Number.isFinite(v) ? v : 0,
        min: Math.min(0, Number.isFinite(v) ? v : 0),
        max: Math.max(1, Number.isFinite(v) ? v : 0) * 2,
        step: 0.01,
      });
    } else if (t === 'combo') {
      const opts: { value: string; text: string }[] = [];
      const rawOpts = String(raw?.options ?? '');
      for (const part of rawOpts.split(';')) {
        const idx = part.indexOf('=');
        if (idx > 0) opts.push({ value: part.slice(0, idx).trim(), text: stripHtml(part.slice(idx + 1)) });
      }
      out.push({ key, type: 'combo', label, value: String(raw.value ?? ''), options: opts });
    }
  }
  return out;
}
