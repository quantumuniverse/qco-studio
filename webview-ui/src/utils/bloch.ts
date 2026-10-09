import type { StepData } from '../types';

export interface BlochVector {
  x: number;
  y: number;
  z: number;
}

/**
 * 取某一步的每 qubit Bloch 向量：消费 engine 经 IR 下发的 bloch_vectors。
 * Engine 始终提供该数据（IR v2 tracks.bloch），无需前端补算。
 * 当数据缺失时（>12 比特 summary mode 等极端场景）返回空数组，由渲染层处理。
 */
export function resolveBlochVectors(
  step: StepData,
  numQubits: number
): BlochVector[] {
  const fromEngine = step.bloch_vectors;
  if (fromEngine && fromEngine.length === numQubits) {
    return fromEngine.map(([x, y, z]) => ({ x, y, z }));
  }
  return [];
}
