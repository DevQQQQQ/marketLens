// src/services/network.ts
import * as http from "http";
import * as https from "https";
import * as net from "net";
import * as zlib from "zlib";
import { URL } from "url";
import { logger } from "../utils/logger.ts";

export interface CryptoNetworkOptions {
  mode: "proxy" | "direct";
  proxyUrl?: string;
}

export interface ProxyStatus {
  /** 当前探测成功的本地端口；尚无可用端口时为 `undefined`（非省略键） */
  activePort?: number | undefined;
  inCooldown: boolean;
  cooldownRemainingSeconds: number;
  /** 当前是否处于软路由/网关透明代理生效模式 */
  isGatewayProxy?: boolean;
}

export interface NetworkRequestConfig {
  timeout?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
  responseType?: "json" | "text" | "arraybuffer";
  proxy?: { host: string; port: number; protocol?: string; auth?: { username: string; password: string } } | false;
}

export interface NetworkResponse<T = unknown> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  config?: NetworkRequestConfig;
}

// 保持历史兼容别名
export type AxiosRequestConfig = NetworkRequestConfig;
export type AxiosResponse<T = unknown> = NetworkResponse<T>;

/**
 * 当服务端返回非 2xx HTTP 状态码时抛出的异常，结构对齐原 AxiosError
 */
export class HttpError extends Error {
  response: {
    status: number;
    statusText: string;
    data: unknown;
    headers: Record<string, string>;
  };
  status: number;

  constructor(status: number, statusText: string, data: unknown, headers: Record<string, string>) {
    super(`Request failed with status code ${status}`);
    this.name = "HttpError";
    this.status = status;
    this.response = { status, statusText, data, headers };
  }
}

/** 默认本地代理端口与地址常量 */
export const DEFAULT_PROXY_PORT = 10808;
export const DEFAULT_PROXY_URL = `http://127.0.0.1:${DEFAULT_PROXY_PORT}`;

/**
 * 主流代理客户端 HTTP/Mixed 端口探测池
 * 优先探测 HTTP 监听端口，确保与 HTTP 代理协议无缝匹配
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

const BASE_HEADERS: Record<string, string> = {
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
/** 默认网络请求超时（毫秒） */
export const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
/** 系统环境变量代理降级探测超时（毫秒） */
export const SYSTEM_PROXY_FALLBACK_TIMEOUT_MS = 2500;
/** 本地主流代理端口快速探测超时（毫秒） */
export const QUICK_PROXY_PROBE_TIMEOUT_MS = 1500;
/** 本地代理端口轻量前置探活超时（毫秒） */
export const PORT_PROBE_TIMEOUT_MS = 600;
/** 行情请求最大重定向跳数 */
export const MAX_REDIRECTS = 3;

/** 网关透明代理探活超时（毫秒） */
export const GATEWAY_PROBE_TIMEOUT_MS = 1500;
/** 网关透明代理探测状态缓存有效期（毫秒）：60 秒，避免每轮高频轮询重复请求外网探活 */
export const GATEWAY_PROBE_CACHE_TTL_MS = 60_000;
/** 网关透明代理无敏感检测地址 */
export const GATEWAY_PROBE_URL = "https://cp.cloudflare.com/generate_204";

let lastGatewayProbeTime = 0;
let lastGatewayProbeResult = false;
let isGatewayProxyActive = false;

/** 获取当前已探测并生效的本地代理端口 */
export function getCachedWorkingPort(): number | undefined {
  return cachedWorkingPort;
}

/** 获取当前是否已识别并切换至软路由/网关透明代理 */
export function getIsGatewayProxyActive(): boolean {
  return isGatewayProxyActive;
}

