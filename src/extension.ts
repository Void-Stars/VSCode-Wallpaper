import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { buildRuntimeConfig } from './config';
import { prunePkgCache } from './scene/pkgcache';
import { applyPatch, revertPatch, isApplied, workbenchHtmlPath } from './patch';
import * as we from './we';
import { applyGlassColors, restoreGlassColors } from './colors';
import { SidebarProvider } from './webview';
import { SceneHost } from './scene/host';

let statusItem: vscode.StatusBarItem | undefined;
let sceneHost: SceneHost | undefined;

function readLoaderJs(context: vscode.ExtensionContext): string {
  const p = path.join(context.extensionPath, 'dist', 'loader.js');
  if (!fs.existsSync(p)) {
    throw new Error(`缺少 dist/loader.js，请先执行 npm run build（路径：${p}）`);
  }
  return fs.readFileSync(p, 'utf8');
}

function readEngineJs(context: vscode.ExtensionContext): string | undefined {
  const p = path.join(context.extensionPath, 'dist', 'webwallgl.global.min.js');
  if (!fs.existsSync(p)) return undefined;
  return fs.readFileSync(p, 'utf8');
}

async function reloadWindow(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.reloadWindow');
}

function updateStatus(): void {
  if (!statusItem) return;
  const c = vscode.workspace.getConfiguration('vsw');
  const enabled = c.get<boolean>('enabled', false);
  const source = c.get<string>('wallpaper.source', 'file');
  const label =
    source === 'wallpaperEngine'
      ? 'Wallpaper Engine'
      : source === 'folder'
        ? '轮播'
        : path.basename(c.get<string>('wallpaper.file', '') || '未设置');
  statusItem.text = enabled ? `$(device-camera) ${label}` : `$(circle-slash) 壁纸·玻璃`;
  statusItem.tooltip = enabled
    ? `壁纸·玻璃 已启用（来源：${label}）\n点击打开控制面板`
    : '壁纸·玻璃 未启用，点击打开控制面板';
  statusItem.show();
}

/** 写入 workbench.html 并在需要时重载窗口 */
async function doApply(context: vscode.ExtensionContext, silent = false): Promise<void> {
  const c = vscode.workspace.getConfiguration('vsw');
  const enabled = c.get<boolean>('enabled', false);

  if (!enabled) {
    try { await restoreGlassColors(context); } catch { /* 忽略 */ }
    const r = revertPatch();
    updateStatus();
    if (r.changed) {
      if (!silent) {
        const pick = await vscode.window.showInformationMessage(
          '壁纸·玻璃已关闭，需要重载窗口才会恢复原样。',
          '重载窗口'
        );
        if (pick) await reloadWindow();
      }
    } else if (!silent) {
      vscode.window.showInformationMessage('壁纸·玻璃当前是关闭状态，已被注入的内容也已清除。');
    }
    return;
  }

  const loaderJs = readLoaderJs(context);
  if (!sceneHost) sceneHost = new SceneHost();
  void prunePkgCache(context);
  const { cfg, resolvedFrom } = await buildRuntimeConfig(sceneHost, context);

  if (cfg.wallpaper.kind === 'none' && cfg.wallpaper.list.length === 0) {
    vscode.window.showWarningMessage(`壁纸没准备好：${resolvedFrom}`);
  }

  // 关键：让面板真正变半透明（走官方 colorCustomizations，比 CSS 硬压可靠）
  try {
    await applyGlassColors(context, { light: false, opacity: cfg.glass.opacity });
  } catch (e) {
    console.error('[vsw] 写入色彩定制失败', e);
  }

  const engineJs = cfg.wallpaper.kind === 'scene' ? readEngineJs(context) : undefined;
  const r = applyPatch({ config: cfg, loaderJs, engineJs });
  updateStatus();

  if (!silent) {
    const msg = r.changed ? '已写入壁纸配置' : '配置没有变化';
    // vsw.autoReload 打开时直接在原地重载窗口，不用手动点、也不开新窗口
    if (vscode.workspace.getConfiguration('vsw').get<boolean>('autoReload', true) && !silent) {
      await reloadWindow();
      return;
    }
    const pick = await vscode.window.showInformationMessage(
      `${msg}（${resolvedFrom}），重载窗口后生效。`,
      '重载窗口'
    );
    if (pick) await reloadWindow();
  }
}

