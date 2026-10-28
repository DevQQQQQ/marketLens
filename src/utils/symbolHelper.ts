// src/utils/symbolHelper.ts
import type { AssetType, MarketSection, WatchConfigItem, MarketItem, PriceAlertItem, AlertsConfig } from "../types";
import { isAShareMarketOpen, isHKMarketOpen, isUSMarketOpen } from "./marketHours.ts";
export type { AssetType, MarketSection, WatchConfigItem };

/** 磁盘/外部 JSON 可能携带的原型污染键名，任何读写路径都必须丢弃 */
const DANGEROUS_CONFIG_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isDangerousKey(key: string): boolean {
  return DANGEROUS_CONFIG_KEYS.has(key);
}

function positiveFinite(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : undefined;
}

/**
 * 资产底层类型 (AssetType) 到市场业务板块 (MarketSection) 的全局唯一映射字典
 * 集中收敛板块判定，杜绝在不同模块平行手写 switch (type) 导致的分支漂移
 */
export const ASSET_TYPE_TO_SECTION_MAP: Record<AssetType, MarketSection> = {
  A_SHARE: "aShare",
  HK_STOCK: "hkStock",
  US_STOCK: "usStock",
  CRYPTO: "binance",
  BSC_TOKEN: "alpha",
  ALPHA_TOKEN: "alpha",
};

/**
 * 分组名是否属于基金板块。
 *
 * 基金没有独立 AssetType（场内 ETF 复用 A股行情通道，`resolveItemAssetType` 返回 `A_SHARE`），
 * 板块归属只能由分组名判定。本函数是该判定的**唯一实现**，禁止在各模块就地复制
 * `includes("基金") || /\betf\b/i.test(...)`——复制即漂移（AGENTS.md §5.3）。
 */
export function isFundGroupName(groupName?: string): boolean {
  if (!groupName) return false;
  return groupName.includes("基金") || /\betf\b/i.test(groupName);
}

/**
 * 解析条目所属业务板块：板块开关判定与条目级过滤必须共用本出口（AGENTS.md §5.3）。
 *
 * 基金由分组名门控（`isFundGroupName`），其余板块经 `ASSET_TYPE_TO_SECTION_MAP` 映射。
 * 若只按映射表判定，基金条目会被 `aShare` 开关错误过滤——分组显示、条目全空。
 * 返回 undefined 表示中立分组（如「自选」），不归属任何单一板块，默认保持展示。
 */
export function resolveItemSection(
  item: { symbol?: string; type?: string },
  groupName: string
): MarketSection | undefined {
  if (isFundGroupName(groupName)) return "fund";
  const assetType = resolveItemAssetType(item, groupName);
  return assetType ? ASSET_TYPE_TO_SECTION_MAP[assetType] : undefined;
}

/**
 * 解析分组所属业务板块（单一真相源）：
 * 优先依据组内首个有效标的判定；若组为空则依据分组名推导。
 */
export function resolveGroupSection(
  groupName: string,
  items?: Array<{ symbol?: string; type?: string }>
): MarketSection | undefined {
  if (isFundGroupName(groupName)) return "fund";
  if (items && items.length > 0) {
    const firstValid = items.find((it) => it && (it.symbol || it.type));
    if (firstValid) {
      const sec = resolveItemSection(firstValid, groupName);
      if (sec) return sec;
    }
  }
  return resolveItemSection({ symbol: "" }, groupName);
}

export function isContractAddress(str: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(str) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(str);
}

/** `deriveTodayProfit` 所需的最小行情字段集（MarketItem 与持仓条目均结构兼容） */
export interface TodayProfitSource {
  price: number;
  // 入参来自 MarketItem / HoldingItemQuote，四个来源都可能「上游未供数 = undefined」，
  // 这正是 deriveTodayProfit 的降级链要逐个判定的前提，契约必须如实允许 undefined。
  change?: number | undefined;
  open?: number | undefined;
  prevClose?: number | undefined;
  changePercent?: number | undefined;
}

/**
 * 今日盈亏反推的**唯一实现**（AGENTS.md §5.5）。
 *
 * 优先级：报文真实涨跌额 > 今开价差 > 昨收价差 > 由涨跌幅反推昨收。
 * 新增展示位需要该数值时必须调用本函数，禁止就地复制公式——
 * 侧边栏卡片、状态栏持仓条、持仓看板曾各写一份，任一处口径调整就会产生两套盈亏数字。
 */
export function deriveTodayProfit(source: TodayProfitSource, shares: number): number {
  if (source.change !== undefined && Number.isFinite(source.change)) {
    return source.change * shares;
  }
  if (source.open !== undefined && source.open > 0) {
    return (source.price - source.open) * shares;
  }
  if (source.prevClose !== undefined && source.prevClose > 0) {
    return (source.price - source.prevClose) * shares;
  }
  if (source.price > 0 && source.changePercent !== undefined && Number.isFinite(source.changePercent)) {
    const r = source.changePercent / 100;
    const prevPrice = r > -1 ? source.price / (1 + r) : source.price;
    return (source.price - prevPrice) * shares;
  }
  return 0;
}

/**
 * 校验两个股票/代币代码是否代表同一个标的
 * 兼容 A股/港股/美股/加密货币 的各种格式：
 * - A股：sh600030 vs 600030，但严格区分不同交易所如 sh000001 vs sz000001
 * - 港股：hk06030 vs 06030 vs hk6030 vs 6030
 * - 美股：AAPL vs usAAPL vs us.AAPL
 * - 币安/链上：BTCUSDT vs btcusdt, 合约地址大小写不敏感等
 */
export function isSameSymbol(a?: string, b?: string): boolean {
  if (!a || !b) {
    return false;
  }
  const orig1 = a.trim();
  const orig2 = b.trim();
  const s1 = orig1.toLowerCase();
  const s2 = orig2.toLowerCase();
  if (s1 === s2) {
    return true;
  }

  const clean1 = s1.replace(/[\._\-\/]/g, "");
  const clean2 = s2.replace(/[\._\-\/]/g, "");
  if (clean1 === clean2) {
    return true;
  }

  // 区分美股显式前缀 vs 真实美股代码（如 USB, USM, USFD）
  // 仅在带显式分隔符（us. / us_ / us-）或小写 us + 大写代码（如 usAAPL, usAMD, usNET）时才提取 us 前缀
  const extractPrefix = (orig: string, clean: string) => {
    // 港股 / A股前缀：sh, sz, bj, hk
    const mStock = clean.match(/^(sh|sz|bj|hk)(\d+)$/i);
    if (mStock) {
      return { prefix: mStock[1].toLowerCase(), code: mStock[2] };
    }
    // 美股显式分隔符: us.AAPL, us_AAPL, us-AAPL
    const mUsDelim = orig.match(/^us[\._\-](.+)$/i);
    if (mUsDelim) {
      return { prefix: "us", code: mUsDelim[1].replace(/[\._\-]/g, "").toLowerCase() };
    }
    // 腾讯美股前缀: 小写 us + 大写字母 (如 usAAPL, usAMD, usNET, usTSM, usARM, usB, usUSB, usBRK.B)
    // 区分大小写，真实大写 ticker (如 USB, USM, USA) 首字母为大写 U，不会被误提取
    if (/^us[A-Z]/.test(orig)) {
      return { prefix: "us", code: orig.slice(2).replace(/[\._\-]/g, "").toLowerCase() };
    }
    return null;
  };

  const p1 = extractPrefix(orig1, clean1);
  const p2 = extractPrefix(orig2, clean2);

  if (p1 && p2) {
    if (p1.prefix !== p2.prefix) {
      return false;
    }
    if (p1.code === p2.code) {
      return true;
    }
    if (/^\d+$/.test(p1.code) && /^\d+$/.test(p2.code)) {
      return p1.code.replace(/^0+/, "") === p2.code.replace(/^0+/, "");
    }
    return false;
  }

  const raw1 = p1 ? p1.code : clean1;
  const raw2 = p2 ? p2.code : clean2;
  if (raw1 === raw2) {
    return true;
  }

  if (/^\d+$/.test(raw1) && /^\d+$/.test(raw2)) {
    return raw1.replace(/^0+/, "") === raw2.replace(/^0+/, "");
  }

  return false;
}

