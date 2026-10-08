import * as vscode from "vscode";
import type { MarketItem, WatchlistConfig, WatchConfigItem, PriceAlertItem, AlertsConfig, GroupSortMode } from "../types/index.ts";
import { normalizeSymbolKey, resolveItemAssetType, resolveItemDisplayName, resolveTrendColors, type ColorScheme, ASSET_TYPE_TO_SECTION_MAP, isGroupMarketClosed, buildGroupNodeId } from "../utils/symbolHelper.ts";
import { isDisplayMasked, resolveStockTooltip } from "../utils/maskState.ts";
import { DEFAULT_PROXY_PORT } from "../services/network.ts";

/**
 * 智能格式化价格
 */
function formatPrice(price: number, currency: "CNY" | "USD" | "HKD" = "USD"): string {
  if (price === 0) return "0.00";
  let sym = "$";
  if (currency === "CNY") sym = "¥";
  else if (currency === "HKD") sym = "HK$";

  if (price < 0.0001) return `${sym}${price.toExponential(4)}`;
  if (price < 1) return `${sym}${price.toFixed(6)}`;
  if (price < 10) return `${sym}${price.toFixed(3)}`;
  return `${sym}${price.toFixed(2)}`;
}

/**
 * 格式化大数值（成交量 / 成交额 / 流动性）
 */
function formatLargeNumber(num: number | undefined, isVolume: boolean, currency: "CNY" | "USD" | "HKD" = "USD"): string {
  if (num === undefined || num === 0) return "--";

  let prefix = "";
  if (!isVolume) {
    if (currency === "CNY") prefix = "¥";
    else if (currency === "HKD") prefix = "HK$";
    else prefix = "$";
  }
  const unit = isVolume ? (currency === "CNY" || currency === "HKD" ? "股" : "") : "";

  if (currency === "CNY" || currency === "HKD") {
    if (num >= 1e12) {
      return `${prefix}${(num / 1e12).toFixed(2)} 万亿${unit}`.trim();
    }
    if (num >= 1e8) {
      return `${prefix}${(num / 1e8).toFixed(2)} 亿${unit}`.trim();
    }
    if (num >= 1e4) {
      return `${prefix}${(num / 1e4).toFixed(2)} 万${unit}`.trim();
    }
    return `${prefix}${num.toLocaleString()}${unit}`.trim();
  } else {
    if (num >= 1e12) {
      return `${prefix}${(num / 1e12).toFixed(2)}T ${unit}`.trim();
    }
    if (num >= 1e9) {
      return `${prefix}${(num / 1e9).toFixed(2)}B ${unit}`.trim();
    }
    if (num >= 1e6) {
      return `${prefix}${(num / 1e6).toFixed(2)}M ${unit}`.trim();
    }
    if (num >= 1e3) {
      return `${prefix}${(num / 1e3).toFixed(2)}K ${unit}`.trim();
    }
    return `${prefix}${num.toFixed(2)} ${unit}`.trim();
  }
}

/**
 * 激活标识：每次扩展宿主加载（即扩展激活）生成一次。
 * 与 WatchlistProvider 的折叠会话序号共同构成分组节点的会话标识，
 * 保证「重载窗口」与「关闭侧边栏再打开」两种重开场景下，休市分组的节点 id 都会变化。
 */
const ACTIVATION_TAG = Date.now().toString(36);

/** 分组节点（基金 / A股 / 港股 / 美股 / Binance / Alpha） */
export class GroupItem extends vscode.TreeItem {
  public readonly groupName: string;
  public readonly children: StockItem[];
  public sortMode: GroupSortMode;
  public isClosed: boolean;
  public autoCollapse: boolean;

  constructor(
    groupName: string,
    children: StockItem[],
    sortMode: GroupSortMode = "default",
    isClosed: boolean = false,
    autoCollapse: boolean = false,
    collapseSessionTag: string = "",
    forceExpanded: boolean = false
  ) {
    super(groupName, vscode.TreeItemCollapsibleState.Expanded);
    this.groupName = groupName;
    this.children = children;
    this.sortMode = sortMode;
    this.isClosed = isClosed;
    this.autoCollapse = autoCollapse;
    this.contextValue = "groupItem";
    this.iconPath = new vscode.ThemeIcon("folder");
    this.applyCollapseState(autoCollapse, collapseSessionTag, forceExpanded);
    this.updateDescription();
  }

  /**
   * 按最新的自动折叠开关、休市判定与会话标识，重新推导节点的 id 与折叠态。
   *
   * id 参与会话标识是刻意为之：VS Code 以 TreeItem.id 作为节点句柄（内部形如 `1/<id>`）
   * 记忆用户的展开/折叠操作，节点重建时会优先恢复该记忆并覆盖 collapsibleState。
   * 让休市分组的 id 随会话变化，可令 VS Code 视其为全新节点，回到「休市默认折叠」的语义；
   * 开盘分组 id 保持稳定，用户手动折叠的偏好继续保留。
   *
   * @param autoCollapse       当前是否启用休市自动折叠
   * @param collapseSessionTag 当前折叠会话标识（调用方须传入 WatchlistProvider.collapseSessionTag）
   * @param forceExpanded      用户是否显式要求「全部展开」，优先于休市自动折叠
   */
  public applyCollapseState(
    autoCollapse: boolean,
    collapseSessionTag: string,
    forceExpanded: boolean = false
  ): void {
    this.autoCollapse = !!autoCollapse;
    this.id = buildGroupNodeId(
      this.groupName,
      this.autoCollapse,
      this.isClosed,
      collapseSessionTag,
      forceExpanded
    );
    this.collapsibleState =
      !forceExpanded && this.autoCollapse && this.isClosed
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.Expanded;
  }

