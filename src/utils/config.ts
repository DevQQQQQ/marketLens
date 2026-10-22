// src/utils/config.ts
import * as vscode from "vscode";
import type { MarketLensConfig, MarketSection, MarketClosingSection } from "../types/index.ts";
import { MARKET_SECTIONS, MARKET_CLOSING_SECTIONS } from "../types/index.ts";
import { computeStatusBarEnabled, sanitizeAlerts, sanitizeWatchlist } from "./symbolHelper.ts";
import { getSystemProxyUrl, DEFAULT_PROXY_PORT } from "../services/network.ts";
import { logger } from "./logger.ts";

function getConfiguration(section?: string): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(section);
}

function getGlobalTarget(): vscode.ConfigurationTarget {
  return vscode.ConfigurationTarget.Global;
}

interface RawSectionConfig {
  enabled?: boolean;
  statusBar?: boolean;
  networkMode?: "proxy" | "direct";
  proxyUrl?: string;
  stopOnMarketClosed?: boolean;
}

interface SectionReadDefaults {
  networkMode: "proxy" | "direct";
  proxyUrl: string;
}

/** 板块通用读取项：不含休市语义，7×24 板块（Binance / Alpha）只能走本函数 */
function readSectionBase(
  cfg: vscode.WorkspaceConfiguration,
  section: string,
  defaults: SectionReadDefaults
) {
  const sectionObj = cfg.get<RawSectionConfig>(section) || {};
  return {
    enabled: cfg.get<boolean>(`${section}.enabled`) ?? sectionObj.enabled ?? true,
    statusBar: cfg.get<boolean>(`${section}.statusBar`) ?? sectionObj.statusBar ?? true,
    networkMode: (cfg.get<"proxy" | "direct">(`${section}.networkMode`) ?? sectionObj.networkMode ?? defaults.networkMode) as "proxy" | "direct",
    proxyUrl: cfg.get<string>(`${section}.proxyUrl`) ?? sectionObj.proxyUrl ?? defaults.proxyUrl,
  };
}

/**
 * 带休市概念的板块读取：`stopOnMarketClosed` 只可能出现在这里。
 *
 * 参数类型限定为 `MarketClosingSection`，给 7×24 板块合成该字段会直接 typecheck 红
 * ——这是 AGENTS.md §6.10 约束的类型系统强制形态，不要退回「任何板块都能写」的宽签名。
 */
function readClosingSection(
  cfg: vscode.WorkspaceConfiguration,
  section: MarketClosingSection,
  defaults: SectionReadDefaults
) {
  const sectionObj = cfg.get<RawSectionConfig>(section) || {};
  return {
    ...readSectionBase(cfg, section, defaults),
    stopOnMarketClosed: cfg.get<boolean>(`${section}.stopOnMarketClosed`) ?? sectionObj.stopOnMarketClosed ?? true,
  };
}

/**
 * 读取 MarketLens 全局与用户配置
 */