/**
 * 标的代码规范化（用于 Map 快速精确定位，避免为单个标的建立 6~10 个冗余别名）
 */
export function normalizeSymbolKey(sym?: string): string {
  if (!sym) return "";
  const s = sym.trim();
  const clean = s.toLowerCase().replace(/[\._\-\/]/g, "");

  // 1. 如果是港股：去除 hk 前缀及前导 0，如 hk00700 -> hk700, 00700 -> hk700
  if (/^hk\d+$/.test(clean)) {
    return "hk" + clean.slice(2).replace(/^0+/, "");
  }
  if (/^\d{5}$/.test(clean)) {
    return "hk" + clean.replace(/^0+/, "");
  }
  if (clean === "hsi" || clean === "hkhsi") return "hkhsi";
  if (clean === "hstech" || clean === "hkhstech") return "hkhstech";

  // 2. 如果是美股：去除显式分隔符前缀（如 us.aapl, us_aapl, us-aapl -> aapl, us.usb -> usb, us.brk.b -> brkb）
  if (/^us[\._\-]/i.test(s)) {
    return s.replace(/^us[\._\-]/i, "").toLowerCase().replace(/[\._\-\/]/g, "");
  }

  // 3. 腾讯美股前缀格式（区分大小写：小写 us + 大写字母，如 usAAPL -> aapl, usAMD -> amd, usNET -> net, usUSB -> usb, usBRK.B -> brkb）
  // 真实大写 ticker（如 USB, USM, USA）首字母为大写 U，不会被误剥离
  if (/^us[A-Z]/.test(s)) {
    return s.slice(2).toLowerCase().replace(/[\._\-\/]/g, "");
  }

  // A股保留 sh/sz/bj 前缀，其他（包括 USB, B, BTCUSDT, SOL/USDT, 合约地址等）直接返回 clean
  return clean;
}

/**
 * 集中统一剥离标的的市场/交易所前缀（如 sh/sz/bj/hk/us），用于弱规则模糊匹配
 */
export function stripMarketPrefix(sym: string): string {
  if (!sym) return "";
  return sym.toLowerCase().replace(/^(us|hk|sh|sz|bj)[\._\-\/]?/i, "");
}

/**
 * 嵌入 Webview 设置面板前端 JS 的标的归一化函数体源码
 * （单一真相源导出，Webview 沙箱直接注入消费，杜绝前后端正则分支漂移）
 */
export const NORMALIZE_SYMBOL_KEY_CLIENT_SCRIPT = `
function getSymbolKey(sym) {
  if (!sym) return '';
  var s = sym.trim();
  var clean = s.toLowerCase().replace(/[\\._\\-\\/]/g, '');
  if (/^hk\\d+$/.test(clean)) return 'hk' + clean.slice(2).replace(/^0+/, '');
  if (/^\\d{5}$/.test(clean)) return 'hk' + clean.replace(/^0+/, '');
  if (clean === 'hsi' || clean === 'hkhsi') return 'hkhsi';
  if (clean === 'hstech' || clean === 'hkhstech') return 'hkhstech';
  if (/^us[\\._\\-]/i.test(s)) return s.replace(/^us[\\._\\-]/i, '').toLowerCase().replace(/[\\._\\-\\/]/g, '');
  if (/^us[A-Z]/.test(s)) return s.slice(2).toLowerCase().replace(/[\\._\\-\\/]/g, '');
  return clean;
}
`.trim();

/**
 * 规范化美股抓取代码（Tencent 接口格式，如 "AMD" -> "usAMD", "usAMD" -> "usAMD", "us.IXIC" -> "usIXIC", "BRK.B" -> "usBRK.B"）
 */
export function normalizeUSCode(raw: string): string {
  const clean = raw.trim().replace(/^r_/, "");
  // 如果带显式 us 分隔符（如 us.AAPL, us_AAPL, us-AAPL, us.BRK.B）
  if (/^us[\._\-]/i.test(clean)) {
    const ticker = clean.replace(/^us[\._\-]/i, "").toUpperCase().replace(/[\-_/]/g, ".");
    return `us${ticker}`;
  }
  if (clean.startsWith(".")) {
    return `us${clean.slice(1).toUpperCase()}`;
  }
  // 如果已带腾讯格式前缀：小写 us 开头后紧跟大写字母（如 usAAPL, usAMD, usNET, usTSM, usARM, usB, usUSB, usBRK.B）
  if (/^us[A-Z]/.test(clean)) {
    const ticker = clean.slice(2).toUpperCase().replace(/[\-_/]/g, ".");
    return `us${ticker}`;
  }
  // 否则原生美股 ticker（如 AAPL, B, USB, USFD, BRK.B, BRK-B），类股连字符统一映射为点号
  const ticker = clean.toUpperCase().replace(/[\-_/]/g, ".");
  return `us${ticker}`;
}

/**
 * 依据 6 位 A 股代码推断所属交易所前缀（沪 sh / 深 sz / 北 bj）
 *
 * 采用「明确代码段优先 + 首位兜底」两级判定，供输入解析与行情抓取共用，确保两端规则绝对一致。
 * 修复此前「6/9→sh，0/3→sz，其余一律 bj」的粗暴推断所导致的严重误判：
 * - 5xxxxx（沪市基金/ETF，如 510300）曾被误判为 bj；
 * - 1xxxxx（深市债/基金，如 159915）曾被误判为 bj；
 * - 2xxxxx（深市 B 股，如 200011）曾被误判为 bj。
 * 上述标的加前缀后腾讯接口始终返回空，表现为永久「获取行情中…」。
 */
export function inferAShareExchange(code: string): "sh" | "sz" | "bj" {
  const c = String(code || "").trim();
  if (!/^\d{6}$/.test(c)) {
    return "sh";
  }

  // 1. 北交所 / 新三板：43 / 83 / 87 / 88 / 92 开头
  if (/^(43|83|87|88|92)/.test(c)) {
    return "bj";
  }

  // 2. 沪市债券与可转债：110/111/113/118 可转债，122 企业债，019/018/010/020 国债企债
  if (/^(110|111|113|118|122|019|018|010|020)/.test(c)) {
    return "sh";
  }

  // 3. 深市债券与可转债：123/127/128 可转债，100/112 债
  if (/^(100|112|123|127|128)/.test(c)) {
    return "sz";
  }

  // 4. 首位兜底 —— 沪市：5 基金/ETF/LOF、6 股票、9 B股
  if (/^[569]/.test(c)) {
    return "sh";
  }

  // 5. 首位兜底 —— 深市：0 股票、1 债/基金、2 B股、3 创业板
  if (/^[0123]/.test(c)) {
    return "sz";
  }

  // 6. 剩余未识别段位（4xxxxx 老三板等）归入北交所
  return "bj";
}

