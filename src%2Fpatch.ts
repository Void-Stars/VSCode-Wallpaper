import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const START = '<!-- vsw-wallpaper-glass-start -->';
const END = '<!-- vsw-wallpaper-glass-end -->';

export interface InjectPayload {
  config: unknown;
  loaderJs: string;
  /** scene 壁纸用的渲染引擎（webwallgl），内联进工作台，避免 iframe 被拦 */
  engineJs?: string;
}

export function workbenchHtmlPath(): string {
  const appRoot = vscode.env.appRoot;
  const candidates = [
    path.join(appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'),
    path.join(appRoot, 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.html'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(`找不到 workbench.html，尝试过：\n${candidates.join('\n')}`);
}

function safeJson(v: unknown): string {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function safeJs(js: string): string {
  // 内联进 <script> 时，源码里只要出现 `<!--`，HTML 解析器就会进入 escaped 状态，
  // 之后真正的 </script> 不再结束元素，把后面的脚本整个吞掉（webwallgl 的正则里就有 `<!--`）。
  // 用 \u0021 / \u0073 转义在 JS 与正则里都等价，但 HTML 解析器不再识别。
  return js
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\u0021--')
    .replace(/<script/gi, '<\\u0073cript');
}

function stripBlock(html: string): string {
  const i = html.indexOf(START);
  const j = html.indexOf(END);
  if (i === -1 || j === -1 || j < i) return html;
  return html.slice(0, i) + html.slice(j + END.length);
}

export function isApplied(html?: string): boolean {
  try {
    const p = workbenchHtmlPath();
    const content = html ?? fs.readFileSync(p, 'utf8');
    return content.includes(START);
  } catch {
    return false;
  }
}

/** 写回注入块；payload 为 undefined 表示清除 */
export function applyPatch(payload?: InjectPayload): { changed: boolean; file: string } {
  const file = workbenchHtmlPath();
  const original = fs.readFileSync(file, 'utf8');
  const cleaned = stripBlock(original);

  let next = cleaned;
  if (payload) {
    // web 类壁纸用 iframe 加载（vscode-file:），scene 壁纸的 iframe 指向本机渲染服务
    next = next.replace(/frame-src([^;]*);/i, (m, g) => {
      let out = g;
      if (!out.includes('vscode-file:')) out += ' vscode-file:';
      if (!out.includes('http://127.0.0.1:*')) out += ' http://127.0.0.1:*';
      return out === g ? m : `frame-src${out};`;
    });
    // scene 渲染页会自己 fetch pkg、加载纹理与音视频，这几条也要放行本机端口
    // connect-src 要放行 vscode-file:，scene.pkg 走同源 vscode-file 读取
    next = next.replace(/connect-src([^;]*);/i, (m, g) => {
      const out = g.includes('vscode-file:') ? g : `${g} vscode-file:`;
      return out.includes('http://127.0.0.1:*') ? `connect-src${out};` : `connect-src${out} http://127.0.0.1:*;`;
    });
    // SceneScript（文字层/图层脚本）是用字符串当脚本执行的，会被 require-trusted-types-for 拦死
    // （实测 diag: "text script 'Clock' 失败: … violates Trusted Type"）。壁纸引擎必须能跑脚本，
    // 所以这条指令整体去掉；<script src> 的 trustedScriptUrl 逻辑保留（无害，去掉后就是普通字符串）。
    next = next.replace(/\s*require-trusted-types-for[^;]*;/i, ';');
    // workbench 的 CSP 带 require-trusted-types-for 'script' + trusted-types 白名单，
    // 策略名不在名单里 createPolicy 会抛错，<script src> 就无法赋值 → 必须把我们的策略加进去
    // 注意用 lookbehind：不能匹配到 require-trusted-types-for 那条
    next = next.replace(/(?<!require-)trusted-types\s+([^;]+);/i, (m, g) =>
      g.includes('vsw-pkg') ? m : `trusted-types ${g.trim()} vsw-pkg;`,
    );
    // scene.pkg 是当 <script> 加载的，script-src 也要放行 vscode-file:
    next = next.replace(/script-src([^;]*);/i, (m, g) =>
      g.includes('vscode-file:') ? m : `script-src${g} vscode-file:;`,
    );
    next = next.replace(/img-src([^;]*);/i, (m, g) =>
      g.includes('http://127.0.0.1:*') ? m : `img-src${g} http://127.0.0.1:*;`
    );
    next = next.replace(/media-src([^;]*);/i, (m, g) =>
      g.includes('blob:') ? m : `media-src${g} blob: data: http://127.0.0.1:*;`
    );
    const block = [
      START,
      '<script>window.__VSW_CONFIG__=' + safeJson(payload.config) + ';</script>',
      // 顺手把「安装似乎损坏」的提示藏掉
      `<script>(function(){var s=document.createElement("style");s.textContent=${JSON.stringify(
        [
          '.notification-toast-container:has([aria-label*="installation appears to be corrupt"]){display:none;}',
          '.notification-toast-container:has([aria-label*="安装似乎损坏"]){display:none;}',
          '.notification-toast-container:has([aria-label*="安裝似乎已損毀"]){display:none;}',
        ].join('')
      )};document.head.appendChild(s);})();</script>`,
      payload.engineJs ? '<script>' + safeJs(payload.engineJs) + '</script>' : '',
      '<script>' + safeJs(payload.loaderJs) + '</script>',
      END,
    ].join('\n');

    if (/<\/html>\s*$/i.test(next)) {
      // 必须用函数做替换串：block 里有大量 `$`，String.replace 会把 $&、$'、$` 当成特殊模式，
      // 之前就是这样把 `</html>` 插进了脚本中间，导致引擎语法错误、整个 loader 不执行。
      next = next.replace(/<\/html>\s*$/i, () => block + '\n</html>\n');
    } else {
      next = next + '\n' + block + '\n';
    }
  }

  if (next === original) return { changed: false, file };

  // 备份一次，方便出问题时恢复
  const bak = file + '.vsw-orig';
  if (!fs.existsSync(bak)) {
    fs.writeFileSync(bak, original, 'utf8');
  }
  fs.writeFileSync(file, next, 'utf8');
  return { changed: true, file };
}

export function revertPatch(): { changed: boolean; file: string } {
  return applyPatch(undefined);
}
