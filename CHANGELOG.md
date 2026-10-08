# Change Log

## [Unreleased]

State Inspector 与振幅热力图改为使用 qco-engine 的计算结果。

### Added

- 渲染就绪 JSON 每步新增 `bloch_vectors`、`purities`、`qubit_entropies`、`amplitude`（engine top-k 快照），由 `python/backend.py` 从 IR 透传
- Bloch 球标签显示纯度与单比特熵（`q{n} · P=… · S=…`），悬停显示数值来源
- 热力图尺子下方标注数据来源：`qco-engine amplitude` / `statevector |ψ|²` / `qco-engine top-k`

### Changed

- Bloch 向量优先使用 engine 的值，仅在 payload 缺少该字段时从态向量现算
- 热力图在 engine 快照覆盖全部基态时直接使用快照；快照不完整时用态向量；没有态向量时只画 top-k 并集列
- 需要 qco-engine 含 State Inspector / Amplitude tracks 的版本；旧版 engine 仍可使用（走前端现算）

## [0.1.0] — 2026-09-09

首个可运行版本：CodeLens 触发观测 + 四视图回放 + 侧边栏元数据。

### Added

- 扩展骨架（TypeScript + webpack）与 `python/backend.py`（FastAPI 风格路由脚本）
- CodeLens：**▶ Observe**（识别 `变量 = QuantumCircuit(...)`）
- Python 子进程调用：`--file` / `--variable`，输出渲染就绪 JSON（metadata / circuit_layout / steps）
- Webview 面板（React + Vite），`QCO: Quantum Circuit Observer`
- 视图一：电路图（Canvas，当前步高亮 + 自动滚动 + 点击/拖动跳步）
- 视图二：Bloch 球（Three.js，态向量 + 历史轨迹）
- 视图三：增强热力图（态空间尺子 + 纵向时间窗口 + 悬停数值）
- 视图四：动态纠缠图（D3 力导向，边宽/颜色随纠缠值过渡）
- 侧边栏 `QCO Metadata`（qubits / 总门数 / depth / 当前门 / 全局熵）
- 命令 `qco.showPanel`、`qco.observe`、`qco.check`
- 设置 `qco.pythonPath`
- 错误处理与环境诊断：Python 缺失、依赖缺失、语法错误、QiskitError 均有友好提示
- 示例：Grover 搜索 13（`examples/demo.py`）