/**
 * 规范化 A 股代码：已带 sh/sz/bj 前缀则原样返回，否则按代码段补齐正确交易所前缀
 */
export function normalizeAShareCode(raw: string): string {
  const code = String(raw || "").trim().toLowerCase();
  if (/^(sh|sz|bj)/.test(code)) {
    return code;
  }
  if (/^\d{6}$/.test(code)) {
    return `${inferAShareExchange(code)}${code}`;
  }
  // 非标准 6 位代码保持既有兜底语义，避免影响历史自定义配置
  if (/^[69]/.test(code)) { return `sh${code}`; }
  if (/^[03]/.test(code)) { return `sz${code}`; }
  if (/^[48]/.test(code)) { return `bj${code}`; }
  return `sh${code}`;
}

/**
 * 确定标的的资产类型（统一裁决逻辑，供网络抓取 extractTargets 与视图构建 buildTree 共享）
 * 判定策略阶梯（分层仲裁）：
 * 1. 【一等公民】显式 type 拥有最高裁决权；
 * 2. 【代码强特征】物理属性绝对优先（合约地址、sh/sz/bj/6位数字、hk/5位数字、us前缀/指数、稳定币计价对），彻底免疫组名误导；
 * 3. 【组名指示】当代码为裸代码或空组时，根据分组名称关键词推导资产类别；
 * 4. 【裸代码兜底】纯字母（1~5位）归为美股，其余归为加密货币；
 * 5. 【纯中立空组】既无有效代码，分组名又无任何市场特征（如 "自选"、"默认分组"），返回 undefined，由调用方单独中立处理。
 */
export function resolveItemAssetType(
  item: { symbol?: string; type?: string } | null | undefined,
  groupName: string = ""
): AssetType | undefined {
  if (!item || typeof item !== "object") {
    return undefined;
  }

  // ── Level 1: 显式 type 拥有绝对优先裁决权 ──
  const type = item.type;
  if (type === "ALPHA_TOKEN" || type === "BSC_TOKEN") return "ALPHA_TOKEN";
  if (type === "CRYPTO") return "CRYPTO";
  if (type === "HK_STOCK") return "HK_STOCK";
  if (type === "US_STOCK") return "US_STOCK";
  if (type === "A_SHARE") return "A_SHARE";

  const rawSym = item.symbol;
  const sym = typeof rawSym === "string" ? rawSym.trim() : "";
  const lowerGroup = groupName.toLowerCase();

  // ── Level 2: 代码绝对强特征（物理属性强确定，完全免疫组名） ──
  if (sym) {
    // 2.1 链上 DEX / Alpha 合约地址
    if (isContractAddress(sym)) {
      return "ALPHA_TOKEN";
    }

    // 2.2 A股绝对强特征：带 sh/sz/bj 前缀或 6 位纯数字
    if (/^(sh|sz|bj)\d{4,6}$/i.test(sym) || /^\d{6}$/.test(sym)) {
      return "A_SHARE";
    }

    // 2.3 港股绝对强特征：带 hk 前缀或 5 位纯数字
    if (/^(?:r_)?hk\d{1,5}$/i.test(sym) || /^\d{5}$/.test(sym)) {
      return "HK_STOCK";
    }

    // 2.4 加密货币强特征：以主流稳定币开头或结尾的明确交易对（优先于美股 us 前缀，彻底杜绝 USTCUSDT / USDPUSDT / USUALUSDT 等币对被误判）
    if (
      /^(usdt|usdc|usd1|usdd|usde|usds|usdy|usdx|usual|fdusd|tusd|pyusd|dai)/i.test(sym) ||
      /(usdt|usdc|busd|fdusd|tusd|pyusd|dai)$/i.test(sym)
    ) {
      return "CRYPTO";
    }

    // 2.5 美股绝对强特征：指数、带分隔符前缀（us.AAPL / us_TSLA）、腾讯美股格式（usAAPL / usNET / usBRK.B 等）、类股代码（如 BRK.B, BF.B, BRK-B）
    if (
      sym.startsWith(".") ||
      /^us[\._\-]/i.test(sym) ||
      (/^us[a-zA-Z]/i.test(sym) && !/^(usdt|usdc|usd1|usdd|usde|usds|usdy|usdx|usual|fdusd|tusd|pyusd|dai)/i.test(sym)) ||
      /^[a-zA-Z]{1,5}[\.\-_/][a-zA-Z]{1,2}$/.test(sym)
    ) {
      return "US_STOCK";
    }
  }

  // ── Level 3: 组名倾向性推导（用于裸代码或空组） ──
  // 3.1 链上特征
  if (
    lowerGroup.includes("alpha") ||
    lowerGroup.includes("bsc") ||
    lowerGroup.includes("dex") ||
    groupName.includes("链上")
  ) {
    return "ALPHA_TOKEN";
  }

  // 3.2 加密货币特征
  if (
    lowerGroup.includes("binance") ||
    lowerGroup.includes("crypto") ||
    lowerGroup.includes("usdt") ||
    lowerGroup.includes("usdc") ||
    groupName.includes("币安") ||
    groupName.includes("加密")
  ) {
    return "CRYPTO";
  }

  // 3.3 港股特征
  if (
    groupName.includes("港股") ||
    /\bhk\b/i.test(groupName)
  ) {
    return "HK_STOCK";
  }

  // 3.4 美股特征
  if (
    groupName.includes("美股") ||
    /\bus\b/i.test(groupName)
  ) {
    return "US_STOCK";
  }

  // 3.5 A股与场内基金/ETF特征
  if (
    groupName.includes("A股") ||
    groupName.includes("a股") ||
    lowerGroup.includes("ashare") ||
    isFundGroupName(groupName)
  ) {
    return "A_SHARE";
  }

  // ── Level 4: 弱代码与裸代码兜底推断（组名也无任何提示） ──
  // 纯字母且无特殊标记的 1~5 位裸代码（如 AAPL, TSLA, NVDA）或类股代码（如 BRK.B, BF.B）
  if (sym && (/^[a-zA-Z]{1,5}$/.test(sym) || /^[a-zA-Z]{1,5}[\.\-_/][a-zA-Z]{1,2}$/.test(sym))) {
    return "US_STOCK";
  }

  // 若存在其他代码但未命中上述特征，兜底落入 CRYPTO（如 DOGE、PEPE 等任意自定义币种裸代码）
  if (sym) {
    return "CRYPTO";
  }

  // ── Level 5: 既无代码，组名又无任何市场特征（如中立空组 "自选"、"我的关注"），返回 undefined ──
  return undefined;
}

/**
 * 纯算法函数：深度清洗与规整 watchlist 配置
 * 1. 过滤非对象、null、数组等非法根结构，兜底为空字典 {}；
 * 2. 对每个分组，若其值为非数组（如 null、undefined、非数组对象）则规整为空数组 []；
 * 3. 兼容字符串简写（如 ["sh600519"]），自动规整为合规的 WatchConfigItem；
 * 4. 彻底剔除 null、undefined、非对象以及 symbol 为空/非法的脏元素；
 * 5. 校验并补齐合规的 AssetType，未知时使用 resolveItemAssetType 依据代码与组名推导；
 * 6. 清理 name 字段的空白字符串（忽略非 string 或空串）。
 */