  public updateDescription(): void {
    const sortSuffix =
      this.sortMode === "changeDesc"
        ? " · 涨幅"
        : this.sortMode === "changeAsc"
        ? " · 跌幅"
        : this.sortMode === "nameAsc"
        ? " · 名称"
        : this.sortMode === "priceDesc"
        ? " · 现价"
        : "";
    const closedSuffix = this.autoCollapse && this.isClosed ? " · 已休市" : "";
    this.description = `(${this.children.length}${sortSuffix}${closedSuffix})`;
  }
}

/** 单只股票 / 代币节点 */
export class StockItem extends vscode.TreeItem {
  public alertRule?: PriceAlertItem;
  public confName?: string;
  public colorScheme: ColorScheme;
  public item: MarketItem;
  public groupName: string;
  public readonly confSymbol: string;
  private maskMode: boolean;
  private colorNeutral: boolean;

  constructor(
    item: MarketItem,
    groupName: string,
    confSymbol: string,
    maskMode: boolean,
    colorNeutral: boolean = false,
    alertRule?: PriceAlertItem,
    confName?: string,
    colorScheme: ColorScheme = "greenUpRedDown"
  ) {
    super(resolveItemDisplayName(confName, confSymbol, item), vscode.TreeItemCollapsibleState.None);
    this.item = item;
    this.groupName = groupName;
    this.confSymbol = confSymbol;
    this.maskMode = maskMode;
    this.colorNeutral = colorNeutral;
    this.confName = confName;
    this.colorScheme = colorScheme;
    this.id = `${groupName}_${confSymbol}`;
    this.contextValue = "stockItem";
    this.alertRule = alertRule;
    this.refresh(item, maskMode, colorNeutral, alertRule, confName, colorScheme);
  }

