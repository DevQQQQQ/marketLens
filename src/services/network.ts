// src/services/network.ts
import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";
import * as http from "http";
import { logger } from "../utils/logger.ts";

export interface CryptoNetworkOptions {
  mode: "proxy" | "direct";
  proxyUrl?: string;
}

export interface ProxyStatus {
  activePort?: number;
  inCooldown: boolean;
  cooldownRemainingSeconds: number;
}

/** 默认本地代理端口与地址常量 */
export const DEFAULT_PROXY_PORT = 10808;
export const DEFAULT_PROXY_URL = `http://127.0.0.1:${DEFAULT_PROXY_PORT}`;

/**
 * 主流代理客户端 HTTP/Mixed 端口探测池
 * 优先探测 HTTP 监听端口，确保与 Axios HTTP 代理协议无缝匹配
 */
export const COMMON_PROXY_PORTS = [
  DEFAULT_PROXY_PORT, // v2rayN (Socks/Mixed)
  10809, // v2rayN (HTTP)
  7890,  // Clash / Clash Verge / ClashX (HTTP/Socks Mixed)
  7897,  // Mihomo Party (HTTP/Socks Mixed)
  2080,  // NekoBox / sing-box (Mixed)
  6152,  // Surge (HTTP)
  8889,  // Qv2ray (HTTP)
  16100, // OpenClash / 内网定制
];

const BASE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
};

/** 缓存当前探测到的可用本地代理端口，避免其他用户（如 7890）每次刷新重复卡顿 */
let cachedWorkingPort: number | undefined = undefined;

/** 上次探测所有 fallback 端口均失败的时间戳 */
let lastFallbackFailedTime = 0;
/** 探测冷却时间：30 秒（避免 10+ 并发请求在代理未开时同时遍历 9 端口打满网络） */
const FALLBACK_COOLDOWN_MS = 30_000;

/** 获取当前已探测并生效的本地代理端口 */
export function getCachedWorkingPort(): number | undefined {
  return cachedWorkingPort;
}

/** 重置代理缓存与探测状态（当用户在设置面板修改网络配置时调用） */
export function resetProxyCache(): void {
  cachedWorkingPort = undefined;
  lastFallbackFailedTime = 0;
}

/** 获取当前代理连接健康度与熔断状态 */
export function getProxyStatus(): ProxyStatus {
  const now = Date.now();
  const elapsed = now - lastFallbackFailedTime;
  const inCooldown = lastFallbackFailedTime > 0 && elapsed < FALLBACK_COOLDOWN_MS;
  const cooldownRemainingSeconds = inCooldown ? Math.ceil((FALLBACK_COOLDOWN_MS - elapsed) / 1000) : 0;
  return {
    activePort: cachedWorkingPort,
    inCooldown,
    cooldownRemainingSeconds,
  };
}

/**
 * 读取操作系统代理环境变量（自适应支持 HTTPS_PROXY / HTTP_PROXY / ALL_PROXY 及其小写形式）
 */
export function getSystemProxyUrl(): string | undefined {
  const env = process.env;
  const raw =
    env.HTTPS_PROXY ||
    env.https_proxy ||
    env.HTTP_PROXY ||
    env.http_proxy ||
    env.ALL_PROXY ||
    env.all_proxy;

  if (!raw || typeof raw !== "string" || !raw.trim()) {
    return undefined;
  }
  return normalizeProxyUrlString(raw.trim());
}

/**
 * 核心规范化逻辑：剥离协议头、解析端口与认证信息，规整为标准 http://[user:pass@]host:port
 */