export function sanitizeWatchlist(raw: unknown): Record<string, WatchConfigItem[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const result: Record<string, WatchConfigItem[]> = {};

  for (const [group, items] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(items)) {
      result[group] = [];
      continue;
    }

    const cleanItems: WatchConfigItem[] = [];
    for (const it of items) {
      if (typeof it === "string") {
        const sym = it.trim();
        if (sym) {
          const inferredType = resolveItemAssetType({ symbol: sym }, group) || "A_SHARE";
          cleanItems.push({ symbol: sym, type: inferredType });
        }
      } else if (it && typeof it === "object" && !Array.isArray(it)) {
        const candidate = it as Record<string, unknown>;
        if (typeof candidate.symbol === "string") {
          const sym = candidate.symbol.trim();
          if (sym) {
            const rawType = candidate.type;
            const validAssetType: AssetType | undefined =
              rawType === "ALPHA_TOKEN" || rawType === "BSC_TOKEN"
                ? "ALPHA_TOKEN"
                : rawType === "CRYPTO"
                  ? "CRYPTO"
                  : rawType === "HK_STOCK"
                    ? "HK_STOCK"
                    : rawType === "US_STOCK"
                      ? "US_STOCK"
                      : rawType === "A_SHARE"
                        ? "A_SHARE"
                        : undefined;

            const item: WatchConfigItem = {
              symbol: sym,
              type: validAssetType || resolveItemAssetType({ symbol: sym }, group) || "A_SHARE",
            };

            if (typeof candidate.name === "string" && candidate.name.trim() !== "") {
              item.name = candidate.name.trim();
            }

            if (typeof candidate.cost === "number" && Number.isFinite(candidate.cost) && candidate.cost >= 0) {
              item.cost = candidate.cost;
            }

            if (typeof candidate.shares === "number" && Number.isFinite(candidate.shares) && candidate.shares > 0) {
              item.shares = candidate.shares;
            }

            cleanItems.push(item);
          }
        }
      }
    }

    result[group] = cleanItems;
  }

  return result;
}

/**
 * 归一化单条预警规则：数值必须为有限正数，非法一律丢弃。
 * 返回 null 表示这条规则没有任何生效阈值（等同删除）。
 */
function normalizeAlertRule(raw: unknown): PriceAlertItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  const above = positiveFinite(candidate.above);
  const below = positiveFinite(candidate.below);
  const changePercent = positiveFinite(candidate.changePercent);

  if (above === undefined && below === undefined && changePercent === undefined) {
    return null;
  }

  const symbol = typeof candidate.symbol === "string" ? candidate.symbol.trim() : "";
  if (!symbol) {
    return null;
  }

  const rule: PriceAlertItem = { symbol, enabled: candidate.enabled !== false };
  if (above !== undefined) rule.above = above;
  if (below !== undefined) rule.below = below;
  if (changePercent !== undefined) rule.changePercent = changePercent;
  if (typeof candidate.name === "string" && candidate.name.trim() !== "") {
    rule.name = candidate.name.trim();
  }
  return rule;
}

/**
 * 预警规则消毒：`alerts` 与 `watchlist` 一样来自磁盘 JSON，禁止 `cfg.get("alerts", {})` 裸取后直接消费。
 *
 * 丢弃内容：非对象输入、原型污染键（`__proto__` / `constructor` / `prototype`）、
 * 无有效阈值的规则、非有限/非正数的阈值。
 */
export function sanitizeAlerts(raw: unknown): AlertsConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const result: AlertsConfig = Object.create(null);
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isDangerousKey(key)) {
      continue;
    }
    const rule = normalizeAlertRule(value);
    if (rule) {
      result[key] = rule;
    }
  }
  return result;
}

/**
 * 按标的增量合并预警规则（设置面板唯一的 alerts 写入口）。
 *
 * 为什么不能整幅镜像回写：后端快照会在防抖窗口内覆盖用户尚未落盘的其他编辑，
 * 且同一标的的历史别名键（大小写 / 前缀形态）会永久并存，导致冷却键与静音失效。
 * 因此本函数以**磁盘现值**为基准，只改动目标标的：写入规范键、回收该标的的全部别名键。
 *
 * @param diskAlerts 磁盘上的现有 alerts（已消毒）
 * @param rawKey     前端送来的标的键
 * @param rawRule    规则对象；传 null / undefined 表示删除该标的的所有预警
 * @returns 合并后的新对象；rawKey 非法时返回 null 表示拒绝本次写入
 */
export function applyAlertRuleDelta(
  diskAlerts: AlertsConfig,
  rawKey: unknown,
  rawRule: unknown
): AlertsConfig | null {
  if (typeof rawKey !== "string") {
    return null;
  }
  const trimmed = rawKey.trim();
  if (!trimmed || isDangerousKey(trimmed)) {
    return null;
  }

  const canonicalKey = normalizeSymbolKey(trimmed) || trimmed.toLowerCase();
  if (!canonicalKey || isDangerousKey(canonicalKey)) {
    return null;
  }

  const rule = normalizeAlertRule(rawRule);

  const next: AlertsConfig = {};
  for (const [existingKey, existingRule] of Object.entries(diskAlerts || {})) {
    if (isDangerousKey(existingKey)) {
      continue;
    }
    const existingCanonical = normalizeSymbolKey(existingKey) || existingKey.toLowerCase();
    // 同一标的的规范键与历史别名键全部先剔除，再按需只写回规范键那一条。
    // 别名判定同时走 isSameSymbol：`sh600519` / `SH600519` / `600519` 这类同标的多形态键
    // 若并存，会让冷却键与静音判定按键形态分裂失效（§5.5）。
    if (existingCanonical === canonicalKey || isSameSymbol(existingKey, canonicalKey)) {
      continue;
    }
    const normalized = normalizeAlertRule(existingRule);
    if (normalized) {
      next[existingKey] = normalized;
    }
  }

  if (rule) {
    next[canonicalKey] = rule;
  }
  return next;
}

/**
 * 计算自选标的的唯一代码集合指纹（完全忽略分组归属与排列顺序）
 * 仅当有标的新增或删除（即全局监控标的集合改变）时指纹才会改变
 * 同组拖拽重排、跨组移动等仅改变本地展示层级，不会改变此指纹，避免重复触发全量网络请求
 */
export type RawWatchlistItem = unknown;
export type RawWatchlistMap = Record<string, RawWatchlistItem[]>;

export function getWatchlistFingerprint(watchlist: RawWatchlistMap): string {
  const allSymbols = new Set<string>();
  for (const items of Object.values(watchlist || {})) {
    for (const it of items || []) {
      const rawSym =
        typeof it === "string"
          ? it
          : it && typeof it === "object" && "symbol" in it
            ? (it as Record<string, unknown>).symbol
            : undefined;
      const norm = typeof rawSym === "string" ? normalizeSymbolKey(rawSym) : undefined;
      if (norm) {
        allSymbols.add(norm);
      }
    }
  }
  return Array.from(allSymbols).sort().join(",");
}

