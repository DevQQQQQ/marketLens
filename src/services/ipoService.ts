// src/services/ipoService.ts
import * as vscode from "vscode";
import type { IpoItem, IpoReminderConfig } from "../types/index.ts";
import { smartNetworkGet } from "./network.ts";
import { logger } from "../utils/logger.ts";
import { readConfig } from "../utils/config.ts";
import { showInfoMessage, showInfoMessageWithActions } from "../utils/feedback.ts";
import {
  beijingFormatter,
  beijingDateFormatter,
  getZonedDateString,
  getZonedTimeParts,
  isAShareHoliday,
  isHKHoliday,
} from "../utils/marketHours.ts";

export interface IpoFilterOptions {
  includeAShare?: boolean;
  includeConvertibleBond?: boolean;
  includeHkShare?: boolean;
}

/** 东方财富 A 股新股申购日历接口 */
export const EASTMONEY_A_IPO_URL =
  "https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPTA_APP_IPOAPPLY&columns=SECURITY_CODE,SECURITY_NAME,APPLY_CODE,ISSUE_PRICE,APPLY_DATE,ONLINE_APPLY_UPPER,MARKET&pageSize=50&sortColumns=APPLY_DATE&sortTypes=-1";

/** 东方财富 A 股可转债申购日历接口 */
export const EASTMONEY_CB_URL =
  "https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_BOND_CB_LIST&columns=SECURITY_CODE,SECURITY_NAME_ABBR,CORRECODE,CORRECODE_NAME_ABBR,SECURITY_SHORT_NAME,CONVERT_STOCK_CODE,PUBLIC_START_DATE,ISSUE_PRICE&pageSize=50&sortColumns=PUBLIC_START_DATE&sortTypes=-1";

/** 东方财富港股新股日历页面 (原生 HTTPS) */
export const EASTMONEY_HK_IPO_URL = "https://hk.eastmoney.com/ipolist.html";

export const GLOBAL_STATE_LAST_IPO_REMIND_KEY = "marketlens.lastIpoRemindDate";

/** 内存缓存：记录当天抓取的全量申购列表，避免单日重复请求 */
let _cachedIpoDate: string | undefined = undefined;
let _cachedIpoItems: IpoItem[] | undefined = undefined;

/** 在途中单例任务锁：彻底杜绝激活瞬间多入口并发重复弹窗 (IPO-13) */
let _inFlightCheck: Promise<void> | null = null;

/** 重置缓存（供测试、配置变更与手动刷新使用） */
export function resetIpoCache(): void {
  _cachedIpoDate = undefined;
  _cachedIpoItems = undefined;
}

/** 测试辅助注入缓存（供单元测试注入 mock 数据，避免直连外网） */
export function setCachedIpoForTesting(items: IpoItem[], dateStr?: string): void {
  _cachedIpoDate = dateStr || getBeijingTodayString();
  _cachedIpoItems = [...items];
}

/** 获取北京时间今日日期字符串 (YYYY-MM-DD) */
export function getBeijingTodayString(date: Date = new Date()): string {
  return getZonedDateString(beijingDateFormatter, date);
}

/** 获取网络出网参数（尊重用户板块配置与 proxyUrl） */
function getNetworkOptions(custom?: { mode?: "direct" | "proxy"; proxyUrl?: string }): {
  mode: "direct" | "proxy";
  proxyUrl?: string;
} {
  if (custom?.mode) {
    const res: { mode: "direct" | "proxy"; proxyUrl?: string } = { mode: custom.mode };
    if (custom.proxyUrl !== undefined) {
      res.proxyUrl = custom.proxyUrl;
    }
    return res;
  }
  const config = readConfig();
  const mode: "direct" | "proxy" = config.aShare?.networkMode === "proxy" ? "proxy" : "direct";
  const res: { mode: "direct" | "proxy"; proxyUrl?: string } = { mode };
  const pUrl = config.aShare?.proxyUrl || config.proxyUrl;
  if (pUrl) {
    res.proxyUrl = pUrl;
  }
  return res;
}

