# QCO Studio：Quantum Circuit Observer

> **QCO 系列**：量子线路观察器（Quantum Circuit Observer）家族的 **VSCode 扩展**。在 IDE 里逐门回放量子线路执行。

在 VSCode 中**逐门回放**量子线路的执行过程，用四个联动视图把量子态演化“看”出来。

> 让量子态演化，像看视频回放一样简单。

## 功能

| 视图 | 说明 |
| --- | --- |
| 电路图 | Canvas 绘制 qubit 轨道与门，当前步橙色高亮并自动滚动居中；可直接点击/拖动电路跳步 |
| Bloch 球 | 每个 qubit 一个 3D 球（Three.js），含坐标轴、态向量箭头与最近 5 步的半透明轨迹；球下标签 `q{n} · P=… · S=…` 显示纯度与单比特熵 |
| 增强热力图 | \|振幅\|² 热力图（行=步骤，列=计算基），下方“态空间尺子”可框选基态区间，纵轴滚轮滚动时间窗口，悬停显示数值；尺子下方标注数据来源 |
| 动态量子关联图 | D3 力导向图，边宽与颜色随关联值（互信息）变化，切换步骤时平滑过渡 |
| 侧边栏 | `QCO Metadata` 实时显示 qubits / 总门数 / depth / 当前门 / 全局熵 |

### 数据来源

Bloch 向量、纯度、单比特熵和振幅快照都由 qco-engine 计算，Webview 直接使用，不再重复计算：

- **Bloch 球**：使用 engine 的 `bloch_vectors`；旧版 engine 的 payload 没有这个字段时，从态向量现算（悬停标签可看到来源）。
- **热力图**按顺序选择数据源，并在尺子下方标注：
  - `qco-engine amplitude`：engine 的 top-k 快照覆盖全部基态（n ≤ 6，k = min(64, 2ⁿ)）；
  - `statevector |ψ|²`：快照不完整（7–12 比特），用态向量计算；
  - `qco-engine top-k`：没有态向量时，只画各步 top-k 的并集列，未进入某步 top-k 的格子按 0 显示。
- **超过 12 比特**：engine 进入 summary mode，不产出逐门快照，面板没有逐步数据。

触发方式：

- 在 `.py` 文件中，`变量 = QuantumCircuit(...)` 上方会出现 **▶ Observe**，点击即观测；
- 或命令面板执行 `QCO: Observe Current Circuit`（默认变量 `qc`）。

## 前置依赖

插件通过子进程调用 `python/backend.py`，需要 Python 3.10+ 与下列包。

> **安装 `.vsix` 不会自动安装 Python 依赖**，请先手动执行（建议在虚拟环境中）：

```bash
# 直接安装（推荐，不依赖仓库文件）
pip install qco-engine qiskit

# 或克隆仓库后按清单安装
pip install -r python/requirements.txt
```

若 Python 不在 PATH 中，或使用了虚拟环境，在设置里把 `qco.pythonPath` 设为解释器绝对路径，例如
`C:\Users\me\.venvs\qco\Scripts\python.exe`。

安装后可执行 `QCO: Check Python Environment` 自检；若依赖缺失就点 `▶ Observe`，
会弹出提示与「打开终端安装依赖」按钮，点击即可自动填好安装命令。

## 命令

| 命令 | 说明 |
| --- | --- |
| `QCO: Observe Current Circuit` | 观测当前 Python 文件中的线路并在面板中回放 |
| `QCO: Show Panel` | 仅打开观测面板 |
| `QCO: Check Python Environment` | 检查 Python 与依赖是否可用 |

## 示例

把下面内容存成任意 `.py` 文件，打开后点击 `qc` 上方的 **▶ Observe** 即可（最小验证用）：

```python
from qiskit import QuantumCircuit

qc = QuantumCircuit(2, name="bell")
qc.h(0)
qc.cx(0, 1)
```

仓库中的 `examples/demo.py` 是更完整的 Grover 搜索示例（4 比特搜索空间中找十进制 13 = `0b1101`，3 次迭代）：
观测后末步 `P(|1101⟩) ≈ 0.96`，回放时能看到振幅逐步集中、纠缠随多控门周期性出现。

> `.vsix` 中不含 `examples/`，需要的话请从仓库获取该文件。

## 开发

```bash
npm install                 # 扩展依赖
npm --prefix webview-ui install   # Webview 依赖

npm run build               # 构建 Webview + 扩展（out/webview、dist/extension.js）
npm run build:webview       # 仅构建 Webview
npm run compile             # 仅构建扩展
npm run watch               # 扩展 watch 模式
npm run watch:webview       # Webview watch 模式

npm run package             # 生产构建（hidden source map）
npm run vsce:package        # 打包为 .vsix（约 360 KB）
```

按 <kbd>F5</kbd> 启动调试（Extension Development Host）。

`.vsix` 只含运行时必需的文件，其余由 `.vscodeignore` 排除（源码 `src/`、`webview-ui/`、`node_modules/`、
文档 `.docs/`、`examples/`、`tools/`、source map、`out/webview/index.html` 等）：

```
extension/
├─ package.json  README.md  CHANGELOG.md  LICENSE
├─ dist/extension.js
├─ out/webview/{index.js, index.css}
├─ python/{backend.py, requirements.txt}
└─ resources/{icon-128.png, icon.svg}
```

其中 `out/webview/index.js` 占绝大部分体积（Three.js + D3 + React）。

## 架构

```
VSCode Extension Host (TypeScript)
  ├─ CodeLens Provider     正则识别 QuantumCircuit 赋值
  ├─ Python 子进程         spawn python backend.py --file ... --variable ...
  ├─ Webview 面板          React + Vite 产物，四视图联动
  └─ 侧边栏 TreeView       元数据看板
                │
        python/backend.py  AST/exec 载入线路 → QCObserver → encode_ir → decode_ir → 渲染就绪 JSON
```

渲染就绪 JSON 的每个 step 包含 `statevector`、`edges`、`global_entropy`，以及 engine 计算的
`bloch_vectors`、`purities`、`qubit_entropies` 和 `amplitude{basis_indices, magnitudes, phases, total_basis}`，
字段说明见 `.docs/TDD.md` §2.1。

消息协议：宿主 → Webview `LOAD_DATA`；Webview → 宿主 `VIEW_READY`、`STEP_JUMP`。

## 许可

MIT