  /** 更新显示内容与悬停详细信息 */
  refresh(
    item: MarketItem,
    maskMode: boolean,
    colorNeutral: boolean = false,
    alertRule?: PriceAlertItem,
    confName?: string,
    colorScheme?: ColorScheme
  ): void {
    this.item = item;
    if (alertRule !== undefined) {
      this.alertRule = alertRule;
    }
    if (confName !== undefined) {
      this.confName = confName;
    }
    if (colorScheme !== undefined) {
      this.colorScheme = colorScheme;
    }
    const currentAlert = this.alertRule;
    const hasAlert = !!(
      currentAlert &&
      currentAlert.enabled !== false &&
      ((currentAlert.above !== undefined && Number.isFinite(currentAlert.above)) ||
       (currentAlert.below !== undefined && Number.isFinite(currentAlert.below)) ||
       (currentAlert.changePercent !== undefined && Number.isFinite(currentAlert.changePercent)))
    );

    const currency = item.currency || (item.type === "A_SHARE" ? "CNY" : (item.type === "HK_STOCK" ? "HKD" : "USD"));
    const currSym = currency === "CNY" ? "¥" : (currency === "HKD" ? "HK$" : "$");

    const hasQuote = item.price !== undefined && item.price > 0;
    const priceStr = maskMode ? "****" : formatPrice(item.price, currency);
    const sign = item.changePercent >= 0 ? "+" : "";
    const pctStr = maskMode ? "**" : `${sign}${item.changePercent.toFixed(2)}%`;
    const arrow = item.changePercent >= 0 ? "▲" : "▼";
    const { colorHint, themeColor } = resolveTrendColors(item.changePercent, colorNeutral, this.colorScheme);

    const alertSuffix = hasAlert ? " 🔔" : "";
    const displayName = resolveItemDisplayName(this.confName, this.confSymbol, item);
    this.label = displayName;
    this.description = maskMode
      ? `****  **${alertSuffix}`
      : (hasQuote ? `${priceStr}  ${arrow} ${pctStr}${alertSuffix}` : `获取行情中…${alertSuffix}`);

    // ── 差异化构建 Tooltip ──
    this.tooltip = resolveStockTooltip(maskMode, () => {
      const isAlpha = item.type === "ALPHA_TOKEN" || item.type === "BSC_TOKEN" || item.chain !== undefined;

      let mdText = "";
      if (isAlpha) {
        // 链上 Alpha 专属卡片
        const chainBadge = item.chain ? `\`${item.chain}\`` : "`DEX`";
        const dexBadge = item.dex ? `\`${item.dex}\`` : "`DEX`";
        const liqStr = formatLargeNumber(item.liquidity, false, "USD");
        const turnoverStr = formatLargeNumber(item.turnover, false, "USD");
        const openStr = item.open ? formatPrice(item.open, "USD") : "--";

        let changeAmtStr = "--";
        if (item.price && item.changePercent !== undefined) {
          const approxChange = item.price * (item.changePercent / 100);
          const cSign = approxChange >= 0 ? "+" : "";
          changeAmtStr = `${cSign}$${Math.abs(approxChange).toFixed(item.price < 1 ? 6 : 2)}`;
        }

        const copyTokenUri = `command:marketlens.copyCode?${encodeURIComponent(JSON.stringify(item.symbol))}`;
        const copyContractUri = `command:marketlens.copyCode?${encodeURIComponent(JSON.stringify(item.id))}`;

        mdText =
          `### ${item.name} (\`${item.symbol}\`) [📋 复制](${copyTokenUri})\n` +
          `公链网络：${chainBadge} &nbsp;|&nbsp; 交易池：${dexBadge}\n\n` +
          `| 核心指标 | 实时行情 |\n` +
          `| :--- | :--- |\n` +
          `| **最新价格** | ${colorHint} **${priceStr}** |\n` +
          `| **24h 涨跌幅** | **${pctStr}** |\n` +
          `| **24h 涨跌额** | **${changeAmtStr}** |\n` +
          `| **开盘参考价** | ${openStr} |\n` +
          `| **流动性池 (Liquidity)** | **${liqStr}** |\n` +
          `| **24h 成交额** | **${turnoverStr}** |\n` +
          `| **合约地址** | \`${item.id}\` &nbsp;[📋 复制合约](${copyContractUri}) |\n\n` +
          `_数据源: DexScreener · ${new Date().toLocaleTimeString()}_`;
      } else {
        // A 股与 Binance 传统金融卡片
        const openStr = item.open !== undefined && item.open > 0 ? formatPrice(item.open, currency) : "--";
        const prevCloseStr = item.prevClose !== undefined && item.prevClose > 0 ? formatPrice(item.prevClose, currency) : "--";
        const highStr = item.high !== undefined && item.high > 0 ? formatPrice(item.high, currency) : "--";
        const lowStr = item.low !== undefined && item.low > 0 ? formatPrice(item.low, currency) : "--";

        let changeAmtStr = "--";
        if (item.change !== undefined) {
          const cSign = item.change >= 0 ? "+" : "";
          changeAmtStr = `${cSign}${currSym}${Math.abs(item.change).toFixed(item.price > 0 && item.price < 1 ? 4 : 2)}`;
        } else if (item.price > 0 && item.changePercent !== undefined) {
          const approxChange = item.price * (item.changePercent / 100);
          const cSign = approxChange >= 0 ? "+" : "";
          changeAmtStr = `${cSign}${currSym}${Math.abs(approxChange).toFixed(item.price < 1 ? 4 : 2)}`;
        }

        const volStr = formatLargeNumber(item.volume, true, currency);
        const turnoverStr = formatLargeNumber(item.turnover, false, currency);
        const currencyLabel = currency === "CNY" ? "人民币 (¥ CNY)" : (currency === "HKD" ? "港币 (HK$ HKD)" : "美元 ($ USD)");

        const tableRows: string[] = [
          `| **最新价格** | ${colorHint} **${priceStr}** |`,
          `| **涨跌百分比** | **${pctStr}** |`,
          `| **涨跌额** | **${changeAmtStr}** |`,
          `| **最高 / 最低** | ${highStr} / ${lowStr} |`,
          `| **今开 / 昨收** | ${openStr} / ${prevCloseStr} |`,
          `| **成交量 / 额** | ${volStr} / ${turnoverStr} |`,
        ];

        // 均价与振幅
        if (item.avgPrice !== undefined || item.amplitude !== undefined) {
          const avgStr = item.avgPrice !== undefined ? formatPrice(item.avgPrice, currency) : "--";
          const ampStr = item.amplitude !== undefined ? `${item.amplitude.toFixed(2)}%` : "--";
          tableRows.push(`| **均价 / 振幅** | ${avgStr} / ${ampStr} |`);
        }

        // 换手率与量比
        if (item.turnoverRate !== undefined || item.volumeRatio !== undefined) {
          const toStr = item.turnoverRate !== undefined ? `${item.turnoverRate.toFixed(2)}%` : "--";
          const vrStr = item.volumeRatio !== undefined ? item.volumeRatio.toFixed(2) : "--";
          tableRows.push(`| **换手 / 量比** | ${toStr} / ${vrStr} |`);
        }

        // 涨跌停价（打板关键线）
        if (item.limitUp !== undefined || item.limitDown !== undefined) {
          const upStr = item.limitUp !== undefined ? formatPrice(item.limitUp, currency) : "--";
          const downStr = item.limitDown !== undefined ? formatPrice(item.limitDown, currency) : "--";
          tableRows.push(`| **涨停 / 跌停** | ${upStr} / ${downStr} |`);
        }

        // 估值（市盈率 TTM / 市净率 PB）
        if (item.peTtm !== undefined || item.pb !== undefined) {
          const peStr = item.peTtm !== undefined ? `${item.peTtm.toFixed(2)}` : "--";
          const pbStr = item.pb !== undefined ? item.pb.toFixed(2) : "--";
          tableRows.push(`| **市盈 / 市净** | ${peStr} / ${pbStr} |`);
        }

        // 体量（流通市值 / 总市值）
        if (item.circulationMarketValue !== undefined || item.totalMarketValue !== undefined) {
          const circStr = formatLargeNumber(item.circulationMarketValue, false, currency);
          const totStr = formatLargeNumber(item.totalMarketValue, false, currency);
          tableRows.push(`| **流通 / 总市值** | ${circStr} / ${totStr} |`);
        }

        const copyCmdUri = `command:marketlens.copyCode?${encodeURIComponent(JSON.stringify(item.symbol))}`;

        mdText =
          `### ${item.name} (\`${item.symbol}\`) [📋 复制](${copyCmdUri})\n` +
          `计价货币：**${currencyLabel}**\n\n` +
          `| 核心指标 | 实时行情 |\n` +
          `| :--- | :--- |\n` +
          `${tableRows.join("\n")}\n\n` +
          `_更新时间: ${new Date().toLocaleTimeString()}_`;
      }

      if (!hasQuote) {
        mdText += `\n\n> 💡 **提示**：若长期处于“获取行情中”，可能是当前网络或公司内网拦截了该接口。建议在插件设置中开启本地代理端口（如 ${DEFAULT_PROXY_PORT}），或在设置中暂时关闭该分组。`;
      }

      if (hasAlert && currentAlert) {
        const parts: string[] = [];
        if (currentAlert.above !== undefined && Number.isFinite(currentAlert.above)) {
          parts.push(`突破上限 ≥ ${currentAlert.above} ${currSym}`);
        }
        if (currentAlert.below !== undefined && Number.isFinite(currentAlert.below)) {
          parts.push(`跌破下限 ≤ ${currentAlert.below} ${currSym}`);
        }
        if (currentAlert.changePercent !== undefined && Number.isFinite(currentAlert.changePercent)) {
          parts.push(`单日剧烈波动 ≥ ±${currentAlert.changePercent}%`);
        }
        mdText += `\n\n---\n🔔 **到价与波动预警（已生效）**\n• ${parts.join("\n• ")}`;
      }

      const md = new vscode.MarkdownString(mdText);
      md.supportHtml = true;
      // 精准白名单授权：仅允许执行安全无害的 copyCode 命令，一票拦截任意未知系统命令
      md.isTrusted = { enabledCommands: ["marketlens.copyCode"] };
      return md;
    });

    if (!hasQuote) {
      this.iconPath = new vscode.ThemeIcon("sync~spin");
    } else if (colorNeutral || !themeColor) {
      // 颜色脱敏：使用系统默认前景色，杜绝红绿色视觉刺激
      this.iconPath = new vscode.ThemeIcon(
        item.changePercent >= 0 ? "arrow-up" : "arrow-down"
      );
    } else {
      this.iconPath = new vscode.ThemeIcon(
        item.changePercent >= 0 ? "arrow-up" : "arrow-down",
        new vscode.ThemeColor(themeColor)
      );
    }
  }
}

