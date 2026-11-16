import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'node:crypto';
import type * as vscode from 'vscode';

/**
 * 把 scene.pkg 转成一个能被 <script src> 加载的 JS 文件：
 *
 *   window.__VSW_PKG__="<base64>";
 *
 * 为什么不用 fetch：
 *   - VSCode 的 renderer 里，往 http://127.0.0.1 的 fetch 会被网络层吞掉（Edge 正常，VSCode 不行）
 *   - vscode-file:// 虽然是页面自己的协议，但 Chromium 只允许把自定义 scheme 当作
 *     图片/视频/脚本这类子资源加载，fetch/XHR 拿不到（supportFetchAPI 未开）
 *   而 <script src="vscode-file:..."> 是可以的（VSCode 自己的 workbench.js 就是这么加载的），
 *   所以用 script 标签把字节搬进来，再 base64 解码成 Uint8Array 交给 WebWallGL。
 *
 * 缓存：文件名带上 pkg 的 size+mtime，换壁纸才会重新生成。
 */
export async function ensurePkgScript(
  context: vscode.ExtensionContext,
  pkgPath: string,
): Promise<string | null> {
  let st: fs.Stats;
  try {
    st = await fs.promises.stat(pkgPath);
  } catch {
    return null;
  }
  const key = createHash('sha1')
    .update(`${pkgPath}|${st.size}|${Math.round(st.mtimeMs)}`)
    .digest('hex')
    .slice(0, 16);

  const dir = context.globalStorageUri.fsPath;
  await fs.promises.mkdir(dir, { recursive: true });
  const out = path.join(dir, `pkg-${key}.js`);

  try {
    await fs.promises.access(out);
    return out;
  } catch {
    // 还没有缓存，生成一次
  }

  const buf = await fs.promises.readFile(pkgPath);
  const fh = await fs.promises.open(out, 'w');
  try {
    await fh.write('window.__VSW_PKG__="');
    // 分块转 base64，避免一次性造出 64MB 字符串把内存顶穿
    const CHUNK = 6 * 1024 * 1024;
    for (let i = 0; i < buf.length; i += CHUNK) {
      await fh.write(buf.subarray(i, Math.min(i + CHUNK, buf.length)).toString('base64'));
    }
    await fh.write('";\n');
  } finally {
    await fh.close();
  }

  return out;
}

/** 清掉旧版本的 pkg 缓存（每次激活时顺手做，避免越积越多） */
export async function prunePkgCache(context: vscode.ExtensionContext): Promise<void> {
  const dir = context.globalStorageUri.fsPath;
  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return;
  }
  const pkgs = names.filter(n => n.startsWith('pkg-') && n.endsWith('.js'));
  if (pkgs.length <= 2) return;
  const withTime = await Promise.all(
    pkgs.map(async n => {
      const p = path.join(dir, n);
      try {
        const s = await fs.promises.stat(p);
        return { p, t: s.mtimeMs };
      } catch {
        return { p, t: 0 };
      }
    }),
  );
  withTime.sort((a, b) => b.t - a.t);
  for (const { p } of withTime.slice(2)) {
    await fs.promises.rm(p, { force: true }).catch(() => undefined);
  }
}
