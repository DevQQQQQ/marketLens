// src/utils/marketHours.ts
import { logger } from "./logger.ts";

/**
 * 专为时区安全设计的交易时段检测（完全解耦本地时区/WSL/远程环境）
 * - A股 / 港股：绑定 Asia/Shanghai
 * - 美股：绑定 America/New_York
 */
export const beijingFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  weekday: "short",
  hour: "numeric",
  minute: "numeric",
  hour12: false,
});

export const newYorkFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "numeric",
  minute: "numeric",
  hour12: false,
});

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

// 热路径缓存：休市判定每标的每 tick 调用 2~3 次 Intl.formatToParts，开销显著。
// 同一格式化器在同一 UTC 分钟内结果恒定（时区偏移不会在分钟中途变化），
// 按格式化器只保留最近一个分钟桶的结果：命中率高且天然有界，无内存增长。
const zonedTimePartsCache = new WeakMap<Intl.DateTimeFormat, { minuteKey: number; value: { day: number; totalMinutes: number } }>();
const zonedDateStringCache = new WeakMap<Intl.DateTimeFormat, { minuteKey: number; value: string }>();

export function getZonedTimeParts(formatter: Intl.DateTimeFormat, date: Date = new Date()): { day: number; totalMinutes: number } {
  const minuteKey = Math.floor(date.getTime() / 60000);
  const cached = zonedTimePartsCache.get(formatter);
  if (cached && cached.minuteKey === minuteKey) {
    return cached.value;
  }
  const parts = formatter.formatToParts(date);
  let weekdayStr = "";
  let hour = 0;
  let minute = 0;

  for (const p of parts) {
    if (p.type === "weekday") { weekdayStr = p.value; }
    else if (p.type === "hour") { hour = parseInt(p.value, 10); }
    else if (p.type === "minute") { minute = parseInt(p.value, 10); }
  }

  // hour12: false 在部分环境中 0 点可能解析为 24
  if (hour === 24) { hour = 0; }

  const day = WEEKDAY_MAP[weekdayStr] ?? 0;
  const value = { day, totalMinutes: hour * 60 + minute };
  zonedTimePartsCache.set(formatter, { minuteKey, value });
  return value;
}

export const beijingDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const newYorkDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function getZonedDateString(formatter: Intl.DateTimeFormat, date: Date = new Date()): string {
  const minuteKey = Math.floor(date.getTime() / 60000);
  const cached = zonedDateStringCache.get(formatter);
  if (cached && cached.minuteKey === minuteKey) {
    return cached.value;
  }
  const parts = formatter.formatToParts(date);
  let year = "";
  let month = "";
  let day = "";
  for (const p of parts) {
    if (p.type === "year") year = p.value;
    else if (p.type === "month") month = p.value.padStart(2, "0");
    else if (p.type === "day") day = p.value.padStart(2, "0");
  }
  const value = `${year}-${month}-${day}`;
  zonedDateStringCache.set(formatter, { minuteKey, value });
  return value;
}

/** A股历年休市日历（元旦、春节、清明、劳动节、端午、中秋、国庆及调休股市休市日） */
export const A_SHARE_HOLIDAYS = new Set<string>([
  // 2024
  "2024-01-01",
  "2024-02-09", "2024-02-12", "2024-02-13", "2024-02-14", "2024-02-15", "2024-02-16",
  "2024-04-04", "2024-04-05",
  "2024-05-01", "2024-05-02", "2024-05-03",
  "2024-06-10",
  "2024-09-16", "2024-09-17",
  "2024-10-01", "2024-10-02", "2024-10-03", "2024-10-04", "2024-10-07",

  // 2025
  "2025-01-01",
  "2025-01-28", "2025-01-29", "2025-01-30", "2025-01-31", "2025-02-03", "2025-02-04",
  "2025-04-04",
  "2025-05-01", "2025-05-02", "2025-05-05",
  "2025-06-02",
  "2025-10-01", "2025-10-02", "2025-10-03", "2025-10-06", "2025-10-07", "2025-10-08",

  // 2026
  "2026-01-01", "2026-01-02",
  "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", "2026-02-23",
  "2026-04-06",
  "2026-05-01", "2026-05-04", "2026-05-05",
  "2026-06-19",
  "2026-09-25",
  "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07",

  // 2027 (已对照国务院办公厅 2026-11-05 发布的《关于2027年部分节假日安排的通知》核准，共 17 个工作日休市)
  "2027-01-01",
  "2027-02-05", "2027-02-08", "2027-02-09", "2027-02-10", "2027-02-11", "2027-02-12",
  "2027-04-05",
  "2027-05-03", "2027-05-04", "2027-05-05",
  "2027-06-09",
  "2027-09-15",
  "2027-10-01", "2027-10-04", "2027-10-05", "2027-10-06", "2027-10-07",
]);