export class WatchlistProvider
  implements
    vscode.TreeDataProvider<GroupItem | StockItem>,
    vscode.TreeDragAndDropController<GroupItem | StockItem>
{
  readonly dropMimeTypes = ["application/vnd.code.tree.marketlens.watchlist"];
  readonly dragMimeTypes = ["application/vnd.code.tree.marketlens.watchlist"];

  public onBatchReorderCallback?: (
    items: Array<{ sourceGroup: string; sourceSymbol: string }>,
    targetGroup: string,
    targetSymbol?: string
  ) => void | Promise<void>;

  private _onDidChangeTreeData = new vscode.EventEmitter<
    GroupItem | StockItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private groups: GroupItem[] = [];
  private stockMap = new Map<string, StockItem[]>();
  private alertsConfig: AlertsConfig = {};
  private groupSortModes = new Map<string, GroupSortMode>();
  public autoCollapseClosedGroups: boolean = true;

  /**
   * 折叠会话序号：扩展激活后的首次构建为 0，此后每次「侧边栏视图由隐藏转为可见」递增。
   * 与模块级 ACTIVATION_TAG 共同构成 collapseSessionTag，用于让休市分组的节点 id 失效。
   */
  private collapseSessionSeq = 0;

  /**
   * 用户是否通过「全部展开」命令临时覆盖了休市自动折叠。
   * 仅在当前视图会话内有效：视图由隐藏转为可见（beginCollapseSession）时复位，
   * 重新回到「休市分组默认折叠」的语义。
   */
  private forceExpandAll = false;

  public onGroupSortModeChangeCallback?: (
    groupName: string,
    mode: GroupSortMode
  ) => void | Promise<void>;

  private maskMode: boolean;
  private colorNeutral: boolean;
  private colorScheme: ColorScheme;

  constructor(
    maskMode: boolean,
    colorNeutral: boolean = false,
    colorScheme: ColorScheme = "greenUpRedDown"
  ) {
    this.maskMode = maskMode;
    this.colorNeutral = colorNeutral;
    this.colorScheme = colorScheme;
  }

  public setAutoCollapseClosedGroups(enabled: boolean): void {
    const next = !!enabled;
    if (this.autoCollapseClosedGroups === next) {
      return;
    }
    this.autoCollapseClosedGroups = next;
    // 开关变更需立即重算各分组的折叠态：此前若处于关闭状态，applyQuotes 会跳过休市判定，
    // group.isClosed 可能已过期，必须在此重算后统一刷新
    this.syncGroupsCollapseState();
  }

  /** 当前折叠会话标识（激活标识 + 会话序号），语义见 buildGroupNodeId */
  private get collapseSessionTag(): string {
    return `${ACTIVATION_TAG}-${this.collapseSessionSeq}`;
  }

  /**
   * 触发树视图轻量变更通知（用于操作完成后快速关闭已激活的 Hover 浮层，消除焦点残留）
   */
  public notifyChange(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * 开启一次新的折叠会话：让所有休市分组的节点 id 失效，
   * 从而绕过 VS Code 对「用户上一次手动展开」的记忆，恢复「休市默认折叠」的语义。
   * 调用时机：侧边栏视图每次由隐藏转为可见时。
   */
  public beginCollapseSession(): void {
    this.collapseSessionSeq += 1;
    this.forceExpandAll = false;
    this.syncGroupsCollapseState();
  }

  /**
   * 展开全部分组（视图标题栏「全部展开」按钮，与 VS Code 内置的「全部折叠」配对）。
   * 同时覆盖休市自动折叠，直到下一次视图由隐藏转为可见时自动复位。
   */
  public expandAllGroups(): void {
    this.forceExpandAll = true;
    // 换一批节点 id：VS Code 会记住「用户上一次折叠过某分组」，
    // 只改 collapsibleState 会被该记忆覆盖，换 id 才能让它按全新节点处理
    this.collapseSessionSeq += 1;
    this.syncGroupsCollapseState();
  }

  /** 按当前会话标识与最新休市判定，重新推导全部分组的 id、折叠态与描述 */
  private syncGroupsCollapseState(): void {
    if (this.groups.length === 0) {
      return;
    }
    const now = new Date();
    for (const group of this.groups) {
      group.isClosed = isGroupMarketClosed(
        group.groupName,
        group.children.map((c) => ({ symbol: c.confSymbol, type: c.item?.type })),
        now
      );
      group.applyCollapseState(
        this.autoCollapseClosedGroups,
        this.collapseSessionTag,
        this.forceExpandAll
      );
      group.updateDescription();
    }
    this._onDidChangeTreeData.fire();
  }

  public getGroups(): GroupItem[] {
    return this.groups;
  }

  public getGroup(groupName: string): GroupItem | undefined {
    return this.groups.find((g) => g.groupName === groupName);
  }

  public getGroupSortMode(groupName: string): GroupSortMode {
    return this.groupSortModes.get(groupName) || "default";
  }

  public setGroupSortMode(groupName: string, mode: GroupSortMode): void {
    this.groupSortModes.set(groupName, mode);
    const group = this.getGroup(groupName);
    if (group) {
      group.sortMode = mode;
      const sorted = this.sortStockItems(group.children, mode);
      group.children.length = 0;
      group.children.push(...sorted);
      group.updateDescription();
    }
    this._onDidChangeTreeData.fire();
    if (this.onGroupSortModeChangeCallback) {
      void this.onGroupSortModeChangeCallback(groupName, mode);
    }
  }

  public setAllGroupSortModes(modes?: Record<string, GroupSortMode>): void {
    this.groupSortModes.clear();
    if (modes) {
      for (const [k, v] of Object.entries(modes)) {
        if (v) {
          this.groupSortModes.set(k, v);
        }
      }
    }
  }

  public getAllGroupSortModes(): Record<string, GroupSortMode> {
    const res: Record<string, GroupSortMode> = {};
    for (const [k, v] of this.groupSortModes.entries()) {
      res[k] = v;
    }
    return res;
  }

  public sortStockItems(items: StockItem[], mode: GroupSortMode): StockItem[] {
    if (mode === "default" || items.length <= 1) {
      return items;
    }
    const copy = [...items];
    switch (mode) {
      case "changeDesc":
        // 涨跌幅从高到低（涨幅优先）
        return copy.sort((a, b) => {
          const diff = (b.item.changePercent ?? 0) - (a.item.changePercent ?? 0);
          if (diff !== 0) return diff;
          const nameA = a.confName || a.item.name || a.confSymbol;
          const nameB = b.confName || b.item.name || b.confSymbol;
          return nameA.localeCompare(nameB, "zh-Hans-CN", { numeric: true });
        });
      case "changeAsc":
        // 涨跌幅从低到高（跌幅优先）
        return copy.sort((a, b) => {
          const diff = (a.item.changePercent ?? 0) - (b.item.changePercent ?? 0);
          if (diff !== 0) return diff;
          const nameA = a.confName || a.item.name || a.confSymbol;
          const nameB = b.confName || b.item.name || b.confSymbol;
          return nameA.localeCompare(nameB, "zh-Hans-CN", { numeric: true });
        });
      case "nameAsc":
        // 按股票名称拼音排序
        return copy.sort((a, b) => {
          const nameA = a.confName || a.item.name || a.confSymbol;
          const nameB = b.confName || b.item.name || b.confSymbol;
          return nameA.localeCompare(nameB, "zh-Hans-CN", { numeric: true });
        });
      case "priceDesc":
        // 按当前价格从高到低
        return copy.sort((a, b) => {
          const diff = (b.item.price ?? 0) - (a.item.price ?? 0);
          if (diff !== 0) return diff;
          const nameA = a.confName || a.item.name || a.confSymbol;
          const nameB = b.confName || b.item.name || b.confSymbol;
          return nameA.localeCompare(nameB, "zh-Hans-CN", { numeric: true });
        });
      default:
        return copy;
    }
  }

  public setColorScheme(colorScheme: ColorScheme): void {
    this.colorScheme = colorScheme || "greenUpRedDown";
    for (const node of this.getAllUniqueNodes()) {
      node.refresh(node.item, this.isMasked(), this.colorNeutral, undefined, undefined, this.colorScheme);
    }
    this._onDidChangeTreeData.fire();
  }

  public setAlerts(alerts: AlertsConfig): void {
    this.alertsConfig = alerts || {};
    for (const node of this.getAllUniqueNodes()) {
      const alertRule = this.getAlertRule(node.confSymbol, node.item);
      node.refresh(node.item, this.isMasked(), this.colorNeutral, alertRule, undefined, this.colorScheme);
    }
    this._onDidChangeTreeData.fire();
  }

  public getAlertRule(confSymbol: string, item?: MarketItem): PriceAlertItem | undefined {
    const alerts = this.alertsConfig;
    if (!alerts || Object.keys(alerts).length === 0) return undefined;
    const normKey = normalizeSymbolKey(confSymbol);
    const idKey = item?.id ? normalizeSymbolKey(item.id) : undefined;
    const symKey = item?.symbol ? normalizeSymbolKey(item.symbol) : undefined;
    const rawTicker = confSymbol.toLowerCase().replace(/^(us|hk|sh|sz|bj)[\._\-\/]?/i, "");

    return (
      (normKey && alerts[normKey] ? alerts[normKey] : undefined) ||
      (idKey && alerts[idKey] ? alerts[idKey] : undefined) ||
      (symKey && alerts[symKey] ? alerts[symKey] : undefined) ||
      alerts[confSymbol] ||
      alerts[confSymbol.toLowerCase()] ||
      (rawTicker && alerts[rawTicker] ? alerts[rawTicker] : undefined) ||
      (item?.symbol && alerts[item.symbol] ? alerts[item.symbol] : undefined) ||
      (item?.symbol && alerts[item.symbol.toLowerCase()] ? alerts[item.symbol.toLowerCase()] : undefined)
    );
  }

  handleDrag(
    source: readonly (GroupItem | StockItem)[],
    treeDataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): void | Thenable<void> {
    const stockItems = source.filter(
      (item): item is StockItem => item instanceof StockItem
    );
    if (stockItems.length > 0) {
      const payload = stockItems.map((it) => ({
        groupName: it.groupName,
        confSymbol: it.confSymbol,
        symbol: it.item?.symbol,
        id: it.item?.id,
        name: it.item?.name,
      }));
      treeDataTransfer.set(
        "application/vnd.code.tree.marketlens.watchlist",
        new vscode.DataTransferItem(payload)
      );
    }
  }

  async handleDrop(
    target: GroupItem | StockItem | undefined,
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const transferItem = dataTransfer.get(
      "application/vnd.code.tree.marketlens.watchlist"
    );
    if (!transferItem) {
      return;
    }

    let rawList: any[] = [];
    if (Array.isArray(transferItem.value)) {
      rawList = transferItem.value;
    } else if (typeof transferItem.value === "string") {
      try {
        rawList = JSON.parse(transferItem.value);
      } catch {}
    } else {
      try {
        const str = await transferItem.asString();
        rawList = JSON.parse(str);
      } catch {}
    }

    if (!rawList || rawList.length === 0) {
      return;
    }

    let targetGroup: string | undefined;
    let targetSymbol: string | undefined;

    if (target instanceof GroupItem) {
      targetGroup = target.groupName;
      targetSymbol = undefined;
    } else if (target instanceof StockItem) {
      targetGroup = target.groupName;
      targetSymbol =
        target.confSymbol ||
        target.item?.symbol ||
        target.item?.id;
    }

    if (!targetGroup) {
      return;
    }

    if (!this.onBatchReorderCallback) {
      return;
    }

    // 提取所有拖拽选中的有效标的列表
    const itemsToMove: Array<{ sourceGroup: string; sourceSymbol: string }> = [];
    for (const dragged of rawList) {
      const sourceGroup = dragged.groupName;
      const sourceSymbol =
        dragged.confSymbol ||
        dragged.symbol ||
        dragged.id ||
        (dragged.item ? (dragged.item.symbol || dragged.item.id) : undefined);

      if (sourceGroup && sourceSymbol) {
        itemsToMove.push({ sourceGroup, sourceSymbol });
      }
    }

    if (itemsToMove.length === 0) {
      return;
    }

    // 严格限制：只能在当前分组内移动，禁止跨分组拖拽
    if (itemsToMove.some((item) => item.sourceGroup !== targetGroup)) {
      return;
    }

    // 若当前分组之前处于非默认排序（如涨幅/跌幅），拖拽意味着用户正在进行手动排列，自动重置为默认顺序
    if (this.getGroupSortMode(targetGroup) !== "default") {
      this.groupSortModes.set(targetGroup, "default");
      const group = this.getGroup(targetGroup);
      if (group) {
        group.sortMode = "default";
        group.updateDescription();
      }
      if (this.onGroupSortModeChangeCallback) {
        void this.onGroupSortModeChangeCallback(targetGroup, "default");
      }
    }

    // 使用原子化批量重排（单次落盘与重绘）
    if (this.onBatchReorderCallback) {
      await this.onBatchReorderCallback(itemsToMove, targetGroup, targetSymbol);
    }
  }

  isEmpty(): boolean {
    return this.groups.length === 0;
  }

  getTreeItem(element: GroupItem | StockItem): vscode.TreeItem {
    return element;
  }

  getChildren(
    element?: GroupItem | StockItem
  ): vscode.ProviderResult<(GroupItem | StockItem)[]> {
    if (!element) {
      return this.groups;
    }
    if (element instanceof GroupItem) {
      return element.children;
    }
    return [];
  }

  buildTree(
    config: WatchlistConfig,
    quoteMap: Map<string, MarketItem>,
    enabledSections: { fund?: boolean; aShare: boolean; hkStock?: boolean; usStock?: boolean; binance: boolean; alpha: boolean } = {
      fund: true,
      aShare: true,
      hkStock: true,
      usStock: true,
      binance: true,
      alpha: true,
    },
    autoCollapseClosedGroups?: boolean
  ): void {
    if (autoCollapseClosedGroups !== undefined) {
      this.autoCollapseClosedGroups = autoCollapseClosedGroups;
    }
    this.stockMap.clear();

    const isSectionEnabled = (type?: string): boolean => {
      if (!type) return true; // 中立空组不归属任何单一边界板块，默认保持展示
      const sec = ASSET_TYPE_TO_SECTION_MAP[type as keyof typeof ASSET_TYPE_TO_SECTION_MAP];
      if (!sec) return true;
      return enabledSections[sec] !== false;
    };

    const isGroupEnabled = (groupName: string, items?: WatchConfigItem[]): boolean => {
      if (groupName.includes("基金") || /\betf\b/i.test(groupName)) {
        return enabledSections.fund !== false;
      }
      if (items && items.length > 0) {
        // 先看组内 item 的真实 type：只要组内至少存在一个处于启用板块的标的，该组即保持展示
        return items.some((item) => item && item.symbol && isSectionEnabled(resolveItemAssetType(item, groupName)));
      }
      // 组内为空时，按组名关键词推导所属板块进行兜底；若为中立组（如 "自选"）推导为 undefined，返回 true 保持展示
      const inferredType = resolveItemAssetType({ symbol: "" }, groupName);
      return isSectionEnabled(inferredType);
    };

    const filteredEntries = Object.entries(config).filter(([groupName, items]) => {
      return isGroupEnabled(groupName, items);
    });

    const getGroupWeight = (name: string, items?: WatchConfigItem[]): number => {
      // 组名显式包含“基金”或“ETF”时，置于最顶层（排在 A 股上方，权重为 0）
      if (name.includes("基金") || /\betf\b/i.test(name)) {
        return 0;
      }
      // 组权重优先看组内标的主流类型，空组或无标的时按组名关键词兜底
      let dominantType: string | undefined;
      const firstValid = items?.find((it) => it && typeof it.symbol === "string" && it.symbol.trim() !== "");
      if (firstValid) {
        dominantType = resolveItemAssetType(firstValid, name);
      } else {
        dominantType = resolveItemAssetType({ symbol: "" }, name);
      }
      switch (dominantType) {
        case "A_SHARE": return 1;
        case "HK_STOCK": return 2;
        case "US_STOCK": return 3;
        case "CRYPTO": return 4;
        case "ALPHA_TOKEN":
        case "BSC_TOKEN": return 5;
        default: return 100; // 中立空组排在最后
      }
    };

    filteredEntries.sort((a, b) => getGroupWeight(a[0], a[1]) - getGroupWeight(b[0], b[1]));

    this.groups = filteredEntries.map(([groupName, items]) => {
      const activeItems = (items || []).filter((conf) =>
        conf && typeof conf.symbol === "string" && conf.symbol.trim() !== "" &&
        isSectionEnabled(resolveItemAssetType(conf, groupName))
      );
      const children = activeItems.map((conf) => {
        const normKey = normalizeSymbolKey(conf.symbol);
        const rawTicker = conf.symbol.toLowerCase().replace(/^(us|hk|sh|sz|bj)[\._\-]?/i, "");
        const found =
          quoteMap.get(normKey) ||
          quoteMap.get(conf.symbol) ||
          quoteMap.get(conf.symbol.toLowerCase()) ||
          quoteMap.get(rawTicker) || {
            id: conf.symbol,
            name: conf.name || conf.symbol,
            symbol: conf.symbol,
            type: conf.type,
            price: 0,
            changePercent: 0,
          };

        const alertRule = this.getAlertRule(conf.symbol, found);
        const node = new StockItem(found, groupName, conf.symbol, this.isMasked(), this.colorNeutral, alertRule, conf.name, this.colorScheme);
        // 使用规范化 key 存储，辅以原始 conf.symbol 索引，支持同一标的在不同分组中均能刷新
        const registerKey = (k?: string) => {
          if (!k) return;
          if (!this.stockMap.has(k)) {
            this.stockMap.set(k, []);
          }
          this.stockMap.get(k)!.push(node);
        };

        registerKey(normKey);
        if (conf.symbol !== normKey) {
          registerKey(conf.symbol);
          registerKey(conf.symbol.toLowerCase());
        }
        if (found.id && found.id !== conf.symbol) {
          registerKey(normalizeSymbolKey(found.id));
        }
        return node;
      });
      const sortMode = this.getGroupSortMode(groupName);
      const sortedChildren = this.sortStockItems(children, sortMode);
      const isClosed = isGroupMarketClosed(groupName, items, new Date());
      return new GroupItem(
        groupName,
        sortedChildren,
        sortMode,
        isClosed,
        this.autoCollapseClosedGroups,
        this.collapseSessionTag,
        this.forceExpandAll
      );
    });

    this._onDidChangeTreeData.fire();
  }

  applyQuotes(quotes: MarketItem[]): void {
    if (!quotes || quotes.length === 0) {
      return;
    }
    for (const q of quotes) {
      const candidates = [
        normalizeSymbolKey(q.symbol),
        normalizeSymbolKey(q.id),
        q.symbol,
        q.id,
        q.symbol?.toLowerCase(),
        q.id?.toLowerCase(),
      ];

      for (const key of candidates.filter(Boolean)) {
        const nodes = this.stockMap.get(key as string);
        if (nodes && nodes.length > 0) {
          for (const node of nodes) {
            const alertRule = this.getAlertRule(node.confSymbol, q);
            node.refresh(q, this.isMasked(), this.colorNeutral, alertRule, undefined, this.colorScheme);
          }
          break;
        }
      }
    }

    const now = new Date();
    for (const group of this.groups) {
      if (this.autoCollapseClosedGroups) {
        const closed = isGroupMarketClosed(
          group.groupName,
          group.children.map((c) => ({ symbol: c.confSymbol, type: c.item?.type })),
          now
        );
        if (group.isClosed !== closed) {
          group.isClosed = closed;
          group.applyCollapseState(
            this.autoCollapseClosedGroups,
            this.collapseSessionTag,
            this.forceExpandAll
          );
          group.updateDescription();
        }
      }
      // 针对处于非 default 排序模式（如涨幅、跌幅、现价）的分组，根据最新行情重新排序
      if (group.sortMode && group.sortMode !== "default" && group.children.length > 1) {
        const sorted = this.sortStockItems(group.children, group.sortMode);
        group.children.length = 0;
        group.children.push(...sorted);
        group.updateDescription();
      }
    }
    // 性能优化：循环内不逐个触发 49 次 IPC 重绘，统一在批量刷新完成后原子性触发 1 次刷新
    this._onDidChangeTreeData.fire();
  }

  private getAllUniqueNodes(): StockItem[] {
    const set = new Set<StockItem>();
    for (const list of this.stockMap.values()) {
      for (const node of list) {
        set.add(node);
      }
    }
    return Array.from(set);
  }

  private bossKeyActive = false;

  setBossKey(active: boolean): void {
    this.bossKeyActive = active;
    for (const node of this.getAllUniqueNodes()) {
      node.refresh(node.item, this.isMasked(), this.colorNeutral, undefined, undefined, this.colorScheme);
    }
    this._onDidChangeTreeData.fire();
  }

  isBossKeyActive(): boolean {
    return this.bossKeyActive;
  }

  private isMasked(): boolean {
    return isDisplayMasked(this.bossKeyActive, this.maskMode);
  }

  setMaskMode(enabled: boolean): void {
    this.maskMode = enabled;
    for (const node of this.getAllUniqueNodes()) {
      node.refresh(node.item, this.isMasked(), this.colorNeutral, undefined, undefined, this.colorScheme);
    }
    this._onDidChangeTreeData.fire();
  }

  setColorNeutral(enabled: boolean): void {
    this.colorNeutral = enabled;
    for (const node of this.getAllUniqueNodes()) {
      node.refresh(node.item, this.isMasked(), this.colorNeutral, undefined, undefined, this.colorScheme);
    }
    this._onDidChangeTreeData.fire();
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}