export interface TargetExtractionOptions {
  fundEnabled?: boolean | undefined;
  aShareEnabled?: boolean | undefined;
  hkStockEnabled?: boolean | undefined;
  usStockEnabled?: boolean | undefined;
  binanceEnabled?: boolean | undefined;
  alphaEnabled?: boolean | undefined;
  /** 调用方传入的可空分组名（全局刷新时为 undefined），与下方 `= undefined` 解构默认值同源 */
  specificGroupName?: string | undefined;
  skipFund?: boolean | undefined;
  skipAShare?: boolean | undefined;
  skipHKStock?: boolean | undefined;
  skipUSStock?: boolean | undefined;
  skipBinance?: boolean | undefined;
  skipAlpha?: boolean | undefined;
}

export interface ExtractedTargets {
  funds: string[];
  aShares: string[];
  hkStocks: string[];
  usStocks: string[];
  cryptos: string[];
  bscTokens: string[];
}

/**
 * 纯算法函数：从 watchlist 中按板块开关和闭市状态分桶提取抓取代码
 */
export function extractTargetsFromWatchlist(
  watchlist: Record<string, Array<{ symbol?: string; name?: string; type?: string }>>,
  options: TargetExtractionOptions = {}
): ExtractedTargets {
  const {
    fundEnabled = true,
    aShareEnabled = true,
    hkStockEnabled = true,
    usStockEnabled = true,
    binanceEnabled = true,
    alphaEnabled = true,
    specificGroupName,
    skipFund = false,
    skipAShare = false,
    skipHKStock = false,
    skipUSStock = false,
    skipBinance = false,
    skipAlpha = false,
  } = options;

  const funds: string[] = [];
  const aShares: string[] = [];
  const hkStocks: string[] = [];
  const usStocks: string[] = [];
  const cryptos: string[] = [];
  const bscTokens: string[] = [];

  for (const [groupName, items] of Object.entries(watchlist || {})) {
    if (specificGroupName && groupName !== specificGroupName) {
      continue;
    }

    const isFundGroup = isFundGroupName(groupName);

    for (const item of items ?? []) {
      const sym = item?.symbol;
      if (!sym) {
        continue;
      }

      const resolvedType = resolveItemAssetType(item, groupName);

      if (resolvedType === "ALPHA_TOKEN" || resolvedType === "BSC_TOKEN") {
        if (alphaEnabled && !skipAlpha) {
          bscTokens.push(sym);
        }
      } else if (resolvedType === "CRYPTO") {
        if (binanceEnabled && !skipBinance) {
          cryptos.push(sym);
        }
      } else if (resolvedType === "HK_STOCK") {
        if (hkStockEnabled && !skipHKStock) {
          hkStocks.push(sym);
        }
      } else if (resolvedType === "US_STOCK") {
        if (usStockEnabled && !skipUSStock) {
          usStocks.push(sym);
        }
      } else if (resolvedType === "A_SHARE") {
        if (isFundGroup) {
          if (fundEnabled && !skipFund) {
            funds.push(sym);
          }
        } else {
          if (aShareEnabled && !skipAShare) {
            aShares.push(sym);
          }
        }
      }
    }
  }

  return {
    funds: [...new Set(funds)],
    aShares: [...new Set(aShares)],
    hkStocks: [...new Set(hkStocks)],
    usStocks: [...new Set(usStocks)],
    cryptos: [...new Set(cryptos)],
    bscTokens: [...new Set(bscTokens)],
  };
}

export interface StatusBarQuotesOptions {
  statusBarEnabled?: boolean;
  autoCollapseClosedGroups?: boolean;
  now?: Date;
  fund?: { enabled?: boolean; statusBar?: boolean };
  aShare?: { enabled?: boolean; statusBar?: boolean };
  hkStock?: { enabled?: boolean; statusBar?: boolean };
  usStock?: { enabled?: boolean; statusBar?: boolean };
  binance?: { enabled?: boolean; statusBar?: boolean };
  alpha?: { enabled?: boolean; statusBar?: boolean };
}

/**
 * 判断指定标的所属的市场当前是否处于休市状态（用于休市折叠与状态栏过滤）
 */
export function isItemMarketClosed(
  item: { symbol?: string; type?: string },
  groupName: string = "",
  now: Date = new Date()
): boolean {
  if (isFundGroupName(groupName)) {
    return !isAShareMarketOpen(now);
  }
  const assetType = resolveItemAssetType(item, groupName);
  if (assetType === "A_SHARE") {
    return !isAShareMarketOpen(now);
  }
  if (assetType === "HK_STOCK") {
    return !isHKMarketOpen(now);
  }
  if (assetType === "US_STOCK") {
    return !isUSMarketOpen(now);
  }
  return false;
}

/**
 * 判断指定分组当前是否处于全休市状态
 * - 组内有标的时：仅当组内所有有效标的对应的市场均已休市，才判定为休市
 * - 组内无标的时：按组名关键词推导所属市场判定
 */
export function isGroupMarketClosed(
  groupName: string,
  items?: Array<{ symbol?: string; type?: string }>,
  now: Date = new Date()
): boolean {
  if (items && items.length > 0) {
    const validItems = items.filter((it) => it && it.symbol);
    if (validItems.length > 0) {
      return validItems.every((item) => isItemMarketClosed(item, groupName, now));
    }
  }
  return isItemMarketClosed({ symbol: "" }, groupName, now);
}

/**
 * 生成分组节点的稳定标识（TreeItem.id）
 *
 * 背景：VS Code 会以 TreeItem.id 作为节点句柄（内部形如 `1/<id>`）记忆用户的展开/折叠操作，
 * 并在节点重建时优先恢复该记忆，从而覆盖 TreeDataProvider 声明的 collapsibleState。
 * 因此「休市自动折叠」的分组必须让 id 随会话变化，才能让 VS Code 视其为全新节点，
 * 重新回到「休市默认折叠」的语义；开盘分组的 id 保持稳定，用户手动折叠的偏好照旧保留。
 *
 * @param groupName     分组名
 * @param autoCollapse  是否启用休市自动折叠
 * @param isClosed      该分组当前是否全休市
 * @param sessionTag    会话标识：同一会话内必须稳定，跨会话（激活 / 视图重新可见 / 全部展开）须变化
 * @param forceExpanded 用户是否显式要求「全部展开」，用于覆盖休市自动折叠
 */
export function buildGroupNodeId(
  groupName: string,
  autoCollapse: boolean,
  isClosed: boolean,
  sessionTag: string,
  forceExpanded: boolean = false
): string {
  // 用户显式「全部展开」时同样必须换 id：VS Code 会记住「用户上一次折叠过该分组」，
  // 只把 collapsibleState 改成 Expanded 会被该记忆覆盖，换 id 才能让它按全新节点处理
  if (forceExpanded) {
    return `group_${groupName}@open#${sessionTag}`;
  }
  return autoCollapse && isClosed
    ? `group_${groupName}@closed#${sessionTag}`
    : `group_${groupName}`;
}

/**
 * 纯算法函数：计算状态栏总控与分板块开关聚合后的最终展示状态
 * @param explicitStatusBarEnabled 用户是否显式配置了 statusBar.enabled（undefined 表示未显式配置，遵循默认值开启）
 * @param anyTabsStatusBar 是否至少有一个分板块开启了状态栏轮播
 */
export function computeStatusBarEnabled(
  explicitStatusBarEnabled: boolean | undefined,
  anyTabsStatusBar: boolean
): boolean {
  return explicitStatusBarEnabled !== false && anyTabsStatusBar;
}

