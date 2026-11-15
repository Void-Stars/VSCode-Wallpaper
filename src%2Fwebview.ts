import * as vscode from 'vscode';
import * as path from 'path';
import * as we from './we';

/** 侧边栏控制面板（WebviewView） */

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

type Msg =
  | { t: 'ready' }
  | { t: 'set'; k: string; v: unknown }
  | { t: 'cmd'; c: string }
  | { t: 'reload' };

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'vswSidebar';

  private view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onApplied: () => Promise<void>
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    view.webview.html = this.html(view.webview);

    view.webview.onDidReceiveMessage(async (m: Msg) => {
      try {
        if (m.t === 'ready') {
          void this.postState();
          return;
        }
        if (m.t === 'cmd') {
          await vscode.commands.executeCommand(m.c);
          void this.postState();
          return;
        }
        if (m.t === 'reload') {
          await vscode.commands.executeCommand('workbench.action.reloadWindow');
          return;
        }
        if (m.t === 'set' && m.k.startsWith('sceneProps.')) {
          // 场景壁纸的用户属性：整体存在 vsw.sceneProps 对象里，改其中一个子键
          const cfgAll = vscode.workspace.getConfiguration('vsw');
          const cur = { ...(cfgAll.get<Record<string, unknown>>('sceneProps', {}) || {}) };
          cur[m.k.slice('sceneProps.'.length)] = m.v;
          await cfgAll.update('sceneProps', cur, vscode.ConfigurationTarget.Global);
          void this.postState();
          return;
        }
        if (m.t === 'set') {
          // workbench.* 是 VS Code 自己的设置（modernUI 开关），不是 vsw.*
          if (m.k.startsWith('workbench.')) {
            const wb = vscode.workspace.getConfiguration('workbench');
            await wb.update(m.k.slice('workbench.'.length), m.v, vscode.ConfigurationTarget.Global);
            void this.postState();
            return;
          }
          const dot = m.k.indexOf('.');
          const section = dot > 0 ? m.k.slice(0, dot) : '';
          const cfg = vscode.workspace.getConfiguration(section ? `vsw.${section}` : 'vsw');
          const key = dot > 0 ? m.k.slice(dot + 1) : m.k;
          await cfg.update(key, m.v, vscode.ConfigurationTarget.Global);
          void this.postState();
          return;
        }
      } catch (e: any) {
        vscode.window.showErrorMessage(`壁纸面板：${e?.message ?? e}`);
      }
    });

    // 配置被别处改动时同步回面板
    const sub = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('vsw')) void this.postState();
    });
    view.onDidDispose(() => sub.dispose());
  }

  public async postState(): Promise<void> {
    if (!this.view) return;
    const c = vscode.workspace.getConfiguration('vsw');
    const wb = vscode.workspace.getConfiguration('workbench');
    const file = c.get<string>('wallpaper.file', '');
    const folder = c.get<string>('wallpaper.folder', '');
    const src = c.get<string>('wallpaper.source', 'file');
    const basename = (p: string) => (p ? p.split(/[\\/]/).pop() || p : '');
    const state = {
      enabled: c.get<boolean>('enabled', false),
      source: src,
      sceneMode: c.get<string>('wallpaper.sceneMode', 'live'),
      // 场景壁纸的用户属性：从当前 WE 壁纸的 project.json 现读，再叠加用户的覆盖值
      ...(() => {
        const weId = c.get<string>('wallpaper.weId', '');
        let defs: we.SceneProp[] = [];
        if (weId) {
          try {
            const r = we.resolveById(weId);
            const dir = r.kind === 'scene' && r.file ? path.dirname(r.file) : '';
            if (dir) defs = we.readSceneProps(dir);
          } catch { /* 壁纸库读不到就算了 */ }
        }
        const ov = c.get<Record<string, any>>('sceneProps', {}) || {};
        return {
          scenePropDefs: defs.map(d => ({
            key: d.key,
            type: d.type,
            label: d.label,
            options: d.options || [],
          })),
          sceneProps: Object.fromEntries(defs.map(d => [d.key, ov[d.key] === undefined ? d.value : ov[d.key]])),
        };
      })(),
      wallpaperName:
        src === 'wallpaperEngine'
          ? c.get<string>('wallpaper.weId', '')
            ? `WE · ${c.get<string>('wallpaper.weId', '')}`
            : '跟随 WE 当前壁纸'
          : src === 'folder'
            ? basename(folder) || '未选择'
            : basename(file) || '未选择',
      glass: {
        enabled: c.get<boolean>('glass.enabled', true),
        blur: c.get<number>('glass.blur', 26),
        opacity: c.get<number>('glass.opacity', 0.5),
        saturation: c.get<number>('glass.saturation', 1.45),
        editorDelta: c.get<number>('glass.editorDelta', 0),
        barDelta: c.get<number>('glass.barDelta', 0),
      },
      layout: {
        radius: c.get<number>('layout.radius', 0),
        panelRadius: c.get<number>('layout.panelRadius', 12),
        tabRadius: c.get<number>('layout.tabRadius', 8),
      },
      floating: wb.get<boolean>('experimental.modernUI', false),
      autoReload: c.get<boolean>('autoReload', true),
    };
    await this.view.webview.postMessage({ t: 'state', s: state });
  }

  private html(webview: vscode.Webview): string {
    const n = makeNonce();
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${n}'`,
      `img-src ${webview.cspSource} data:`,
    ].join('; ');

    return /* html */ `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  :root { --pad: 10px; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 10px 12px 18px;
    font-family: var(--vscode-font-family);
    font-size: 12px;
    color: var(--vscode-foreground);
    background: transparent;
  }
  h4 {
    margin: 14px 0 6px; font-size: 11px; font-weight: 600;
    letter-spacing: .4px; text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
  }
  h4:first-of-type { margin-top: 4px; }
  .row { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
  .row > .lab { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .val {
    font-variant-numeric: tabular-nums; min-width: 44px; text-align: right;
    color: var(--vscode-descriptionForeground);
  }
  input[type=range] {
    -webkit-appearance: none; appearance: none;
    width: 100%; height: 18px; background: transparent; margin: 0;
  }
  input[type=range]::-webkit-slider-runnable-track {
    height: 3px; border-radius: 2px;
    background: var(--vscode-slider-track-background, rgba(128,128,128,.35));
  }
  input[type=range]::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 11px; height: 11px; margin-top: -4px; border-radius: 50%;
    background: var(--vscode-button-background);
    border: 1px solid var(--vscode-button-border, transparent);
  }
  button {
    font-family: inherit; font-size: 11px;
    padding: 4px 8px; border-radius: 4px; cursor: pointer;
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground);
    border: 1px solid transparent;
  }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.primary {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  select {
    background: var(--vscode-dropdown-background, #3c3c3c);
    color: var(--vscode-dropdown-foreground, #ccc);
    border: 1px solid var(--vscode-dropdown-border, #444);
    border-radius: 4px; padding: 3px 6px; font-size: 12px; max-width: 58%;
  }
  .btns { display: flex; gap: 6px; flex-wrap: wrap; }
  .btns button { flex: 1; min-width: 62px; }
  .card {
    padding: 8px; border-radius: 6px;
    background: var(--vscode-editorWidget-background, rgba(128,128,128,.1));
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.2));
    margin-bottom: 8px;
  }
  .name { font-size: 11px; color: var(--vscode-descriptionForeground); word-break: break-all; }
  /* 开关 */
  .sw {
    position: relative; width: 30px; height: 16px; border-radius: 9px; cursor: pointer;
    background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, rgba(128,128,128,.4));
    flex: none; transition: background .15s;
  }
  .sw::after {
    content: ''; position: absolute; top: 1px; left: 1px;
    width: 12px; height: 12px; border-radius: 50%;
    background: var(--vscode-foreground); opacity: .75; transition: transform .15s;
  }
  .sw.on { background: var(--vscode-button-background); border-color: transparent; }
  .sw.on::after { transform: translateX(14px); background: #fff; opacity: 1; }
  .hint { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 6px; line-height: 1.5; }
</style>
</head>
<body>
  <div class="card">
    <div class="row">
      <span class="lab"><b>启用壁纸</b></span>
      <div class="sw" id="sw-enabled" data-k="enabled"></div>
    </div>
    <div class="name" id="wp-name">…</div>
  </div>

  <h4>壁纸来源</h4>
  <div class="btns">
    <button data-cmd="vsw.pickFile">选文件</button>
    <button data-cmd="vsw.pickFolder">轮播文件夹</button>
  </div>
  <div class="btns" style="margin-top:6px">
    <button data-cmd="vsw.useWallpaperEngine">跟随 WE</button>
    <button data-cmd="vsw.browseWallpaperEngine">WE 壁纸库</button>
  </div>
  <div class="row" style="margin-top:10px">
    <span class="lab">scene 壁纸</span>
    <select id="sel-scene" data-k="wallpaper.sceneMode">
      <option value="preview">用预览图（动图/静态）</option>
      <option value="live">实机渲染 scene.pkg（实验）</option>
    </select>
  </div>
  <div id="scene-props"></div>

  <h4>毛玻璃</h4>
  <div class="row">
    <span class="lab">启用玻璃</span>
    <div class="sw" id="sw-glass" data-k="glass.enabled"></div>
  </div>
  <div class="row"><span class="lab">模糊</span><span class="val" id="v-glass.blur"></span></div>
  <input type="range" data-k="glass.blur" min="0" max="60" step="1" />
  <div class="row"><span class="lab">不透明度</span><span class="val" id="v-glass.opacity"></span></div>
  <input type="range" data-k="glass.opacity" min="0.1" max="1" step="0.02" />
  <div class="row"><span class="lab">饱和度</span><span class="val" id="v-glass.saturation"></span></div>
  <input type="range" data-k="glass.saturation" min="1" max="2.4" step="0.05" />
  <div class="row"><span class="lab">编辑器亮度差</span><span class="val" id="v-glass.editorDelta"></span></div>
  <input type="range" data-k="glass.editorDelta" min="-0.5" max="0.5" step="0.02" />
  <div class="row"><span class="lab">标题/状态栏亮度差</span><span class="val" id="v-glass.barDelta"></span></div>
  <input type="range" data-k="glass.barDelta" min="-0.5" max="0.5" step="0.02" />

  <h4>布局</h4>
  <div class="row">
    <span class="lab">三块浮层（modernUI）</span>
    <div class="sw" id="sw-floating"></div>
  </div>
  <div class="row"><span class="lab">窗口圆角</span><span class="val" id="v-layout.radius"></span></div>
  <input type="range" data-k="layout.radius" min="0" max="24" step="1" />
  <div class="row"><span class="lab">侧栏/编辑区圆角</span><span class="val" id="v-layout.panelRadius"></span></div>
  <input type="range" data-k="layout.panelRadius" min="0" max="32" step="1" />
  <div class="row"><span class="lab">标签页圆角</span><span class="val" id="v-layout.tabRadius"></span></div>
  <input type="range" data-k="layout.tabRadius" min="0" max="20" step="1" />

  <h4>操作</h4>
  <div class="btns">
    <button class="primary" id="btn-reload">重载窗口生效</button>
  </div>
  <div class="btns" style="margin-top:6px">
    <button data-cmd="vsw.setCorners">四角分别设置</button>
    <button data-cmd="vsw.apply">重新写入</button>
  </div>
  <div class="hint">拖动滑块会立刻写进设置并重新注入；样式改动要点「重载窗口生效」才看得到。</div>

<script nonce="${n}">
(function () {
  const vscode = acquireVsCodeApi();
  const fmt = {
    'glass.blur': v => v + 'px',
    'glass.opacity': v => Math.round(v * 100) + '%',
    'glass.saturation': v => Number(v).toFixed(2) + '×',
    'glass.editorDelta': v => (v > 0 ? '+' : '') + Number(v).toFixed(2),
    'glass.barDelta': v => (v > 0 ? '+' : '') + Number(v).toFixed(2),
    'layout.radius': v => v + 'px',
    'layout.panelRadius': v => v + 'px',
    'layout.tabRadius': v => v + 'px',
  };

  const sliders = Array.from(document.querySelectorAll('input[type=range]'));
  const switches = Array.from(document.querySelectorAll('.sw[data-k]'));

  function labelOf(el) {
    const k = el.dataset.k;
    const out = document.getElementById('v-' + k);
    if (out && fmt[k]) out.textContent = fmt[k](Number(el.value));
  }

  sliders.forEach(el => {
    el.addEventListener('input', () => labelOf(el));
    el.addEventListener('change', () => {
      const k = el.dataset.k;
      const v = Number(el.value);
      vscode.postMessage({ t: 'set', k, v });
    });
  });

  switches.forEach(el => {
    el.addEventListener('click', () => {
      const on = !el.classList.contains('on');
      el.classList.toggle('on', on);
      vscode.postMessage({ t: 'set', k: el.dataset.k, v: on });
    });
  });

  // scene 壁纸自带的用户属性（鼠标拖尾、壁纸视差、雨、音频条…），按壁纸的 project.json 动态生成
  function renderSceneProps(defs, vals) {
    const box = document.getElementById('scene-props');
    if (!box) return;
    box.textContent = '';
    if (!defs || !defs.length) return;
    const h = document.createElement('h4');
    h.textContent = '壁纸自带设置';
    box.appendChild(h);
    for (const d of defs) {
      const k = 'sceneProps.' + d.key;
      const val = vals && vals[d.key] !== undefined ? vals[d.key] : d.value;
      if (d.type === 'bool') {
        const row = document.createElement('div');
        row.className = 'row';
        const lab = document.createElement('span');
        lab.className = 'lab';
        lab.textContent = d.label;
        const sw = document.createElement('div');
        sw.className = 'sw' + (val ? ' on' : '');
        sw.addEventListener('click', () => {
          const on = !sw.classList.contains('on');
          sw.classList.toggle('on', on);
          vscode.postMessage({ t: 'set', k, v: on });
        });
        row.appendChild(lab);
        row.appendChild(sw);
        box.appendChild(row);
      } else if (d.type === 'slider') {
        const num = Number(val);
        const lo = Math.min(0, num);
        const hi = Math.max(1, Math.abs(num) * 2 || 1);
        const row = document.createElement('div');
        row.className = 'row';
        row.innerHTML = '<span class="lab"></span><span class="val"></span>';
        row.querySelector('.lab').textContent = d.label;
        const out = row.querySelector('.val');
        out.textContent = String(num);
        const rng = document.createElement('input');
        rng.type = 'range';
        rng.min = String(lo);
        rng.max = String(hi);
        rng.step = '0.01';
        rng.value = String(num);
        rng.addEventListener('input', () => { out.textContent = rng.value; });
        rng.addEventListener('change', () => vscode.postMessage({ t: 'set', k, v: Number(rng.value) }));
        box.appendChild(row);
        box.appendChild(rng);
      } else if (d.type === 'combo' && d.options && d.options.length) {
        const row = document.createElement('div');
        row.className = 'row';
        const lab = document.createElement('span');
        lab.className = 'lab';
        lab.textContent = d.label;
        const sel = document.createElement('select');
        for (const o of d.options) {
          const op = document.createElement('option');
          op.value = o.value;
          op.textContent = o.text || o.value;
          sel.appendChild(op);
        }
        sel.value = String(val);
        sel.addEventListener('change', () => vscode.postMessage({ t: 'set', k, v: sel.value }));
        row.appendChild(lab);
        row.appendChild(sel);
        box.appendChild(row);
      }
    }
  }

  const selScene = document.getElementById('sel-scene');
  if (selScene) {
    selScene.addEventListener('change', () => {
      vscode.postMessage({ t: 'set', k: selScene.dataset.k, v: selScene.value });
    });
  }

  document.querySelectorAll('button[data-cmd]').forEach(b => {
    b.addEventListener('click', () => vscode.postMessage({ t: 'cmd', c: b.dataset.cmd }));
  });
  document.getElementById('btn-reload').addEventListener('click', () => vscode.postMessage({ t: 'reload' }));

  const swFloating = document.getElementById('sw-floating');
  swFloating.addEventListener('click', () => {
    const on = !swFloating.classList.contains('on');
    swFloating.classList.toggle('on', on);
    // 这是 workbench 的设置，不走 vsw.set；直接由扩展侧处理
    vscode.postMessage({ t: 'set', k: 'workbench.experimental.modernUI', v: on });
  });

  window.addEventListener('message', ev => {
    const m = ev.data;
    if (!m || m.t !== 'state') return;
    const s = m.s;
    document.getElementById('wp-name').textContent = s.wallpaperName;
    document.getElementById('sw-enabled').classList.toggle('on', !!s.enabled);
    document.getElementById('sw-glass').classList.toggle('on', !!s.glass.enabled);
    swFloating.classList.toggle('on', !!s.floating);
    if (selScene && typeof s.sceneMode === 'string') selScene.value = s.sceneMode;
    renderSceneProps(s.scenePropDefs, s.sceneProps);
    sliders.forEach(el => {
      const k = el.dataset.k;
      const parts = k.split('.');
      const v = s[parts[0]] ? s[parts[0]][parts[1]] : undefined;
      if (typeof v === 'number') { el.value = String(v); labelOf(el); }
    });
  });

  vscode.postMessage({ t: 'ready' });
})();
</script>
</body>
</html>`;
  }
}
