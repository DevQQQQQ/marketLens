// src/ui/statusBar.ts
// 极致摸鱼状态栏：伪装模式 / 老板键 / 颜色脱敏 / 轮播展示

import * as vscode from "vscode";
import type { MarketItem } from "../types/index.ts";
import { getProxyStatus } from "../services/network.ts";
import { escapeMarkdownInline, toMarkdownCodeSpan, currencyPrefix, currencySuffix, type HoldingItemQuote } from "../utils/symbolHelper.ts";
import { isDisplayMasked } from "../utils/maskState.ts";
import { closePortfolioHud } from "./portfolioHud.ts";
import { MarketPanoramaWebviewPanel } from "./panoramaWebview.ts";
import {
  aggregateHoldingsByCurrency,
  formatFxSourceNote,
  formatFxDetailNote,
  formatPortfolioAmount,
  deriveTodayProfitRate,
  deriveTotalProfitRate,
  type HoldingCurrencyBucket,
  type PortfolioSummary,
} from "../utils/portfolio.ts";

// ────────────────────────────────────────────────────────────────
//  常量与工具函数
// ────────────────────────────────────────────────────────────────

const CAMO_BRANCHES = ["main", "dev", "feat/ui", "fix/perf", "release/v2"];
const CAMO_LABELS = [
  "build", "dep", "pkg", "lint", "test",
  "dist", "chunk", "mod", "lib", "src",
];

/** 把价格伪装成文件大小/构建产物体积 */
function toCamoPrice(price: number): string {
  if (price === 0) return "0.0";
  if (price < 0.001) return `${(price * 1_000_000).toFixed(0)}n`;
  if (price < 1)     return `${(price * 1000).toFixed(1)}m`;
  if (price >= 1e6)  return `${(price / 1e6).toFixed(2)}M`;
  if (price >= 1000) return `${(price / 1000).toFixed(1)}k`;
  return price.toFixed(1);
}

/** 把实际价格格式化用于正常显示（方案 A：微小单价展开，小于 1e-8 才回退科学计数法） */
export function toDisplayPrice(price: number): string {
  if (!Number.isFinite(price) || price === 0) return "0.00";
  const prefix = price < 0 ? "-" : "";
  const abs = Math.abs(price);
  if (abs < 1e-8) return `${prefix}${abs.toExponential(3)}`;
  if (abs < 0.0001) {
    const parts = abs.toFixed(8).split(".");
    const dec = parts[1]!.replace(/0+$/, "");
    return `${prefix}${parts[0]}.${dec}`;
  }
  if (abs < 1)   return `${prefix}${abs.toFixed(4)}`;
  if (abs < 10)  return `${prefix}${abs.toFixed(3)}`;
  return `${prefix}${abs.toFixed(2)}`;
}

/** 确定性 hash，用于把 symbol 稳定映射到伪装标签（不随机，保证同一资产标签一致） */
function symbolHash(str: string): number {
  let h = 0;
  for (const c of str) { h = (h * 31 + c.charCodeAt(0)) & 0xffff; }
  return h;
}

function camoLabel(item: MarketItem): string {
  return CAMO_LABELS[symbolHash(item.id ?? item.symbol) % CAMO_LABELS.length];
}

function camoBranch(item: MarketItem): string {
  return CAMO_BRANCHES[symbolHash(item.symbol) % CAMO_BRANCHES.length];
}

// ────────────────────────────────────────────────────────────────
//  StatusBar 主类
// ────────────────────────────────────────────────────────────────

export interface StatusBarOptions {
  maskMode: boolean;
  colorNeutral: boolean;
  colorScheme?: "greenUpRedDown" | "redUpGreenDown";
}

export class StatusBar implements vscode.Disposable {
  private readonly barItem: vscode.StatusBarItem;
  private readonly holdingBarItem: vscode.StatusBarItem;

  // 行情数据
  private quotes: MarketItem[] = [];

  // 持仓数据
  private holdings: HoldingItemQuote[] = [];
  private holdingEnabled = true;
  private holdingInterval = 3;
  private holdingIndex = 0;
  // 持仓总账（跨币种统一折算，由 scheduler 经单一计算出口推送）
  private portfolioSummary: PortfolioSummary | undefined;
  private holdingTimer: ReturnType<typeof setInterval> | undefined;
  /** 当前定时器采用的轮播间隔；间隔变化时必须重建，否则用户调整间隔不生效 */
  private holdingTimerInterval: number | undefined;