/**
 * 统一解析标的的最终展示名称：
 * 1. 优先使用用户在配置中显式定义的自定义名称（如 "Cloudflare"、"纳斯达克综合指数" 或用户设置的昵称）；
 * 2. 若配置中的名称为空，或与代码本身相同（如未命名直接填写的 "600030"、"usAAPL"），则回退使用实时行情接口返回的标准官方名称（如 "贵州茅台"、"苹果"）；
 * 3. 若均无，则兜底使用代码本身。
 * 确保侧边栏看板、设置面板、状态栏、预警向导等所有界面全局统一！
 */
export function resolveItemDisplayName(
  confName?: string,
  confSymbol?: string,
  cachedQuote?: { name?: string; symbol?: string }
): string {
  const trimmedConf = confName?.trim();
  const trimmedSym = confSymbol?.trim();

  const isCustomName =
    !!trimmedConf &&
    (!trimmedSym || (
      !isSameSymbol(trimmedConf, trimmedSym) &&
      trimmedConf.toLowerCase() !== trimmedSym.toLowerCase() &&
      trimmedConf.toLowerCase() !== normalizeSymbolKey(trimmedSym).toLowerCase()
    ));

  if (isCustomName) {
    return trimmedConf!;
  }

  if (cachedQuote?.name && cachedQuote.name.trim()) {
    return cachedQuote.name.trim();
  }

  return trimmedConf || trimmedSym || "";
}

/**
 * 纯算法函数：从 watchlist 中按板块开关、轮播开关与休市管理策略提取参与底部状态栏轮播的标的行情
 * 1. 优先从 quoteCache 读取最新报价，若 quoteCache 暂无则提供基础占位，确保标的正常流转；
 * 2. 休市管理协同（autoCollapseClosedGroups）：
 *    - 若开启 autoCollapseClosedGroups（默认开启），已闭市标的将被动态跳过剔除（全休市时返回空数组，促使状态栏静默隐藏）；
 *    - 若未开启 autoCollapseClosedGroups，即使对应市场因闭市跳过了周期网络拉取，依然保留收盘报价持续轮播。
 */
export function extractStatusBarQuotes<
  T extends { symbol: string; name?: string; type?: string; price?: number; changePercent?: number }
>(
  watchlist: Record<string, Array<{ symbol?: string; name?: string; type?: string }>>,
  quoteCache: Map<string, T>,
  options: StatusBarQuotesOptions = {}
): T[] {
  const {
    statusBarEnabled = true,
    fund = { enabled: true, statusBar: true },
    aShare = { enabled: true, statusBar: true },
    hkStock = { enabled: true, statusBar: true },
    usStock = { enabled: true, statusBar: true },
    binance = { enabled: true, statusBar: true },
    alpha = { enabled: true, statusBar: true },
  } = options;

  if (statusBarEnabled === false) {
    return [];
  }

  const resolvedSections: Record<MarketSection, { enabled?: boolean; statusBar?: boolean }> = {
    fund,
    aShare,
    hkStock,
    usStock,
    binance,
    alpha,
  };

  const isSectionActive = (type?: string): boolean => {
    if (!type) return true;
    const sec = ASSET_TYPE_TO_SECTION_MAP[type as AssetType];
    if (!sec) return true;
    const conf = resolvedSections[sec];
    return conf?.enabled !== false && conf?.statusBar !== false;
  };

  const result: T[] = [];
  const seenSymbols = new Set<string>();

  for (const [groupName, items] of Object.entries(watchlist || {})) {
    const isFundGroup = isFundGroupName(groupName);

    for (const item of items || []) {
      if (!item?.symbol) continue;
      const symKey = item.symbol.toLowerCase().trim();
      if (seenSymbols.has(symKey)) continue;

      const assetType = resolveItemAssetType(item, groupName);
      if (isFundGroup) {
        if (fund.enabled === false || fund.statusBar === false) {
          continue;
        }
      } else if (!isSectionActive(assetType)) {
        continue;
      }

      if (options.autoCollapseClosedGroups) {
        const checkNow = options.now || new Date();
        if (isItemMarketClosed(item, groupName, checkNow)) {
          continue;
        }
      }

      seenSymbols.add(symKey);

      const normKey = normalizeSymbolKey(item.symbol);
      const rawTicker = stripMarketPrefix(item.symbol);
      const cached =
        quoteCache.get(normKey) ||
        quoteCache.get(item.symbol) ||
        quoteCache.get(item.symbol.toLowerCase()) ||
        quoteCache.get(rawTicker);

      const displayName = resolveItemDisplayName(item.name, item.symbol, cached);

      if (cached) {
        result.push({
          ...cached,
          name: displayName,
        });
      } else {
        result.push({
          id: item.symbol,
          name: displayName,
          symbol: item.symbol,
          type: (assetType || item.type || "A_SHARE") as AssetType,
          price: 0,
          changePercent: 0,
        } as unknown as T);
      }
    }
  }

  return result;
}

export interface ReorderItemDescriptor {
  sourceGroup: string;
  sourceSymbol: string;
}

/**
 * 纯算法函数：批量计算同组/跨组拖拽重排后的新 watchlist 结构（原子性操作）
 * 无论单项或多项拖拽，均在内存中一次性完成字典变换，避免向磁盘发起多次重复写入
 * 若未发生有效变动返回 null
 */
export function batchReorderWatchlist<T extends { symbol?: string } = WatchConfigItem>(
  currentWatchlist: Record<string, T[]>,
  itemsToMove: ReorderItemDescriptor[],
  targetGroup: string,
  targetSymbol?: string
): Record<string, T[]> | null {
  if (!itemsToMove || !itemsToMove.length || !currentWatchlist[targetGroup]) {
    return null;
  }

  // 1. 若目标标的本身就是被拖拽标的之一，拖拽到自身无意义，直接忽略
  if (
    targetSymbol &&
    itemsToMove.some(
      (m) =>
        m.sourceGroup === targetGroup &&
        (isSameSymbol(m.sourceSymbol, targetSymbol) ||
          m.sourceSymbol.toLowerCase() === targetSymbol.toLowerCase())
    )
  ) {
    return null;
  }

  // 2. 严格限制：只能在当前分组内移动，禁止跨分组转移
  if (!itemsToMove.every((m) => m.sourceGroup === targetGroup)) {
    return null;
  }

  // 3. 克隆 watchlist 字典
  const updated: Record<string, T[]> = {};
  for (const [grp, itms] of Object.entries(currentWatchlist)) {
    updated[grp] = [...(itms || [])];
  }

  const targetGroupItemsBefore = currentWatchlist[targetGroup] || [];

  // 计算同组拖拽时的方向（以选中的首个标的与 targetSymbol 的相对位置判定）
  let isDownward = false;
  if (targetSymbol) {
    const origTargetIndex = targetGroupItemsBefore.findIndex(
      (it) =>
        isSameSymbol(it?.symbol || "", targetSymbol) ||
        it?.symbol?.toLowerCase() === targetSymbol.toLowerCase()
    );
    const firstSourceIndex = targetGroupItemsBefore.findIndex(
      (it) =>
        isSameSymbol(it?.symbol || "", itemsToMove[0].sourceSymbol) ||
        it?.symbol?.toLowerCase() === itemsToMove[0].sourceSymbol.toLowerCase()
    );
    if (origTargetIndex !== -1 && firstSourceIndex !== -1 && firstSourceIndex < origTargetIndex) {
      isDownward = true;
    }
  }

  // 4. 依次摘除需要移动的 items
  const extractedItems: T[] = [];
  for (const descriptor of itemsToMove) {
    const { sourceGroup, sourceSymbol } = descriptor;
    const groupList = updated[sourceGroup];
    if (!groupList) continue;

    const idx = groupList.findIndex(
      (it) =>
        isSameSymbol(it?.symbol || "", sourceSymbol) ||
        it?.symbol?.toLowerCase() === sourceSymbol.toLowerCase()
    );
    if (idx !== -1) {
      const [removed] = groupList.splice(idx, 1);
      extractedItems.push(removed);
    }
  }

  if (extractedItems.length === 0) {
    return null;
  }

  // 5. 插入目标组
  const targetList = updated[targetGroup];
  if (!targetList) {
    return null;
  }

  if (targetSymbol) {
    const newTargetIndex = targetList.findIndex(
      (it) =>
        isSameSymbol(it?.symbol || "", targetSymbol) ||
        it?.symbol?.toLowerCase() === targetSymbol.toLowerCase()
    );

    if (newTargetIndex !== -1) {
      if (isDownward) {
        targetList.splice(newTargetIndex + 1, 0, ...extractedItems);
      } else {
        targetList.splice(newTargetIndex, 0, ...extractedItems);
      }
    } else {
      targetList.push(...extractedItems);
    }
  } else {
    // 拖拽到组名（targetSymbol 未指定）：同组拖到组名置顶
    targetList.unshift(...extractedItems);
  }

  return updated;
}