export function readConfig(): MarketLensConfig {
  const cfg = getConfiguration("marketlens");
  const portInspect = cfg.inspect<number>("proxyPort");
  const urlInspect = cfg.inspect<string>("proxyUrl");
  const isCustomPort = portInspect?.globalValue !== undefined || portInspect?.workspaceValue !== undefined;
  const isCustomUrl = urlInspect?.globalValue !== undefined || urlInspect?.workspaceValue !== undefined;

  let proxyPort = cfg.get<number>("proxyPort", DEFAULT_PROXY_PORT);
  let globalProxy = cfg.get<string>("proxyUrl") || `http://127.0.0.1:${proxyPort}`;

  // 若用户未主动在 VS Code 设置中显式配置自定义代理端口与地址，自适应读取操作系统代理环境变量
  if (!isCustomPort && !isCustomUrl) {
    const sysProxy = getSystemProxyUrl();
    if (sysProxy) {
      globalProxy = sysProxy;
      try {
        const u = new URL(sysProxy);
        if (u.port) {
          proxyPort = parseInt(u.port, 10);
        }
      } catch (err) {
        logger.debug("[config] parse sysProxy URL failed", err);
      }
    }
  }

  const fund    = readClosingSection(cfg, "fund",    { networkMode: "direct", proxyUrl: globalProxy });
  const aShare  = readClosingSection(cfg, "aShare",  { networkMode: "direct", proxyUrl: globalProxy });
  const hkStock = readClosingSection(cfg, "hkStock", { networkMode: "direct", proxyUrl: globalProxy });
  const usStock = readClosingSection(cfg, "usStock", { networkMode: "direct", proxyUrl: globalProxy });
  const binance = readSectionBase(cfg, "binance", { networkMode: "proxy",  proxyUrl: globalProxy });
  const alpha   = readSectionBase(cfg, "alpha",   { networkMode: "proxy",  proxyUrl: globalProxy });

  const explicitStatusBarEnabled = cfg.get<boolean>("statusBar.enabled");
  const anyTabsStatusBar = fund.statusBar || aShare.statusBar || hkStock.statusBar || usStock.statusBar || binance.statusBar || alpha.statusBar;
  // 总控开关判定：显式关闭时彻底关闭状态栏；未显式关闭时，只要有任意板块开启轮播即保持状态栏展示
  const isStatusBarEnabled = computeStatusBarEnabled(explicitStatusBarEnabled, anyTabsStatusBar);

  return {
    autoRefresh:     cfg.get<boolean>("autoRefresh", true),
    refreshInterval: cfg.get<number>("refreshInterval", 5000),
    maskMode:        cfg.get<boolean>("maskMode", false),
    colorNeutral:    cfg.get<boolean>("colorNeutral", false),
    colorScheme:     cfg.get<"greenUpRedDown" | "redUpGreenDown">("colorScheme", "greenUpRedDown"),
    proxyPort,
    proxyUrl:        globalProxy,

    statusBar: {
      enabled: isStatusBarEnabled,
      holdingEnabled: cfg.get<boolean>("statusBar.holdingEnabled", true),
      holdingInterval: Math.min(
        60,
        Math.max(1, Math.round(cfg.get<number>("statusBar.holdingInterval", 3)) || 3)
      ),
    },
    autoCollapseClosedGroups: cfg.get<boolean>("autoCollapseClosedGroups", true),

    fund,
    aShare,
    hkStock,
    usStock,
    binance,
    alpha,

    watchlist: sanitizeWatchlist(cfg.get("watchlist", {})),
    alerts: sanitizeAlerts(cfg.get("alerts", {})),
    alertNotificationMode: cfg.get<"notification" | "statusBarOnly" | "both">("alertNotificationMode", "notification"),
    alertCooldownMinutes: cfg.get<number>("alertCooldownMinutes", 15),
  };
}

export {
  getWatchlistFingerprint,
  computeStatusBarEnabled,
  sanitizeWatchlist,
  sanitizeAlerts,
  applyAlertRuleDelta,
} from "./symbolHelper.ts";

/**
 * 板块六项枚举的**唯一真相源**位于 `src/types/index.ts`（`MARKET_SECTIONS as const`）。
 * 本文件只做再导出，让既有调用点（settingsHtml / settingsWebview / backupHelper / test）
 * 保持 `from "../utils/config.ts"` 的导入路径不变。
 *
 * 旧版在 types 与 config 两处各写一份六项枚举，新增板块时漏改其一不会 typecheck 红，
 * 只会让运行时集合漏项（AGENTS.md §5.2 / 体检报告 P3-19）。现收敛为单处声明。
 */
export { MARKET_SECTIONS, MARKET_CLOSING_SECTIONS } from "../types/index.ts";
export type { MarketSection, MarketClosingSection } from "../types/index.ts";

/** 默认分组名：与 `MARKET_SECTIONS` 同源的展示分组（AGENTS.md §5.2 / §6.7） */
export const SECTION_DEFAULT_GROUP_NAMES: Record<MarketSection, string> = {
  fund: "基金",
  aShare: "A股",
  hkStock: "港股",
  usStock: "美股",
  binance: "Binance",
  alpha: "Alpha",
};

/** 由 MARKET_SECTIONS 派生的全量默认分组名，禁止手写平行列表 */
export const DEFAULT_GROUP_NAMES: readonly string[] = MARKET_SECTIONS.map((sec) => SECTION_DEFAULT_GROUP_NAMES[sec]);

/**
 * 板块键类型守卫：由 `MARKET_SECTIONS` 派生，调用方据此把磁盘/消息里的自由字符串收窄为板块。
 * 禁止在调用处再手写 `"fund" | "aShare" | …` 的内联联合类型（§5.2 单一真相源）。
 */
export function isMarketSection(value: string): value is MarketSection {
  return (MARKET_SECTIONS as readonly string[]).includes(value);
}

/**
 * 「有休市概念的板块子集」的唯一定义点位于 `src/types/index.ts`（`MARKET_CLOSING_SECTIONS as const`），
 * 由上方再导出对既有调用点保持可见。
 *
 * Binance / Alpha 为 7×24 市场，不存在休市跳过与 `stopOnMarketClosed` 配置项。
 * 其他文件不得再复制一份该子集：休市键的白名单组装、导入落盘守卫、休市判定读取
 * 全部必须回到这里取（AGENTS.md §5.2 / §6.10）。
 */
