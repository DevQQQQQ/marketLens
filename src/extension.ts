// src/extension.ts
import * as vscode from "vscode";
import { MarketManager } from "./services/marketManager.ts";
import { WatchlistProvider } from "./ui/watchlistProvider.ts";
import { StatusBar } from "./ui/statusBar.ts";
import { logger } from "./utils/logger.ts";
import { shouldAutoExitBossKey } from "./utils/maskState.ts";
import { setMaskSnapshotSource } from "./utils/feedback.ts";
import { resetProxyCache, validateAndNormalizeProxyUrl, DEFAULT_PROXY_PORT, DEFAULT_PROXY_URL } from "./services/network.ts";
import {
  readConfig,
  getWatchlistFingerprint,
  applyProxyToAllSections,
  applyStatusBarToAllSections,
  recomputeStatusBarEnabled,
  affectsNetworkConfig,
  isMarketSection,
  sanitizeAlerts,
} from "./utils/config.ts";
import { RefreshScheduler } from "./scheduler.ts";
import { WatchlistOps } from "./watchlistOps.ts";
import { registerCommands } from "./commands/index.ts";
import { SettingsWebviewPanel } from "./ui/settingsWebview.ts";

// ── 模块级句柄：让 deactivate() 可以显式清理，防止热重载内存泄漏 ──
let _scheduler: RefreshScheduler | undefined;
let _statusBar: StatusBar | undefined;
let _configDebounceTimer: NodeJS.Timeout | undefined;

/**
 * 收敛「不需要等待结果、但绝不能漏掉 rejection」的持久化调用。
 *
 * `void thenable` 只是丢弃返回值；globalState/cfg.update 在宿主关闭或磁盘写入失败时
 * 仍会 reject，未处理 Promise 会污染扩展宿主日志（AGENTS.md §5.6 异步与生命周期）。
 */