/** 港股历年休市日历（HKEX Holidays） */
export const HK_HOLIDAYS = new Set<string>([
  // 2024
  "2024-01-01", "2024-02-12", "2024-02-13", "2024-03-29", "2024-04-01", "2024-04-04",
  "2024-05-01", "2024-05-15", "2024-06-10", "2024-07-01", "2024-09-18", "2024-10-01",
  "2024-10-11", "2024-12-25", "2024-12-26",

  // 2025
  "2025-01-01", "2025-01-29", "2025-01-30", "2025-01-31", "2025-04-04", "2025-04-18",
  "2025-04-21", "2025-05-01", "2025-05-05", "2025-07-01", "2025-10-01", "2025-10-07",
  "2025-10-29", "2025-12-25", "2025-12-26",

  // 2026 (共 14 个平日休市日；04-07 为清明复活节翌日顺延补休，12-28 正常开市不休)
  "2026-01-01", "2026-02-17", "2026-02-18", "2026-02-19", "2026-04-03", "2026-04-06", "2026-04-07",
  "2026-05-01", "2026-05-25", "2026-06-19", "2026-07-01", "2026-10-01", "2026-10-19", "2026-12-25",

  // 2027 (已对照 HKEX 官方 2027 休市通告核准，共 13 个平日休市日；02-05 为农历除夕半日市，12-28 正常开市)
  "2027-01-01", "2027-02-08", "2027-02-09", "2027-03-26", "2027-03-29",
  "2027-04-05", "2027-05-13", "2027-06-09", "2027-07-01", "2027-09-16", "2027-10-01",
  "2027-10-08", "2027-12-27",
]);

/**
 * 港股半日市日历（HKEX Half-Day Trading）：仅上午 9:30~12:00 交易，无午市。
 * 固定为平安夜（12-24）与除夕（12-31）；农历除夕取春节假期首日的前一个工作日
 * （落在周末时天然被周末判定排除，无需列入）。
 */
export const HK_HALF_DAYS = new Set<string>([
  "2024-12-24", "2024-12-31",
  "2025-01-28", "2025-12-24", "2025-12-31",
  "2026-02-16", "2026-12-24", "2026-12-31",
  "2027-02-05", "2027-12-24", "2027-12-31",
]);