  // 状态开关
  private maskMode: boolean;
  private colorNeutral: boolean;
  private colorScheme: "greenUpRedDown" | "redUpGreenDown";
  private bossKeyActive = false;
  private compactMode = false;
  private lastFetchTimestamp: number | undefined;

  // 网络退避状态（用于状态栏 Tooltip 提示）
  private networkBackoffFailures = 0;
  private networkBackoffSeconds = 0;

  // 轮播
  private carouselIndex = 0;
  private carouselTimer: ReturnType<typeof setInterval> | undefined;
  private static readonly CAROUSEL_INTERVAL = 3000;
  private static readonly INLINE_MAX = 3; // ≤3 个时全部显示，>3 时轮播

  // ── 构造 ────────────────────────────────────────────────────────

  constructor(options: StatusBarOptions) {
    this.maskMode    = options.maskMode;
    this.colorNeutral = options.colorNeutral;
    this.colorScheme  = options.colorScheme || "greenUpRedDown";

    // 1. 行情条 (priority 100)
    this.barItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.barItem.command = "marketlens.refresh";
    this.barItem.text    = "$(graph-line) MarketLens…";
    this.barItem.show();

    // 2. 持仓盈亏独立轮播条 (priority 99，自然排列在行情条右侧)
    this.holdingBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      99
    );
    this.holdingBarItem.command = "marketlens.openSettings";
    this.holdingBarItem.text    = "";
  }

  // ── 公共 API ────────────────────────────────────────────────────

  /** 同步后台网络退避状态到状态栏悬停提示 */
  setNetworkBackoff(consecutiveFailures: number, nextRetrySeconds: number = 0): void {
    const nextFailures = Math.max(0, consecutiveFailures);
    const nextSec = Math.max(0, nextRetrySeconds);
    if (this.networkBackoffFailures === nextFailures && this.networkBackoffSeconds === nextSec) {
      return;
    }
    this.networkBackoffFailures = nextFailures;
    this.networkBackoffSeconds = nextSec;
    if (!this.bossKeyActive && this.quotes.length > 0 && !this.flashAlertTimer) {
      this.render();
    }
  }

  /** 更新全量行情数据，触发显示刷新 */
  setQuotes(quotes: MarketItem[]): void {
    const prevCount = this.quotes.length;
    this.quotes = quotes;
    if (this.quotes.length > 0) {
      this.lastFetchTimestamp = Date.now();
    }
    if (this.quotes.length === 0) {
      this.carouselIndex = 0;
      this.stopCarousel();
      this.barItem.text = "";
      this.barItem.tooltip = undefined;
      this.barItem.hide();
      return;
    }
    // 当标的总数发生变动时（例如板块开关开启或关闭），重置轮播索引为 0，使 UI 即时从第一条开始呈现新总数
    if (prevCount !== this.quotes.length || this.carouselIndex >= this.quotes.length) {
      this.carouselIndex = 0;
    }
    if (this.bossKeyActive) {
      return;
    }
    this.restartCarousel();
    this.render();
  }

  /** 更新全量持仓数据与持仓状态栏配置，触发持仓盈亏条目刷新 */
  setHoldings(
    holdings: HoldingItemQuote[],
    enabled: boolean = true,
    intervalSeconds: number = 3
  ): void {
    const prevCount = this.holdings.length;
    this.holdings = holdings;
    this.holdingEnabled = enabled;
    this.holdingInterval = Number.isFinite(intervalSeconds)
      ? Math.min(60, Math.max(1, Math.round(intervalSeconds)))
      : 3;

    if (!this.hasHoldingContent() || !this.holdingEnabled || this.displayMasked) {
      this.holdingIndex = 0;
      this.stopHoldingCarousel();
      this.holdingBarItem.text = "";
      this.holdingBarItem.tooltip = undefined;
      this.holdingBarItem.hide();
      return;
    }

    if (this.holdings.length === 0) {
      // 轮播子集为空但全量总账非空：只保留第 0 帧，不启动定时器，也不能 hide
      this.holdingIndex = 0;
      this.stopHoldingCarousel();
      this.renderHolding();
      return;
    }

    const totalFrames = this.holdings.length + 1;
    if (prevCount !== this.holdings.length || this.holdingIndex >= totalFrames) {
      this.holdingIndex = 0;
    }

    this.restartHoldingCarousel();
    this.renderHolding();
  }

  /**
   * 是否存在可独立展示的第 0 帧「统一折算总账」。
   *
   * 总账取数口径（forPortfolio）与持仓轮播口径不同：前者忽略板块 statusBar 开关与
   * 休市折叠，只看板块 enabled。因此「轮播标的为 0、总账非空」是合法且常见的状态
   * （如关掉 A 股轮播、周末休市），此时第 0 帧仍必须显示，否则三入口缺一。
   */
  private hasPortfolioFrame(): boolean {
    return !!this.portfolioSummary && this.portfolioSummary.total.count > 0;
  }

  /** 持仓条是否有可展示内容（明细帧或总账第 0 帧） */
  private hasHoldingContent(): boolean {
    return this.holdings.length > 0 || this.hasPortfolioFrame();
  }

  /**
   * 更新持仓总账（跨币种统一折算）。scheduler 每轮刷新后推送；
   * summary 为 undefined 表示清空（如全部持仓移除）。
   */
  setPortfolioSummary(summary: PortfolioSummary | undefined): void {
    this.portfolioSummary = summary;
    if (this.holdingIndex === 0) {
      this.renderHolding();
    }
  }

  /** 显示状态栏 */
  show(): void {
    if (!this.bossKeyActive && this.quotes.length > 0) {
      this.barItem.show();
      this.render();
    } else if (this.quotes.length === 0) {
      this.barItem.text = "";
      this.barItem.hide();
    }
    if (this.holdingEnabled && !this.displayMasked && this.hasHoldingContent()) {
      this.restartHoldingCarousel();
      this.renderHolding();
    }
  }

  /** 隐藏状态栏 */
  hide(): void {
    this.barItem.hide();
    this.stopHoldingCarousel();
    this.holdingBarItem.hide();
  }

  /** 切换伪装模式 */
  setMaskMode(enabled: boolean): void {
    this.maskMode = enabled;
    // 这里是 maskMode 的唯一写入口（命令 / 设置面板 / 配置变更最终都落到这里）：
    // 脱敏激活时必须同步收掉已打开的总账 HUD，否则真实财务数据会残留在屏幕上。
    if (this.maskMode) closePortfolioHud();
    this.render();
    if (this.maskMode) {
      // 模式 B：摸鱼伪装模式下一票否决彻底隐藏持仓盈亏状态栏条目
      this.stopHoldingCarousel();
      this.holdingBarItem.text = "";
      this.holdingBarItem.tooltip = undefined;
      this.holdingBarItem.hide();
    } else {
      if (this.holdingEnabled && !this.displayMasked && this.hasHoldingContent()) {
        this.restartHoldingCarousel();
        this.renderHolding();
      }
    }
  }

  /** 切换状态栏紧凑模式（省略价格，仅显示 名称+涨跌幅） */
  setCompact(enabled: boolean): void {
    this.compactMode = !!enabled;
    this.render();
  }

  /** 切换颜色脱敏模式（纯白/无红绿） */
  setColorNeutral(enabled: boolean): void {
    this.colorNeutral = enabled;
    this.render();
    if (!this.displayMasked && this.holdings.length > 0) {
      this.renderHolding();
    }
  }

  /** 切换涨跌配色方案（绿涨红跌 / 红涨绿跌） */
  setColorScheme(scheme: "greenUpRedDown" | "redUpGreenDown"): void {
    this.colorScheme = scheme || "greenUpRedDown";
    this.render();
    if (!this.displayMasked && this.holdings.length > 0) {
      this.renderHolding();
    }
  }

  /**
   * 老板键：按下后立即隐藏状态栏所有市场信息；再次按下恢复。
   * @param forceState 可选强制设置状态（true 为隐藏，false 为显示）
   */
  toggleBossKey(forceState?: boolean): boolean {
    this.bossKeyActive = forceState !== undefined ? forceState : !this.bossKeyActive;
    // 老板键一票否决所有真实数据展示：已打开的总账 HUD 必须同帧关闭。
    // 这里是 bossKeyActive 的唯一写入口，覆盖 Alt+M、设置面板自动退出等全部路径。
    if (this.bossKeyActive) {
      closePortfolioHud();
      MarketPanoramaWebviewPanel.closeIfVisible();
    }
    if (this.bossKeyActive) {
      this.stopCarousel();
      this.stopHoldingCarousel();
      this.barItem.text = "";
      this.barItem.tooltip = "";
      this.barItem.hide();
      this.holdingBarItem.text = "";
      this.holdingBarItem.tooltip = undefined;
      this.holdingBarItem.hide();
    } else {
      this.barItem.show();
      this.restartCarousel();
      this.render();
      if (this.holdingEnabled && !this.displayMasked && this.hasHoldingContent()) {
        this.restartHoldingCarousel();
        this.renderHolding();
      }
    }
    return this.bossKeyActive;
  }

  isHoldingCarouselRunning(): boolean {
    return this.holdingTimer !== undefined;
  }

  isBossKeyActive(): boolean {
    return this.bossKeyActive;
  }

  /** 简洁展示模式（伪装摸鱼）是否处于开启状态，供脱敏状态快照来源读取 */
  isMaskModeActive(): boolean {
    return this.maskMode;
  }

  /**
   * 当前是否处于「可见面必须脱敏」状态（老板键或简洁展示模式任一激活）。
   *
   * 状态栏内部的持仓轮播/渲染守卫必须走 maskState 的共享谓词：
   * 各处手写 `bossKeyActive || maskMode` 等价条件，一旦脱敏来源增加就必然漏项（§5.4）。
   */
  private get displayMasked(): boolean {
    return isDisplayMasked(this.bossKeyActive, this.maskMode);
  }

  /** 检查轮播定时器是否处于活跃运行状态（供单元测试和状态检查使用） */
  isCarouselRunning(): boolean {
    return this.carouselTimer !== undefined;
  }

  // ── 轮播 ────────────────────────────────────────────────────────

  private restartCarousel(): void {
    if (this.bossKeyActive) {
      this.stopCarousel();
      return;
    }
    if (this.quotes.length > StatusBar.INLINE_MAX) {
      if (!this.carouselTimer) {
        this.carouselTimer = setInterval(() => {
          this.carouselIndex =
            (this.carouselIndex + 1) % this.quotes.length;
          this.render();
        }, StatusBar.CAROUSEL_INTERVAL);
      }
    } else {
      this.stopCarousel();
    }
  }

  private stopCarousel(): void {
    if (this.carouselTimer !== undefined) {
      clearInterval(this.carouselTimer);
      this.carouselTimer = undefined;
    }
  }

  // ── 渲染 ────────────────────────────────────────────────────────

  private render(): void {
    if (this.bossKeyActive || this.quotes.length === 0) {
      this.barItem.text = "";
      this.barItem.tooltip = undefined;
      this.barItem.hide();
      return;
    }

    // 决定要显示哪些条目
    let visible: MarketItem[];
    const needCarousel = this.quotes.length > StatusBar.INLINE_MAX;
    if (needCarousel) {
      visible = [this.quotes[this.carouselIndex]]; // 轮播模式：一次显示 1 条
    } else {
      visible = this.quotes;                        // 内联模式：全部显示
    }

    if (this.maskMode) {
      this.renderCamouflage(visible, needCarousel);
    } else {
      this.renderNormal(visible, needCarousel);
    }
  }

  /** 正常模式：显示真实名称、价格与涨跌幅 */
  private renderNormal(visible: MarketItem[], carousel: boolean): void {
    const parts = visible.map((q) => {
      const displayName = q.alias || q.name;
      const sign   = q.changePercent >= 0 ? "+" : "";
      const arrow  = q.changePercent >= 0 ? "▲" : "▼";
      if (this.compactMode) {
        return `${displayName} ${arrow}${sign}${q.changePercent.toFixed(2)}%`;
      }
      const price  = toDisplayPrice(q.price);
      return `${displayName} ${price} ${arrow}${sign}${q.changePercent.toFixed(2)}%`;
    });

    const suffix = carousel
      ? ` (${this.carouselIndex + 1}/${this.quotes.length})`
      : "";

    this.barItem.text = `$(graph-line) ${parts.join("  |  ")}${suffix}`;

    let tip = "MarketLens — 点击立即刷新";
    if (this.lastFetchTimestamp) {
      const timeStr = new Date(this.lastFetchTimestamp).toLocaleTimeString("zh-CN", { hour12: false });
      tip += `\n🕒 最后刷新: ${timeStr}`;
    }
    const proxyStatus = getProxyStatus();
    if (proxyStatus.inCooldown) {
      tip += `\n⚠️ 代理不可达 (冷却中 ${proxyStatus.cooldownRemainingSeconds}s)`;
    } else if (proxyStatus.activePort) {
      tip += `\n🌐 本地代理: 已连接 (127.0.0.1)`;
    } else if (proxyStatus.isGatewayProxy) {
      tip += `\n🌐 网关代理: 软路由/透明代理已生效`;
    }
    if (this.networkBackoffFailures >= 2) {
      const retryHint = this.networkBackoffSeconds > 0 ? `，${this.networkBackoffSeconds}s 后重试` : "";
      tip += `\n⚠️ 行情连接异常，已进入退避重试 (连续失败 ${this.networkBackoffFailures} 次${retryHint})`;
    }
    this.barItem.tooltip = tip;
    this.applyColor(visible[0]);
  }

  /**
   * 伪装模式：把价格、名称全部替换为 git/build 风格文本。
   * 示例：git:(main) build: 79.6k | dep: 2.5k  [1/5]
   */
  private renderCamouflage(visible: MarketItem[], carousel: boolean): void {
    const branch = camoBranch(visible[0]);
    const parts  = visible.map((q) => `${camoLabel(q)}: ${toCamoPrice(q.price)}`);
    const countPart = carousel
      ? ` [${this.carouselIndex + 1}/${this.quotes.length}]`
      : "";
    this.barItem.text = `$(git-branch) ${branch}${countPart}  ${parts.join("  |  ")}`;
    // 伪装态下 tooltip 必须一并收敛：文本已伪装成 git 分支，若 tooltip 仍写「MarketLens」
    // 则鼠标悬停即自曝，伪装防线形同虚设（AGENTS.md §5.4）。
    this.barItem.tooltip = undefined;
    // 伪装模式下强制无色
    this.barItem.backgroundColor = undefined;
    this.barItem.color = undefined;
  }

  /**
   * 应用涨跌颜色
   * - colorNeutral 开启时：强制无色（白色/主题默认色），不刺眼
   * - 正常时：
   *   - greenUpRedDown (默认，国际习惯)：下跌使用状态栏红色背景，上涨恢复默认
   *   - redUpGreenDown (国内习惯)：上涨使用状态栏红色背景，下跌恢复默认
   */
  private applyColor(quote: MarketItem | undefined): void {
    if (!quote || this.colorNeutral) {
      this.barItem.backgroundColor = undefined;
      this.barItem.color = undefined;
      return;
    }
    const isRedUp = this.colorScheme === "redUpGreenDown";
    const isRed = isRedUp ? quote.changePercent > 0.01 : quote.changePercent < -0.01;
    if (isRed) {
      this.barItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.errorBackground"
      );
    } else {
      this.barItem.backgroundColor = undefined;
    }
    this.barItem.color = undefined;
  }

  private flashAlertTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * 临时高亮展示预警信息，并在指定时长后恢复日常轮播
   */
  flashAlert(text: string, durationMs: number = 15000): void {
    // 简洁展示模式 / 老板键激活期间：预警闪光会顶掉伪装文本并暴露真实行情，必须静默拒绝。
    if (this.displayMasked) {
      return;
    }
    if (this.flashAlertTimer !== undefined) {
      clearTimeout(this.flashAlertTimer);
      this.flashAlertTimer = undefined;
    }

    this.stopCarousel();
    this.barItem.text = text;
    this.barItem.show();

    this.flashAlertTimer = setTimeout(() => {
      this.flashAlertTimer = undefined;
      this.restartCarousel();
      this.render();
    }, durationMs);
  }

  // ── 持仓轮播与渲染 ──────────────────────────────────────────────

  /**
   * 按币种聚合持仓——委托 `portfolio.ts` 的共享出口（AGENTS.md §5.5 禁止两处累加逻辑）。
   * 持仓条第 0 帧概览与持仓看板 Tooltip 共用本方法。
   */
  private aggregateHoldings(): Array<[string, HoldingCurrencyBucket]> {
    return Array.from(aggregateHoldingsByCurrency(this.holdings).entries());
  }

  private restartHoldingCarousel(): void {
    if (this.displayMasked || !this.holdingEnabled || this.holdings.length === 0) {
      this.stopHoldingCarousel();
      return;
    }
    // 每轮行情刷新都会走 setHoldings() → 本方法。旧实现无条件重建定时器，计时基准每次归零：
    // refreshInterval < holdingInterval 时定时器永远来不及触发，持仓条冻结在第 0 帧；
    // 即便前者更大，实际轮播周期也被拉成刷新间隔而非用户设定值。与行情轮播
    // restartCarousel() 一致：只在定时器缺失或间隔变化时重建。
    if (this.holdingTimer !== undefined && this.holdingTimerInterval === this.holdingInterval) {
      return;
    }
    this.stopHoldingCarousel();
    if (this.holdings.length + 1 > 1) {
      this.holdingTimerInterval = this.holdingInterval;
      this.holdingTimer = setInterval(() => {
        // 帧数动态取当前持仓数：持仓增减后无需重建定时器，闭包也不会残留旧 totalFrames
        const frames = this.holdings.length + 1;
        this.holdingIndex = frames > 0 ? (this.holdingIndex + 1) % frames : 0;
        this.renderHolding();
      }, this.holdingInterval * 1000);
    }
  }

  private stopHoldingCarousel(): void {
    if (this.holdingTimer !== undefined) {
      clearInterval(this.holdingTimer);
      this.holdingTimer = undefined;
    }
    this.holdingTimerInterval = undefined;
  }

  private renderHolding(): void {
    if (this.displayMasked || !this.holdingEnabled || !this.hasHoldingContent()) {
      this.holdingBarItem.text = "";
      this.holdingBarItem.tooltip = undefined;
      this.holdingBarItem.hide();
      return;
    }

    this.holdingBarItem.show();

    if (this.holdingIndex === 0) {
      // ── 第 0 帧：全账户总持仓概览（优先统一折算总账，无总账时回退原生币种格式） ──
      if (this.portfolioSummary && this.portfolioSummary.total.count > 0) {
        const sum = this.portfolioSummary;
        const bSym = sum.base === "CNY" ? "¥" : "$";
        const mFmt = formatPortfolioAmount(sum.total.marketVal);
        const todayRate = deriveTodayProfitRate(sum.total);
        const rSign = sum.total.todayProfit >= 0 ? "+" : "-";
        // 第 0 帧升级为总账后仍保留今日盈亏金额；紧凑模式下让位给宽度
        const todayAmount = this.compactMode
          ? ""
          : ` ｜ 今日 ${rSign}${bSym}${formatPortfolioAmount(sum.total.todayProfit)}`;
        this.holdingBarItem.text = `$(briefcase) 总资产: ${bSym}${mFmt} (${rSign}${Math.abs(todayRate).toFixed(2)}%)${todayAmount}`;
        this.applyHoldingColor(sum.total.todayProfit > 0, Math.abs(sum.total.todayProfit) < 0.01);
        this.holdingBarItem.tooltip = this._buildHoldingBarTooltip();
        return;
      }

      const entries = this.aggregateHoldings().sort((a, b) => b[1].count - a[1].count);
      if (entries.length === 0) {
        // 理论上只在「总账被清空但 holdings 尚未同步」的瞬态出现，保持不渲染脏帧
        this.holdingBarItem.text = "";
        this.holdingBarItem.tooltip = undefined;
        this.holdingBarItem.hide();
        return;
      }
      const [primaryCur, primaryData] = entries[0];
      const pSym = currencyPrefix(primaryCur);
      const pSuf = currencySuffix(primaryCur);
      const tSign = primaryData.todayProfit >= 0 ? "+" : "-";
      const fSign = primaryData.totalProfit >= 0 ? "+" : "-";
      const tFmt = formatPortfolioAmount(primaryData.todayProfit);
      const fFmt = formatPortfolioAmount(primaryData.totalProfit);

      let text = `$(briefcase) 今日: ${tSign}${pSym}${tFmt}${pSuf} ｜ 浮盈: ${fSign}${pSym}${fFmt}${pSuf}`;
      if (entries.length > 1) {
        const extras = entries.slice(1).map(([c, d]) => {
          const s = currencyPrefix(c);
          const suf = currencySuffix(c);
          const sign = d.totalProfit >= 0 ? "+" : "-";
          return `${sign}${s}${formatPortfolioAmount(d.totalProfit)}${suf}`;
        });
        text += ` (${extras.join(", ")})`;
      }

      this.holdingBarItem.text = text;
      this.applyHoldingColor(primaryData.totalProfit > 0, Math.abs(primaryData.totalProfit) < 0.01);
    } else {
      // ── 第 1..N 帧：按次序轮播已持仓的具体标的 ──
      const h = this.holdings[this.holdingIndex - 1];
      if (!h) {
        this.holdingIndex = 0;
        this.renderHolding();
        return;
      }
      const curSym = currencyPrefix(h.currency);
      const curSuf = currencySuffix(h.currency);
      const profit = (h.price - h.cost) * h.shares;
      const profitRate = ((h.price - h.cost) / h.cost) * 100;
      const pSign = profit >= 0 ? "+" : "-";
      const rSign = profitRate >= 0 ? "+" : "-";
      const pFmt = formatPortfolioAmount(profit);
      const rFmt = Math.abs(profitRate).toFixed(2);

      this.holdingBarItem.text = `$(briefcase) ${h.name}: ${pSign}${curSym}${pFmt}${curSuf} (${rSign}${rFmt}%) [${this.holdingIndex}/${this.holdings.length}]`;
      this.applyHoldingColor(profit > 0, Math.abs(profit) < 0.01);
    }

    this.holdingBarItem.tooltip = this._buildHoldingBarTooltip();
  }

  private _buildHoldingBarTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = false;
    md.supportHtml = false;

    const entries = this.aggregateHoldings();

    md.appendMarkdown(`### 💼 持仓盈亏独立对账看板\n\n`);
    if (entries.length === 0) {
      md.appendMarkdown(`_当前没有标的参与状态栏轮播（板块轮播开关或休市折叠已过滤），本看板与下方明细为空。_\n\n`);
    } else if (entries.length === 1) {
      const [cur, d] = entries[0];
      const s = currencyPrefix(cur);
      const suf = currencySuffix(cur);
      const tSign = d.todayProfit >= 0 ? "+" : "-";
      const fSign = d.totalProfit >= 0 ? "+" : "-";
      const tFmt = formatPortfolioAmount(d.todayProfit);
      const fFmt = formatPortfolioAmount(d.totalProfit);
      const mFmt = formatPortfolioAmount(d.marketVal);
      const cFmt = formatPortfolioAmount(d.costVal);
      const totalRate = deriveTotalProfitRate(d);
      const rSign = totalRate >= 0 ? "+" : "-";

      md.appendMarkdown(`| 统计指标 | 数值表现 |\n| :--- | :--- |\n`);
      md.appendMarkdown(`| **今日总盈亏** | **${tSign}${s}${tFmt}${suf}** |\n`);
      md.appendMarkdown(`| **累计总浮盈** | **${fSign}${s}${fFmt}${suf} (${rSign}${Math.abs(totalRate).toFixed(2)}%)** |\n`);
      md.appendMarkdown(`| **持仓总市值** | ${s}${mFmt}${suf} |\n`);
      md.appendMarkdown(`| **持仓总本金** | ${s}${cFmt}${suf} |\n\n`);
    } else {
      md.appendMarkdown(`| 币种 | 今日盈亏 | 累计浮盈 | 当前市值 | 持仓本金 |\n| :--- | :--- | :--- | :--- | :--- |\n`);
      for (const [cur, d] of entries) {
        const s = currencyPrefix(cur);
        const suf = currencySuffix(cur);
        const tSign = d.todayProfit >= 0 ? "+" : "-";
        const fSign = d.totalProfit >= 0 ? "+" : "-";
        const tFmt = formatPortfolioAmount(d.todayProfit);
        const fFmt = formatPortfolioAmount(d.totalProfit);
        const mFmt = formatPortfolioAmount(d.marketVal);
        const cFmt = formatPortfolioAmount(d.costVal);
        const label =
          cur === "CNY" ? "人民币 (¥)" :
          cur === "HKD" ? "港币 (HK$)" :
          cur === "USDT" ? "U 本位 (USDT $)" :
          cur === "BTC" ? "BTC 本位 (BTC)" :
          cur === "ETH" ? "ETH 本位 (ETH)" : "美元 ($)";
        md.appendMarkdown(`| **${label}** | ${tSign}${s}${tFmt}${suf} | ${fSign}${s}${fFmt}${suf} | ${s}${mFmt}${suf} | ${s}${cFmt}${suf} |\n`);
      }
      md.appendMarkdown(`\n`);
    }

    // 统一折算总账（跨币种合并为基准货币）
    if (this.portfolioSummary && this.portfolioSummary.total.count > 0) {
      const sum = this.portfolioSummary;
      const s = sum.base === "CNY" ? "¥" : "$";
      const baseLabel = sum.base === "CNY" ? "人民币 (¥)" : "美元 ($)";
      const tSign = sum.total.todayProfit >= 0 ? "+" : "-";
      const fSign = sum.total.totalProfit >= 0 ? "+" : "-";
      const totalRate = deriveTotalProfitRate(sum.total);
      const rSign = totalRate >= 0 ? "+" : "-";
      md.appendMarkdown(`**🌐 统一折算总账（基准 ${baseLabel}）**\n\n`);
      md.appendMarkdown(`| 总市值 | 今日盈亏 | 累计浮盈 |\n| :--- | :--- | :--- |\n`);
      md.appendMarkdown(`| ${s}${formatPortfolioAmount(sum.total.marketVal)} | ${tSign}${s}${formatPortfolioAmount(sum.total.todayProfit)} | ${fSign}${s}${formatPortfolioAmount(sum.total.totalProfit)} (${rSign}${Math.abs(totalRate).toFixed(2)}%) |\n\n`);
      md.appendMarkdown(`> 汇率：${formatFxSourceNote(sum.fx)}（${formatFxDetailNote(sum.fx)}）。\n\n`);
      md.appendMarkdown(`> 口径说明：上方总账为**全量持仓**（忽略板块状态栏开关与休市折叠），下方对账看板与明细仅含**当前参与状态栏轮播**的标的，两项标的数量可能不一致。\n\n`);
    }

    md.appendMarkdown(`---\n**持仓明细（状态栏轮播口径 · 共 ${this.holdings.length} 只标的，当前轮播: ${this.holdingIndex === 0 ? "总览" : `${this.holdingIndex}/${this.holdings.length}`}）**：\n\n`);
    for (let i = 0; i < this.holdings.length; i++) {
      const h = this.holdings[i];
      const s = currencyPrefix(h.currency);
      const suf = currencySuffix(h.currency);
      const profit = (h.price - h.cost) * h.shares;
      const profitRate = ((h.price - h.cost) / h.cost) * 100;
      const pSign = profit >= 0 ? "+" : "-";
      const rSign = profitRate >= 0 ? "+" : "-";
      const pFmt = formatPortfolioAmount(profit);
      const rFmt = Math.abs(profitRate).toFixed(2);
      const currentIndicator = this.holdingIndex === i + 1 ? " 👈" : "";
      md.appendMarkdown(`- **${escapeMarkdownInline(h.name)}** (${toMarkdownCodeSpan(h.symbol)}): 成本 ${s}${toDisplayPrice(h.cost)}${suf} ｜ 现价 ${s}${toDisplayPrice(h.price)}${suf} ｜ 浮盈: **${pSign}${s}${pFmt}${suf} (${rSign}${rFmt}%)**${currentIndicator}\n`);
    }

    md.appendMarkdown(`\n_点击打开「通用与全局设置」调整持仓轮播开关与间隔 (当前 ${this.holdingInterval}s)_`);
    return md;
  }

  private applyHoldingColor(isProfit: boolean, isZero: boolean): void {
    if (isZero || this.colorNeutral) {
      this.holdingBarItem.backgroundColor = undefined;
      this.holdingBarItem.color = undefined;
      return;
    }
    const isRedUp = this.colorScheme === "redUpGreenDown";
    const isRed = isRedUp ? isProfit : !isProfit;
    if (isRed) {
      this.holdingBarItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.errorBackground"
      );
    } else {
      this.holdingBarItem.backgroundColor = undefined;
    }
    this.holdingBarItem.color = undefined;
  }

  // ── 释放 ────────────────────────────────────────────────────────

  dispose(): void {
    this.stopCarousel();
    this.stopHoldingCarousel();
    closePortfolioHud();
    MarketPanoramaWebviewPanel.closeIfVisible();
    if (this.flashAlertTimer !== undefined) {
      clearTimeout(this.flashAlertTimer);
      this.flashAlertTimer = undefined;
    }
    this.barItem.dispose();
    this.holdingBarItem.dispose();
  }
}