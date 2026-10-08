import type { StepData } from '../types';

/**
 * 热力图数据来源：
 * - engine：每步 engine 振幅快照覆盖完整基底（top_k === total_basis），无损直接消费；
 * - statevector：快照不完整但每步都有完整态向量，由 |ψ|² 得到全基底概率；
 * - engine-topk：无态向量（engine 按 max_qubits_for_statevector 丢弃，或 payload 未携带）
 *   ——仅显示各步 top-k 并集列，
 *   未进入某步 top-k 的格子按 0 显示（UI 须诚实标注）。
 */
export type ProbabilitySource = 'engine' | 'statevector' | 'engine-topk';

export interface ProbabilityGrid {
  source: ProbabilitySource;
  /** 列对应的计算基底索引（升序）；dense 模式即 0..total_basis-1 */
  basis: number[];
  /** probs[step][col] = |amp|² */
  probs: number[][];
  /** phases[step][col] = arg(amp)（弧度）；缺失时为 null */
  phases: (number | null)[][];
  totalBasis: number;
}

function snapshotIsComplete(step: StepData): boolean {
  const amp = step.amplitude;
  return (
    !!amp &&
    amp.total_basis > 0 &&
    amp.basis_indices.length === amp.total_basis &&
    amp.magnitudes.length === amp.basis_indices.length
  );
}

/** 按列基底把一步的 engine 振幅快照展开为 probs / phases 行。 */
function rowFromSnapshot(step: StepData, column: Map<number, number>, width: number) {
  const probs = new Array<number>(width).fill(0);
  const phases = new Array<number | null>(width).fill(null);
  const amp = step.amplitude;
  if (!amp) {
    return { probs, phases };
  }
  amp.basis_indices.forEach((basis, k) => {
    const col = column.get(basis);
    if (col === undefined) {
      return;
    }
    const magnitude = amp.magnitudes[k] ?? 0;
    probs[col] = magnitude * magnitude;
    phases[col] = amp.phases[k] ?? null;
  });
  return { probs, phases };
}

/**
 * 为热力图选择数据源并构造概率/相位网格。优先消费 engine 下发的振幅快照，
 * 前端只做 |amp|² / arg(amp) 这类展示变换，不再重复量子计算。
 */
export function buildProbabilityGrid(steps: StepData[], numQubits: number): ProbabilityGrid | null {
  if (steps.length === 0) {
    return null;
  }
  const fullBasis = numQubits > 0 ? 1 << numQubits : 0;

  // (1) engine 快照完整覆盖基底：无损，直接消费。
  if (steps.every(snapshotIsComplete)) {
    const totalBasis = steps[0].amplitude!.total_basis;
    const basis = Array.from({ length: totalBasis }, (_, index) => index);
    const column = new Map(basis.map((b, col) => [b, col] as [number, number]));
    const rows = steps.map((step) => rowFromSnapshot(step, column, totalBasis));
    return {
      source: 'engine',
      basis,
      probs: rows.map((row) => row.probs),
      phases: rows.map((row) => row.phases),
      totalBasis
    };
  }

  // (2) 有完整态向量：全基底概率（engine top-k 只截取了前 k 个，信息量不如态向量）。
  if (steps.every((step) => step.statevector.length > 0)) {
    const totalBasis = steps[0].statevector.length;
    return {
      source: 'statevector',
      basis: Array.from({ length: totalBasis }, (_, index) => index),
      probs: steps.map((step) => step.statevector.map(([re, im]) => re * re + im * im)),
      phases: steps.map((step) => step.statevector.map(([re, im]) => Math.atan2(im, re))),
      totalBasis
    };
  }

  // (3) 无态向量：engine top-k 并集作为稀疏列。
  const union = new Set<number>();
  for (const step of steps) {
    for (const basis of step.amplitude?.basis_indices ?? []) {
      union.add(basis);
    }
  }
  if (union.size === 0) {
    return null;
  }
  const basis = Array.from(union).sort((a, b) => a - b);
  const column = new Map(basis.map((b, col) => [b, col] as [number, number]));
  const rows = steps.map((step) => rowFromSnapshot(step, column, basis.length));
  return {
    source: 'engine-topk',
    basis,
    probs: rows.map((row) => row.probs),
    phases: rows.map((row) => row.phases),
    totalBasis: steps.find((step) => step.amplitude)?.amplitude?.total_basis || fullBasis
  };
}
