// src/services/alertManager.ts
import * as vscode from "vscode";
import type { MarketItem, MarketLensConfig, PriceAlertItem } from "../types/index.ts";
import { normalizeSymbolKey, stripMarketPrefix } from "../utils/symbolHelper.ts";
import { isDisplayMasked } from "../utils/maskState.ts";
import { emitStatusMessage } from "../utils/feedback.ts";
import type { StatusBar } from "../ui/statusBar.ts";
import { readConfig } from "../utils/config.ts";

/** 默认预警冷却时间（分钟） */
export const DEFAULT_ALERT_COOLDOWN_MINUTES = 15;

function readConfigFallback(): Partial<MarketLensConfig> {
  try {
    return readConfig();
  } catch {
    return {
      alerts: {},
      alertNotificationMode: "notification",
      alertCooldownMinutes: DEFAULT_ALERT_COOLDOWN_MINUTES,
    };
  }
}

export interface AlertTriggerEvent {
  symbolKey: string;
  item: MarketItem;
  rule: PriceAlertItem;
  type: "above" | "below" | "changePercent";
  currentValue: number;
  thresholdValue: number;
}

export class AlertManager {
  private readonly cooldownMap = new Map<string, number>();
  // 构造参数可缺省（无状态栏场景），存入的真是 `undefined` 而非「键不存在」
  private readonly statusBar: StatusBar | undefined;

  constructor(statusBar?: StatusBar) {
    this.statusBar = statusBar;
  }

  /**
   * 手动对指定标的加设静音冷却。
   *
   * 存储口径唯一：值恒为**绝对到期时刻**。读取端一律用 `now >= expiry` 判定，
   * 不得改回「上次触发时刻」语义——两套口径混用会让静音实际时长变成配置值的两倍（§6.11）。
   */
  public mute(symbolKey: string, minutes: number = DEFAULT_ALERT_COOLDOWN_MINUTES): void {
    const normKey = normalizeSymbolKey(symbolKey) || symbolKey.toLowerCase();
    const expiry = Date.now() + minutes * 60 * 1000;
    this.cooldownMap.set(`${normKey}:above`, expiry);
    this.cooldownMap.set(`${normKey}:below`, expiry);
    this.cooldownMap.set(`${normKey}:changePercent`, expiry);
  }

  /** 只读探针：当前是否仍处于静音冷却期内（供回归用例观测到期自清理链路） */
  public isMuted(symbolKey: string, minutesSuffix: "above" | "below" | "changePercent" = "above"): boolean {
    const normKey = normalizeSymbolKey(symbolKey) || symbolKey.toLowerCase();
    const expiry = this.cooldownMap.get(`${normKey}:${minutesSuffix}`);
    return expiry !== undefined && Date.now() < expiry;
  }

  /**
   * 清空所有冷却记录（供测试和重置使用）
   */
  public resetCooldown(): void {
    this.cooldownMap.clear();
  }

  /**
   * 在行情拉取完成后，由调度器调用进行纯内存预警评估
   */
  public checkQuotes(quotes: MarketItem[], customConfig?: Partial<MarketLensConfig>): AlertTriggerEvent[] {
    if (!quotes || quotes.length === 0) {
      return [];
    }

    const config = customConfig || readConfigFallback();
    const alerts = config.alerts || {};
    if (Object.keys(alerts).length === 0) {
      return [];
    }

    // 老板键激活状态下一票否决：全量静音，杜绝弹窗与状态栏泄密
    if (this.statusBar?.isBossKeyActive()) {
      return [];
    }

    const cooldownMs = Math.max(1, config.alertCooldownMinutes || DEFAULT_ALERT_COOLDOWN_MINUTES) * 60 * 1000;
    const now = Date.now();
    const triggeredEvents: AlertTriggerEvent[] = [];

    for (const q of quotes) {
      if (!q || !q.symbol) continue;

      const normSym = normalizeSymbolKey(q.symbol);
      const normId  = q.id ? normalizeSymbolKey(q.id) : undefined;
      const rawTicker = stripMarketPrefix(q.symbol);

      // 多键尝试匹配预警规则
      const matchedKey =
        (normSym && alerts[normSym] ? normSym : undefined) ||
        (normId && alerts[normId] ? normId : undefined) ||
        (alerts[q.symbol] ? q.symbol : undefined) ||
        (alerts[q.symbol.toLowerCase()] ? q.symbol.toLowerCase() : undefined) ||
        (rawTicker && alerts[rawTicker] ? rawTicker : undefined);

      if (!matchedKey) continue;
      const rule = alerts[matchedKey];
      if (!rule || rule.enabled === false) continue;

      // 1. 检查突破上限
      if (rule.above !== undefined && Number.isFinite(rule.above) && q.price > 0 && q.price >= rule.above) {
        const cKey = `${matchedKey}:above`;
        const cooldownExpiry = this.cooldownMap.get(cKey) || 0;
        if (now >= cooldownExpiry) {
          this.cooldownMap.set(cKey, now + cooldownMs);
          triggeredEvents.push({
            symbolKey: matchedKey,
            item: q,
            rule,
            type: "above",
            currentValue: q.price,
            thresholdValue: rule.above,
          });
        }
      }

      // 2. 检查跌破下限
      if (rule.below !== undefined && Number.isFinite(rule.below) && q.price > 0 && q.price <= rule.below) {
        const cKey = `${matchedKey}:below`;
        const cooldownExpiry = this.cooldownMap.get(cKey) || 0;
        if (now >= cooldownExpiry) {
          this.cooldownMap.set(cKey, now + cooldownMs);
          triggeredEvents.push({
            symbolKey: matchedKey,
            item: q,
            rule,
            type: "below",
            currentValue: q.price,
            thresholdValue: rule.below,
          });
        }
      }

      // 3. 检查单日剧烈涨跌幅绝对值突破
      if (
        rule.changePercent !== undefined &&
        Number.isFinite(rule.changePercent) &&
        rule.changePercent > 0 &&
        Math.abs(q.changePercent) >= rule.changePercent
      ) {
        const cKey = `${matchedKey}:changePercent`;
        const cooldownExpiry = this.cooldownMap.get(cKey) || 0;
        if (now >= cooldownExpiry) {
          this.cooldownMap.set(cKey, now + cooldownMs);
          triggeredEvents.push({
            symbolKey: matchedKey,
            item: q,
            rule,
            type: "changePercent",
            currentValue: q.changePercent,
            thresholdValue: rule.changePercent,
          });
        }
      }
    }

    // 冷却表到期即删：无人回收会让已删除自选的键永久滞留内存（AGENTS.md §6.6）
    for (const [expiredKey, expiry] of this.cooldownMap) {
      if (now >= expiry) {
        this.cooldownMap.delete(expiredKey);
      }
    }

    // 分发触发通知
    for (const evt of triggeredEvents) {
      this.dispatchAlert(evt, config);
    }

    return triggeredEvents;
  }