/** 美股历年休市日历（NYSE / NASDAQ Holidays） */
export const US_HOLIDAYS = new Set<string>([
  // 2024
  "2024-01-01", "2024-01-15", "2024-02-19", "2024-03-29", "2024-05-27", "2024-06-19",
  "2024-07-04", "2024-09-02", "2024-11-28", "2024-12-25",

  // 2025
  "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19",
  "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",

  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19",
  "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",

  // 2027 (已对照 NYSE / NASDAQ 官方 2027 假日日历核准，共 10 个全天休市日；11-26 提前收盘不列入)
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18",
  "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

export const MAX_COVERED_HOLIDAY_YEAR = 2027;

/**
 * 仍为「提前占位预测数据」的年份：日历条目已写入，但尚未对照交易所官方终版公告复核。
 * 官方终版通常在 11 月下旬 ~ 12 月中旬发布，复核校准后必须把该年份从本集合移除（AGENTS.md §5.5）。
 */
export const FORECAST_HOLIDAY_YEARS: ReadonlySet<number> = new Set<number>();

const warnedHolidayYears = new Set<number>();
const warnedForecastYears = new Set<number>();

/**
 * 节假日日历覆盖有效性护栏：
 * - 年份超出已知日历上限：按年度去重告警，防止静默失效；
 * - 年份仍属占位预测数据：按年度去重提示，避免把预测当成官方终版口径长期无人复核。
 *
 * 年份口径必须与调用方查日历键所用的**同一个** Intl 格式化器同源：
 * 用 `date.getFullYear()`（宿主机本地时区）会在跨年边界（12-31 / 01-01）与查表时区错位，
 * 造成超限年份漏告警或未超限年份误告警（AGENTS.md §5.5）。
 */
export function checkHolidayCoverage(
  date: Date = new Date(),
  formatter: Intl.DateTimeFormat = beijingDateFormatter
): boolean {
  const year = Number(getZonedDateString(formatter, date).slice(0, 4));
  if (year > MAX_COVERED_HOLIDAY_YEAR) {
    if (!warnedHolidayYears.has(year)) {
      warnedHolidayYears.add(year);
      logger.warn(
        `[marketHours] 当前年份 (${year}) 超出已知节假日日历上限 (${MAX_COVERED_HOLIDAY_YEAR})，法定节假日休市判定可能失真，请及时更新休市日历。`
      );
    }
    return false;
  }
  if (FORECAST_HOLIDAY_YEARS.has(year) && !warnedForecastYears.has(year)) {
    warnedForecastYears.add(year);
    logger.warn(
      `[marketHours] ${year} 年休市日历目前为提前占位预测数据，尚未对照交易所官方终版公告复核；请在终版公布后更新日历并从 FORECAST_HOLIDAY_YEARS 移除该年份。`
    );
  }
  return true;
}

export function isAShareHoliday(date: Date = new Date()): boolean {
  checkHolidayCoverage(date, beijingDateFormatter);
  const dateStr = getZonedDateString(beijingDateFormatter, date);
  return A_SHARE_HOLIDAYS.has(dateStr);
}

export function isHKHoliday(date: Date = new Date()): boolean {
  checkHolidayCoverage(date, beijingDateFormatter);
  const dateStr = getZonedDateString(beijingDateFormatter, date);
  return HK_HOLIDAYS.has(dateStr);
}

export function isUSHoliday(date: Date = new Date()): boolean {
  checkHolidayCoverage(date, newYorkDateFormatter);
  const dateStr = getZonedDateString(newYorkDateFormatter, date);
  return US_HOLIDAYS.has(dateStr);
}

/**
 * 当前日期是否落在已知节假日日历的覆盖范围内。
 *
 * `checkHolidayCoverage()` 在超出 MAX_COVERED_HOLIDAY_YEAR 时只告警、返回 false，
 * 而三个 isXXXHoliday 都丢弃该返回值继续查空表 → 法定假日会被误判为普通交易日。
 * 依赖休市判定的「闭市停止轮询」等优化必须在日历不可靠时保守关闭，宁可多轮询，
 * 也不能在春节/国庆整天停掉行情。
 */
export function isHolidayCalendarReliable(date: Date = new Date()): boolean {
  return (
    checkHolidayCoverage(date, beijingDateFormatter) &&
    checkHolidayCoverage(date, newYorkDateFormatter)
  );
}

/**
 * 校验当前是否处于 A 股交易时段（严格按北京时间 Asia/Shanghai 判定）：
 * - 排除周末与法定休市日
 * - 周一至周五 9:15 ~ 11:30, 13:00 ~ 15:05
 */
export function isAShareMarketOpen(date?: Date): boolean {
  const targetDate = date || new Date();
  if (isAShareHoliday(targetDate)) {
    return false;
  }
  const { day, totalMinutes } = getZonedTimeParts(beijingFormatter, targetDate);
  if (day === 0 || day === 6) { return false; }
  const isMorning   = totalMinutes >= 9 * 60 + 15 && totalMinutes <= 11 * 60 + 30;
  const isAfternoon = totalMinutes >= 13 * 60 && totalMinutes <= 15 * 60 + 5;
  return isMorning || isAfternoon;
}

/**
 * 校验当前是否处于港股交易时段（严格按北京/香港时间 Asia/Shanghai 判定）：
 * - 排除周末与法定休市日
 * - 周一至周五 9:30 ~ 12:00, 13:00 ~ 16:10
 * - 半日市（平安夜/除夕/农历除夕）仅 9:30 ~ 12:00，无午市
 */
export function isHKMarketOpen(date?: Date): boolean {
  const targetDate = date || new Date();
  if (isHKHoliday(targetDate)) {
    return false;
  }
  const { day, totalMinutes } = getZonedTimeParts(beijingFormatter, targetDate);
  if (day === 0 || day === 6) { return false; }
  const isMorning   = totalMinutes >= 9 * 60 + 30 && totalMinutes <= 12 * 60;
  if (HK_HALF_DAYS.has(getZonedDateString(beijingDateFormatter, targetDate))) {
    return isMorning;
  }
  const isAfternoon = totalMinutes >= 13 * 60 && totalMinutes <= 16 * 60 + 10;
  return isMorning || isAfternoon;
}

/**
 * 校验当前是否处于美股交易时段（严格按美东时间 America/New_York 判定）：
 * - 排除周末与法定休市日
 * - 规则：美东时间周一至周五 09:00 ~ 16:30（覆盖盘前缓冲、09:30~16:00 常规交易及收盘清算）
 * - 优势：底层由时区数据库自适应夏令时与冬令时，无需复杂跨天推算，周六日全天闭市。
 */
export function isUSMarketOpen(date?: Date): boolean {
  const targetDate = date || new Date();
  if (isUSHoliday(targetDate)) {
    return false;
  }
  const { day, totalMinutes } = getZonedTimeParts(newYorkFormatter, targetDate);
  if (day === 0 || day === 6) { return false; }
  return totalMinutes >= 9 * 60 && totalMinutes <= 16 * 60 + 30;
}

export interface AdaptiveThrottleOptions {
  fundEnabled?: boolean;
  aShareEnabled: boolean;
  hkStockEnabled: boolean;
  usStockEnabled: boolean;
  has24HourCrypto: boolean;
  hasPriceChanged: boolean;
  consecutiveUnchangedCount: number;
  unchangedThreshold?: number;
  now?: Date;
}

export interface AdaptiveThrottleResult {
  isThrottled: boolean;
  consecutiveUnchangedCount: number;
  reason: "price_changed" | "market_open" | "holiday_or_closed" | "crypto_unchanged_throttle";
}

/**
 * 评估休市与无行情变动自适应降频：
 * - 若有价格变动：重置计数，恢复标准频率 (isThrottled = false)
 * - 若所有已启用的股票市场闭市（周末、非交易时段、法定休市日）：
 *   - 若无 24/7 加密资产：直接进入休市降频 (isThrottled = true)
 *   - 若有 24/7 加密资产：连续无价格变动达到阈值 (默认 3 次) 时降频 (isThrottled = true)
 * - 若股票市场正在开盘：维持高频，仅在极端长周期无波动 (>= 20 次) 时降频
 */
export function evaluateAdaptiveThrottle(options: AdaptiveThrottleOptions): AdaptiveThrottleResult {
  const {
    fundEnabled = true,
    aShareEnabled,
    hkStockEnabled,
    usStockEnabled,
    has24HourCrypto,
    hasPriceChanged,
    unchangedThreshold = 3,
    now = new Date(),
  } = options;

  if (hasPriceChanged) {
    return {
      isThrottled: false,
      consecutiveUnchangedCount: 0,
      reason: "price_changed",
    };
  }

  const nextCount = options.consecutiveUnchangedCount + 1;

  const fundOpen = fundEnabled && isAShareMarketOpen(now);
  const aOpen = aShareEnabled && isAShareMarketOpen(now);
  const hkOpen = hkStockEnabled && isHKMarketOpen(now);
  const usOpen = usStockEnabled && isUSMarketOpen(now);
  const anyStockMarketOpen = fundOpen || aOpen || hkOpen || usOpen;

  if (anyStockMarketOpen) {
    if (nextCount >= 20) {
      return {
        isThrottled: true,
        consecutiveUnchangedCount: nextCount,
        reason: "holiday_or_closed",
      };
    }
    return {
      isThrottled: false,
      consecutiveUnchangedCount: nextCount,
      reason: "market_open",
    };
  }

  if (!has24HourCrypto) {
    return {
      isThrottled: true,
      consecutiveUnchangedCount: nextCount,
      reason: "holiday_or_closed",
    };
  }

  if (nextCount >= unchangedThreshold) {
    return {
      isThrottled: true,
      consecutiveUnchangedCount: nextCount,
      reason: "crypto_unchanged_throttle",
    };
  }

  return {
    isThrottled: false,
    consecutiveUnchangedCount: nextCount,
    reason: "market_open",
  };
}

export interface MarketPollingSkipOptions {
  /** 用户配置项：是否在闭市时停止轮询该板块 */
  stopOnMarketClosed?: boolean | undefined;
  /** 当前板块是否正处于交易开盘时段 */
  isMarketOpen: boolean;
  /** 插件生命周期内是否已成功加载过首轮行情（用于避免冷启动盘面空白） */
  hasLoadedInitialQuotes: boolean;
  /** 是否由用户发起了全局强制刷新 */
  forceAll?: boolean | undefined;
  /**
   * 是否指定刷新单一分组名称。
   * 调用方（scheduler）传入的是配置里的可空分组名，因此 `undefined` 是合法入参而非「未提供键」，
   * `exactOptionalPropertyTypes` 下必须如实允许（§5.5 三条休市链路的粒度判定依赖此默认值语义）。
   */
  specificGroupName?: string | undefined;
  /** 节假日日历是否覆盖当前日期；false 时保守禁用「闭市停止轮询」 */
  holidayCalendarReliable?: boolean | undefined;
}

/**
 * 判定当前板块在调度轮询时是否应当因闭市而跳过网络请求
 *
 * 跳过必须同时满足以下 6 项条件：
 * 1. 当前日期落在已知节假日日历覆盖范围内（holidayCalendarReliable）
 * 2. 用户配置了「闭市时停止轮询」stopOnMarketClosed === true
 * 3. 当前板块已处于休市或法定节假日（!isMarketOpen）
 * 4. 插件已至少成功完成过一轮首次行情拉取（hasLoadedInitialQuotes === true），保证闭市时启动不会盘面全空白
 * 5. 非全局强制刷新（!forceAll）
 * 6. 非单组定向刷新（!specificGroupName）
 *
 * 条件 1 是保守护栏：日历越界时 isXXXHoliday() 查的是空表，会把春节/国庆误判成正常交易日，
 * 此时若仍按「休市」跳过轮询，行情会整天不更新。宁可多轮询，也不能静默停摆。
 */
export function shouldSkipMarketPolling(options: MarketPollingSkipOptions): boolean {
  const {
    stopOnMarketClosed = false,
    isMarketOpen,
    hasLoadedInitialQuotes,
    forceAll = false,
    specificGroupName,
    holidayCalendarReliable = isHolidayCalendarReliable(),
  } = options;

  return !!(
    holidayCalendarReliable &&
    stopOnMarketClosed &&
    !isMarketOpen &&
    hasLoadedInitialQuotes &&
    !forceAll &&
    !specificGroupName
  );
}


