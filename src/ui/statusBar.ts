// src/ui/statusBar.ts
// 极致摸鱼状态栏：伪装模式 / 老板键 / 颜色脱敏 / 轮播展示

import * as vscode from "vscode";
import type { MarketItem } from "../types/index.ts";
import { getProxyStatus } from "../services/network.ts";
import { escapeMarkdownInline, toMarkdownCodeSpan, deriveTodayProfit, type HoldingItemQuote } from "../utils/symbolHelper.ts";
import { isDisplayMasked } from "../utils/maskState.ts";

// ────────────────────────────────────────────────────────────────
//  常量与工具函数
// ────────────────────────────────────────────────────────────────

/** 单一币种的持仓聚合桶 */
interface HoldingCurrencyBucket {
  todayProfit: number;
  totalProfit: number;
  count: number;
  marketVal: number;
  costVal: number;
}

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

/** 把实际价格格式化用于正常显示 */
function toDisplayPrice(price: number): string {
  if (price === 0) return "0.00";
  if (price < 0.0001) return price.toExponential(3);
  if (price < 1)   return price.toFixed(4);
  if (price < 10)  return price.toFixed(3);
  return price.toFixed(2);
}

/** 格式化持仓盈亏数字（支持亿、万单位简写与千分位） */
function formatHoldingProfit(val: number): string {
  const abs = Math.abs(val);
  if (abs >= 1e8) {
    return `${(abs / 1e8).toFixed(2)}亿`;
  }
  if (abs >= 1e4) {
    return `${(abs / 1e4).toFixed(2)}万`;
  }
  if (abs < 0.01 && abs > 0) {
    return abs.toFixed(4);
  }
  return abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  private holdingTimer: ReturnType<typeof setInterval> | undefined;

  // 状态开关
  private maskMode: boolean;
  private colorNeutral: boolean;
  private colorScheme: "greenUpRedDown" | "redUpGreenDown";
  private bossKeyActive = false;

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

    if (this.holdings.length === 0 || !this.holdingEnabled || this.displayMasked) {
      this.holdingIndex = 0;
      this.stopHoldingCarousel();
      this.holdingBarItem.text = "";
      this.holdingBarItem.tooltip = undefined;
      this.holdingBarItem.hide();
      return;
    }

    const totalFrames = this.holdings.length + 1;
    if (prevCount !== this.holdings.length || this.holdingIndex >= totalFrames) {
      this.holdingIndex = 0;
    }

    this.restartHoldingCarousel();
    this.renderHolding();
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
    if (this.holdingEnabled && !this.displayMasked && this.holdings.length > 0) {
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
    this.render();
    if (this.maskMode) {
      // 模式 B：摸鱼伪装模式下一票否决彻底隐藏持仓盈亏状态栏条目
      this.stopHoldingCarousel();
      this.holdingBarItem.text = "";
      this.holdingBarItem.tooltip = undefined;
      this.holdingBarItem.hide();
    } else {
      if (this.holdingEnabled && !this.displayMasked && this.holdings.length > 0) {
        this.restartHoldingCarousel();
        this.renderHolding();
      }
    }
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
      if (this.holdingEnabled && !this.displayMasked && this.holdings.length > 0) {
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
      const price  = toDisplayPrice(q.price);
      const sign   = q.changePercent >= 0 ? "+" : "";
      const arrow  = q.changePercent >= 0 ? "▲" : "▼";
      return `${q.name} ${price} ${arrow}${sign}${q.changePercent.toFixed(2)}%`;
    });

    const suffix = carousel
      ? ` (${this.carouselIndex + 1}/${this.quotes.length})`
      : "";

    this.barItem.text = `$(graph-line) ${parts.join("  |  ")}${suffix}`;

    let tip = "MarketLens — 点击立即刷新";
    const proxyStatus = getProxyStatus();
    if (proxyStatus.inCooldown) {
      tip += `\n⚠️ 代理不可达 (冷却中 ${proxyStatus.cooldownRemainingSeconds}s)`;
    } else if (proxyStatus.activePort) {
      tip += `\n🌐 本地代理: 已连接 (127.0.0.1)`;
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
   * 按币种聚合持仓（今日盈亏经 `deriveTodayProfit` 单一出口，AGENTS.md §5.5）。
   * 持仓条第 0 帧概览与持仓看板 Tooltip 共用本方法，禁止在两处各写一份累加逻辑。
   */
  private aggregateHoldings(): Array<[string, HoldingCurrencyBucket]> {
    const currencyMap: Record<string, HoldingCurrencyBucket> = {};
    for (const h of this.holdings) {
      const cur = h.currency || "CNY";
      if (!currencyMap[cur]) {
        currencyMap[cur] = { todayProfit: 0, totalProfit: 0, count: 0, marketVal: 0, costVal: 0 };
      }
      const data = currencyMap[cur];
      data.count++;
      data.costVal += h.cost * h.shares;
      data.marketVal += h.price * h.shares;
      data.totalProfit += (h.price - h.cost) * h.shares;
      data.todayProfit += deriveTodayProfit(h, h.shares);
    }
    return Object.entries(currencyMap);
  }

  private restartHoldingCarousel(): void {
    this.stopHoldingCarousel();
    if (this.displayMasked || !this.holdingEnabled || this.holdings.length === 0) {
      return;
    }
    const totalFrames = this.holdings.length + 1;
    if (totalFrames > 1) {
      this.holdingTimer = setInterval(() => {
        this.holdingIndex = (this.holdingIndex + 1) % totalFrames;
        this.renderHolding();
      }, this.holdingInterval * 1000);
    }
  }

  private stopHoldingCarousel(): void {
    if (this.holdingTimer !== undefined) {
      clearInterval(this.holdingTimer);
      this.holdingTimer = undefined;
    }
  }

  private renderHolding(): void {
    if (this.displayMasked || !this.holdingEnabled || this.holdings.length === 0) {
      this.holdingBarItem.text = "";
      this.holdingBarItem.tooltip = undefined;
      this.holdingBarItem.hide();
      return;
    }

    this.holdingBarItem.show();

    if (this.holdingIndex === 0) {
      // ── 第 0 帧：全账户总持仓概览 ──
      const entries = this.aggregateHoldings().sort((a, b) => b[1].count - a[1].count);
      const [primaryCur, primaryData] = entries[0];
      const pSym = primaryCur === "CNY" ? "¥" : primaryCur === "HKD" ? "HK$" : "$";
      const tSign = primaryData.todayProfit >= 0 ? "+" : "-";
      const fSign = primaryData.totalProfit >= 0 ? "+" : "-";
      const tFmt = formatHoldingProfit(primaryData.todayProfit);
      const fFmt = formatHoldingProfit(primaryData.totalProfit);

      let text = `$(briefcase) 今日: ${tSign}${pSym}${tFmt} ｜ 浮盈: ${fSign}${pSym}${fFmt}`;
      if (entries.length > 1) {
        const extras = entries.slice(1).map(([c, d]) => {
          const s = c === "CNY" ? "¥" : c === "HKD" ? "HK$" : "$";
          const sign = d.totalProfit >= 0 ? "+" : "-";
          return `${sign}${s}${formatHoldingProfit(d.totalProfit)}`;
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
      const curSym = h.currency === "CNY" ? "¥" : h.currency === "HKD" ? "HK$" : "$";
      const profit = (h.price - h.cost) * h.shares;
      const profitRate = ((h.price - h.cost) / h.cost) * 100;
      const pSign = profit >= 0 ? "+" : "-";
      const rSign = profitRate >= 0 ? "+" : "-";
      const pFmt = formatHoldingProfit(profit);
      const rFmt = Math.abs(profitRate).toFixed(2);

      this.holdingBarItem.text = `$(briefcase) ${h.name}: ${pSign}${curSym}${pFmt} (${rSign}${rFmt}%) [${this.holdingIndex}/${this.holdings.length}]`;
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
    if (entries.length === 1) {
      const [cur, d] = entries[0];
      const s = cur === "CNY" ? "¥" : cur === "HKD" ? "HK$" : "$";
      const tSign = d.todayProfit >= 0 ? "+" : "-";
      const fSign = d.totalProfit >= 0 ? "+" : "-";
      const tFmt = formatHoldingProfit(d.todayProfit);
      const fFmt = formatHoldingProfit(d.totalProfit);
      const mFmt = formatHoldingProfit(d.marketVal);
      const cFmt = formatHoldingProfit(d.costVal);
      const totalRate = d.costVal > 0 ? ((d.totalProfit / d.costVal) * 100) : 0;
      const rSign = totalRate >= 0 ? "+" : "-";

      md.appendMarkdown(`| 统计指标 | 数值表现 |\n| :--- | :--- |\n`);
      md.appendMarkdown(`| **今日总盈亏** | **${tSign}${s}${tFmt}** |\n`);
      md.appendMarkdown(`| **累计总浮盈** | **${fSign}${s}${fFmt} (${rSign}${Math.abs(totalRate).toFixed(2)}%)** |\n`);
      md.appendMarkdown(`| **持仓总市值** | ${s}${mFmt} |\n`);
      md.appendMarkdown(`| **持仓总本金** | ${s}${cFmt} |\n\n`);
    } else {
      md.appendMarkdown(`| 币种 | 今日盈亏 | 累计浮盈 | 当前市值 | 持仓本金 |\n| :--- | :--- | :--- | :--- | :--- |\n`);
      for (const [cur, d] of entries) {
        const s = cur === "CNY" ? "¥" : cur === "HKD" ? "HK$" : "$";
        const tSign = d.todayProfit >= 0 ? "+" : "-";
        const fSign = d.totalProfit >= 0 ? "+" : "-";
        const tFmt = formatHoldingProfit(d.todayProfit);
        const fFmt = formatHoldingProfit(d.totalProfit);
        const mFmt = formatHoldingProfit(d.marketVal);
        const cFmt = formatHoldingProfit(d.costVal);
        const label =
          cur === "CNY" ? "人民币 (¥)" :
          cur === "HKD" ? "港币 (HK$)" :
          cur === "USDT" ? "U 本位 (USDT $)" : "美元 ($)";
        md.appendMarkdown(`| **${label}** | ${tSign}${s}${tFmt} | ${fSign}${s}${fFmt} | ${s}${mFmt} | ${s}${cFmt} |\n`);
      }
      md.appendMarkdown(`\n`);
    }

    md.appendMarkdown(`---\n**持仓明细（共 ${this.holdings.length} 只标的，当前轮播: ${this.holdingIndex === 0 ? "总览" : `${this.holdingIndex}/${this.holdings.length}`}）**：\n\n`);
    for (let i = 0; i < this.holdings.length; i++) {
      const h = this.holdings[i];
      const s = h.currency === "CNY" ? "¥" : h.currency === "HKD" ? "HK$" : "$";
      const profit = (h.price - h.cost) * h.shares;
      const profitRate = ((h.price - h.cost) / h.cost) * 100;
      const pSign = profit >= 0 ? "+" : "-";
      const rSign = profitRate >= 0 ? "+" : "-";
      const pFmt = formatHoldingProfit(profit);
      const rFmt = Math.abs(profitRate).toFixed(2);
      const currentIndicator = this.holdingIndex === i + 1 ? " 👈" : "";
      md.appendMarkdown(`- **${escapeMarkdownInline(h.name)}** (${toMarkdownCodeSpan(h.symbol)}): 成本 ${s}${toDisplayPrice(h.cost)} ｜ 现价 ${s}${toDisplayPrice(h.price)} ｜ 浮盈: **${pSign}${s}${pFmt} (${rSign}${rFmt}%)**${currentIndicator}\n`);
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
    if (this.flashAlertTimer !== undefined) {
      clearTimeout(this.flashAlertTimer);
      this.flashAlertTimer = undefined;
    }
    this.barItem.dispose();
    this.holdingBarItem.dispose();
  }
}