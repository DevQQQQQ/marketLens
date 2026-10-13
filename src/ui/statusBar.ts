// src/ui/statusBar.ts
// 极致摸鱼状态栏：伪装模式 / 老板键 / 颜色脱敏 / 轮播展示

import * as vscode from "vscode";
import type { MarketItem } from "../types/index.ts";
import { getProxyStatus } from "../services/network.ts";

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

/** 把实际价格格式化用于正常显示 */
function toDisplayPrice(price: number): string {
  if (price === 0) return "0.00";
  if (price < 0.0001) return price.toExponential(3);
  if (price < 1)   return price.toFixed(4);
  if (price < 10)  return price.toFixed(3);
  return price.toFixed(2);
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

  // 数据
  private quotes: MarketItem[] = [];

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

    this.barItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.barItem.command = "marketlens.refresh";
    this.barItem.text    = "$(graph-line) MarketLens…";
    this.barItem.show();
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

  /** 显示状态栏 */
  show(): void {
    if (!this.bossKeyActive && this.quotes.length > 0) {
      this.barItem.show();
      this.render();
    } else if (this.quotes.length === 0) {
      this.barItem.text = "";
      this.barItem.hide();
    }
  }

  /** 隐藏状态栏 */
  hide(): void {
    this.barItem.hide();
  }

  /** 切换伪装模式 */
  setMaskMode(enabled: boolean): void {
    this.maskMode = enabled;
    this.render();
  }

  /** 切换颜色脱敏模式（纯白/无红绿） */
  setColorNeutral(enabled: boolean): void {
    this.colorNeutral = enabled;
    this.render();
  }

  /** 切换涨跌配色方案（绿涨红跌 / 红涨绿跌） */
  setColorScheme(scheme: "greenUpRedDown" | "redUpGreenDown"): void {
    this.colorScheme = scheme || "greenUpRedDown";
    this.render();
  }

  /**
   * 老板键：按下后立即隐藏状态栏所有市场信息；再次按下恢复。
   * @param forceState 可选强制设置状态（true 为隐藏，false 为显示）
   */
  toggleBossKey(forceState?: boolean): boolean {
    this.bossKeyActive = forceState !== undefined ? forceState : !this.bossKeyActive;
    if (this.bossKeyActive) {
      this.stopCarousel();
      this.barItem.text = "";
      this.barItem.tooltip = "";
      this.barItem.hide();
    } else {
      this.barItem.show();
      this.restartCarousel();
      this.render();
    }
    return this.bossKeyActive;
  }

  isBossKeyActive(): boolean {
    return this.bossKeyActive;
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
    this.barItem.tooltip = "MarketLens — 点击立即刷新";
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
    if (this.bossKeyActive || this.maskMode) {
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

  // ── 释放 ────────────────────────────────────────────────────────

  dispose(): void {
    this.stopCarousel();
    if (this.flashAlertTimer !== undefined) {
      clearTimeout(this.flashAlertTimer);
      this.flashAlertTimer = undefined;
    }
    this.barItem.dispose();
  }
}