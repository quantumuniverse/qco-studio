# QCO: Quantum Circuit Observer

在 VSCode 中**逐门回放**量子线路的执行过程，用四个联动视图把量子态演化“看”出来。

> 让量子态演化，像看视频回放一样简单。

## 功能

| 视图 | 说明 |
| --- | --- |
| 电路图 | Canvas 绘制 qubit 轨道与门，当前步橙色高亮并自动滚动居中；可直接点击/拖动电路跳步 |
| Bloch 球 | 每个 qubit 一个 3D 球（Three.js），含坐标轴、态向量箭头与最近 5 步的半透明轨迹 |
| 增强热力图 | \|振幅\|² 热力图（行=步骤，列=计算基），下方“态空间尺子”可框选基态区间，纵轴滚轮滚动时间窗口，悬停显示数值 |
| 动态纠缠图 | D3 力导向图，边宽与颜色随纠缠值（互信息）变化，切换步骤时平滑过渡 |
| 侧边栏 | `QCO Metadata` 实时显示 qubits / 总门数 / depth / 当前门 / 全局熵 |

触发方式：

- 在 `.py` 文件中，`变量 = QuantumCircuit(...)` 上方会出现 **▶ Observe**，点击即观测；
- 或命令面板执行 `QCO: Observe Current Circuit`（默认变量 `qc`）。

## 前置依赖

插件通过子进程调用 `python/backend.py`，需要：

```bash
pip install -r python/requirements.txt   # quantum-circuit-observer、qiskit
```

若 Python 不在 PATH 中，在设置里指定 `qco.pythonPath`（可为绝对路径）。
可执行 `QCO: Check Python Environment` 做环境自检。

## 命令

| 命令 | 说明 |
| --- | --- |
| `QCO: Observe Current Circuit` | 观测当前 Python 文件中的线路并在面板中回放 |
| `QCO: Show Panel` | 仅打开观测面板 |
| `QCO: Check Python Environment` | 检查 Python 与依赖是否可用 |

## 示例

`examples/demo.py` 是一个 Grover 搜索示例（4 比特搜索空间中找十进制 13 = `0b1101`，3 次迭代）：

```python
from qiskit import QuantumCircuit

qc = QuantumCircuit(5, name="grover_13")
qc.h(range(4))
# ... Grover 迭代（oracle + diffuser）
```

观测后末步 `P(|1101⟩) ≈ 0.96`，回放时能看到振幅逐步集中、纠缠随多控门周期性出现。

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
npx vsce package            # 打包为 .vsix
```

按 <kbd>F5</kbd> 启动调试（Extension Development Host）。

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

消息协议：宿主 → Webview `LOAD_DATA`；Webview → 宿主 `VIEW_READY`、`STEP_JUMP`。

## 许可

MIT
