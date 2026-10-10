// src/scheduler.ts
import * as vscode from "vscode";
import { MarketManager } from "./services/marketManager.ts";
import { WatchlistProvider, GroupItem } from "./ui/watchlistProvider.ts";
import { StatusBar } from "./ui/statusBar.ts";
import type { MarketLensConfig, MarketItem } from "./types/index.ts";
import { normalizeSymbolKey } from "./utils/symbolHelper.ts";
import { logger } from "./utils/logger.ts";
import { isAShareMarketOpen, isHKMarketOpen, isUSMarketOpen, evaluateAdaptiveThrottle, shouldSkipMarketPolling } from "./utils/marketHours.ts";
import { readConfig } from "./utils/config.ts";

import { extractTargetsFromWatchlist, extractStatusBarQuotes, pruneQuoteCache } from "./utils/symbolHelper.ts";
import { AlertManager } from "./services/alertManager.ts";

export interface SchedulerContext {
  marketManager: MarketManager;
  treeProvider: WatchlistProvider;
  statusBar: StatusBar;
  treeView: vscode.TreeView<any>;
}

export class RefreshScheduler implements vscode.Disposable {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryCount = 0;
  private readonly MAX_RETRY_COUNT = 2;
  private hasLoadedInitialQuotes = false;
  private isRefreshing = false;
  /**
   * 终止标志：dispose() 之后永久为 true。
   *
   * 与 stop() 的区别：stop() 是「暂停」（扩展仍在使用中，仅清理当前定时器），
   * dispose() 是「终点」——此后不得再有任何新定时器被挂出。
   */
  private disposed = false;

  // 休市与无行情变动自适应降频
  private consecutiveUnchangedCount = 0;
  private isThrottled = false;
  public readonly THROTTLED_INTERVAL_MS = 60000;
  public readonly UNCHANGED_THRESHOLD = 3;

  // 网络持续故障自适应退避计数
  private consecutiveNetworkFailures = 0;
  public readonly MAX_BACKOFF_INTERVAL_MS = 60000;

  public readonly quoteCache = new Map<string, MarketItem>();
  public readonly alertManager: AlertManager;

  private readonly marketManager: MarketManager;
  private readonly treeProvider: WatchlistProvider;
  private readonly statusBar: StatusBar;
  private readonly treeView: vscode.TreeView<any>;

  constructor(context: SchedulerContext) {
    this.marketManager = context.marketManager;
    this.treeProvider = context.treeProvider;
    this.statusBar = context.statusBar;
    this.treeView = context.treeView;
    this.alertManager = new AlertManager(this.statusBar);
  }

  /**
   * 将 watchlist 配置分类为五种抓取目标（受板块启用状态控制）
   */
  public extractTargets(
    config: MarketLensConfig,
    specificGroupName?: string,
    forceAll: boolean = false
  ) {
    const skipHK = shouldSkipMarketPolling({
      stopOnMarketClosed: config.hkStock.stopOnMarketClosed,
      isMarketOpen: isHKMarketOpen(),
      hasLoadedInitialQuotes: this.hasLoadedInitialQuotes,
      forceAll,
      specificGroupName,
    });
    const skipUS = shouldSkipMarketPolling({
      stopOnMarketClosed: config.usStock.stopOnMarketClosed,
      isMarketOpen: isUSMarketOpen(),
      hasLoadedInitialQuotes: this.hasLoadedInitialQuotes,
      forceAll,
      specificGroupName,
    });
    const skipFund = shouldSkipMarketPolling({
      stopOnMarketClosed: config.fund?.stopOnMarketClosed ?? true,
      isMarketOpen: isAShareMarketOpen(),
      hasLoadedInitialQuotes: this.hasLoadedInitialQuotes,
      forceAll,
      specificGroupName,
    });
    const skipA = shouldSkipMarketPolling({
      stopOnMarketClosed: config.aShare.stopOnMarketClosed,
      isMarketOpen: isAShareMarketOpen(),
      hasLoadedInitialQuotes: this.hasLoadedInitialQuotes,
      forceAll,
      specificGroupName,
    });

    return extractTargetsFromWatchlist(config.watchlist, {
      fundEnabled: config.fund?.enabled ?? true,
      aShareEnabled: config.aShare.enabled,
      hkStockEnabled: config.hkStock.enabled,
      usStockEnabled: config.usStock.enabled,
      binanceEnabled: config.binance.enabled,
      alphaEnabled: config.alpha.enabled,
      specificGroupName,
      skipFund,
      skipAShare: skipA,
      skipHKStock: skipHK,
      skipUSStock: skipUS,
    });
  }

