const esbuild = require('esbuild');
const watch = process.argv.includes('--watch');

/** host 侧：Node CJS，vscode 外部化 */
const hostCfg = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: false,
  minify: false,
  logLevel: 'info',
};

/** 注入进 workbench.html 的运行时：浏览器 IIFE，压缩 */
const loaderCfg = {
  entryPoints: ['src/media/loader.ts'],
  bundle: true,
  outfile: 'dist/loader.js',
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  sourcemap: false,
  minify: true,
  legalComments: 'none',
  logLevel: 'info',
};

const fs = require('fs');
/** 借来的 Wallpaper Engine scene 渲染器（MIT），运行时由 scene/host.ts 直接读 dist 里的这份 */
function copyEngine() {
  const src = 'node_modules/webwallgl/webwallgl.global.min.js';
  const dst = 'dist/webwallgl.global.min.js';
  fs.mkdirSync('dist', { recursive: true });
  fs.copyFileSync(src, dst);
  console.log('[build] dist/webwallgl.global.min.js', (fs.statSync(dst).size / 1048576).toFixed(2) + ' MB');
}

(async () => {
  if (watch) {
    const ctx1 = await esbuild.context(hostCfg);
    const ctx2 = await esbuild.context(loaderCfg);
    await Promise.all([ctx1.watch(), ctx2.watch()]);
    console.log('[watch] 编译中…');
  } else {
    await esbuild.build(hostCfg);
    await esbuild.build(loaderCfg);
    copyEngine();
    console.log('[build] dist/extension.js + dist/loader.js 就绪');
  }
})().catch(e => { console.error(e); process.exit(1); });
