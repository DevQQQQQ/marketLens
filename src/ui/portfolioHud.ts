// src/ui/portfolioHud.ts
// 持仓总账 HUD（Alt + P）的单例句柄管理。
//
// 背景：早期实现用 `vscode.window.showQuickPick()`，该 API 不返回句柄，浮窗一旦打开，
// 老板键 / 简洁展示模式激活时无法主动关闭——全账户真实财务数据会一直挂在屏幕上，
// 与「脱敏态零暴露」的安全约定相悖。改为 createQuickPick 并集中持有句柄后，
// 由 StatusBar 的两个脱敏状态唯一写入口统一调用 closePortfolioHud()，
// 命令、设置面板、配置事件、老板键四条路径无需各自挂回调。
import * as vscode from "vscode";

/** 当前正在展示的总账浮窗；ESC / 主动关闭 / 脱敏激活后一律回落 undefined */
let activeHud: vscode.QuickPick<vscode.QuickPickItem> | undefined;

/**
 * 内容重建器，由 registerCommands 在激活期注册。
 * 在线汇率是 fire-and-forget 后台拉取，可能在 HUD 已经打开之后才到位；
 * 没有这个回调，浮窗会一直停留在打开瞬间的静态兜底牌价上。
 */
let hudContentProvider: (() => readonly vscode.QuickPickItem[]) | undefined;

/** 是否存在正在展示的总账浮窗（供测试与诊断读取，不暴露句柄本身） */
export function isPortfolioHudVisible(): boolean {
  return activeHud !== undefined;
}

/** 注册 / 注销 HUD 内容重建器（扩展激活时注册一次，模块级状态被后续注册覆盖） */
export function setPortfolioHudContentProvider(
  provider: (() => readonly vscode.QuickPickItem[]) | undefined
): void {
  hudContentProvider = provider;
}

/**
 * 后台数据（目前是在线汇率）到位后原地刷新已打开的 HUD。
 *
 * 直接写 QuickPick.items 而不是重新 show()：重建窗口会闪一下、抢焦点并触发
 * onDidHide 回收竞态；赋值 items 是 VS Code 支持的原地更新，用户无感。
 * HUD 未打开或 provider 未注册时为空操作，异常一律吞掉（调用方是后台 fire-and-forget）。
 */
export function refreshPortfolioHudIfVisible(): void {
  if (!activeHud || !hudContentProvider) return;
  try {
    activeHud.items = hudContentProvider();
  } catch (err) {
    console.warn("[MarketLens] 刷新持仓总账浮窗内容失败", err);
  }
}

/**
 * 展示（或替换）总账浮窗。
 *
 * - 单例：重复按 Alt + P 先关闭旧窗口，避免浮窗叠加；
 * - onDidHide 是唯一回收点：ESC、失焦、主动 hide 都走同一条清理路径；
 * - 纯展示用途，不监听 onDidAccept / onDidChangeValue，不产生任何持久副作用。
 */
export function showPortfolioHud(items: readonly vscode.QuickPickItem[]): void {
  closePortfolioHud();
  const qp = vscode.window.createQuickPick<vscode.QuickPickItem>();
  qp.title = "💼 持仓总资产总账";
  qp.placeholder = "ESC 关闭";
  qp.ignoreFocusOut = false;
  qp.items = items;
  qp.onDidHide(() => {
    if (activeHud === qp) activeHud = undefined;
    qp.dispose();
  });
  activeHud = qp;
  qp.show();
}

/**
 * 主动关闭总账浮窗（脱敏状态激活、扩展停用时调用）；无窗口时为空操作。
 * VS Code API 契约：hide() 会派发 onDidHide，资源由上面的统一回收点释放，
 * 此处不重复 dispose，避免与 onDidHide 竞争。
 */
export function closePortfolioHud(): void {
  const qp = activeHud;
  if (!qp) return;
  activeHud = undefined;
  qp.hide();
}