/**
 * 纯算法函数：计算同组/跨组拖拽重排后的新 watchlist 结构
 * 若未发生有效变动返回 null
 */
export function reorderWatchlist<T extends { symbol?: string } = WatchConfigItem>(
  currentWatchlist: Record<string, T[]>,
  sourceGroup: string,
  sourceSymbol: string,
  targetGroup: string,
  targetSymbol?: string
): Record<string, T[]> | null {
  return batchReorderWatchlist(
    currentWatchlist,
    [{ sourceGroup, sourceSymbol }],
    targetGroup,
    targetSymbol
  );
}

/**
 * 纯算法函数：基于当前有效自选清单修剪清理 quoteCache 中已失效的历史死缓存（Active-Set Prune）
 * 无论标的是通过 UI 删除、快捷键清空，还是用户直接在 settings.json 中剪切/编辑，
 * 只要不在当前 watchlist 范围内的历史残留项，均从 quoteCache 中安全剔除。
 * 同时 100% 保留当前自选中即使闭市也依然需要的收盘报价缓存。
 *
 * @param watchlist 当前生效的自选配置
 * @param quoteCache 内存行情缓存 Map
 * @returns 实际被清理的失效缓存 Key 数量
 */
export function pruneQuoteCache<T extends { symbol?: string; id?: string }>(
  watchlist: Record<string, Array<{ symbol?: string; id?: string }>>,
  quoteCache: Map<string, T>
): number {
  if (!quoteCache || quoteCache.size === 0) {
    return 0;
  }

  // 1. 收集当前 watchlist 中所有合法活跃标的的标识符集合
  const activeIdentifiers = new Set<string>();
  for (const items of Object.values(watchlist || {})) {
    for (const item of items || []) {
      if (!item || !item.symbol) continue;

      const rawSym = String(item.symbol).trim();
      if (!rawSym) continue;

      activeIdentifiers.add(rawSym);
      activeIdentifiers.add(rawSym.toLowerCase());

      const normKey = normalizeSymbolKey(rawSym);
      if (normKey) {
        activeIdentifiers.add(normKey);
        activeIdentifiers.add(normKey.toLowerCase());
      }

      const rawTicker = stripMarketPrefix(rawSym);
      if (rawTicker) {
        activeIdentifiers.add(rawTicker);
      }

      if (item.id) {
        const rawId = String(item.id).trim();
        activeIdentifiers.add(rawId);
        activeIdentifiers.add(rawId.toLowerCase());
        const normId = normalizeSymbolKey(rawId);
        if (normId) {
          activeIdentifiers.add(normId);
          activeIdentifiers.add(normId.toLowerCase());
        }
      }
    }
  }

  // 2. 遍历检查 quoteCache，标记所有死缓存 Key
  const deadKeys: string[] = [];
  for (const [cacheKey, quote] of quoteCache.entries()) {
    const keyLower = cacheKey.toLowerCase();
    // 检查缓存键本身是否直接命中活跃标识
    if (activeIdentifiers.has(cacheKey) || activeIdentifiers.has(keyLower)) {
      continue;
    }

    // 检查缓存对象所关联的 symbol / id 是否能命中当前活跃标的
    let belongsToActive = false;
    if (quote) {
      if (quote.symbol) {
        const sym = String(quote.symbol).trim();
        const normSym = normalizeSymbolKey(sym);
        if (
          activeIdentifiers.has(sym) ||
          activeIdentifiers.has(sym.toLowerCase()) ||
          (normSym && activeIdentifiers.has(normSym))
        ) {
          belongsToActive = true;
        }
      }
      if (!belongsToActive && quote.id) {
        const id = String(quote.id).trim();
        const normId = normalizeSymbolKey(id);
        if (
          activeIdentifiers.has(id) ||
          activeIdentifiers.has(id.toLowerCase()) ||
          (normId && activeIdentifiers.has(normId))
        ) {
          belongsToActive = true;
        }
      }
    }

    if (!belongsToActive) {
      deadKeys.push(cacheKey);
    }
  }

  // 3. 执行安全的淘汰清理
  for (const k of deadKeys) {
    quoteCache.delete(k);
  }

  return deadKeys.length;
}

export type ColorScheme = "greenUpRedDown" | "redUpGreenDown";

/**
 * 根据涨跌幅及配色方案解析对应的颜色提示符号与主题色
 * - greenUpRedDown (默认，国际习惯): 涨为绿，跌为红
 * - redUpGreenDown (国内A股传统习惯): 涨为红，跌为绿
 * - colorNeutral (中性脱敏): 使用中性点号，不暴露红绿
 */
export function resolveTrendColors(
  changePercent: number,
  colorNeutral: boolean = false,
  colorScheme: ColorScheme = "greenUpRedDown"
): {
  colorHint: string;
  themeColor: "charts.green" | "charts.red" | undefined;
  isUp: boolean;
} {
  const isUp = changePercent >= 0;
  if (colorNeutral) {
    return {
      colorHint: "•",
      themeColor: undefined,
      isUp,
    };
  }
  const isRedUp = colorScheme === "redUpGreenDown";
  const upColor = isRedUp ? "charts.red" : "charts.green";
  const downColor = isRedUp ? "charts.green" : "charts.red";
  const upEmoji = isRedUp ? "🔴" : "🟢";
  const downEmoji = isRedUp ? "🟢" : "🔴";

  return {
    colorHint: isUp ? upEmoji : downEmoji,
    themeColor: isUp ? upColor : downColor,
    isUp,
  };
}

/**
 * 将数组按指定批次大小切片分块，用于大批量标的请求切片保护
 */
