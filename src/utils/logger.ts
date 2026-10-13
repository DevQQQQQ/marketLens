// src/utils/logger.ts
import * as vscode from "vscode";

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
    const timestamp = new Date().toLocaleTimeString();
    const errObj = detail as { stack?: string; message?: string } | undefined;
    const detailStr = detail ? ` => ${errObj?.stack || errObj?.message || String(detail)}` : "";
    const line = `[${timestamp}] [DEBUG] ${message}${detailStr}`;
    this.channel?.appendLine(line);
    console.debug(`[MarketLens] ${message}`, detail ?? "");
  }

  public info(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    const line = `[${timestamp}] [INFO] ${message}`;
    this.channel?.appendLine(line);
    console.log(`[MarketLens] ${message}`);
  }

  public warn(message: string, error?: unknown): void {
    const timestamp = new Date().toLocaleTimeString();
    const errObj = error as { stack?: string; message?: string } | undefined;
    const errDetail = error ? ` => ${errObj?.stack || errObj?.message || String(error)}` : "";
    const line = `[${timestamp}] [WARN] ${message}${errDetail}`;
    this.channel?.appendLine(line);
    console.warn(`[MarketLens] ${message}`, error ?? "");
  }

  public error(message: string, error?: unknown): void {
    const timestamp = new Date().toLocaleTimeString();
    const errObj = error as { stack?: string; message?: string } | undefined;
    const errDetail = error ? ` => ${errObj?.stack || errObj?.message || String(error)}` : "";
    const line = `[${timestamp}] [ERROR] ${message}${errDetail}`;
    this.channel?.appendLine(line);
    console.error(`[MarketLens] ${message}`, error ?? "");
  }

  public show(): void {
    this.channel?.show(true);
  }
}

export const logger = new LoggerService();
