"""Grover 搜索示例：在 4 比特搜索空间中找十进制 13（二进制 1101）。

比特约定（Qiskit little-endian，q0 为最低位）：
    13 = 0b1101 -> q3=1, q2=1, q1=0, q0=1
因此目标态在计算基下的索引正好是 13。

q4 是辅助位：用于把 3 控 X（C3X）拆成 3 个 Toffoli，
Aer 原生支持 ccx，无需更深的基础门分解。
"""

from qiskit import QuantumCircuit

NUM_QUBITS = 4  # 搜索空间 2^4 = 16
TARGET = 13  # 0b1101 -> q3 q2 q1 q0 = 1 1 0 1
ANCILLA = 4  # 辅助位，保持 |0>
ITERATIONS = 3  # floor(pi/4 * sqrt(16)) = 3

qc = QuantumCircuit(NUM_QUBITS + 1, name="grover_13")


def multi_controlled_z(circuit: QuantumCircuit) -> None:
    """给 4 个搜索比特全为 1 的态加 -1 相位：|1111> -> -|1111>。

    由 H(3) + C3X(0,1,2 -> 3) + H(3) 构成；
    C3X 用 1 个辅助位拆成 3 个 Toffoli（辅助位用完复位）。
    """
    circuit.h(3)
    circuit.ccx(0, 1, ANCILLA)  # ancilla = q0 & q1
    circuit.ccx(2, ANCILLA, 3)  # q3 ^= q2 & ancilla
    circuit.ccx(0, 1, ANCILLA)  # 复位 ancilla
    circuit.h(3)


# 1. 均匀叠加
qc.h(range(NUM_QUBITS))

for _ in range(ITERATIONS):
    # 2. Oracle：给 |1101> 加 -1 相位（q1 为 0，先翻转到 |1111> 再翻回）
    qc.x(1)
    multi_controlled_z(qc)
    qc.x(1)

    # 3. Diffuser：关于均匀叠加态的反射
    qc.h(range(NUM_QUBITS))
    qc.x(range(NUM_QUBITS))
    multi_controlled_z(qc)
    qc.x(range(NUM_QUBITS))
    qc.h(range(NUM_QUBITS))
