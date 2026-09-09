export interface BlochVector {
  x: number;
  y: number;
  z: number;
}

/**
 * 由完整态向量计算每个 qubit 的 Bloch 向量 (x, y, z)。
 *
 * 采用 little-endian 位序（与 Qiskit 一致）：索引 idx 的第 i 位对应 qubit i。
 * 对 qubit i 求约化密度矩阵 ρ = 1/2 (I + xσx + yσy + zσz)：
 *   ρ01 = Σ amp(bit=0) * conj(amp(bit=1)) = (x - i·y) / 2
 *   z   = Σ|amp(bit=0)|² - Σ|amp(bit=1)|²
 */
export function getBlochVectors(statevector: [number, number][], numQubits: number): BlochVector[] {
  const size = 1 << numQubits;
  const amps: [number, number][] = Array.from({ length: size }, (_, index) => statevector[index] ?? [0, 0]);

  const vectors: BlochVector[] = [];

  for (let qubit = 0; qubit < numQubits; qubit += 1) {
    const mask = 1 << qubit;
    let rho00 = 0;
    let rho11 = 0;
    let rho01Real = 0;
    let rho01Imag = 0;

    for (let base = 0; base < size; base += 1) {
      if ((base & mask) !== 0) {
        continue;
      }

      const [aReal, aImag] = amps[base];
      const [bReal, bImag] = amps[base | mask];

      rho00 += aReal * aReal + aImag * aImag;
      rho11 += bReal * bReal + bImag * bImag;

      // a * conj(b)
      rho01Real += aReal * bReal + aImag * bImag;
      rho01Imag += aImag * bReal - aReal * bImag;
    }

    vectors.push({
      x: 2 * rho01Real,
      y: -2 * rho01Imag,
      z: rho00 - rho11
    });
  }

  return vectors;
}