/** 抓取 A 股今日新股申购列表 */
export async function fetchAShareIpos(
  targetDateStr: string,
  networkOpts?: { mode?: "direct" | "proxy"; proxyUrl?: string }
): Promise<IpoItem[]> {
  const opts = getNetworkOptions(networkOpts);
  const res = await smartNetworkGet<{ result?: { data?: Array<Record<string, unknown>> } }>(
    EASTMONEY_A_IPO_URL,
    opts,
    { timeout: 6000 }
  );
  const data = res.data?.result?.data;
  if (!Array.isArray(data)) {
    return [];
  }

  const items: IpoItem[] = [];
  for (const raw of data) {
    const applyDate = String(raw.APPLY_DATE || "").slice(0, 10);
    if (applyDate !== targetDateStr) {
      continue;
    }
    const code = String(raw.SECURITY_CODE || "");
    const name = String(raw.SECURITY_NAME || "");
    const applyCode = raw.APPLY_CODE ? String(raw.APPLY_CODE) : code;
    const price = typeof raw.ISSUE_PRICE === "number" ? raw.ISSUE_PRICE : String(raw.ISSUE_PRICE || "-");
    const upper = typeof raw.ONLINE_APPLY_UPPER === "number" ? raw.ONLINE_APPLY_UPPER : 0;
    const limitStr = upper > 0 ? `${(upper / 10000).toFixed(2)}万股` : undefined;
    const market = raw.MARKET ? String(raw.MARKET) : undefined;

    items.push({
      type: "A_SHARE",
      code,
      name,
      applyCode,
      price,
      applyDate,
      limitOrLots: limitStr,
      detail: market,
    });
  }
  return items;
}

/** 抓取 A 股今日可转债申购列表 */
export async function fetchConvertibleBonds(
  targetDateStr: string,
  networkOpts?: { mode?: "direct" | "proxy"; proxyUrl?: string }
): Promise<IpoItem[]> {
  const opts = getNetworkOptions(networkOpts);
  const res = await smartNetworkGet<{ result?: { data?: Array<Record<string, unknown>> } }>(
    EASTMONEY_CB_URL,
    opts,
    { timeout: 6000 }
  );
  const data = res.data?.result?.data;
  if (!Array.isArray(data)) {
    return [];
  }

  const items: IpoItem[] = [];
  for (const raw of data) {
    const pubDate = String(raw.PUBLIC_START_DATE || "").slice(0, 10);
    if (pubDate !== targetDateStr) {
      continue;
    }
    const code = String(raw.SECURITY_CODE || "");
    const name = String(raw.SECURITY_NAME_ABBR || raw.CORRECODE_NAME_ABBR || "");
    const applyCode = raw.CORRECODE ? String(raw.CORRECODE) : undefined;
    // 缺失时不伪造 100 元假值
    const price = typeof raw.ISSUE_PRICE === "number" ? raw.ISSUE_PRICE : undefined;
    const stockName = raw.SECURITY_SHORT_NAME ? String(raw.SECURITY_SHORT_NAME) : undefined;
    const stockCode = raw.CONVERT_STOCK_CODE ? String(raw.CONVERT_STOCK_CODE) : undefined;
    const detail = stockName ? `正股: ${stockName}${stockCode ? ` (${stockCode})` : ""}` : undefined;

    items.push({
      type: "CONVERTIBLE_BOND",
      code,
      name,
      applyCode,
      price,
      applyDate: pubDate,
      detail,
    });
  }
  return items;
}

