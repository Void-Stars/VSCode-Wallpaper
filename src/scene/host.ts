import * as fs from 'fs';
import * as http from 'http';
import { createHash } from 'node:crypto';

/**
 * Wallpaper Engine 的 scene 壁纸（scene.pkg）是私有格式 + DirectX 渲染，
 * 插件自己无法解码。这里借 WebWallGL（MIT，1.1 MB，浏览器 WebGL2 实时渲染器）
 * 把它跑起来：本机起一个只绑 127.0.0.1 的临时 HTTP 服务，提供
 *   /engine.js  渲染引擎
 *   /           渲染页（iframe 的 srcdoc 目标）
 *   /pkg?id=…   该壁纸的 scene.pkg 字节
 * 工作台里用 <iframe> 指向它，等于把 Wallpaper Engine 的渲染结果搬进 VSCode。
 *
 * 安全约束：只服务 register() 登记过的 pkg，id 是随机 token 而非路径，
 * 不接受任何客户端传入的文件路径。
 */
export class SceneHost {
  private server: http.Server | null = null;
  private port = 0;
  private entries = new Map<string, { pkg: string; title: string }>();
  private starting: Promise<number> | null = null;

  get running(): boolean {
    return this.server !== null;
  }

  /** 注册一张 scene 壁纸，返回可取 pkg 字节的 URL（loader 里 fetch 后交给内联引擎）。 */
  async register(pkgPath: string, title: string, fit: string): Promise<string | null> {
    if (!fs.existsSync(pkgPath)) return null;
    const port = await this.ensureStarted();
    if (!port) return null;
    // id 必须稳定：窗口 reload 会重启扩展宿主，随机 id 会让已注入 HTML 里的 URL
    // 与当前服务对不上，永远落后一版
    const id = createHash('sha1').update(pkgPath).digest('hex').slice(0, 12);
    this.entries.set(id, { pkg: pkgPath, title });
    // 只保留最近 8 个，避免长期运行后无限增长
    if (this.entries.size > 8) {
      const first = this.entries.keys().next().value;
      if (first && first !== id) this.entries.delete(first);
    }
    return `http://127.0.0.1:${port}/pkg?id=${id}`;
  }

  dispose(): void {
    this.server?.close();
    this.server = null;
    this.port = 0;
    this.entries.clear();
    this.starting = null;
  }

  private ensureStarted(): Promise<number> {
    if (this.port) return Promise.resolve(this.port);
    if (this.starting) return this.starting;
    this.starting = new Promise<number>(resolve => {
      const server = http.createServer((req, res) => this.handle(req, res));
      server.on('error', err => {
        console.warn('[vsw] scene host 启动失败:', err);
        resolve(0);
      });
      // 固定端口段：窗口 reload 会重启扩展宿主，若端口每次都变，注入进 HTML 的 URL
      // 就永远落后一版（页面加载的是上一轮的地址），scene 永远 Failed to fetch。
      const tryListen = (port: number): Promise<number> =>
        new Promise(resolve => {
          const onErr = () => {
            server.removeListener('listening', onOk);
            resolve(0);
          };
          const onOk = () => {
            server.removeListener('error', onErr);
            const addr = server.address();
            resolve(typeof addr === 'object' && addr ? addr.port : 0);
          };
          server.once('error', onErr);
          server.once('listening', onOk);
          server.listen(port, '127.0.0.1');
        });
      void (async () => {
        let ok = 0;
        for (let p = 45871; p <= 45890 && !ok; p++) {
          ok = await tryListen(p);
        }
        if (!ok) {
          server.removeAllListeners('error');
          server.on('error', () => {
            /* ignore */
          });
          ok = await tryListen(0);
        }
        this.port = ok;
        this.server = ok ? server : null;
        resolve(this.port);
      })();
    });
    return this.starting;
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    // 渲染器是 file:// 页面（opaque origin），访问本机端口会触发 Chrome 的
    // Private Network Access 预检，必须显式应答，否则一律 Failed to fetch
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,HEAD,OPTIONS',
        'access-control-allow-headers': '*',
        'access-control-allow-private-network': 'true',
        'access-control-max-age': '86400',
      });
      res.end();
      return;
    }
    if (url.pathname !== '/pkg') {
      res.writeHead(404, { 'access-control-allow-origin': '*' }).end('not found');
      return;
    }
    // id 只作标识用：页面里的 URL 可能来自上一轮注入（宿主重启前），
    // 对不上时退回到当前唯一登记的那张 scene，避免「每次都落后一版」
    const entry = this.entries.get(url.searchParams.get('id') || '') ||
      (this.entries.size === 1 ? [...this.entries.values()][0] : undefined);
    if (!entry) {
      res.writeHead(404, { 'access-control-allow-origin': '*' }).end('not found');
      return;
    }
    let size = 0;
    try {
      size = fs.statSync(entry.pkg).size;
    } catch {
      res.writeHead(404).end('missing');
      return;
    }
    res.writeHead(200, {
      // 渲染器页面来自 file://（Origin 为 null），跨源请求必须带 CORS 头，否则 fetch 直接 Failed to fetch
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-private-network': 'true',
      'content-type': 'application/octet-stream',
      'content-length': String(size),
      'cache-control': 'no-store',
    });
    fs.createReadStream(entry.pkg).pipe(res);
  }

}
