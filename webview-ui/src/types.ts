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

export interface StepData {
  step_id: number;
  gate_name: string;
  qubits: number[];
  /** [real, imag] 对 */
  statevector: [number, number][];
  /** [source, target, value] 三元组 */
  edges: [number, number, number][];
  global_entropy: number;
}

export interface RenderReadyData {
  metadata: CircuitMetadata;
  circuit_layout: CircuitLayout;
  steps: StepData[];
}
