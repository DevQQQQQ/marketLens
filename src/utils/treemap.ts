// src/utils/treemap.ts
// Squarified Treemap（平铺矩形树图）算法纯原生实现。
// 基于 Bruls, Huizing, van Wijk (2000) 经典算法，0 外部依赖。
// 将一组带有权重的标的或板块切分为尽量接近正方形的矩形布局。

export interface TreemapInputItem {
  readonly id?: string | undefined;
  readonly name: string;
  readonly value: number; // 权重（如成交额或市值），必须 > 0
  readonly change: number; // 涨跌幅百分比（如 2.35 或 -1.42）
  readonly extra?: string | undefined; // 辅助展示文本（如 "+21.6亿" 或 "353亿"）
}

export interface TreemapRect {
  readonly id?: string | undefined;
  readonly name: string;
  readonly value: number;
  readonly change: number;
  readonly extra?: string | undefined;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface Container {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 计算行内矩形的最差长宽比（worst aspect ratio）
 * 目标是让这个值尽量小（越接近 1 越趋于正方形）
 */
function worstAspectRatio(rowAreas: readonly number[], length: number): number {
  if (rowAreas.length === 0 || length <= 0) return Infinity;
  let rowSum = 0;
  let maxArea = -Infinity;
  let minArea = Infinity;

  for (const area of rowAreas) {
    rowSum += area;
    if (area > maxArea) maxArea = area;
    if (area < minArea) minArea = area;
  }

  if (rowSum <= 0 || minArea <= 0) return Infinity;

  const lengthSq = length * length;
  const rowSumSq = rowSum * rowSum;

  const ratio1 = (lengthSq * maxArea) / rowSumSq;
  const ratio2 = rowSumSq / (lengthSq * minArea);

  return Math.max(ratio1, ratio2);
}

/**
 * 执行 Squarified 矩形树图排布计算
 *
 * @param items 输入标的列表（内部会自动滤除非正权重并降序排序）
 * @param width 目标容器总宽度（px）
 * @param height 目标容器总高度（px）
 * @returns 带有精确坐标和尺寸的矩形集合
 */
export function computeSquarifiedTreemap(
  items: readonly TreemapInputItem[],
  width: number,
  height: number
): TreemapRect[] {
  if (!items || items.length === 0 || width <= 0 || height <= 0) {
    return [];
  }

  // 1. 过滤非法数据并保证权重非负
  const validItems = items
    .filter((item) => typeof item.value === "number" && Number.isFinite(item.value) && item.value > 0)
    .sort((a, b) => b.value - a.value);

  if (validItems.length === 0) {
    return [];
  }

  const totalValue = validItems.reduce((acc, cur) => acc + cur.value, 0);
  if (totalValue <= 0) return [];

  const totalArea = width * height;
  // 归一化为实际面积
  const normalizedItems = validItems.map((item) => ({
    raw: item,
    area: (item.value / totalValue) * totalArea,
  }));

  const results: TreemapRect[] = [];
  const container: Container = { x: 0, y: 0, w: width, h: height };

  let remaining = normalizedItems;

  while (remaining.length > 0 && container.w > 0 && container.h > 0) {
    const isHorizontal = container.w >= container.h;
    const sideLength = isHorizontal ? container.h : container.w;

    const row = [remaining[0]!];
    const rowAreas = [remaining[0]!.area];

    for (let i = 1; i < remaining.length; i++) {
      const nextItem = remaining[i]!;
      const candidateAreas = [...rowAreas, nextItem.area];

      const currentWorst = worstAspectRatio(rowAreas, sideLength);
      const candidateWorst = worstAspectRatio(candidateAreas, sideLength);

      // 若加入下一个元素会让长宽比更优（或相同），则吸纳入当前行；否则封顶当前行
      if (candidateWorst <= currentWorst) {
        row.push(nextItem);
        rowAreas.push(nextItem.area);
      } else {
        break;
      }
    }

    // 布局当前行中的元素
    const rowAreaSum = rowAreas.reduce((a, b) => a + b, 0);
    const rowThickness = sideLength > 0 ? rowAreaSum / sideLength : 0;

    let offset = 0;
    for (const item of row) {
      const itemLength = rowThickness > 0 ? item.area / rowThickness : 0;

      if (isHorizontal) {
        // 沿纵向排布，向右延伸
        results.push({
          id: item.raw.id,
          name: item.raw.name,
          value: item.raw.value,
          change: item.raw.change,
          extra: item.raw.extra,
          x: container.x,
          y: container.y + offset,
          w: rowThickness,
          h: itemLength,
        });
      } else {
        // 沿横向排布，向下延伸
        results.push({
          id: item.raw.id,
          name: item.raw.name,
          value: item.raw.value,
          change: item.raw.change,
          extra: item.raw.extra,
          x: container.x + offset,
          y: container.y,
          w: itemLength,
          h: rowThickness,
        });
      }
      offset += itemLength;
    }

    // 切除已使用的空间，更新剩余容器
    if (isHorizontal) {
      container.x += rowThickness;
      container.w -= rowThickness;
    } else {
      container.y += rowThickness;
      container.h -= rowThickness;
    }

    remaining = remaining.slice(row.length);
  }

  return results;
}