/** 解析港股表格行提取正在招股或今日可申购的新股 */
export function parseHkIpoHtml(html: string, targetDateStr: string): IpoItem[] {
  const rowRegex =
    /<tr>\s*<td><span>\d+<\/span><\/td>\s*<td>\s*<a[^>]*>([^<]+)<\/a>\s*<\/td>\s*<td>\s*<a[^>]*>([^<]+)<\/a>\s*<\/td>\s*<td><span>([^<]*)<\/span><\/td>\s*<td><span>([^<]*)<\/span><\/td>\s*<td><span>([^<]*)<\/span><\/td>\s*<td><span>([^<]*)<\/span><\/td>\s*<td><span>([^<]*)<\/span><\/td>\s*<\/tr>/gi;

  const items: IpoItem[] = [];
  let match: RegExpExecArray | null;

  while ((match = rowRegex.exec(html)) !== null) {
    const code = match[1]?.trim() || "";
    const name = match[2]?.trim() || "";
    const price = match[3]?.trim() || "";
    const shares = match[4]?.trim() || "";
    const fund = match[5]?.trim() || "";
    const applyDate = match[6]?.trim() || "";
    const listingDate = match[7]?.trim() || "";

    // 港股招股日判定：若当天处于有效招股区间（start~end），或当天即为招股起始日 (IPO-3)
    let isApplicable = false;
    if (applyDate.includes("~") || applyDate.includes("～")) {
      const [start, end] = applyDate.split(/[~～]/).map((s) => s.trim());
      if (start && end && targetDateStr >= start && targetDateStr <= end) {
        isApplicable = true;
      }
    } else if (applyDate && applyDate === targetDateStr) {
      isApplicable = true;
    }

    if (isApplicable && code) {
      const detailParts: string[] = [];
      if (fund) detailParts.push(`募资: ${fund}`);
      if (shares) detailParts.push(`发行量: ${shares}股`);
      if (listingDate) detailParts.push(`上市日: ${listingDate}`);

      items.push({
        type: "HK_STOCK",
        code,
        name,
        price: price ? `${price}港元` : undefined,
        applyDate,
        // 港股无个人申购上限概念，原字段为全盘招股数，收敛至 detail 避免误导 (IPO-4)
        limitOrLots: undefined,
        detail: detailParts.join(" · "),
      });
    }
  }

  return items;
}

/** 抓取港股今日处于招股中的新股 */
export async function fetchHkIpos(
  targetDateStr: string,
  networkOpts?: { mode?: "direct" | "proxy"; proxyUrl?: string }
): Promise<IpoItem[]> {
  const opts = getNetworkOptions(networkOpts);
  const res = await smartNetworkGet<string>(EASTMONEY_HK_IPO_URL, opts, { timeout: 6000 });
  const html = typeof res.data === "string" ? res.data : String(res.data || "");
  return parseHkIpoHtml(html, targetDateStr);
}

/** 全量聚合抓取今日可申购标的并返回网络执行状态 (IPO-2 / IPO-5) */
export async function fetchTodayIposWithStatus(
  options: IpoFilterOptions = { includeAShare: true, includeConvertibleBond: true, includeHkShare: true },
  date: Date = new Date()
): Promise<{ items: IpoItem[]; fetchFailed: boolean }> {
  const targetDateStr = getBeijingTodayString(date);

  // 若已有当日全量缓存，直接按当次选项过滤输出 (IPO-5)
  if (_cachedIpoDate === targetDateStr && _cachedIpoItems !== undefined) {
    return { items: filterIpoItems(_cachedIpoItems, options), fetchFailed: false };
  }

  const netOpts = getNetworkOptions();
  let fetchFailed = false;

  const aShareHoliday = isAShareHoliday(date);
  const hkHoliday = isHKHoliday(date);

  // 始终完整抓取未休市市场，确保同日设置变动后缓存不会永久缺失
  const tasks: [Promise<IpoItem[]>, Promise<IpoItem[]>, Promise<IpoItem[]>] = [
    !aShareHoliday
      ? fetchAShareIpos(targetDateStr, netOpts).catch((err) => {
          fetchFailed = true;
          logger.debug("[ipoService] fetchAShareIpos failed", err);
          return [];
        })
      : Promise.resolve([]),
    !aShareHoliday
      ? fetchConvertibleBonds(targetDateStr, netOpts).catch((err) => {
          fetchFailed = true;
          logger.debug("[ipoService] fetchConvertibleBonds failed", err);
          return [];
        })
      : Promise.resolve([]),
    !hkHoliday
      ? fetchHkIpos(targetDateStr, netOpts).catch((err) => {
          fetchFailed = true;
          logger.debug("[ipoService] fetchHkIpos failed", err);
          return [];
        })
      : Promise.resolve([]),
  ];

  const [aShares, bonds, hkStocks] = await Promise.all(tasks);
  const allItems = [...aShares, ...bonds, ...hkStocks];

  // 只要未发生网络错误，或即便有局部错误但已抓到有效标的，才写入缓存
  if (!fetchFailed || allItems.length > 0) {
    _cachedIpoDate = targetDateStr;
    _cachedIpoItems = allItems;
  }

  return { items: filterIpoItems(allItems, options), fetchFailed };
}