function fireAndForgetPersist(label: string, task: PromiseLike<unknown>): void {
  void Promise.resolve(task).catch((err) => {
    logger.warn(`${label}落盘失败`, err);
  });
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  logger.init(context);
  logger.info("MarketLens 正在激活...");

  let config = readConfig();

  const marketManager = new MarketManager();
  const treeProvider  = new WatchlistProvider(config.maskMode, config.colorNeutral, config.colorScheme);
  treeProvider.setAutoCollapseClosedGroups(config.autoCollapseClosedGroups ?? true);
  const statusBar     = new StatusBar({
    maskMode:     config.maskMode,
    colorNeutral: config.colorNeutral,
    colorScheme:  config.colorScheme,
  });
  if (config.statusBar?.enabled === false) {
    statusBar.hide();
  }

  // 绑定到模块级变量，使 deactivate() 可以显式清理
  _statusBar = statusBar;

  // 脱敏状态唯一来源注入给回显统一出口：feedback.ts 与命令层必须读到同一份
  // bossKey / maskMode，否则会出现「守卫判定一套、回显判定另一套」。
  setMaskSnapshotSource(() => ({
    bossKeyActive: statusBar.isBossKeyActive(),
    maskMode: statusBar.isMaskModeActive(),
  }));

  const treeView = vscode.window.createTreeView("marketlens.watchlist", {
    treeDataProvider: treeProvider,
    dragAndDropController: treeProvider,
    showCollapseAll: true,
    canSelectMany: true,
  });

  const scheduler = new RefreshScheduler({
    marketManager,
    treeProvider,
    statusBar,
    treeView,
  });
  _scheduler = scheduler;
  SettingsWebviewPanel.getQuoteCache = () => scheduler.quoteCache;
  SettingsWebviewPanel.globalState = context.globalState;

  const watchlistOps = new WatchlistOps({
    quoteCache: scheduler.quoteCache,
    rebuildTree: (customWatchlist) => scheduler.rebuildTree(customWatchlist),
    treeProvider,
  });

  // 恢复持久化的各分组排序模式并监听变更
  const savedSortModes = context.globalState.get<Record<string, import("./types").GroupSortMode>>(
    "marketlens.groupSortModes",
    {}
  );
  treeProvider.setAllGroupSortModes(savedSortModes);
  treeProvider.onGroupSortModeChangeCallback = async () => {
    await context.globalState.update(
      "marketlens.groupSortModes",
      treeProvider.getAllGroupSortModes()
    );
  };

  // 绑定拖拽排序回调（支持多选原子批量重排）
  treeProvider.onBatchReorderCallback = (items, targetGroup, targetSymbol) =>
    watchlistOps.handleBatchReorder(items, targetGroup, targetSymbol);

  // 立即构建初版树骨架（展示配置中的所有分组和标的，无需等待首次网络请求返回）
  scheduler.rebuildTree();

  // 当用户展开侧边栏视图时，开启一次新的折叠会话（让休市分组回到默认折叠，
  // 避免 VS Code 恢复用户上一次的手动展开状态），并立即唤醒刷新一次保证最新数据
  context.subscriptions.push(
    treeView.onDidChangeVisibility((e) => {
      if (!e.visible) {
        return;
      }

      // 用户主动打开看板 = 明确要查看行情，此处作为专注模式（老板键）的自然出口：
      // 老板键状态仅存内存且原本只由 Alt+M 复位，若不在此解除，bossKeyActive 会
      // 一票否决 maskMode，导致「切换简洁展示模式 (Alt+K)」静默失效——界面永久停留在
      // 脱敏态且无任何提示。判据以 statusBar 为准（其 bossKeyActive 先于 treeProvider 更新）。
      if (shouldAutoExitBossKey(e.visible, statusBar.isBossKeyActive())) {
        statusBar.toggleBossKey(false);
        treeProvider.setBossKey(false);
        logger.info("检测到用户重新打开自选看板，已自动退出专注模式");
      }

      treeProvider.beginCollapseSession();
      void scheduler.refresh(true);
    })
  );

  // 注册所有命令
  registerCommands(context, {
    scheduler,
    watchlistOps,
    statusBar,
    treeProvider,
  });

  // 监听 Webview 设置面板即时操作（0延迟同步更新内存，无需等待异步磁盘 I/O）
  SettingsWebviewPanel.onDidUpdateSetting = (key: string, value: unknown) => {
    if (key === "restoreDefaults") {
      config = readConfig();
      config.alerts = {};
      scheduler.alertManager.resetCooldown();
      treeProvider.setAlerts({});
      treeProvider.setAllGroupSortModes({});
      fireAndForgetPersist("分组排序复位", context.globalState.update("marketlens.groupSortModes", {}));
      scheduler.updateStatusBar(config);
      scheduler.rebuildTree(undefined, config);
      SettingsWebviewPanel.syncSettings();
      return;
    }

    if (key === "importSettings") {
      config = readConfig();
      treeProvider.setAlerts(config.alerts || {});
      if (value && typeof value === "object" && "groupSortModes" in value) {
        const modes = (value as { groupSortModes?: Record<string, import("./types").GroupSortMode> }).groupSortModes;
        if (modes) {
          treeProvider.setAllGroupSortModes(modes);
        }
      }
      scheduler.updateStatusBar(config);
      scheduler.rebuildTree(config.watchlist, config);
      SettingsWebviewPanel.syncSettings();
      return;
    }

    if (key === "alerts") {
      // 内存先行同样要过消毒：这里收到的 value 可能来自面板增量合并，也可能来自磁盘变更事件
      config.alerts = sanitizeAlerts(value);
      treeProvider.setAlerts(config.alerts);
      scheduler.rebuildTree(undefined, config);
      SettingsWebviewPanel.syncSettings();
      return;
    }

    if (key === "watchlist") {
      const sanitized = (value && typeof value === "object" && !Array.isArray(value))
        ? (value as import("./types").WatchlistConfig)
        : {};
      config.watchlist = sanitized;
      scheduler.updateStatusBar(config);
      scheduler.rebuildTree(sanitized, config);
      return;
    }

    if (key === "statusBar.enabled") {
      applyStatusBarToAllSections(config, !!value);
    } else if (key === "autoCollapseClosedGroups") {
      config.autoCollapseClosedGroups = !!value;
      treeProvider.setAutoCollapseClosedGroups(config.autoCollapseClosedGroups);
    } else if (key === "maskMode") {
      config.maskMode = !!value;
      // 入口语义对齐（与 `marketlens.toggleMask` 命令同源）：老板键激活期间 maskMode 被
      // isDisplayMasked 一票否决，若放任自持状态会造成「配置已改、观感未变」的静默失效。
      // 此处先解除专注模式，保证用户在任何入口的显式显示开关都立即生效。
      if (statusBar.isBossKeyActive()) {
        statusBar.toggleBossKey(false);
        treeProvider.setBossKey(false);
        logger.info("检测到设置面板变更简洁展示模式，已自动退出专注模式");
      }
      statusBar.setMaskMode(config.maskMode);
      treeProvider.setMaskMode(config.maskMode);
    } else if (key === "colorNeutral") {
      config.colorNeutral = !!value;
      statusBar.setColorNeutral(config.colorNeutral);
      treeProvider.setColorNeutral(config.colorNeutral);
    } else if (key === "colorScheme") {
      config.colorScheme = value === "redUpGreenDown" ? "redUpGreenDown" : "greenUpRedDown";
      config.colorNeutral = false;
      statusBar.setColorNeutral(false);
      treeProvider.setColorNeutral(false);
      statusBar.setColorScheme(config.colorScheme);
      treeProvider.setColorScheme(config.colorScheme);
    } else if (key === "autoRefresh") {
      config.autoRefresh = !!value;
      if (!config.autoRefresh) {
        scheduler.stop();
      }
    } else if (key === "refreshInterval") {
      config.refreshInterval = Number(value) || 5000;
    } else if (key === "proxyPort") {
      const port = Number(value) || DEFAULT_PROXY_PORT;
      const currentUrl = config.proxyUrl || DEFAULT_PROXY_URL;
      let pUrl = `http://127.0.0.1:${port}`;
      try {
        const parsed = new URL(currentUrl);
        parsed.port = String(port);
        pUrl = parsed.toString().replace(/\/$/, "");
      } catch (err) {
        logger.warn("解析当前代理 URL 失败，已回退默认格式", err);
      }
      applyProxyToAllSections(config, pUrl, port);
      resetProxyCache();
      scheduler.clearProxySuspensions();
    } else if (key === "proxyUrl") {
      // 内存镜像与磁盘写入必须同一形态，否则「内存已纠偏、磁盘仍是 socks5:// 原样」
      // 会让下一次 readConfig 覆盖回异形值（规范化出口见 services/network.ts）
      const pUrl =
        typeof value === "string" && value.trim() !== ""
          ? validateAndNormalizeProxyUrl(value)
          : DEFAULT_PROXY_URL;
      applyProxyToAllSections(config, pUrl);
      resetProxyCache();
      scheduler.clearProxySuspensions();
    } else if (key === "alertNotificationMode") {
      config.alertNotificationMode =
        value === "statusBarOnly" || value === "both" ? value : "notification";
    } else if (key === "alertCooldownMinutes") {
      config.alertCooldownMinutes = Number(value) || 15;
    }

    const dotIndex = key.indexOf(".");
    if (dotIndex > 0) {
      const section = key.slice(0, dotIndex);
      if (isMarketSection(section)) {
        const targetSection = config[section];
        const field = key.slice(dotIndex + 1);
        if (targetSection && typeof targetSection === "object" && field in targetSection) {
          // 板块级代理地址与全局代理走同一规范化出口；留空仍是「继承全局代理」语义，原样保留
          (targetSection as Record<string, unknown>)[field] =
            field === "proxyUrl" && typeof value === "string" && value.trim() !== ""
              ? validateAndNormalizeProxyUrl(value)
              : value;
          if (field === "proxyUrl" || field === "networkMode") {
            resetProxyCache();
            scheduler.clearProxySuspensions();
          }
          if (field === "statusBar") {
            recomputeStatusBarEnabled(config);
          }
        }
      }
    }

    lastWebviewUpdateTimestamp = Date.now();
    scheduler.updateStatusBar(config);
    scheduler.rebuildTree(undefined, config);
  };

  // 配置变更监听（50ms 去抖动与状态聚合，杜绝连续修改多项配置时的重复重排与时序抖动）
  let lastWebviewUpdateTimestamp = 0;
  let pendingAffectsNetwork = false;
  let pendingAffectsColorScheme = false;
  let pendingAffectsColorNeutral = false;
  let baselineFingerprint: string | undefined;

  const flushConfigChange = () => {
    try {
      _configDebounceTimer = undefined;
      const oldFingerprint = baselineFingerprint ?? getWatchlistFingerprint(config.watchlist);
      baselineFingerprint = undefined;

      const hadNetworkChange = pendingAffectsNetwork;
      const hadColorSchemeChange = pendingAffectsColorScheme;
      const hadColorNeutralChange = pendingAffectsColorNeutral;
      pendingAffectsNetwork = false;
      pendingAffectsColorScheme = false;
      pendingAffectsColorNeutral = false;

      config = readConfig();

      if (hadColorSchemeChange && !hadColorNeutralChange) {
        const cfg = vscode.workspace.getConfiguration("marketlens");
        if (cfg.get<boolean>("colorNeutral")) {
          fireAndForgetPersist("配色中性化复位", cfg.update("colorNeutral", false, vscode.ConfigurationTarget.Global));
          config.colorNeutral = false;
        }
      }

      const isBossActive = statusBar.isBossKeyActive();
      treeProvider.setBossKey(isBossActive);
      treeProvider.setMaskMode(config.maskMode);
      treeProvider.setColorNeutral(config.colorNeutral);
      treeProvider.setColorScheme(config.colorScheme);
      treeProvider.setAlerts(config.alerts || {});
      treeProvider.setAutoCollapseClosedGroups(config.autoCollapseClosedGroups ?? true);
      statusBar.setMaskMode(config.maskMode);
      statusBar.setColorNeutral(config.colorNeutral);
      statusBar.setColorScheme(config.colorScheme);

      const isFromRecentWebview = Date.now() - lastWebviewUpdateTimestamp < 400;
      const watchlistContentChanged = oldFingerprint !== getWatchlistFingerprint(config.watchlist);

      scheduler.updateStatusBar(config);
      // 若变更由 Webview 面板发起且自选内容未变动，onDidUpdateSetting 已执行即时内存重排，跳过落盘二次重复 rebuild
      if (!isFromRecentWebview || watchlistContentChanged) {
        scheduler.rebuildTree(undefined, config);
      }
      SettingsWebviewPanel.syncSettings();

      // 仅在网络/轮询周期/板块开关变动，或自选列表发生实际标的增删时才重启定时器并触发网络拉取
      // 纯 UI 配置（如 maskMode, colorNeutral, statusBar）或同组拖拽、跨组移动完全不重复打全量网络（标的报价已在内存缓存中）
      if (hadNetworkChange || watchlistContentChanged) {
        resetProxyCache();
        marketManager.clearInvalidCache();
        scheduler.start();
      }
    } catch (err) {
      logger.error("flushConfigChange 处理配置变更时异常，防止脏数据阻塞后续轮询", err);
    }
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("marketlens")) {
        if (baselineFingerprint === undefined) {
          baselineFingerprint = getWatchlistFingerprint(config.watchlist);
        }
        if (affectsNetworkConfig(e)) {
          pendingAffectsNetwork = true;
        }
        if (e.affectsConfiguration("marketlens.colorScheme")) {
          pendingAffectsColorScheme = true;
        }
        if (e.affectsConfiguration("marketlens.colorNeutral")) {
          pendingAffectsColorNeutral = true;
        }

        if (_configDebounceTimer) {
          clearTimeout(_configDebounceTimer);
        }
        _configDebounceTimer = setTimeout(flushConfigChange, 50);
      }
    })
  );

  // 注册生命周期清理：statusBar, treeView, treeProvider, 调度器释放
  context.subscriptions.push(statusBar, treeView, treeProvider, scheduler);

  scheduler.start();
  logger.info("activated ✓");
}

export function deactivate(): void {
  if (_configDebounceTimer) {
    clearTimeout(_configDebounceTimer);
    _configDebounceTimer = undefined;
  }

  // 三个静态注入位必须全部复位：activate 会重新注入，遗留旧实例会让 deactivate 之后的
  // 任何 webview 回调继续持有上一轮的 statusBar/config/quoteCache 引用。
  SettingsWebviewPanel.onDidUpdateSetting = undefined;
  SettingsWebviewPanel.getQuoteCache = undefined;
  SettingsWebviewPanel.globalState = undefined;

  _scheduler?.dispose();
  _scheduler = undefined;

  _statusBar?.dispose();
  _statusBar = undefined;

  logger.info("deactivated");
}