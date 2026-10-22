// src/utils/feedback.ts
import * as vscode from "vscode";
import { canEmitUserFeedback, isDisplayMasked, shouldBlockNodeCommand } from "./maskState.ts";

/**
 * 用户回显与对话框入口的统一出口。
 *
 * 存在理由：`vscode.window.setStatusBarMessage` 与 `showInformationMessage` 都独立于
 * `StatusBar.barItem.hide()`——行情条已隐藏时临时消息仍会闪现，弹窗仍会铺满真实标的名。
 * 因此所有面向用户的回显必须经本模块收口，严禁在 `feedback.ts` 之外直调状态栏消息 API。
 *
 * 脱敏状态不在此模块内自持，而是由 `extension.ts` 在 activate 时注入快照来源，
 * 这样既保证与状态栏 / 树视图读到同一份真相，又避免与 `StatusBar` 形成循环依赖。
 */
export interface MaskSnapshot {
  bossKeyActive: boolean;
  maskMode: boolean;
}

let maskSnapshotSource: () => MaskSnapshot = () => ({ bossKeyActive: false, maskMode: false });

/** 注入脱敏状态来源（由扩展入口在创建 StatusBar 后调用一次） */
export function setMaskSnapshotSource(source: () => MaskSnapshot): void {
  maskSnapshotSource = source;
}

/** 读取当前脱敏状态快照 */
export function getMaskSnapshot(): MaskSnapshot {
  return maskSnapshotSource();
}

/** 当前是否处于任一脱敏态（老板键或简洁展示） */
export function isMasked(): boolean {
  const { bossKeyActive, maskMode } = getMaskSnapshot();
  return isDisplayMasked(bossKeyActive, maskMode);
}

/**
 * 判定对话框 / 向导入口是否允许开启（守卫下沉用）。
 *
 * 与命令层的 `shouldBlockNodeCommand` 使用同一谓词，构成纵深防御：
 * 命令面板与右键菜单是不同分支，模块入口必须自带判定，不能只依赖调用方。
 */
export function canOpenPrompt(hasNode: boolean): boolean {
  const { bossKeyActive, maskMode } = getMaskSnapshot();
  return !shouldBlockNodeCommand(bossKeyActive, maskMode, hasNode);
}

/** 老板键是否处于激活态（一票否决全部弹窗与回显） */
export function isBossKeyActive(): boolean {
  return getMaskSnapshot().bossKeyActive;
}

/** 脱敏态占位文本：不得含插件名与模式名，否则悬停即自曝 */
export const MASKED_VALUE_TEXT = "****";

/** 出口 A：仅把数值段收敛为占位符，保留标的名（向导文案需要名称确认目标） */
export function maskNumbers(text: string): string {
  if (!isMasked()) {
    return text;
  }
  return text.replace(/\d+(?:[.,]\d+)?/g, MASKED_VALUE_TEXT);
}

/** 出口 B：脱敏态下整条收敛为中性占位（被动可见回显连名称一起藏） */
export function maskIfNeeded(text: string): string {
  return isMasked() ? MASKED_VALUE_TEXT : text;
}

/** 状态栏临时消息统一出口：老板键期间完全静默 */
export function emitStatusMessage(message: string, timeout: number = 2500): void {
  if (!canEmitUserFeedback(getMaskSnapshot().bossKeyActive)) {
    return;
  }
  vscode.window.setStatusBarMessage(message, timeout);
}

/** 信息提示统一出口：老板键期间完全静默 */
export function showInfoMessage(message: string): void {
  if (!canEmitUserFeedback(getMaskSnapshot().bossKeyActive)) {
    return;
  }
  void vscode.window.showInformationMessage(message);
}