  public saveToQuoteCache(q: MarketItem): void {
    const normSym = normalizeSymbolKey(q.symbol);
    const normId = normalizeSymbolKey(q.id);
    if (normSym) this.quoteCache.set(normSym, q);
    if (normId && normId !== normSym) this.quoteCache.set(normId, q);
    if (q.symbol) this.quoteCache.set(q.symbol, q);
    if (q.id && q.id !== q.symbol) this.quoteCache.set(q.id, q);
  }

  /**
   * 统一收口树视图构建，避免多处重复传递相同的 enabledSections 参数
   *
   * @param customWatchlist 可选：直接使用调用方已计算好的自选列表，跳过磁盘读取
   * @param configOverride  可选：内存中已即时更新的配置。Webview 面板的 updateSetting 是
   *                        「先同步更新内存、后异步落盘」，此时若仍从磁盘 readConfig() 会读回旧值，
   *                        导致预警 🔔 图标与板块开关出现「对 → 错 → 对」的瞬时回退。
   *                        由调用方透传内存配置即可彻底消除该时序抖动。
   */
  public rebuildTree(
    customWatchlist?: Record<string, any[]>,
    configOverride?: MarketLensConfig
  ): void {
    const currentCfg = configOverride || readConfig();
    const activeWatchlist = customWatchlist || currentCfg.watchlist;
    this.treeProvider.setAlerts(currentCfg.alerts || {});
    pruneQuoteCache(activeWatchlist, this.quoteCache);
    this.treeProvider.buildTree(
      activeWatchlist,
      this.quoteCache,
      {
        fund: currentCfg.fund?.enabled ?? true,
        aShare: currentCfg.aShare.enabled,
        hkStock: currentCfg.hkStock.enabled,
        usStock: currentCfg.usStock.enabled,
        binance: currentCfg.binance.enabled,
        alpha: currentCfg.alpha.enabled,
      },
      currentCfg.autoCollapseClosedGroups ?? true
    );
  }

  /**
   * 统一更新底部状态栏行情与轮播展示
   * 聚合所有启用且开启轮播的板块标的，优先使用内存中的最新报价（含已闭市标的的收盘报价），
   * 确保闭市时状态栏不会丢失已缓存的收盘行情，并在配置开关变动时立即生效。
   */
  public updateStatusBar(currentConfig?: MarketLensConfig): void {
    const config = currentConfig || readConfig();
    const statusBarQuotes = extractStatusBarQuotes(config.watchlist, this.quoteCache, {
      statusBarEnabled: config.statusBar?.enabled,
      autoCollapseClosedGroups: config.autoCollapseClosedGroups ?? true,
      fund: config.fund,
      aShare: config.aShare,
      hkStock: config.hkStock,
      usStock: config.usStock,
      binance: config.binance,
      alpha: config.alpha,
    });

    this.statusBar.setQuotes(statusBarQuotes);
    if (statusBarQuotes.length > 0) {
      this.statusBar.show();
    } else {
      this.statusBar.hide();
    }
  }

  public isAdaptiveThrottled(): boolean {
    return this.isThrottled;
  }

  public getConsecutiveUnchangedCount(): number {
    return this.consecutiveUnchangedCount;
  }

  // ── 全量刷新 ────────────────────────────────────────────────────