/** 判定任意板块名是否属于「有休市概念」子集（写入 stopOnMarketClosed 前的强制守卫） */
export function isClosingSection(sec: string): sec is MarketClosingSection {
  return (MARKET_CLOSING_SECTIONS as readonly string[]).includes(sec);
}

/**
 * 内存配置同步：将状态栏开关同步到所有板块
 */
export function applyStatusBarToAllSections(cfg: MarketLensConfig, enabled: boolean): void {
  cfg.statusBar.enabled = enabled;
  for (const section of MARKET_SECTIONS) {
    if (cfg[section]) {
      cfg[section].statusBar = enabled;
    }
  }
}

/**
 * 内存配置同步：将代理地址与端口同步到所有板块
 */
export function applyProxyToAllSections(cfg: MarketLensConfig, proxyUrl: string, port?: number): void {
  if (port !== undefined) {
    cfg.proxyPort = port;
  }
  cfg.proxyUrl = proxyUrl;
  for (const section of MARKET_SECTIONS) {
    if (cfg[section]) {
      cfg[section].proxyUrl = proxyUrl;
    }
  }
}

/**
 * 内存配置同步：重新计算状态栏聚合总控开关
 */
export function recomputeStatusBarEnabled(cfg: MarketLensConfig): boolean {
  const anyActive = MARKET_SECTIONS.some((sec) => cfg[sec]?.statusBar !== false);
  cfg.statusBar.enabled = anyActive;
  return anyActive;
}

/**
 * 磁盘持久化：将代理端口与地址全量扇出写入 VS Code 全局配置（包括所有板块，彻底杜绝遗漏）
 */
export async function persistProxyToAllSections(
  cfg: vscode.WorkspaceConfiguration,
  proxyUrl: string,
  port?: number
): Promise<void> {
  const target = getGlobalTarget();
  const updates: Thenable<void>[] = [
    cfg.update("proxyUrl", proxyUrl, target),
  ];
  if (port !== undefined && port >= 1 && port <= 65535) {
    updates.push(cfg.update("proxyPort", port, target));
  }
  for (const section of MARKET_SECTIONS) {
    updates.push(cfg.update(`${section}.proxyUrl`, proxyUrl, target));
  }
  await Promise.all(updates);
}

/**
 * 磁盘持久化：将状态栏总控与各板块状态栏全量扇出写入 VS Code 全局配置
 */
export async function persistStatusBarToAllSections(
  cfg: vscode.WorkspaceConfiguration,
  enabled: boolean
): Promise<void> {
  const target = getGlobalTarget();
  const updates: Thenable<void>[] = [
    cfg.update("statusBar.enabled", enabled, target),
  ];
  for (const section of MARKET_SECTIONS) {
    updates.push(cfg.update(`${section}.statusBar`, enabled, target));
  }
  await Promise.all(updates);
}

/**
 * 磁盘持久化：写入单个板块状态栏开关并联动聚合计算 statusBar.enabled
 */
export async function persistSectionStatusBarAndRecompute(
  cfg: vscode.WorkspaceConfiguration,
  sectionKey: string,
  value: boolean
): Promise<boolean> {
  const target = getGlobalTarget();
  await cfg.update(sectionKey, value, target);
  const anyActive = MARKET_SECTIONS.some((sec) => {
    return `${sec}.statusBar` === sectionKey
      ? value
      : (cfg.get<boolean>(`${sec}.statusBar`) ?? true);
  });
  await cfg.update("statusBar.enabled", anyActive, target);
  return anyActive;
}

/**
 * 判定配置变更事件是否影响后台网络轮询
 * 集中由 MARKET_SECTIONS 派生，自动覆盖全局网络键与全部板块的 enabled / networkMode / proxyUrl / stopOnMarketClosed，杜绝漏项
 */
export function affectsNetworkConfig(e: { affectsConfiguration(section: string): boolean }): boolean {
  if (
    e.affectsConfiguration("marketlens.proxyPort") ||
    e.affectsConfiguration("marketlens.proxyUrl") ||
    e.affectsConfiguration("marketlens.autoRefresh") ||
    e.affectsConfiguration("marketlens.refreshInterval")
  ) {
    return true;
  }
  for (const section of MARKET_SECTIONS) {
    if (
      e.affectsConfiguration(`marketlens.${section}.enabled`) ||
      e.affectsConfiguration(`marketlens.${section}.networkMode`) ||
      e.affectsConfiguration(`marketlens.${section}.proxyUrl`) ||
      e.affectsConfiguration(`marketlens.${section}.stopOnMarketClosed`)
    ) {
      return true;
    }
  }
  return false;
}