  private dispatchAlert(evt: AlertTriggerEvent, config: Partial<MarketLensConfig>): void {
    // 老板键 + 简洁展示模式统一判定：只要任一处于激活/开启状态，预警 UI 就必须彻底脱敏，
    // 杜绝状态栏伪装文本被顶掉、以及右下角通知泄露真实价格/阈值。
    const masked = isDisplayMasked(this.statusBar?.isBossKeyActive() ?? false, config.maskMode ?? false);
    const displayName = masked ? "****" : (evt.item.name || evt.item.symbol);
    const displaySymbol = masked ? "**" : evt.item.symbol;
    const currency = !masked && evt.item.currency ? ` ${evt.item.currency}` : "";

    let alertMessage = "";
    let statusText = "";

    if (evt.type === "above") {
      const currentStr = masked ? "****" : String(evt.currentValue);
      const thresholdStr = masked ? "****" : String(evt.thresholdValue);
      alertMessage = `🔔 [MarketLens 预警] ${displayName} (${displaySymbol}) 现价已突破上限：${currentStr}${currency}（设定阈值 ≥ ${thresholdStr}）`;
      statusText = masked ? "$(bell) [突破预警]" : `$(bell) [突破预警] ${displayName} ${evt.currentValue}`;
    } else if (evt.type === "below") {
      const currentStr = masked ? "****" : String(evt.currentValue);
      const thresholdStr = masked ? "****" : String(evt.thresholdValue);
      alertMessage = `⚠️ [MarketLens 预警] ${displayName} (${displaySymbol}) 现价已跌破下限：${currentStr}${currency}（设定阈值 ≤ ${thresholdStr}）`;
      statusText = masked ? "$(warning) [跌破预警]" : `$(warning) [跌破预警] ${displayName} ${evt.currentValue}`;
    } else {
      const sign = evt.currentValue >= 0 ? "+" : "";
      const currentStr = masked ? "****" : `${sign}${evt.currentValue.toFixed(2)}%`;
      const thresholdStr = masked ? "****" : `${evt.thresholdValue}%`;
      alertMessage = `⚡ [MarketLens 波动] ${displayName} (${displaySymbol}) 今日涨跌幅达到 ${currentStr}（阈值 ±${thresholdStr}）`;
      statusText = masked ? "$(pulse) [剧烈波动]" : `$(pulse) [剧烈波动] ${displayName} ${sign}${evt.currentValue.toFixed(2)}%`;
    }

    const mode = config.alertNotificationMode || "notification";

    // 状态栏静默提醒通道：脱敏态下禁止一切可能顶掉伪装文本的预警闪光
    if (!masked && (mode === "statusBarOnly" || mode === "both") && this.statusBar) {
      this.statusBar.flashAlert(statusText, 15000);
    }

    // 右下角轻量非模态浮窗通道：脱敏态下完全静音，严防摸鱼露馅
    if (!masked && (mode === "notification" || mode === "both")) {
      const muteAction = `静音 ${config.alertCooldownMinutes || 15} 分钟`;
      const settingsAction = "管理预警";
      const notifyFn = evt.type === "below"
        ? vscode.window?.showWarningMessage
        : vscode.window?.showInformationMessage;

      if (typeof notifyFn === "function") {
        void notifyFn(alertMessage, muteAction, settingsAction).then((action?: string) => {
          if (action === muteAction) {
            this.mute(evt.symbolKey, config.alertCooldownMinutes || 15);
            if (!masked) {
              emitStatusMessage(`$(bell-slash) 已静音 ${displayName} 预警 ${config.alertCooldownMinutes || 15} 分钟`, 3000);
            }
          } else if (action === settingsAction) {
            void vscode.commands?.executeCommand("marketlens.openSettings");
          }
        });
      }
    }
  }
}