/** 全量聚合抓取今日可申购标的（支持内存缓存） */
export async function fetchTodayIpos(
  options: IpoFilterOptions = { includeAShare: true, includeConvertibleBond: true, includeHkShare: true },
  date: Date = new Date()
): Promise<IpoItem[]> {
  const { items } = await fetchTodayIposWithStatus(options, date);
  return items;
}

/** 按选项过滤标的 */
function filterIpoItems(items: IpoItem[], options: IpoFilterOptions): IpoItem[] {
  return items.filter((item) => {
    if (item.type === "A_SHARE" && options.includeAShare === false) return false;
    if (item.type === "CONVERTIBLE_BOND" && options.includeConvertibleBond === false) return false;
    if (item.type === "HK_STOCK" && options.includeHkShare === false) return false;
    return true;
  });
}

/** 判断当前北京时间是否处于交易日 09:15 ~ 15:00 申购窗口期 */
export function isWithinIpoWindow(date: Date = new Date()): boolean {
  const { day, totalMinutes } = getZonedTimeParts(beijingFormatter, date);
  // 周六 (6) 或周日 (0) 闭市
  if (day === 0 || day === 6) {
    return false;
  }
  // 两地同时节假日休市
  if (isAShareHoliday(date) && isHKHoliday(date)) {
    return false;
  }
  // 09:15 ~ 15:00
  return totalMinutes >= 9 * 60 + 15 && totalMinutes <= 15 * 60;
}

/**
 * 弹出 QuickPick 展示申购详情，并支持点击复制
 */