export function activate(context: vscode.ExtensionContext): void {
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
  statusItem.command = 'vsw.openPanel';
  context.subscriptions.push(statusItem);
  updateStatus();

  // 侧边栏控制面板
  const sidebar = new SidebarProvider(context.extensionUri, () => doApply(context, true));
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebar, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('vsw.openSidebar', async () => {
      await vscode.commands.executeCommand('vswSidebar.focus');
    })
  );

  const run = (fn: (...a: any[]) => Promise<void>) => async () => {
    try {
      await fn();
    } catch (e: any) {
      vscode.window.showErrorMessage(`壁纸·玻璃：${e?.message ?? e}`);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'vsw.openPanel',
      run(async () => {
        const c = vscode.workspace.getConfiguration('vsw');
        const on = c.get<boolean>('enabled', false);
        const glassOn = c.get<boolean>('glass.enabled', true);
        const picks: (vscode.QuickPickItem & { act: string })[] = [
          { label: '$(file-media) 选一个图片/视频做壁纸', act: 'file' },
          { label: '$(folder) 轮播一个文件夹', act: 'folder' },
          { label: '$(library) 跟随 Wallpaper Engine 当前壁纸', act: 'weCurrent' },
          { label: '$(list-unordered) 从 Wallpaper Engine 壁纸库挑一张', act: 'weLibrary' },
          { label: `${glassOn ? '$(check)' : '$(circle-slash)'} 毛玻璃效果`, act: 'toggleGlass' },
          { label: '$(symbol-color) 调整玻璃模糊强度', act: 'glassBlur' },
          { label: '$(screen-full) 设置四角圆角', act: 'corners' },
          { label: '$(layout) 调整界面布局', act: 'layout' },
          { label: `${on ? '$(debug-stop) 关闭壁纸（还原窗口）' : '$(play) 启用壁纸'}`, act: 'toggleOn' },
          { label: '$(gear) 打开设置页', act: 'settings' },
        ];
        const chosen = await vscode.window.showQuickPick(picks, {
          title: '壁纸 · 玻璃',
          placeHolder: '选一项要做的操作',
        });
        if (!chosen) return;
        switch (chosen.act) {
          case 'file':
            return vscode.commands.executeCommand('vsw.pickFile');
          case 'folder':
            return vscode.commands.executeCommand('vsw.pickFolder');
          case 'weCurrent':
            return vscode.commands.executeCommand('vsw.useWallpaperEngine');
          case 'weLibrary':
            return vscode.commands.executeCommand('vsw.browseWallpaperEngine');
          case 'toggleGlass': {
            await c.update('glass.enabled', !glassOn, vscode.ConfigurationTarget.Global);
            return doApply(context);
          }
          case 'glassBlur': {
            const v = await vscode.window.showInputBox({
              title: '玻璃模糊强度（px）',
              value: String(c.get<number>('glass.blur', 26)),
              validateInput: x => (/^\d{0,3}$/.test(x) ? undefined : '填 0-140 的整数'),
            });
            if (v === undefined) return;
            await c.update('glass.blur', Number(v) || 0, vscode.ConfigurationTarget.Global);
            return doApply(context);
          }
          case 'corners':
            return vscode.commands.executeCommand('vsw.setCorners');
          case 'layout':
            return vscode.commands.executeCommand('vsw.applyLayout');
          case 'toggleOn': {
            await c.update('enabled', !on, vscode.ConfigurationTarget.Global);
            return doApply(context);
          }
          default:
            return vscode.commands.executeCommand(
              'workbench.action.openSettings',
              '@ext:local-vsw.vscode-wallpaper-glass'
            );
        }
      })
    ),

    vscode.commands.registerCommand(
      'vsw.pickFile',
      run(async () => {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: '用它做壁纸',
          filters: {
            图片或视频: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'mp4', 'webm', 'mkv', 'mov'],
          },
        });
        if (!picked?.length) return;
        const file = picked[0].fsPath;
        const c = vscode.workspace.getConfiguration('vsw');
        await c.update('wallpaper.file', file, vscode.ConfigurationTarget.Global);
        await c.update('wallpaper.source', 'file', vscode.ConfigurationTarget.Global);
        await c.update('enabled', true, vscode.ConfigurationTarget.Global);
        await doApply(context);
      })
    ),

    vscode.commands.registerCommand(
      'vsw.pickFolder',
      run(async () => {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          canSelectFolders: true,
          canSelectFiles: false,
          openLabel: '轮播这个文件夹',
        });
        if (!picked?.length) return;
        const dir = picked[0].fsPath;
        const c = vscode.workspace.getConfiguration('vsw');
        await c.update('wallpaper.folder', dir, vscode.ConfigurationTarget.Global);
        await c.update('wallpaper.source', 'folder', vscode.ConfigurationTarget.Global);
        await c.update('enabled', true, vscode.ConfigurationTarget.Global);
        await doApply(context);
      })
    ),

    vscode.commands.registerCommand(
      'vsw.useWallpaperEngine',
      run(async () => {
        const dir = we.findWallpaperEngine();
        if (!dir) {
          const go = await vscode.window.showWarningMessage(
            '没找到 Wallpaper Engine。它装好了吗？',
            '知道了'
          );
          void go;
          return;
        }
        const r = we.resolveCurrent(dir);
        if (!r.file) {
          vscode.window.showWarningMessage(`读不到当前壁纸：${r.note}`);
          return;
        }
        const c = vscode.workspace.getConfiguration('vsw');
        await c.update('wallpaper.weId', '', vscode.ConfigurationTarget.Global);
        await c.update('wallpaper.source', 'wallpaperEngine', vscode.ConfigurationTarget.Global);
        await c.update('enabled', true, vscode.ConfigurationTarget.Global);
        await doApply(context);
      })
    ),

    vscode.commands.registerCommand(
      'vsw.browseWallpaperEngine',
      run(async () => {
        const items = we.listLibrary();
        if (!items.length) {
          vscode.window.showWarningMessage('壁纸库里没找到内容（workshop/431960 是空的？）');
          return;
        }
        const picks = items.map(it => {
          const t = it.type || 'unknown';
          const badge = t.includes('video')
            ? '🎬'
            : t.includes('scene')
              ? '🌀'
              : t.includes('web')
                ? '🌐'
                : '🖼';
          return {
            label: `${badge} ${it.title}`,
            description: t,
            detail: it.dir,
            item: it,
          } as vscode.QuickPickItem & { item: we.WallpaperEngineItem };
        });

        const chosen = await vscode.window.showQuickPick(picks, {
          title: 'Wallpaper Engine 壁纸库',
          placeHolder: '选一张（scene 场景壁纸会退化成预览图）',
          matchOnDetail: true,
        });
        if (!chosen) return;

        const it = chosen.item;
        let file = it.playable;
        if (!file || !/\.(mp4|webm|png|jpe?g|gif|webp)$/i.test(file)) {
          file = it.preview;
        }
        if (!file) {
          vscode.window.showWarningMessage(`${it.title} 里没有可直接用的视频或预览图`);
          return;
        }
        const c = vscode.workspace.getConfiguration('vsw');
        await c.update('wallpaper.weId', it.id, vscode.ConfigurationTarget.Global);
        await c.update('wallpaper.source', 'wallpaperEngine', vscode.ConfigurationTarget.Global);
        await c.update('enabled', true, vscode.ConfigurationTarget.Global);
        await doApply(context);
      })
    ),

    vscode.commands.registerCommand('vsw.apply', run(() => doApply(context))),

    vscode.commands.registerCommand(
      'vsw.revert',
      run(async () => {
        try { await restoreGlassColors(context); } catch { /* 忽略 */ }
        const r = revertPatch();
        updateStatus();
        if (r.changed) {
          const pick = await vscode.window.showInformationMessage(
            '已移除注入，重载窗口后完全还原。',
            '重载窗口'
          );
          if (pick) await reloadWindow();
        } else {
          vscode.window.showInformationMessage('没有找到需要移除的注入内容。');
        }
      })
    ),

    vscode.commands.registerCommand(
      'vsw.setCorners',
      run(async () => {
        const c = vscode.workspace.getConfiguration('vsw');
        const base = c.get<number>('layout.radius', 0);
        const cur = [
          c.get<number>('layout.radiusTopLeft', -1),
          c.get<number>('layout.radiusTopRight', -1),
          c.get<number>('layout.radiusBottomRight', -1),
          c.get<number>('layout.radiusBottomLeft', -1),
        ].map(v => (v < 0 ? '跟随' : String(v))).join(',');

        const raw = await vscode.window.showInputBox({
          title: '四角圆角（px）',
          prompt: '填 1 个数 = 四角一样；填 4 个数 = 左上,右上,右下,左下；填 -1 表示该角跟随基础值',
          value: cur,
          valueSelection: [0, cur.length],
          validateInput: (x) => {
            const t = x.trim();
            if (!t) return undefined;
            const nums = t.split(/[,，\s]+/).filter(Boolean);
            if (nums.length !== 1 && nums.length !== 4) return '填 1 个数或 4 个数';
            if (nums.some(n => !/^-?\d{1,2}$/.test(n))) return '只能填 -1 到 48 的整数';
            return undefined;
          },
        });
        if (raw === undefined) return;

        const t = raw.trim();
        const target = vscode.ConfigurationTarget.Global;
        if (!t) {
          await c.update('layout.radius', 0, target);
          for (const k of ['radiusTopLeft', 'radiusTopRight', 'radiusBottomLeft', 'radiusBottomRight']) {
            await c.update(`layout.${k}`, -1, target);
          }
          return doApply(context);
        }
        const nums = t.split(/[,，\s]+/).filter(Boolean).map(Number);
        if (nums.length === 1) {
          await c.update('layout.radius', Math.max(0, nums[0]), target);
          for (const k of ['radiusTopLeft', 'radiusTopRight', 'radiusBottomLeft', 'radiusBottomRight']) {
            await c.update(`layout.${k}`, -1, target);
          }
        } else {
          await c.update('layout.radius', 0, target);
          const order = ['radiusTopLeft', 'radiusTopRight', 'radiusBottomRight', 'radiusBottomLeft'];
          for (let i = 0; i < 4; i++) {
            await c.update(`layout.${order[i]}`, nums[i], target);
          }
        }
        void base;
        return doApply(context);
      })
    ),

    vscode.commands.registerCommand(
      'vsw.applyLayout',
      run(async () => {
        const c = vscode.workspace.getConfiguration('vsw');
        const abLoc = c.get<string>('layout.activityBarLocation', 'default');
        const sbLoc = c.get<string>('layout.sideBarLocation', 'left');
        const hideStatus = c.get<boolean>('layout.hideStatusbar', false);

        const wb = vscode.workspace.getConfiguration('workbench');
        const target = vscode.ConfigurationTarget.Workspace;

        if (abLoc !== 'default') {
          await wb.update('activityBar.location', abLoc === 'hidden' ? 'hidden' : abLoc, target);
        }
        const hideAB = c.get<boolean>('layout.hideActivityBar', false);
        if (hideAB) await wb.update('activityBar.location', 'hidden', target);
        await wb.update('sideBar.location', sbLoc, target);
        await wb.update('statusBar.visible', !hideStatus, target);

        vscode.window.showInformationMessage('布局设置已写入工作区。');
      })
    )
  );

  // 启动时若已启用，保证注入是最新的（配置可能被改过）
  const enabled = vscode.workspace.getConfiguration('vsw').get<boolean>('enabled', false);
  if (enabled) {
    try {
      // 每次都重写一遍：配置可能改过，也顺便确认注入块没被其它插件覆盖
      void doApply(context, true);
      console.log(`[vsw] 已注入，之前状态 applied=${isApplied()}`);
    } catch (e) {
      console.error('[vsw] 启动注入失败', e);
    }
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('vsw')) updateStatus();
      // 改了壁纸/玻璃/布局相关设置后自动重新注入，省得用户改完发现没变化。
      // 这里刻意不自动重载窗口（会打断手头的事），只提示一句。
      const hot =
        e.affectsConfiguration('vsw.wallpaper') ||
        e.affectsConfiguration('vsw.glass') ||
        e.affectsConfiguration('vsw.layout');
      const on = vscode.workspace.getConfiguration('vsw').get<boolean>('enabled', false);
      if (hot && on) {
        void doApply(context, true).then(() => {
          vscode.window.setStatusBarMessage('壁纸设置已重新写入，重载窗口后生效（Ctrl+Shift+P → Reload Window）', 9000);
        });
      }
    })
  );

  console.log(`[vsw] workbench.html = ${workbenchHtmlPath()}`);
}

export function deactivate(): void {
  sceneHost?.dispose();
  sceneHost = undefined;
  /* 不做自动还原：用户可能只是停用了扩展 */
}