export function normalizeProxyUrlString(rawStr: string): string {
  let str = rawStr.trim();

  // 若用户直接输入纯数字端口（例如 "10808"）
  if (/^\d{1,5}$/.test(str)) {
    const p = parseInt(str, 10);
    if (p >= 1 && p <= 65535) {
      return `http://127.0.0.1:${p}`;
    }
  }

  // 若用户填了 socks5:// 或 socks://，剥离前缀并转换
  if (/^socks5?:\/\//i.test(str)) {
    str = str.replace(/^socks5?:\/\//i, "");
  }

  // 若用户填了 https://，剥离前缀转为 http://
  if (/^https?:\/\//i.test(str)) {
    str = str.replace(/^https?:\/\//i, "");
  }

  // 补齐 http:// 标准协议头
  str = `http://${str}`;

  try {
    const u = new URL(str);
    const host = u.hostname || "127.0.0.1";
    const isLocal = host === "127.0.0.1" || host === "localhost";
    const defaultPort = isLocal ? String(DEFAULT_PROXY_PORT) : "8080";
    const port = u.port || defaultPort;
    const authPart = u.username ? `${u.username}${u.password ? `:${u.password}` : ""}@` : "";
    return `http://${authPart}${host}:${port}`;
  } catch {
    return DEFAULT_PROXY_URL;
  }
}

/**
 * 校验并规范化代理地址（防止用户输入为空、带特殊协议或格式残缺导致崩溃）
 * 1. 支持纯端口号输入（如 10808 或 "10808"），自动规范化为 http://127.0.0.1:10808
 * 2. 彻底纠偏 https://：本地代理服务器均为明文 HTTP 监听，自动规整为 http://
 * 3. 友好支持 socks5:// / socks://：提取其中的 host 与 port，将其转换为 Node.js HTTP 代理形式
 * 4. 完整保留认证信息 (http://user:pass@host:port)
 * 5. 缺省优先返回当前可用工作端口、操作系统环境变量代理、或默认 10808
 */
export function validateAndNormalizeProxyUrl(rawUrl: string | undefined): string {
  if (!rawUrl || !rawUrl.trim()) {
    if (cachedWorkingPort) {
      return `http://127.0.0.1:${cachedWorkingPort}`;
    }
    const sysProxy = getSystemProxyUrl();
    if (sysProxy) {
      return sysProxy;
    }
    return DEFAULT_PROXY_URL;
  }
  return normalizeProxyUrlString(rawUrl);
}

/**
 * 解析 proxyUrl，供 axios proxy 配置项使用
 * 提取 host, port, protocol 以及企业代理认证信息 auth (username, password)
 */
export function parseProxy(proxyUrlStr: string) {
  const normalized = validateAndNormalizeProxyUrl(proxyUrlStr);
  try {
    const url = new URL(normalized);
    const host = url.hostname || "127.0.0.1";
    const isLocal = host === "127.0.0.1" || host === "localhost";
    const defaultPort = isLocal ? DEFAULT_PROXY_PORT : 8080;
    const port = parseInt(url.port, 10) || defaultPort;

    const res: {
      host: string;
      port: number;
      protocol: string;
      auth?: { username: string; password: string };
    } = {
      host,
      port,
      protocol: "http",
    };

    if (url.username || url.password) {
      res.auth = {
        username: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
      };
    }

    return res;
  } catch {
    return { host: "127.0.0.1", port: DEFAULT_PROXY_PORT, protocol: "http" };
  }
}

/**
 * 快速检测某个本地端口是否开启了 HTTP 代理监听（超时 600ms）
 */
export function testLocalPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "HEAD",
        path: "http://data-api.binance.vision/api/v3/ping",
        timeout: 600,
      },
      (res) => {
        resolve(
          res.statusCode !== undefined &&
            ((res.statusCode >= 200 && res.statusCode < 400) || res.statusCode === 407)
        );
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

/**
 * 自动探测本机当前活跃的代理端口号（返回端口数字，如 10808）
 */
export async function detectAvailablePort(): Promise<number | null> {
  if (cachedWorkingPort && (await testLocalPort(cachedWorkingPort))) {
    return cachedWorkingPort;
  }
  // 优先探测操作系统环境变量中配置的代理端口（若为本地端口）
  const sysUrl = getSystemProxyUrl();
  if (sysUrl) {
    const sysProxy = parseProxy(sysUrl);
    if (sysProxy.host === "127.0.0.1" || sysProxy.host === "localhost") {
      const ok = await testLocalPort(sysProxy.port);
      if (ok) {
        cachedWorkingPort = sysProxy.port;
        return sysProxy.port;
      }
    }
  }
  for (const port of COMMON_PROXY_PORTS) {
    const ok = await testLocalPort(port);
    if (ok) {
      cachedWorkingPort = port;
      return port;
    }
  }
  return null;
}

/**
 * 通用网络请求核心方法（支持 direct 直连 与 proxy 强制代理）
 */
export async function smartNetworkGet<T = any>(
  url: string,
  options: CryptoNetworkOptions,
  config: AxiosRequestConfig = {}
): Promise<AxiosResponse<T>> {
  const { mode = "direct", proxyUrl } = options;

  const mergedConfig: AxiosRequestConfig = {
    ...config,
    timeout: config.timeout || 5000,
    headers: { ...BASE_HEADERS, ...config.headers },
  };

  // 1. 直连模式（显式声明 proxy: false，杜绝宿主环境 http_proxy/https_proxy 环境变量隐式劫持）
  if (mode === "direct") {
    return await axios.get<T>(url, {
      ...mergedConfig,
      proxy: false,
    });
  }

  // 2. 强制代理模式（绝不直连）
  // 优先使用用户输入的代理或缺省/缓存代理（若 proxyUrl 为空，validateAndNormalizeProxyUrl 已自适应返回 cachedWorkingPort/系统代理/10808）
  const rawProxy = parseProxy(proxyUrl || "");
  const targetProxy =
    cachedWorkingPort && !proxyUrl && (rawProxy.host === "127.0.0.1" || rawProxy.host === "localhost") && rawProxy.port === DEFAULT_PROXY_PORT
      ? { ...rawProxy, port: cachedWorkingPort }
      : rawProxy;

  // 第一优先级：尝试目标代理端口
  try {
    const res = await axios.get<T>(url, {
      ...mergedConfig,
      proxy: targetProxy,
    });
    cachedWorkingPort = targetProxy.port;
    return res;
  } catch (err: any) {
    // 若远端服务器已正常返回 HTTP 响应（如 400 Bad Request, 404, 429），说明代理通道完全通畅且连接成功，
    // 绝非代理端口不可用，直接抛出原生异常保留 status 与业务错误体，杜绝误触发代理探测熔断
    if (err?.response) {
      throw err;
    }
    const now = Date.now();
    // 如果在冷却期内，直接拒绝探测，避免突发并发请求轮询探测卡死
    if (now - lastFallbackFailedTime < FALLBACK_COOLDOWN_MS) {
      throw new Error(
        `[MarketLens] 代理连接失败（端口探测处于冷却中，${Math.ceil((FALLBACK_COOLDOWN_MS - (now - lastFallbackFailedTime)) / 1000)}s 后重试）。已阻止直连。`
      );
    }

    // 第二优先级：自适应探测操作系统环境变量代理（若配置了环境变量且与 targetProxy 不同）
    const sysUrl = getSystemProxyUrl();
    if (sysUrl) {
      const sysProxy = parseProxy(sysUrl);
      if (sysProxy.host !== targetProxy.host || sysProxy.port !== targetProxy.port) {
        try {
          const res = await axios.get<T>(url, {
            ...mergedConfig,
            timeout: 2500,
            proxy: sysProxy,
          });
          if (cachedWorkingPort !== sysProxy.port) {
            logger.info(`[smartNetworkGet] 目标代理端口不可达，已自动切换至系统环境变量代理端口: ${sysProxy.port}`);
          }
          cachedWorkingPort = sysProxy.port;
          return res;
        } catch {
          // 继续回退到主流常见端口探测池
        }
      }
    }

    // 第三优先级：自动自适应探测其他主流端口（前置 600ms 快速探活，缩短超时，杜绝冷 miss 卡死）
    for (const port of COMMON_PROXY_PORTS) {
      if (port === targetProxy.port) continue;
      // 前置轻量探活：若本地端口未监听或无代理响应，瞬间跳过，杜绝 8 次完整业务请求长耗时
      const isAlive = await testLocalPort(port);
      if (!isAlive) continue;

      try {
        const res = await axios.get<T>(url, {
          ...mergedConfig,
          timeout: 1500, // 快速探测
          proxy: { host: "127.0.0.1", port, protocol: "http" },
        });
        // 成功！记录并缓存此端口，后续无需重试
        if (cachedWorkingPort !== port) {
          logger.info(`[smartNetworkGet] 目标代理端口不可达，已自动降级回退至本地可用端口: ${port}`);
        }
        cachedWorkingPort = port;
        return res;
      } catch {
        // 继续探测下一个端口
      }
    }

    // 所有代理端口均不可达，记录失败时间以开启冷却熔断
    lastFallbackFailedTime = Date.now();
    logger.warn(`[smartNetworkGet] 所有本地代理端口与系统代理均不可达，已进入 ${Math.round(FALLBACK_COOLDOWN_MS / 1000)}s 熔断冷却。`);

    // 所有代理端口不可达，阻止直连，保护隐私
    throw new Error(
      `[MarketLens] 代理连接失败。已阻止直连。请确认代理软件已启动。`
    );
  }
}

// 兼容别名
export const cryptoGet = smartNetworkGet;