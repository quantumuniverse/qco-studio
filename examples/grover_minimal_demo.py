from qiskit import QuantumCircuit
from quantum_circuit_observer import QCObserver, export_to_json
from qiskit.circuit.library import MCXGate

# qc = QuantumCircuit(2)
# qc.h(0)
# qc.cx(0, 1)

n = 4
qc = QuantumCircuit(n)

# 通用 3-控制 X 门（无辅助比特）。直接添加未指定合成的 MCXGate，
# 由 Aer/编译器通过 high-level-synthesis 自动选取合成方案，
# 避免已弃用的 MCXGrayCode / mcx(mode=...) 构造方式。
mcx3 = MCXGate(num_ctrl_qubits=3)
qc.append(mcx3, [0, 1, 2, 3])

# Step 1: 初始化叠加态
qc.h(range(n))

# ------------------ Oracle (标记 |1010>) ------------------
# Qiskit 小端序: |1010> 表示 q0=0, q1=1, q2=0, q3=1
# 翻转 q0 和 q2，使 |1010> 变为 |1111>，以便多控门识别
qc.x([0, 2])

# 多控 Z 门：当 q0,q1,q2 均为 |1> 时，翻转 q3 的相位
qc.h(3)                         # 将 Z 转成 X 的基
qc.append(mcx3, [0, 1, 2, 3])  # 多控 Toffoli (无辅助比特)
qc.h(3)

# 翻转回来
qc.x([0, 2])

# ------------------ 扩散器 (振幅放大) ------------------
qc.h(range(n))
qc.x(range(n))

# 多控 Z (同结构)
qc.h(3)
qc.append(mcx3, [0, 1, 2, 3])  # 多控 Toffoli (无辅助比特)
qc.h(3)

qc.x(range(n))
qc.h(range(n))

# 可选：添加测量（不影响观测，但可以验证最终概率）
# qc.measure_all()

result = QCObserver(qc).run()      # Produce the Visualization IR
export_to_json(result, "grover_search_1010.json")