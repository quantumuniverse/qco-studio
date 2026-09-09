# Change Log

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