  public async refresh(forceRefreshAll: boolean = false): Promise<void> {
    if (this.disposed) {
      return;
    }
    const config = readConfig();
    // 资源节流控制：若状态栏未开启且侧边栏视图不可见，且非显式强制唤醒刷新，暂停后台打网
    const isStatusBarActive = config.statusBar?.enabled !== false;
    const isTreeViewActive = this.treeView.visible;
    if (!isStatusBarActive && !isTreeViewActive && !forceRefreshAll) {
      this.scheduleNextTick();
      return;
    }

    if (this.isRefreshing) {
      if (forceRefreshAll && !this.retryTimer && this.retryCount < this.MAX_RETRY_COUNT) {
        this.retryCount++;
        // 若当前已有刷新在执行，且未排队重试，延迟 300ms 再次触发一次强制刷新
        this.retryTimer = setTimeout(() => {
          this.retryTimer = undefined;
          void this.refresh(true);
        }, 300);
      }
      return;
    }

    // 成功进入执行，重置重试计数
    this.retryCount = 0;
    this.isRefreshing = true;
    try {
      // 首次加载或明确要求强制刷新时，确保必定拉取并复位失效抑制黑名单
      // 当网络连续全失败 >= 3 次时，非显式强制刷新下不再强制 forceAll，允许休市市场跳过
      const forceAll = forceRefreshAll || (!this.hasLoadedInitialQuotes && this.consecutiveNetworkFailures < 3);
      if (forceRefreshAll) {
        this.marketManager.clearInvalidCache();
      }
      const targets = this.extractTargets(config, undefined, forceAll);
      const quotes  = await this.marketManager.pollAll(
        targets,
        { mode: config.aShare.networkMode, proxyUrl: config.aShare.proxyUrl },
        { mode: config.hkStock.networkMode, proxyUrl: config.hkStock.proxyUrl },
        { mode: config.usStock.networkMode, proxyUrl: config.usStock.proxyUrl },
        { mode: config.binance.networkMode, proxyUrl: config.binance.proxyUrl },
        { mode: config.alpha.networkMode, proxyUrl: config.alpha.proxyUrl },
        { mode: config.fund?.networkMode ?? "direct", proxyUrl: config.fund?.proxyUrl }
      );

      if (this.disposed) {
        return;
      }

      const hasAnyTargets =
        targets.funds.length > 0 ||
        targets.aShares.length > 0 ||
        targets.hkStocks.length > 0 ||
        targets.usStocks.length > 0 ||
        targets.cryptos.length > 0 ||
        targets.bscTokens.length > 0;

      if (quotes.length > 0) {
        this.consecutiveNetworkFailures = 0;
      } else if (hasAnyTargets) {
        this.consecutiveNetworkFailures++;
      }

      const isWatchlistCompletelyEmpty =
        !config.watchlist ||
        Object.values(config.watchlist).every((list) => !Array.isArray(list) || list.length === 0);

      if (isWatchlistCompletelyEmpty) {
        this.quoteCache.clear();
      }

      // 行情变动与休市降频评估
      let hasPriceChanged = false;
      if (!forceRefreshAll && this.hasLoadedInitialQuotes && quotes.length > 0) {
        for (const q of quotes) {
          const cached = this.quoteCache.get(normalizeSymbolKey(q.symbol)) || this.quoteCache.get(q.symbol);
          if (!cached || cached.price !== q.price) {
            hasPriceChanged = true;
            break;
          }
        }
      } else if (!this.hasLoadedInitialQuotes) {
        hasPriceChanged = true;
      }

      for (const q of quotes) {
        this.saveToQuoteCache(q);
      }
      pruneQuoteCache(config.watchlist, this.quoteCache);

      // 评估休市与自适应降频状态
      const has24HourCrypto =
        (config.binance.enabled && targets.cryptos.length > 0) ||
        (config.alpha.enabled && targets.bscTokens.length > 0);

      const throttleResult = evaluateAdaptiveThrottle({
        fundEnabled: config.fund?.enabled ?? true,
        aShareEnabled: config.aShare.enabled,
        hkStockEnabled: config.hkStock.enabled,
        usStockEnabled: config.usStock.enabled,
        has24HourCrypto,
        hasPriceChanged,
        consecutiveUnchangedCount: this.consecutiveUnchangedCount,
        unchangedThreshold: this.UNCHANGED_THRESHOLD,
      });

      this.isThrottled = throttleResult.isThrottled;
      this.consecutiveUnchangedCount = throttleResult.consecutiveUnchangedCount;

      // 评估价格预警与剧烈波动
      this.alertManager.checkQuotes(quotes, config);

      const wasFirstLoad = !this.hasLoadedInitialQuotes;
      if (quotes.length > 0 || this.hasLoadedInitialQuotes) {
        this.hasLoadedInitialQuotes = true;
      }

      if (this.treeProvider.isEmpty() || wasFirstLoad || forceRefreshAll) {
        this.rebuildTree();
      } else {
        this.treeProvider.applyQuotes(quotes);
      }

      this.updateStatusBar(config);
    } catch (err) {
      this.consecutiveNetworkFailures++;
      // 静默降级：仅写日志到 OutputChannel，绝不弹窗打断用户编码
      logger.error("全量刷新失败", err);
    } finally {
      this.isRefreshing = false;
      if (!this.disposed) {
        this.scheduleNextTick();
      }
    }
  }

