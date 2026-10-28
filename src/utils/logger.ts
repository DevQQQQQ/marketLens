// src/utils/logger.ts
import * as vscode from "vscode";
import { createHash } from "node:crypto";

/**
 * 日志用的不可逆标的标签。
 *
 * 存在理由：AGENTS.md §5.4 明令「自选内容等敏感信息不得写入日志或外发」，而设置面板与
 * README 都把「打开运行日志」当作官方反馈渠道——用户贴到 issue 即等于外发。
 * 于是行情服务需要标识来做跨行关联，又不能落明文：取 sha1 前 6 位十六进制，
 * 同一标的/分组在任何机器上都能复现同一个标签，但无法反推代码、名称或合约地址。
 * 严禁在此之外把原始 symbol、name、合约地址或价格数值拼进日志。
 */
export function describeForLog(raw: string | undefined | null): string {
  const value = String(raw ?? "");
  if (value === "") {
    return "#<empty>";
  }
  return `#${createHash("sha1").update(value).digest("hex").slice(0, 6)}`;
}

/** 把一批标识折叠为「数量 + 少量标签」，避免整幅自选清单进日志 */
export function describeListForLog(list: ReadonlyArray<string>, maxTags = 3): string {
  const tags = list.slice(0, maxTags).map((s) => describeForLog(s)).join(" ");
  const rest = list.length > maxTags ? " …" : "";
  return `${list.length} 项 [${tags}${rest}]`;
}

// 请求 URL 常把整批自选代码带在查询串里（腾讯 `q=sh600519,sz000001`、币安 symbols=、
// DexScreener tokens/0x…），axios/fetch 的 error.message 又原样回显该 URL。
const URL_IN_TEXT_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'）)]+/gi;
// 长标识串（EVM/Solana 合约地址、批量代码列表等）。刻意不碰短词，避免把
// "timeout / ECONNREFUSED" 这类可读信息也哈希掉。
const LONG_TOKEN_RE = /\b[0-9a-zA-Z,._-]{16,}\b/g;

/**
 * 清洗任意外部文本（错误消息、堆栈、报文）后再进日志：
 * 整段 URL 与长标识串一律替换为不可逆标签。
 */
export function scrubForLog(text: string): string {
  return text
    .replace(URL_IN_TEXT_RE, (m) => describeForLog(m))
    .replace(LONG_TOKEN_RE, (m) => describeForLog(m));
}

/** 错误对象的日志表示：只保留错误名与清洗后的消息，不回显 URL 与标识 */
export function describeErrorForLog(err: unknown): string {
  const e = err as { name?: string; message?: string } | undefined;
  const name = e?.name && e.name !== "" ? e.name : "Error";
  const message = e?.message ? scrubForLog(String(e.message)) : scrubForLog(String(err));
  return `${name}: ${message}`;
}

/**
 * 只保留错误名的日志表示。
 * 用于消息本身可能内嵌被解析内容（如 JSON.parse 的 SyntaxError 会带上出错片段）的场景，
 * 此时连清洗过的 message 也不值得冒回显自选清单的风险。
 */
export function describeErrorNameForLog(err: unknown): string {
  const name = (err as { name?: string } | undefined)?.name;
  return name && name !== "" ? scrubForLog(name) : "unknown";
}

/** 明细参数的日志表示：保留错误名/堆栈结构，但先清洗 URL 与长标识串 */
export function formatDetailForLog(detail: unknown): string {
  if (detail === undefined || detail === null) {
    return "";
  }
  if (typeof detail === "string") {
    return scrubForLog(detail);
  }
  const e = detail as { stack?: string; message?: string };
  if (e?.stack) {
    return scrubForLog(e.stack);
  }
  if (e?.message) {
    return scrubForLog(e.message);
  }
  return scrubForLog(String(detail));
}

class LoggerService {
  private channel: vscode.OutputChannel | undefined;

  public init(context: vscode.ExtensionContext): vscode.OutputChannel | undefined {
    if (!this.channel && vscode.window) {
      this.channel = vscode.window.createOutputChannel("MarketLens");
      context.subscriptions.push(this.channel);
    }
    return this.channel;
  }

  public debug(message: string, detail?: unknown): void {
    this.emit("DEBUG", message, detail);
  }

  public info(message: string): void {
    this.emit("INFO", message);
  }

  public warn(message: string, error?: unknown): void {
    this.emit("WARN", message, error);
  }

  public error(message: string, error?: unknown): void {
    this.emit("ERROR", message, error);
  }

  /**
   * 唯一的落笔出口：OutputChannel 与 dev console 共用同一行已清洗文本，
   * 避免两个通道里出现「一份脱敏、一份明文」的双轨日志。
   */
  private emit(level: string, message: string, detail?: unknown): void {
    const timestamp = new Date().toLocaleTimeString();
    const detailStr = detail === undefined || detail === null ? "" : ` => ${formatDetailForLog(detail)}`;
    const line = `[${timestamp}] [${level}] ${message}${detailStr}`;
    this.channel?.appendLine(line);
    console.log(`[MarketLens] ${message}`, detailStr);
  }

  public show(): void {
    this.channel?.show(true);
  }
}

export const logger = new LoggerService();
