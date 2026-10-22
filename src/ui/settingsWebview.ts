import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { detectAvailablePort, getCachedWorkingPort, resetProxyCache, DEFAULT_PROXY_PORT, DEFAULT_PROXY_URL } from "../services/network.ts";
import { getSettingsWebviewHtml } from "./settingsHtml.ts";
import { logger } from "../utils/logger.ts";
import type { MarketItem, WatchlistConfig, GroupSortMode } from "../types/index.ts";
import { normalizeSymbolKey, stripMarketPrefix, resolveItemDisplayName, sanitizeAlerts, applyAlertRuleDelta } from "../utils/symbolHelper.ts";
import {
  readConfig,
  persistProxyToAllSections,
  persistStatusBarToAllSections,
  persistSectionStatusBarAndRecompute,
  MARKET_SECTIONS,
  MARKET_CLOSING_SECTIONS,
  DEFAULT_GROUP_NAMES,
} from "../utils/config.ts";
import { exportSettingsToFile, importSettingsFromFile } from "../utils/backupHelper.ts";
import { isBossKeyActive, maskIfNeeded, showInfoMessage } from "../utils/feedback.ts";

const GLOBAL_CONFIG_KEYS = [
  "proxyPort",
  "proxyUrl",
  "autoRefresh",
  "refreshInterval",
  "maskMode",
  "colorNeutral",
  "colorScheme",
  "statusBar.enabled",
  "statusBar.holdingEnabled",
  "statusBar.holdingInterval",
  "autoCollapseClosedGroups",
  "alertNotificationMode",
  "alertCooldownMinutes",
] as const;

const COMMON_SECTION_PROPERTIES = [
  "enabled",
  "statusBar",
  "networkMode",
  "proxyUrl",
] as const;

/**
 * 允许由 Webview 设置面板前端发起变更的配置项白名单，严格从 MARKET_SECTIONS 唯一真相源派生。
 *
 * 注意：`alerts` **不得**进入本白名单。预警规则只能由 `updateAlertRule` 按标的增量写入，
 * 整幅镜像回写会让后端快照在防抖窗口内覆盖用户未落盘的编辑（AGENTS.md §6.2）。
 */
export const ALLOWED_CONFIG_KEYS = new Set<string>([
  ...GLOBAL_CONFIG_KEYS,
  ...MARKET_SECTIONS.flatMap((sec) =>
    COMMON_SECTION_PROPERTIES.map((prop) => `${sec}.${prop}`)
  ),
  ...MARKET_CLOSING_SECTIONS.map((sec) => `${sec}.stopOnMarketClosed`),
]);

/**
 * 板块级状态栏开关键集合（同样由 MARKET_SECTIONS 派生）。
 * 消息分发处必须用本集合做成员判定，禁止把各板块的 statusBar 键逐个写进 || 链式条件
 * ——新增板块时链式判定必然漏项（AGENTS.md §5.2）。
 */
export const SECTION_STATUS_BAR_KEYS = new Set<string>(
  MARKET_SECTIONS.map((sec) => `${sec}.statusBar`)
);

function isAllowedUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export class SettingsWebviewPanel {
  public static currentPanel: SettingsWebviewPanel | undefined;
  // 三个静态注入位由 activate() 写入、deactivate() 显式复位为 undefined（§7.5 面板与订阅生命周期）。
  // `exactOptionalPropertyTypes` 下必须声明成「必需但可为 undefined」，否则复位语句判红。
  public static onDidUpdateSetting: ((key: string, value: unknown) => void) | undefined;
  public static getQuoteCache: (() => Map<string, MarketItem>) | undefined;
  public static globalState: vscode.Memento | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _version: string;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri, version?: string) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (SettingsWebviewPanel.currentPanel) {
      SettingsWebviewPanel.currentPanel._panel.reveal(column);
      SettingsWebviewPanel.currentPanel.sendCurrentSettings();
      return;
    }

    const resolvedVersion =
      version ||
      vscode.extensions.getExtension("devqqqqq.marketlens")?.packageJSON?.version ||
      "";

    const panel = vscode.window.createWebviewPanel(
      "marketlensSettings",
      "MarketLens 设置",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    SettingsWebviewPanel.currentPanel = new SettingsWebviewPanel(panel, extensionUri, resolvedVersion);
  }

  private static _generateNonce(): string {
    return crypto.randomBytes(16).toString("base64");
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, version: string = "") {
    this._panel = panel;
    this._version = version;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // 1. 先注册消息接收器，避免 webview 加载时发出的 getSettings 信号丢失
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case "getSettings":
            this.sendCurrentSettings();
            break;
          case "updateSetting":
            if (message.key && ALLOWED_CONFIG_KEYS.has(message.key)) {
              // 1. 立即同步触发内存配置更新（0ms 响应，立即刷新状态栏与看板，无需等待磁盘写入）
              try {
                SettingsWebviewPanel.onDidUpdateSetting?.(message.key, message.value);
              } catch (syncErr) {
                logger.error(`即时内存配置更新异常: ${message.key}`, syncErr);
              }

              // 2. 异步持久化配置到 VS Code 配置（磁盘 I/O）
              try {
                const cfg = vscode.workspace.getConfiguration("marketlens");
                if (message.key === "proxyPort") {
                  resetProxyCache();
                  const port = parseInt(message.value, 10);
                  if (port >= 1 && port <= 65535) {
                    const currentUrl = cfg.get<string>("proxyUrl") || DEFAULT_PROXY_URL;
                    let pUrl = `http://127.0.0.1:${port}`;
                    try {
                      const parsed = new URL(currentUrl);
                      parsed.port = String(port);
                      pUrl = parsed.toString().replace(/\/$/, "");
                    } catch (err) {
                      logger.debug("[SettingsWebview] parse currentUrl failed", err);
                    }
                    await persistProxyToAllSections(cfg, pUrl, port);
                    this.sendCurrentSettings();
                  }
                } else if (message.key === "proxyUrl") {
                  resetProxyCache();
                  const pUrl = message.value || DEFAULT_PROXY_URL;
                  let port = DEFAULT_PROXY_PORT;
                  try {
                    const u = new URL(pUrl);
                    if (u.port) port = parseInt(u.port, 10);
                  } catch (err) {
                    logger.debug("[SettingsWebview] parse proxyUrl port failed", err);
                  }
                  await persistProxyToAllSections(cfg, pUrl, port);
                  this.sendCurrentSettings();
                } else if (message.key === "statusBar.enabled") {
                  const enableAll = !!message.value;
                  await persistStatusBarToAllSections(cfg, enableAll);
                  this.sendCurrentSettings();
                } else if (SECTION_STATUS_BAR_KEYS.has(message.key)) {
                  await persistSectionStatusBarAndRecompute(cfg, message.key, !!message.value);
                  this.sendCurrentSettings();
                } else if (message.key === "colorScheme") {
                  await Promise.all([
                    cfg.update("colorScheme", message.value, vscode.ConfigurationTarget.Global),
                    cfg.update("colorNeutral", false, vscode.ConfigurationTarget.Global),
                  ]);
                  this.sendCurrentSettings();
                } else {
                  await cfg.update(message.key, message.value, vscode.ConfigurationTarget.Global);
                }
              } catch (err) {
                logger.error(`更新设置项失败: ${message.key}`, err);
              }
            } else {
              logger.warn(`拦截到未知或非法的设置项写入: ${message.key}`);
            }
            break;
          case "detectProxy": {
            const port = await detectAvailablePort();
            const url = port ? `http://127.0.0.1:${port}` : null;
            if (port && url) {
              const cfg = vscode.workspace.getConfiguration("marketlens");
              await persistProxyToAllSections(cfg, url, port);
              try {
                SettingsWebviewPanel.onDidUpdateSetting?.("proxyPort", port);
                SettingsWebviewPanel.onDidUpdateSetting?.("proxyUrl", url);
              } catch (err) {
                logger.warn("[SettingsWebview] notify proxy update failed", err);
              }
            }
            this._panel.webview.postMessage({
              command: "proxyDetected",
              target: message.target,
              port,
              url,
            });
            break;
          }
          case "openKeybindings":
            await vscode.commands.executeCommand(
              "workbench.action.openGlobalKeybindings",
              message.query || "marketlens"
            );
            break;
          case "restoreDefaults":
            await SettingsWebviewPanel.restoreDefaults();
            break;
          case "showLogs":
            if (readConfig().maskMode) {
              logger.info("简洁展示模式激活期间拒绝打开运行日志（打码守卫已生效）");
              break;
            }
            logger.show();
            break;
          case "addCommonIndices":
            await vscode.commands.executeCommand("marketlens.addCommonIndices");
            SettingsWebviewPanel.syncSettings();
            break;
          case "clearWatchlist":
            await SettingsWebviewPanel.clearWatchlist();
            break;
          case "exportSettings":
            await SettingsWebviewPanel.exportSettings();
            break;
          case "importSettings":
            await SettingsWebviewPanel.importSettings();
            break;
          case "updateAlertRule": {
            // alerts 只能按标的增量写入：以**磁盘现值**为基准合并单个标的，
            // 绝不接受前端整幅镜像回写——那会让后端快照在防抖窗口内覆盖用户未落盘的编辑，
            // 并让同一标的的历史别名键永久并存（AGENTS.md §6.2 / §6.11）。
            const cfg = vscode.workspace.getConfiguration("marketlens");
            const diskAlerts = sanitizeAlerts(cfg.get("alerts", {}));
            const merged = applyAlertRuleDelta(diskAlerts, message.key, message.rule);
            if (!merged) {
              logger.warn(`[SettingsWebview] 拒绝非法预警标的键: ${String(message.key)}`);
              break;
            }
            try {
              SettingsWebviewPanel.onDidUpdateSetting?.("alerts", merged);
            } catch (err) {
              logger.warn("[SettingsWebview] notify alert delta failed", err);
            }
            await cfg.update("alerts", merged, vscode.ConfigurationTarget.Global);
            this.sendCurrentSettings();
            break;
          }
          case "clearAllAlerts": {
            const confirm = await vscode.window.showWarningMessage(
              "确定要清空当前所有自选标的的价格预警规则吗？",
              { modal: true },
              "确认清空",
              "取消"
            );
            if (confirm === "确认清空") {
              try {
                SettingsWebviewPanel.onDidUpdateSetting?.("alerts", {});
              } catch (err) {
                logger.warn("[SettingsWebview] notify clearAllAlerts failed", err);
              }
              const cfg = vscode.workspace.getConfiguration("marketlens");
              await cfg.update("alerts", {}, vscode.ConfigurationTarget.Global);
              this.sendCurrentSettings();
              showInfoMessage("✅ 已清空所有价格预警规则");
            }
            break;
          }
          case "openExternal":
            if (message.url && isAllowedUrl(message.url)) {
              await vscode.env.openExternal(vscode.Uri.parse(message.url));
            } else {
              logger.warn(`拦截到非 HTTP/HTTPS 外部链接请求: ${message.url}`);
            }
            break;
          case "updateHolding": {
            if (message.group && message.symbol) {
              const cfg = vscode.workspace.getConfiguration("marketlens");
              const watchlist = JSON.parse(JSON.stringify(cfg.get("watchlist") || {}));
              const grpList = watchlist[message.group] || [];
              const it = grpList.find(
                (x: { symbol?: string }) =>
                  x &&
                  typeof x.symbol === "string" &&
                  (normalizeSymbolKey(x.symbol) === normalizeSymbolKey(message.symbol) ||
                    x.symbol === message.symbol)
              );
              if (it) {
                if (typeof message.cost === "number" && Number.isFinite(message.cost) && message.cost > 0) {
                  it.cost = message.cost;
                } else {
                  delete it.cost;
                }
                if (typeof message.shares === "number" && Number.isFinite(message.shares) && message.shares > 0) {
                  it.shares = message.shares;
                } else {
                  delete it.shares;
                }
                await cfg.update("watchlist", watchlist, vscode.ConfigurationTarget.Global);
                this.sendCurrentSettings();
              }
            }
            break;
          }
          case "copyToClipboard":
            if (message.text) {
              await vscode.env.clipboard.writeText(message.text);
              // 剪贴板按用户意图写入原文，但回显是被动可见面：脱敏态下必须收敛内容
              showInfoMessage(`📋 已复制到剪贴板: ${maskIfNeeded(String(message.text))}`);
            }
            break;
        }
      },
      null,
      this._disposables
    );

    // 2. 监听 panel 视图可见性状态改变，切回前台时自动重新同步配置
    this._panel.onDidChangeViewState(
      (e) => {
        if (e.webviewPanel.visible) {
          this.sendCurrentSettings();
        }
      },
      null,
      this._disposables
    );

    // 3. 赋值 webview HTML
    this._panel.webview.html = this._getHtmlForWebview();

    // 4. 主动推一次配置（双向握手保障）
    this.sendCurrentSettings();
  }

  public static async restoreDefaults(): Promise<boolean> {
    // 守卫下沉（AGENTS.md §6.3 规则六）：本方法可由命令面板直达，老板键激活时
    // 既不能弹出 modal 确认框（文案自曝插件名），也不能执行破坏性重置。
    if (isBossKeyActive()) {
      return false;
    }
    const confirm = await vscode.window.showWarningMessage(
      "确定要将 MarketLens 恢复为出厂默认设置吗？\n所有自选标的列表将重置为初始预设（基金/A股/港股/美股/Binance/Alpha 各精选 5 只，共 30 个标的），所有价格预警规则与自定义配置也将全部还原。",
      { modal: true },
      "确认恢复",
      "取消"
    );
    if (confirm !== "确认恢复") {
      return false;
    }

    // 1. 立即同步重置内存状态（0延迟清空树节点 🔔 图标与状态栏预警）
    try {
      SettingsWebviewPanel.onDidUpdateSetting?.("restoreDefaults", true);
    } catch (err) {
      logger.warn("[SettingsWebview] notify restoreDefaults failed", err);
    }

    const cfg = vscode.workspace.getConfiguration("marketlens");
    // 先清空核心 watchlist 与价格预警 alerts
    await cfg.update("watchlist", undefined, vscode.ConfigurationTarget.Global);
    await cfg.update("alerts", undefined, vscode.ConfigurationTarget.Global);

    const keys = Array.from(ALLOWED_CONFIG_KEYS);

    for (const k of keys) {
      await cfg.update(k, undefined, vscode.ConfigurationTarget.Global);
    }

    if (SettingsWebviewPanel.currentPanel) {
      SettingsWebviewPanel.currentPanel.sendCurrentSettings();
    }

    // 触发全局强制刷新全部最新行情
    await vscode.commands.executeCommand("marketlens.refresh");

    showInfoMessage("✅ MarketLens 已成功恢复为出厂默认设置（价格预警与自选列表均已还原初始状态）！");
    return true;
  }

  public static async clearWatchlist(): Promise<boolean> {
    // 同 restoreDefaults：命令面板可直达，老板键激活时必须静默拒绝（modal 文案自曝插件名，且属破坏性操作）
    if (isBossKeyActive()) {
      return false;
    }
    const confirm = await vscode.window.showWarningMessage(
      "确定要一键清空当前所有自选标的吗？\n清空后自选列表将变为空白（保留板块分类），方便您从零开始自由添加喜欢的资产。\n（注：您后续仍可随时通过【恢复出厂默认设置】重新找回系统预设标的）",
      { modal: true },
      "确认清空",
      "取消"
    );
    if (confirm !== "确认清空") {
      return false;
    }

    const cfg = vscode.workspace.getConfiguration("marketlens");
    const currentWatchlist = cfg.get<WatchlistConfig>("watchlist", {});
    const emptyWatchlist: WatchlistConfig = {};
    for (const group of Object.keys(currentWatchlist)) {
      emptyWatchlist[group] = [];
    }
    // 保留板块分类：六个默认分组名由 MARKET_SECTIONS 派生，禁止在此手写平行列表（§5.2 / §6.7）。
    // 新增板块时只改 config.ts 的 SECTION_DEFAULT_GROUP_NAMES，这里自动跟上。
    for (const group of DEFAULT_GROUP_NAMES) {
      if (!emptyWatchlist[group]) emptyWatchlist[group] = [];
    }

    // 立即同步清空内存列表，状态栏立刻清空并隐藏
    try {
      SettingsWebviewPanel.onDidUpdateSetting?.("watchlist", emptyWatchlist);
    } catch (err) {
      logger.warn("[SettingsWebview] notify clearWatchlist failed", err);
    }

    await cfg.update("watchlist", emptyWatchlist, vscode.ConfigurationTarget.Global);

    // 触发全局强制刷新
    await vscode.commands.executeCommand("marketlens.refresh");

    showInfoMessage("🗑️ 已成功清空所有自选标的！您可以点击自选栏顶部的加号 [+] 开始添加属于您的标的。");
    return true;
  }

  public static async exportSettings(globalState?: vscode.Memento): Promise<boolean> {
    const config = readConfig();
    const targetState = globalState || SettingsWebviewPanel.globalState;
    const savedSortModes = targetState?.get<Record<string, GroupSortMode>>("marketlens.groupSortModes", {}) || {};
    const version = vscode.extensions.getExtension("devqqqqq.marketlens")?.packageJSON?.version;
    return await exportSettingsToFile(config, savedSortModes, version);
  }

  public static async importSettings(globalState?: vscode.Memento): Promise<boolean> {
    const targetState = globalState || SettingsWebviewPanel.globalState;
    return await importSettingsFromFile({
      globalState: targetState,
      onSuccess: async (backupData) => {
        SettingsWebviewPanel.onDidUpdateSetting?.("importSettings", backupData);
        SettingsWebviewPanel.syncSettings();
        await vscode.commands.executeCommand("marketlens.refresh");
      },
    });
  }

  private _getCurrentSettingsData() {
    const config = readConfig();

    // 解析当前生效的统一代理端口与地址（优先尊重用户配置的自定义代理地址）
    const cachedPort = getCachedWorkingPort();
    const effectivePort = config.proxyPort || cachedPort || DEFAULT_PROXY_PORT;
    const proxyUrl = config.proxyUrl || (cachedPort ? `http://127.0.0.1:${cachedPort}` : DEFAULT_PROXY_URL);

    return {
      autoRefresh:              config.autoRefresh,
      refreshInterval:          config.refreshInterval,
      maskMode:                 config.maskMode,
      colorNeutral:             config.colorNeutral,
      colorScheme:              config.colorScheme,
      // 总控开关直接采用全局 statusBar.enabled 语义（未显式关闭即为开启）。
      // 此前用五个板块 statusBar 的逻辑与判定，会导致「只关掉 A 股轮播」时总控开关被误显示为关闭。
      statusBarEnabled:         config.statusBar.enabled,
      statusBarHoldingEnabled:  config.statusBar.holdingEnabled ?? true,
      statusBarHoldingInterval: config.statusBar.holdingInterval ?? 3,
      autoCollapseClosedGroups: config.autoCollapseClosedGroups ?? true,
      proxyPort:                effectivePort,
      proxyUrl:                 proxyUrl,
      fundEnabled:              config.fund.enabled,
      fundStatusBar:            config.fund.statusBar,
      fundStopOnMarketClosed:   config.fund.stopOnMarketClosed,
      fundNetworkMode:          config.fund.networkMode,
      aShareEnabled:            config.aShare.enabled,
      aShareStatusBar:          config.aShare.statusBar,
      aShareStopOnMarketClosed: config.aShare.stopOnMarketClosed,
      aShareNetworkMode:        config.aShare.networkMode,
      hkStockEnabled:           config.hkStock.enabled,
      hkStockStatusBar:         config.hkStock.statusBar,
      hkStockStopOnMarketClosed: config.hkStock.stopOnMarketClosed,
      hkStockNetworkMode:       config.hkStock.networkMode,
      usStockEnabled:           config.usStock.enabled,
      usStockStatusBar:         config.usStock.statusBar,
      usStockStopOnMarketClosed: config.usStock.stopOnMarketClosed,
      usStockNetworkMode:       config.usStock.networkMode,
      binanceEnabled:           config.binance.enabled,
      binanceStatusBar:         config.binance.statusBar,
      binanceNetworkMode:       config.binance.networkMode,
      alphaEnabled:             config.alpha.enabled,
      alphaStatusBar:           config.alpha.statusBar,
      alphaNetworkMode:         config.alpha.networkMode,
      alerts:                   config.alerts || {},
      alertNotificationMode:    config.alertNotificationMode,
      alertCooldownMinutes:     config.alertCooldownMinutes,
      watchlist:                (() => {
        const rawWatchlist = config.watchlist || {};
        const quoteCache = SettingsWebviewPanel.getQuoteCache?.();
        const resolvedWatchlist: WatchlistConfig = {};

        for (const [grp, items] of Object.entries(rawWatchlist)) {
          resolvedWatchlist[grp] = (items || []).map((it) => {
            if (!it) return it;
            const sym = typeof it === "string" ? it : it.symbol;
            const confName = typeof it === "object" ? it.name : undefined;
            let cached: MarketItem | undefined;
            if (quoteCache && sym) {
              const normKey = normalizeSymbolKey(sym);
              const rawTicker = stripMarketPrefix(sym);
              cached =
                quoteCache.get(normKey) ||
                quoteCache.get(sym) ||
                quoteCache.get(sym.toLowerCase()) ||
                quoteCache.get(rawTicker);
            }
            const finalName = resolveItemDisplayName(confName, sym, cached);
            return typeof it === "object"
              ? { ...it, name: finalName }
              : { symbol: sym, name: finalName, type: cached?.type || "A_SHARE" };
          });
        }
        return resolvedWatchlist;
      })(),
    };
  }

  public sendCurrentSettings(): void {
    if (this._panel && this._panel.webview) {
      const data = this._getCurrentSettingsData();
      this._panel.webview.postMessage({ command: "initSettings", data });
    }
  }

  public static syncSettings(): void {
    if (SettingsWebviewPanel.currentPanel) {
      SettingsWebviewPanel.currentPanel.sendCurrentSettings();
    }
  }

  public dispose() {
    SettingsWebviewPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) { x.dispose(); }
    }
  }

  private _getHtmlForWebview(): string {
    const nonce = SettingsWebviewPanel._generateNonce();
    const currentData = this._getCurrentSettingsData();
    return getSettingsWebviewHtml(nonce, this._version, this._panel.webview.cspSource, currentData);
  }
}
