// src/types/index.ts

export type AssetType = "A_SHARE" | "HK_STOCK" | "US_STOCK" | "CRYPTO" | "BSC_TOKEN" | "ALPHA_TOKEN";

/**
 * 板块六项枚举的**唯一真相源**（AGENTS.md §5.2）。
 *
 * 类型 `MarketSection` 直接由这份值列表下标派生，杜绝旧版在 `types` 与 `utils/config`
 * 各写一份导致的「新增板块漏改其一，typecheck 不红但运行时集合漏项」双写风险。
 * `utils/config.ts` 再导出本常量，既有调用点的导入路径不变。
 */
export const MARKET_SECTIONS = ["fund", "aShare", "hkStock", "usStock", "binance", "alpha"] as const;
export type MarketSection = (typeof MARKET_SECTIONS)[number];
export type MarketType = MarketSection;

/**
 * 「有休市概念的板块子集」的唯一定义点。Binance / Alpha 为 7×24 市场，
 * 不得为其合成 `stopOnMarketClosed`（§6.10）；休市键白名单与导入落盘守卫一律取自此。
 */
export const MARKET_CLOSING_SECTIONS = ["fund", "aShare", "hkStock", "usStock"] as const;
export type MarketClosingSection = (typeof MARKET_CLOSING_SECTIONS)[number];

/**
 * 统一行情数据结构。
 *
 * 可选数值位一律显式允许 `undefined`：解析层（§6.13）对「上游未供数」的语义就是产出
 * `undefined`（如恒发 `"0"` 的换手率、指数的 `-1` 占位），而不是省略键。
 * 在 `exactOptionalPropertyTypes` 下，省略键与存 `undefined` 是两种类型，
 * 契约必须如实描述后者，否则各抓取服务只能靠类型断言绕过。
 */
export interface MarketItem {
  id: string;
  name: string;
  symbol: string;
  type: AssetType;
  price: number;
  changePercent: number;

  // ── 扩展行情字段 ──
  open?: number | undefined;       // 今日开盘价 / 24h 前参考价
  prevClose?: number | undefined;  // 昨日收盘价
  high?: number | undefined;       // 今日最高价
  low?: number | undefined;        // 今日最低价
  change?: number | undefined;     // 涨跌额
  volume?: number | undefined;     // 成交量
  turnover?: number | undefined;   // 成交额 (USD / CNY / HKD)
  currency?: "CNY" | "USD" | "HKD" | "USDT" | undefined; // 计价货币（加密标的统一 U 本位，见 AGENTS.md §6.9）

  // ── 深度量价与估值指标（A股等板块） ──
  turnoverRate?: number | undefined;           // 换手率 %
  peTtm?: number | undefined;                  // 市盈率 (TTM)
  pb?: number | undefined;                     // 市净率
  amplitude?: number | undefined;              // 振幅 %
  circulationMarketValue?: number | undefined; // 流通市值 (基准货币单位：元)
  totalMarketValue?: number | undefined;       // 总市值 (基准货币单位：元)
  limitUp?: number | undefined;                // 涨停价
  limitDown?: number | undefined;              // 跌停价
  volumeRatio?: number | undefined;            // 量比
  avgPrice?: number | undefined;               // 日内成交均价

  // ── Alpha 链上代币专属字段 ──
  chain?: string | undefined;      // 公链标识，如 "bsc", "solana", "base", "ethereum"
  dex?: string | undefined;        // 所在 DEX，如 "pancakeswap", "raydium", "uniswap", "pumpfun"
  liquidity?: number | undefined;  // 流动性池资金 (USD)
}

// 兼容别名
export type Quote = MarketItem;

export interface WatchConfigItem {
  symbol: string;
  name?: string;
  type: AssetType;
  cost?: number;   // 持仓买入成本单价
  shares?: number; // 持仓数量/股数/币数
}

export interface WatchlistConfig {
  [group: string]: WatchConfigItem[];
}

// ── 价格预警与剧烈波动类型 ──
export interface PriceAlertItem {
  symbol: string;
  name?: string | undefined;
  above?: number | undefined;          // 突破上限价格 (> X)
  below?: number | undefined;          // 跌破下限价格 (< X)
  changePercent?: number | undefined;  // 单日涨跌幅突破绝对值 (|%| >= X)
  enabled: boolean;        // 是否启用预警
}

export type AlertsConfig = Record<string, PriceAlertItem>;

export type ColorScheme = "greenUpRedDown" | "redUpGreenDown";

/** 分组排序模式 */
export type GroupSortMode =
  | "default"     // 默认顺序（手动排列）
  | "changeDesc"  // 按涨幅排序（涨跌幅从高到低）
  | "changeAsc"   // 按跌幅排序（涨跌幅从低到高）
  | "nameAsc"     // 按名称排序（按股票名称拼音排序）
  | "priceDesc";  // 按现价排序（按当前价格从高到低）

export interface MarketLensConfig {
  // ── 全局设置 ──
  autoRefresh: boolean;
  refreshInterval: number;
  maskMode: boolean;
  colorNeutral: boolean;
  colorScheme: ColorScheme;
  statusBar: { enabled: boolean; holdingEnabled?: boolean; holdingInterval?: number };
  autoCollapseClosedGroups?: boolean;
  proxyPort?: number;
  proxyUrl?: string;

  // ── 分板块独立设置 ──
  fund:    { enabled: boolean; networkMode: "proxy" | "direct"; proxyUrl: string; stopOnMarketClosed: boolean; statusBar: boolean };
  aShare:  { enabled: boolean; networkMode: "proxy" | "direct"; proxyUrl: string; stopOnMarketClosed: boolean; statusBar: boolean };
  hkStock: { enabled: boolean; networkMode: "proxy" | "direct"; proxyUrl: string; stopOnMarketClosed: boolean; statusBar: boolean };
  usStock: { enabled: boolean; networkMode: "proxy" | "direct"; proxyUrl: string; stopOnMarketClosed: boolean; statusBar: boolean };
  binance: { enabled: boolean; networkMode: "proxy" | "direct"; proxyUrl: string; statusBar: boolean };
  alpha:   { enabled: boolean; networkMode: "proxy" | "direct"; proxyUrl: string; statusBar: boolean };

  // ── 自选列表 ──
  watchlist: WatchlistConfig;

  // ── 预警配置 ──
  alerts: AlertsConfig;
  alertNotificationMode: "notification" | "statusBarOnly" | "both";
  alertCooldownMinutes: number;
}