  // ── 分类刷新 ────────────────────────────────────────────────────

  public async refreshGroup(group: GroupItem): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (this.isRefreshing) {
      // 若当前已有全量或分组刷新在执行，避免并发重叠打网
      return;
    }
    this.isRefreshing = true;
    try {
      const config = readConfig();
      const targets = this.extractTargets(config, group.groupName);
      const quotes  = await this.marketManager.pollAll(
        targets,
        { mode: config.aShare.networkMode, proxyUrl: config.aShare.proxyUrl },
        { mode: config.hkStock.networkMode, proxyUrl: config.hkStock.proxyUrl },
        { mode: config.usStock.networkMode, proxyUrl: config.usStock.proxyUrl },
        { mode: config.binance.networkMode, proxyUrl: config.binance.proxyUrl },
        { mode: config.alpha.networkMode, proxyUrl: config.alpha.proxyUrl },
        { mode: config.fund?.networkMode ?? "direct", proxyUrl: config.fund?.proxyUrl }
      );

      if (this.disposed) {
        return;
      }

      for (const q of quotes) {
        this.saveToQuoteCache(q);
      }
      pruneQuoteCache(config.watchlist, this.quoteCache);

      // 评估价格预警与剧烈波动
      this.alertManager.checkQuotes(quotes, config);

      this.treeProvider.applyQuotes(quotes);
      this.updateStatusBar(config);
    } catch (err) {
      logger.error(`分组 '${group.groupName}' 刷新失败`, err);
    } finally {
      this.isRefreshing = false;
    }
  }

  // ── 定时器生命周期 ──────────────────────────────────────────────

  private scheduleNextTick(forcedDelayMs?: number): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.disposed) {
      return;
    }
    const config = readConfig();
    // 如果关闭了自动刷新，则不调度下一次轮询
    if (!config.autoRefresh) {
      return;
    }

    const standardInterval = Math.max(1000, config.refreshInterval || 5000);
    let delay = forcedDelayMs ?? (this.isThrottled ? Math.max(this.THROTTLED_INTERVAL_MS, standardInterval) : standardInterval);

    // 网络持续故障退避策略：若连续失败 >= 2 次，引入指数退避（上限 60s），避免雪崩与上游限流
    if (forcedDelayMs === undefined && this.consecutiveNetworkFailures >= 2) {
      const backoffMultiplier = Math.pow(1.5, Math.min(this.consecutiveNetworkFailures - 1, 6));
      delay = Math.min(this.MAX_BACKOFF_INTERVAL_MS, Math.max(delay, Math.round(standardInterval * backoffMultiplier)));
    }

    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh();
    }, delay);
  }

  public getConsecutiveNetworkFailures(): number {
    return this.consecutiveNetworkFailures;
  }

  public start(): void {
    // 与 dispose() 对称：允许「停用后重新启用」的合法路径撤销终止标志
    this.disposed = false;
    this.stop();
    this.consecutiveUnchangedCount = 0;
    this.isThrottled = false;
    this.consecutiveNetworkFailures = 0;
    // 首次启动时无条件强制刷新一次，确保即使处于闭市/休市/周末也能看到最新收盘数据
    void this.refresh(true);
  }

  public stop(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.retryTimer !== undefined) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    this.retryCount = 0;
    this.isThrottled = false;
    this.consecutiveUnchangedCount = 0;
    this.consecutiveNetworkFailures = 0;
  }

  public dispose(): void {
    // 必须先置终止标志、再 stop()：
    // 若此刻恰有一次刷新在飞行中，其 finally 会在 stop() 之后调用 scheduleNextTick()，
    // 把已经被清理的 timer 重新挂回来，导致扩展停用后仍在后台周期性发起网络请求，
    // 直至 VS Code 进程退出（轮询窗口 5s、请求最长 5s，命中概率不低）。
    this.disposed = true;
    this.stop();
  }

  public isDisposed(): boolean {
    return this.disposed;
  }
}