/** 重置代理缓存与探测状态（当用户在设置面板修改网络配置时调用） */
export function resetProxyCache(): void {
  cachedWorkingPort = undefined;
  lastFallbackFailedTime = 0;
  lastGatewayProbeTime = 0;
  lastGatewayProbeResult = false;
  isGatewayProxyActive = false;
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
    isGatewayProxy: cachedWorkingPort === undefined && isGatewayProxyActive,
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
 * 解析 proxyUrl，供代理通道使用
 */
export function parseProxy(proxyUrlStr: string): {
  host: string;
  port: number;
  protocol: string;
  auth?: { username: string; password: string };
} {
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
        timeout: PORT_PROBE_TIMEOUT_MS,
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

// =================== 测试 Mock 钩子支持 ===================
export interface RawHttpRequestOptions {
  url: string;
  config: NetworkRequestConfig;
  proxy?: { host: string; port: number; protocol?: string; auth?: { username: string; password: string } } | undefined;
  isDirect: boolean;
}

export type RawHttpExecutor = (
  options: RawHttpRequestOptions
) => Promise<NetworkResponse<unknown>> | NetworkResponse<unknown>;

let customHttpExecutor: RawHttpExecutor | undefined = undefined;

/**
 * 设置单测专属的底层网络执行器（传入 undefined 恢复真实网络调用）
 */
export function setCustomHttpExecutor(executor?: RawHttpExecutor): void {
  customHttpExecutor = executor;
}

// =================== Node.js 原生 0 依赖 HTTP 请求执行器 ===================

/**
 * 建立到 HTTP 代理服务器的 CONNECT TCP 隧道（用于安全发起远端 HTTPS 请求）
 */
function createProxyConnectTunnel(
  proxyHost: string,
  proxyPort: number,
  targetHost: string,
  targetPort: number,
  auth?: { username: string; password: string },
  timeoutMs: number = 5000
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      Host: `${targetHost}:${targetPort}`,
    };
    if (auth) {
      headers["Proxy-Authorization"] = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`;
    }

    const req = http.request({
      host: proxyHost,
      port: proxyPort,
      method: "CONNECT",
      path: `${targetHost}:${targetPort}`,
      headers,
      timeout: timeoutMs,
    });

    req.on("connect", (res, socket) => {
      if (res.statusCode === 200) {
        resolve(socket);
      } else {
        socket.destroy();
        reject(new Error(`Proxy CONNECT failed with status code ${res.statusCode}`));
      }
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Proxy CONNECT timeout after ${timeoutMs}ms`));
    });

    req.end();
  });
}

/**
 * 依据响应头的 Content-Encoding 对原始报文进行透明解压（支持 gzip / deflate / br）
 */
function decompressBufferIfNeeded(buffer: Buffer, contentEncoding?: string): Buffer {
  if (!contentEncoding || buffer.length === 0) {
    return buffer;
  }
  const encoding = contentEncoding.toLowerCase().trim();
  try {
    if (encoding === "gzip" || encoding === "x-gzip") {
      return zlib.gunzipSync(buffer);
    }
    if (encoding === "deflate") {
      return zlib.inflateSync(buffer);
    }
    if (encoding === "br") {
      return zlib.brotliDecompressSync(buffer);
    }
  } catch {
    // 若特定解压格式异常，优雅降级为原始 Buffer
  }
  return buffer;
}

/**
 * 原生执行单个 GET 请求（支持 direct 直连 与 HTTP Proxy 通道，内置解压缩与重定向）
 */
