/** 与 python/backend.py 输出的“渲染就绪 JSON”一一对应（TDD 2.1）。 */

export interface CircuitMetadata {
  n_qubits: number;
  total_steps: number;
  depth: number;
}

export interface GateLayout {
  name: string;
  qubits: number[];
  step: number;
  x_pos: number;
}

export interface CircuitLayout {
  gates: GateLayout[];
  num_qubits: number;
  width: number;
}

/**
 * Engine 计算的稀疏 top-k 振幅快照（qco-engine AmplitudeProjector，经 IR v2 tracks.amp 传输）。
 * magnitudes 为振幅模 |amp|（非概率，prob = mag²）；phases 为弧度相位 arg(amp)。
 */
export interface AmplitudeSnapshot {
  basis_indices: number[];
  magnitudes: number[];
  phases: number[];
  total_basis: number;
}

export interface StepData {
  step_id: number;
  gate_name: string;
  qubits: number[];
  /** [real, imag] 对；大电路（超过 engine 的 max_qubits_for_statevector）为空数组 */
  statevector: [number, number][];
  /** [source, target, value] 三元组 */
  edges: [number, number, number][];
  global_entropy: number;
  /** Engine 计算的每 qubit Bloch 向量 [x, y, z]（|0> 为北极）；旧后端缺省时为 undefined */
  bloch_vectors?: [number, number, number][];
  /** 每 qubit 约化密度矩阵纯度 Tr(ρ²) */
  purities?: number[];
  /** 每 qubit von Neumann 熵（bit） */
  qubit_entropies?: number[];
  amplitude?: AmplitudeSnapshot;
}

export interface RenderReadyData {
  metadata: CircuitMetadata;
  circuit_layout: CircuitLayout;
  steps: StepData[];
}
