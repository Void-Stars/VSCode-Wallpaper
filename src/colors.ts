import * as vscode from 'vscode';

/** 需要变成半透明的主题色键 */
export const COLOR_KEYS = [
  'editor.background',
  'editorGutter.background',
  'editorGroupHeader.tabsBackground',
  'sideBar.background',
  'activityBar.background',
  'panel.background',
  'statusBar.background',
  'titleBar.activeBackground',
  'titleBar.inactiveBackground',
  'terminal.background',
  'sideBarSectionHeader.background',
  // 右侧 Copilot / 聊天面板
  'chat.requestBackground',
  'chat.requestBubbleBackground',
  'chat.requestBubbleHoverBackground',
  'chat.slashCommandBackground',
  'chat.avatarBackground',
  'chat.statusBackground',
  // 标签、面包屑、分组与浮层
  'tab.activeBackground',
  'tab.inactiveBackground',
  'tab.unfocusedActiveBackground',
  'editorGroupHeader.background',
  'editorGroup.background',
  'editorPane.background',
  'breadcrumb.background',
  'toolbar.hoverBackground',
];

export interface GlassColors {
  light: boolean;
  /** 0-1，越大越不透明（现在只影响 CSS 层，不写进主题色） */
  opacity: number;
}

const SNAPSHOT_KEY = 'vsw.colorCustomizations.snapshot';
const WRITTEN_KEY = 'vsw.colorKeys.written';

/** 把 workbench.colorCustomizations 改成带 alpha 的颜色，让面板真正半透明 */
export async function applyGlassColors(
  context: vscode.ExtensionContext,
  opt: GlassColors
): Promise<void> {
  const wb = vscode.workspace.getConfiguration('workbench');
  const inspected = wb.inspect<Record<string, string>>('colorCustomizations');
  const current: Record<string, string> = {
    ...(inspected?.globalValue || {}),
    ...(inspected?.workspaceValue || {}),
  };

  // 第一次改动前留一份原件，还原时用
  if (!context.globalState.get(SNAPSHOT_KEY)) {
    await context.globalState.update(SNAPSHOT_KEY, current);
  }

  // 官方通道只负责「把底色清成全透明」，具体玻璃用什么颜色由 loader 里的 CSS rgba 决定。
  // 这样每个面板只有一层半透明，不会叠成不透明，也不会污染菜单等浮层。
  const next: Record<string, string> = { ...current };

  // 之前写过、但现在不再托管的键（比如浮层菜单）要删掉，恢复成主题原本的不透明
  const prev = context.globalState.get<string[]>(WRITTEN_KEY) || [];
  withPrev: for (const k of prev) {
    if (COLOR_KEYS.includes(k)) continue withPrev;
    delete next[k];
  }

  for (const k of COLOR_KEYS) {
    next[k] = '#00000000';
  }

  const same = JSON.stringify(current) === JSON.stringify(next);
  if (same) return;

  await wb.update('colorCustomizations', next, vscode.ConfigurationTarget.Global);
  await context.globalState.update(WRITTEN_KEY, COLOR_KEYS);
}

/** 还原成改动前的样子 */
export async function restoreGlassColors(context: vscode.ExtensionContext): Promise<void> {
  const snapshot = context.globalState.get<Record<string, string>>(SNAPSHOT_KEY);
  if (!snapshot) return;
  const wb = vscode.workspace.getConfiguration('workbench');
  await wb.update(
    'colorCustomizations',
    Object.keys(snapshot).length ? snapshot : undefined,
    vscode.ConfigurationTarget.Global
  );
  await context.globalState.update(SNAPSHOT_KEY, undefined);
}