export function chunkArray<T>(arr: T[], size: number): T[][] {
  if (!arr || !arr.length || size <= 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

let gbkDecoderSupported: boolean | undefined = undefined;
let cachedGbkDecoder: TextDecoder | null = null;

/**
 * 健壮的原生 GBK 解码函数（0 外部依赖，三级自适应安全兜底）
 * 1. 优先使用 WHATWG 标准 TextDecoder("gbk") 解码（VS Code 桌面端与官方 Node.js 均为 Full-ICU 100% 原生支持）；
 * 2. 若宿主环境处于极端裁剪（如 small-icu / --with-intl=none）抛出 RangeError，自动降级为 UTF-8；
 * 3. 极端末梢容错：若 UTF-8 亦异常，通过单字节逐位映射（Latin-1）兜底，确保行情核心数字、逗号与波浪号等 ASCII 数据 100% 可解析。
 */
export function decodeGbk(buffer: ArrayBuffer | Uint8Array): string {
  if (gbkDecoderSupported !== false) {
    try {
      if (!cachedGbkDecoder) {
        cachedGbkDecoder = new TextDecoder("gbk");
      }
      const result = cachedGbkDecoder.decode(buffer);
      gbkDecoderSupported = true;
      return result;
    } catch {
      gbkDecoderSupported = false;
      cachedGbkDecoder = null;
    }
  }

  try {
    return new TextDecoder("utf-8").decode(buffer);
  } catch {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let str = "";
    for (let i = 0; i < bytes.length; i++) {
      str += String.fromCharCode(bytes[i]);
    }
    return str;
  }
}

/**
 * 健壮的 HTML 实体转义函数，防御 XSS 与属性引号逃逸 (CWE-79)
 */
export function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) {
    return "";
  }
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Markdown 行内文本消毒（Tooltip / 卡片标题用）。
 *
 * 存在理由：树节点与状态栏 Tooltip 走 `MarkdownString` 渲染，`supportHtml=false` 只挡住 HTML，
 * 挡不住 Markdown 链接语法。而 Tooltip 里的标的名来自行情接口与 DexScreener 报文（外部可控），
 * 若不转义方括号，报文就能自行拼出 `[文案](command:...)` 或外链（AGENTS.md §5.4）。
 * 先折叠换行（避免撑破标题行与表格行），再转义 HTML 实体与 Markdown 强调/链接字符。
 */
export function escapeMarkdownInline(str: unknown): string {
  if (str === null || str === undefined) {
    return "";
  }
  const flat = String(str).replace(/[\r\n]+/g, " ");
  return escapeHtml(flat).replace(/([`[\]])/g, "\\$1");
}

/**
 * Markdown 代码段（反引号包裹）消毒：折叠换行并剥离反引号，防止报文提前闭合代码段后注入富文本。
 * 反引号无法在代码段内用反斜杠转义，因此只能删除。
 */
export function toMarkdownCodeSpan(str: unknown): string {
  const flat = String(str ?? "").replace(/[\r\n]+/g, " ").replace(/`/g, "");
  return `\`${flat}\``;
}

/**
 * 推导条目的计价货币（单一出口，§5.5）
 * 加密与链上标的按 U 本位（USDT）计价：币安报价来自 USDT 等稳定币交易对，
 * DexScreener 的 priceUsd 在本产品口径下同样按 U 本位表达，不做多币种换算。
 * 侧边栏卡片与持仓看板必须共用本函数，否则同一标的会出现两套盈亏币种口径。
 */
export function resolveQuoteCurrency(item: {
  currency?: MarketItem["currency"];
  type?: MarketItem["type"];
}): "CNY" | "USD" | "HKD" | "USDT" {
  if (item.currency) return item.currency;
  switch (item.type) {
    case "A_SHARE":
      return "CNY";
    case "HK_STOCK":
      return "HKD";
    case "CRYPTO":
    case "BSC_TOKEN":
    case "ALPHA_TOKEN":
      return "USDT";
    default:
      return "USD";
  }
}

/** 状态栏持仓盈亏条目数据模型 */
export interface HoldingItemQuote {
  name: string;
  symbol: string;
  currency: "CNY" | "USD" | "HKD" | "USDT";
  cost: number;
  shares: number;
  price: number;
  changePercent: number;
  // 行情解析层对「上游未供数」产出 undefined（§5.5），此处的可选位同样如实允许
  change?: number | undefined;
  open?: number | undefined;
  prevClose?: number | undefined;
}

/** 提取持仓行情过滤选项 */
export interface ExtractHoldingQuotesOptions {
  statusBarEnabled?: boolean;
  autoCollapseClosedGroups?: boolean;
  now?: Date;
  fund?: { enabled?: boolean; statusBar?: boolean };
  aShare?: { enabled?: boolean; statusBar?: boolean };
  hkStock?: { enabled?: boolean; statusBar?: boolean };
  usStock?: { enabled?: boolean; statusBar?: boolean };
  binance?: { enabled?: boolean; statusBar?: boolean };
  alpha?: { enabled?: boolean; statusBar?: boolean };
}

/**
 * 从自选列表中提取所有已设置持仓成本与数量的有效标的行情
 * 支持与状态栏总控开关、分板块开关及休市折叠对齐过滤
 */
export function extractHoldingQuotes(
  watchlist: import("../types/index.ts").WatchlistConfig,
  quoteCache: Map<string, MarketItem>,
  options?: ExtractHoldingQuotesOptions
): HoldingItemQuote[] {
  if (options && options.statusBarEnabled === false) {
    return [];
  }

  const resolvedSections: Record<MarketSection, { enabled?: boolean; statusBar?: boolean } | undefined> = {
    fund: options?.fund,
    aShare: options?.aShare,
    hkStock: options?.hkStock,
    usStock: options?.usStock,
    binance: options?.binance,
    alpha: options?.alpha,
  };

  const isSectionActive = (type?: string): boolean => {
    if (!type) return true;
    const sec = ASSET_TYPE_TO_SECTION_MAP[type as AssetType];
    if (!sec) return true;
    const conf = resolvedSections[sec];
    if (!conf) return true;
    return conf.enabled !== false && conf.statusBar !== false;
  };

  const result: HoldingItemQuote[] = [];
  const seenSymbols = new Set<string>();

  for (const [groupName, items] of Object.entries(watchlist || {})) {
    const isFundGroup = isFundGroupName(groupName);

    for (const conf of items || []) {
      if (!conf || typeof conf === "string" || !conf.symbol) continue;
      if (
        conf.cost === undefined ||
        !Number.isFinite(conf.cost) ||
        conf.cost <= 0 ||
        conf.shares === undefined ||
        !Number.isFinite(conf.shares) ||
        conf.shares <= 0
      ) {
        continue;
      }

      if (options) {
        const assetType = resolveItemAssetType(conf, groupName);
        if (isFundGroup) {
          if (options.fund?.enabled === false || options.fund?.statusBar === false) {
            continue;
          }
        } else if (!isSectionActive(assetType)) {
          continue;
        }

        if (options.autoCollapseClosedGroups) {
          const checkNow = options.now || new Date();
          if (isItemMarketClosed(conf, groupName, checkNow)) {
            continue;
          }
        }
      }

      const normKey = normalizeSymbolKey(conf.symbol);
      if (seenSymbols.has(normKey)) continue;

      const q = quoteCache.get(normKey) || quoteCache.get(conf.symbol);
      if (!q || q.price === undefined || q.price <= 0) continue;

      seenSymbols.add(normKey);

      const currency = resolveQuoteCurrency(q);

      result.push({
        name: resolveItemDisplayName(conf.name, conf.symbol, q),
        symbol: conf.symbol,
        currency,
        cost: conf.cost,
        shares: conf.shares,
        price: q.price,
        changePercent: q.changePercent ?? 0,
        change: q.change,
        open: q.open,
        prevClose: q.prevClose,
      });
    }
  }

  return result;
}