async function executeNativeGet<T>(
  targetUrlStr: string,
  config: NetworkRequestConfig,
  proxy?: { host: string; port: number; protocol?: string; auth?: { username: string; password: string } },
  redirectsRemaining: number = config.maxRedirects ?? MAX_REDIRECTS
): Promise<NetworkResponse<T>> {
  const parsedUrl = new URL(targetUrlStr);
  const isHttps = parsedUrl.protocol === "https:";
  const timeoutMs = config.timeout || DEFAULT_REQUEST_TIMEOUT_MS;
  const headers = { ...BASE_HEADERS, ...config.headers };

  let reqOptions: http.RequestOptions;

  if (proxy) {
    if (isHttps) {
      // HTTPS over HTTP Proxy: 必须通过 CONNECT 隧道先打通 TCP Socket
      const targetPort = parseInt(parsedUrl.port, 10) || 443;
      const socket = await createProxyConnectTunnel(
        proxy.host,
        proxy.port,
        parsedUrl.hostname,
        targetPort,
        proxy.auth,
        timeoutMs
      );

      reqOptions = {
        createConnection: () => socket, // 复用已建立好代理隧道的 TCP Socket
        agent: false,
        hostname: parsedUrl.hostname,
        port: targetPort,
        method: "GET",
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        headers: {
          Host: parsedUrl.hostname,
          ...headers,
        },
        timeout: timeoutMs,
      };
    } else {
      // HTTP over HTTP Proxy: 直接向代理服务器发 GET，Path 为完整 URL
      const reqHeaders = { ...headers };
      if (proxy.auth) {
        reqHeaders["Proxy-Authorization"] = `Basic ${Buffer.from(`${proxy.auth.username}:${proxy.auth.password}`).toString("base64")}`;
      }
      reqOptions = {
        host: proxy.host,
        port: proxy.port,
        method: "GET",
        path: targetUrlStr,
        headers: {
          Host: parsedUrl.hostname,
          ...reqHeaders,
        },
        timeout: timeoutMs,
      };
    }
  } else {
    // 直连模式
    reqOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      method: "GET",
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      headers: {
        Host: parsedUrl.hostname,
        ...headers,
      },
      timeout: timeoutMs,
    };
  }

  return new Promise((resolve, reject) => {
    const client = (isHttps && !proxy) || (isHttps && proxy) ? https : http;
    const req = client.request(reqOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const rawBuffer = Buffer.concat(chunks);
        const respHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (v !== undefined) {
            respHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
          }
        }

        const statusCode = res.statusCode || 200;
        const statusText = res.statusMessage || "OK";

        // 自动跟随 301 / 302 / 307 / 308 重定向
        if (
          statusCode >= 300 &&
          statusCode < 400 &&
          res.headers.location &&
          redirectsRemaining > 0
        ) {
          try {
            const nextUrl = new URL(res.headers.location, targetUrlStr).toString();
            executeNativeGet<T>(nextUrl, config, proxy, redirectsRemaining - 1).then(resolve, reject);
            return;
          } catch {
            // URL 格式异常时继续向下按常规状态码处理
          }
        }

        // 透明解压缩（支持网关注入的 gzip / deflate / br）
        const fullBuffer = decompressBufferIfNeeded(rawBuffer, respHeaders["content-encoding"]);

        let parsedData: unknown;
        if (config.responseType === "arraybuffer") {
          // 直接将 Buffer 转换为 ArrayBuffer（供腾讯行情 decodeGbk 消费）
          const arrayBuffer = fullBuffer.buffer.slice(
            fullBuffer.byteOffset,
            fullBuffer.byteOffset + fullBuffer.byteLength
          );
          parsedData = arrayBuffer;
        } else {
          const text = fullBuffer.toString("utf8");
          if (config.responseType === "text") {
            parsedData = text;
          } else {
            try {
              parsedData = JSON.parse(text);
            } catch {
              parsedData = text;
            }
          }
        }

        // 若 HTTP 状态码不是 2xx，抛出 HttpError 以对齐 AxiosError 契约
        if (statusCode < 200 || statusCode >= 300) {
          reject(new HttpError(statusCode, statusText, parsedData, respHeaders));
          return;
        }

        resolve({
          data: parsedData as T,
          status: statusCode,
          statusText,
          headers: respHeaders,
          config,
        });
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Request timeout after ${timeoutMs}ms: ${targetUrlStr}`));
    });

    req.end();
  });
}

async function performRequest<T>(
  url: string,
  config: NetworkRequestConfig,
  isDirect: boolean,
  proxy?: { host: string; port: number; protocol?: string; auth?: { username: string; password: string } }
): Promise<NetworkResponse<T>> {
  if (customHttpExecutor) {
    const res = await customHttpExecutor({ url, config, isDirect, proxy });
    return res as NetworkResponse<T>;
  }
  return await executeNativeGet<T>(url, config, isDirect ? undefined : proxy);
}

/**
 * 探测当前网络是否具备软路由/网关透明代理能力（即直连可透明出海）
 * @param timeoutMs 探测超时，默认 GATEWAY_PROBE_TIMEOUT_MS (1500ms)
 * @param forceBypassCache 是否绕过缓存强制重新探测
 */
export async function testGatewayTransparentProxy(
  timeoutMs: number = GATEWAY_PROBE_TIMEOUT_MS,
  forceBypassCache: boolean = false
): Promise<boolean> {
  const now = Date.now();
  if (!forceBypassCache && lastGatewayProbeTime > 0 && now - lastGatewayProbeTime < GATEWAY_PROBE_CACHE_TTL_MS) {
    return lastGatewayProbeResult;
  }
  try {
    const res = await performRequest<{ status?: string } | string>(
      GATEWAY_PROBE_URL,
      { timeout: timeoutMs, proxy: false },
      true,
      undefined
    );
    // 204 No Content 或 200 OK 均视为透明代理连通有效
    const isSuccess = res.status === 204 || res.status === 200;
    lastGatewayProbeTime = now;
    lastGatewayProbeResult = isSuccess;
    return isSuccess;
  } catch {
    lastGatewayProbeTime = now;
    lastGatewayProbeResult = false;
    return false;
  }
}

/**
 * 通用网络请求核心方法（支持 direct 直连 与 proxy 强制代理）
 */
export async function smartNetworkGet<T = unknown>(
  url: string,
  options: CryptoNetworkOptions,
  config: NetworkRequestConfig = {}
): Promise<NetworkResponse<T>> {
  const { mode = "direct", proxyUrl } = options;

  const mergedConfig: NetworkRequestConfig = {
    ...config,
    timeout: config.timeout || DEFAULT_REQUEST_TIMEOUT_MS,
    maxRedirects: config.maxRedirects ?? MAX_REDIRECTS,
    headers: { ...BASE_HEADERS, ...config.headers },
  };

  // 1. 直连模式（绝不走代理）
  if (mode === "direct") {
    return await performRequest<T>(url, { ...mergedConfig, proxy: false }, true, undefined);
  }

  // 2. 强制代理模式（含软路由透明网关自适应）
  const rawProxy = parseProxy(proxyUrl || "");
  const isLocalTarget = !proxyUrl || rawProxy.host === "127.0.0.1" || rawProxy.host === "localhost";
  const isDefaultLocalProxy =
    !proxyUrl ||
    proxyUrl === DEFAULT_PROXY_URL ||
    ((rawProxy.host === "127.0.0.1" || rawProxy.host === "localhost") && rawProxy.port === DEFAULT_PROXY_PORT);

  // 若已识别处于软路由透明网关模式，且本地无活跃端口、未指定远程代理，优先走网关直连
  if (isGatewayProxyActive && isLocalTarget && !cachedWorkingPort) {
    try {
      const res = await performRequest<T>(url, { ...mergedConfig, proxy: false }, true, undefined);
      return res;
    } catch (err: unknown) {
      const httpError = err as { response?: unknown } | null | undefined;
      if (httpError?.response) {
        throw err;
      }
      // 网关直连失败（可能用户已离开软路由环境），清除状态并下落进入常规本地代理与探测流程
      isGatewayProxyActive = false;
      lastGatewayProbeResult = false;
      lastGatewayProbeTime = 0;
      logger.warn(`[smartNetworkGet] 软路由网关连接中断，已自动退回本地代理与端口探测流程: ${String((err as Error)?.message || err)}`);
    }
  }

  const targetProxy =
    cachedWorkingPort && isDefaultLocalProxy
      ? { ...rawProxy, host: "127.0.0.1", port: cachedWorkingPort }
      : rawProxy;

  // 第一优先级：尝试目标代理端口
  try {
    const res = await performRequest<T>(url, { ...mergedConfig, proxy: targetProxy }, false, targetProxy);
    cachedWorkingPort = targetProxy.port;
    isGatewayProxyActive = false;
    return res;
  } catch (err: unknown) {
    // 若远端服务器已正常返回 HTTP 响应（如 400 Bad Request, 404, 429），说明代理通道完全通畅且连接成功，
    // 绝非代理端口不可用，直接抛出原生异常保留 status 与业务错误体，杜绝误触发代理探测熔断
    const httpError = err as { response?: unknown } | null | undefined;
    if (httpError?.response) {
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
          const res = await performRequest<T>(
            url,
            { ...mergedConfig, timeout: SYSTEM_PROXY_FALLBACK_TIMEOUT_MS, proxy: sysProxy },
            false,
            sysProxy
          );
          if (cachedWorkingPort !== sysProxy.port) {
            logger.info(`[smartNetworkGet] 目标代理端口不可达，已自动切换至系统环境变量代理端口: ${sysProxy.port}`);
          }
          cachedWorkingPort = sysProxy.port;
          isGatewayProxyActive = false;
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
        const fallbackProxy = { host: "127.0.0.1", port, protocol: "http" };
        const res = await performRequest<T>(
          url,
          { ...mergedConfig, timeout: QUICK_PROXY_PROBE_TIMEOUT_MS, proxy: fallbackProxy },
          false,
          fallbackProxy
        );
        // 成功！记录并缓存此端口，后续无需重试
        if (cachedWorkingPort !== port) {
          logger.info(`[smartNetworkGet] 目标代理端口不可达，已自动降级回退至本地可用端口: ${port}`);
        }
        cachedWorkingPort = port;
        isGatewayProxyActive = false;
        return res;
      } catch {
        // 继续探测下一个端口
      }
    }

    // 第四优先级：本地所有代理端口均不可达时，智能检测网关透明代理（软路由环境自适应）
    const isLocalDefault = !proxyUrl || targetProxy.host === "127.0.0.1" || targetProxy.host === "localhost";
    if (isLocalDefault) {
      const isGatewayOk = await testGatewayTransparentProxy();
      if (isGatewayOk) {
        try {
          const res = await performRequest<T>(url, { ...mergedConfig, proxy: false }, true, undefined);
          if (!isGatewayProxyActive) {
            logger.info(`[smartNetworkGet] 未检测到本地代理客户端，但已成功识别软路由/网关透明代理，自动启用透明直连。`);
          }
          cachedWorkingPort = undefined;
          isGatewayProxyActive = true;
          return res;
        } catch (gatewayErr: unknown) {
          const httpError = gatewayErr as { response?: unknown } | null | undefined;
          if (httpError?.response) {
            cachedWorkingPort = undefined;
            isGatewayProxyActive = true;
            throw gatewayErr;
          }
          logger.warn(`[smartNetworkGet] 网关探活成功但实际业务请求连接失败: ${String((gatewayErr as Error)?.message || gatewayErr)}`);
        }
      }
    }

    // 所有代理端口与网关透明代理均不可达，记录失败时间以开启冷却熔断
    isGatewayProxyActive = false;
    lastFallbackFailedTime = Date.now();
    logger.warn(`[smartNetworkGet] 所有本地代理端口与网关透明代理均不可达，已进入 ${Math.round(FALLBACK_COOLDOWN_MS / 1000)}s 熔断冷却。`);

    // 所有代理端口不可达，阻止直连，保护隐私
    throw new Error(
      `[MarketLens] 代理连接失败。已阻止直连。请确认代理软件已启动或软路由已开启透明代理。`
    );
  }
}

// 兼容别名
export const cryptoGet = smartNetworkGet;