export async function showIpoDetailQuickPick(
  items: IpoItem[],
  isBossKeyOrMaskActive?: () => boolean
): Promise<void> {
  // 发射前脱敏守卫 (IPO-1)
  if (isBossKeyOrMaskActive && isBossKeyOrMaskActive()) {
    return;
  }

  if (items.length === 0) {
    showInfoMessage("今日暂无可申购的新股或可转债。");
    return;
  }

  const pickItems = items.map((it) => {
    const typeLabel =
      it.type === "A_SHARE" ? "A股新股" : it.type === "CONVERTIBLE_BOND" ? "可转债" : "港股IPO";
    const icon = it.type === "A_SHARE" ? "$(tag)" : it.type === "CONVERTIBLE_BOND" ? "$(credit-card)" : "$(globe)";

    const label = `${icon} [${typeLabel}] ${it.name} (${it.code})`;
    const descParts: string[] = [];
    if (it.applyCode && it.applyCode !== it.code) {
      descParts.push(`申购代码: ${it.applyCode}`);
    }
    if (it.price !== undefined) {
      descParts.push(`发行价: ${typeof it.price === "number" ? `${it.price}元` : it.price}`);
    }
    if (it.limitOrLots) {
      descParts.push(`上限: ${it.limitOrLots}`);
    }

    const detailParts: string[] = [];
    if (it.applyDate) {
      detailParts.push(`申购日: ${it.applyDate}`);
    }
    if (it.detail) {
      detailParts.push(it.detail);
    }

    return {
      label,
      description: descParts.join(" · "),
      detail: detailParts.join(" · "),
      item: it,
    };
  });

  const selected = await vscode.window.showQuickPick(pickItems, {
    placeHolder: `今日共有 ${items.length} 只标的可申购（回车可复制标的信息）`,
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (selected) {
    if (isBossKeyOrMaskActive && isBossKeyOrMaskActive()) {
      return;
    }
    const it = selected.item;
    const priceStr = it.price !== undefined ? ` 发行价: ${typeof it.price === "number" ? `${it.price}元` : it.price}` : "";
    const textToCopy = `${it.name} (${it.code}) 申购代码: ${it.applyCode || it.code}${priceStr}`;
    await vscode.env.clipboard.writeText(textToCopy);
    showInfoMessage(`已复制申购信息至剪贴板：${textToCopy}`);
  }
}

/**
 * 核心提醒调度入口：
 * - 自动模式：检查配置、交易日、时段、老板键，当天仅提醒一次
 * - 手动模式：立即执行抓取并展示
 * - 支持时间注入与单例在途互斥 (IPO-13 / IPO-14)
 */
export async function checkAndTriggerIpoReminder(
  globalState: vscode.Memento,
  isBossKeyOrMaskActive: () => boolean,
  manual: boolean = false,
  now: Date = new Date()
): Promise<void> {
  if (_inFlightCheck) {
    return _inFlightCheck;
  }
  _inFlightCheck = doCheckAndTriggerIpoReminder(globalState, isBossKeyOrMaskActive, manual, now);
  try {
    await _inFlightCheck;
  } finally {
    _inFlightCheck = null;
  }
}

async function doCheckAndTriggerIpoReminder(
  globalState: vscode.Memento,
  isBossKeyOrMaskActive: () => boolean,
  manual: boolean,
  now: Date
): Promise<void> {
  const config = readConfig();
  const ipoConfig: IpoReminderConfig = config.ipoReminder || {
    enabled: true,
    includeAShare: true,
    includeConvertibleBond: true,
    includeHkShare: true,
  };

  if (!manual && !ipoConfig.enabled) {
    return;
  }

  const todayStr = getBeijingTodayString(now);

  // 自动模式下进行窗口期与频次检查
  if (!manual) {
    if (!isWithinIpoWindow(now)) {
      return;
    }

    const lastRemindedDate = globalState.get<string>(GLOBAL_STATE_LAST_IPO_REMIND_KEY);
    if (lastRemindedDate === todayStr) {
      return;
    }

    // 老板键或专注打码激活期间不打扰，等待下个周期 (IPO-1)
    if (isBossKeyOrMaskActive()) {
      return;
    }
  }

  // 板块总控联动：若用户整体关闭了 A 股或港股，则连带排除对应打新 (IPO-6)
  const effectiveOptions: IpoFilterOptions = {
    includeAShare: ipoConfig.includeAShare && (config.aShare?.enabled !== false),
    includeConvertibleBond: ipoConfig.includeConvertibleBond && (config.aShare?.enabled !== false),
    includeHkShare: ipoConfig.includeHkShare && (config.hkStock?.enabled !== false),
  };

  const { items, fetchFailed } = await fetchTodayIposWithStatus(effectiveOptions, now);

  if (items.length === 0) {
    if (manual) {
      showInfoMessage("今日暂无可申购的新股或可转债。");
    } else if (!fetchFailed) {
      // 仅在明确抓取成功且确实无任何打新标的时，才记录当日已检测，避免因网络错误耗尽配额 (IPO-2)
      await globalState.update(GLOBAL_STATE_LAST_IPO_REMIND_KEY, todayStr);
    }
    return;
  }

  if (manual) {
    await showIpoDetailQuickPick(items, isBossKeyOrMaskActive);
    return;
  }

  // 发射时刻老板键再确认（消除网络耗时期间 Alt+M 的竞态穿透）(IPO-1)
  if (isBossKeyOrMaskActive()) {
    return;
  }

  // 统计各类数量
  const aCount = items.filter((i) => i.type === "A_SHARE").length;
  const cbCount = items.filter((i) => i.type === "CONVERTIBLE_BOND").length;
  const hkCount = items.filter((i) => i.type === "HK_STOCK").length;

  const summaryParts: string[] = [];
  if (aCount > 0) summaryParts.push(`${aCount} 只 A股新股`);
  if (cbCount > 0) summaryParts.push(`${cbCount} 只可转债`);
  if (hkCount > 0) summaryParts.push(`${hkCount} 只港股IPO`);

  const notificationMsg = `🔔 MarketLens 今日申购提醒：今日有 ${summaryParts.join("、")} 正在申购！`;

  // 弹出前记录已提醒，防止后续快速轮询重复弹出 (IPO-13)
  await globalState.update(GLOBAL_STATE_LAST_IPO_REMIND_KEY, todayStr);

  const viewAction = "查看详情";
  const dismissAction = "今日不再提醒";

  const action = await showInfoMessageWithActions(notificationMsg, viewAction, dismissAction);
  if (action === viewAction) {
    // 点击查看详情时再次守卫 (IPO-1)
    if (!isBossKeyOrMaskActive()) {
      await showIpoDetailQuickPick(items, isBossKeyOrMaskActive);
    }
  }
}
