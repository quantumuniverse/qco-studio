这是一个非常好的想法。使用 AI 辅助编程开发这类全栈项目，最忌讳的就是一次性给出海量代码。正确的做法是**“分而治之，步步验证”**。

基于我们已锁定的 PRD 和 TDD，我为你设计了一套 **“逐级递进的 Prompt 列表”**。每个 Prompt 都对应一个**可独立运行、可验证成果**的里程碑。

请严格按照顺序执行，每完成一步并确认运行无误后，再使用下一个 Prompt 继续。**建议在一个新的空白工作区开始，将以下 Prompt 依次发送给 AI 编程助手（如 Cursor、Copilot 或 ChatGPT + 终端）**。

---

### 🛠️ 第一阶段：项目脚手架与环境准备

**目标**：搭建 Monorepo 基础结构，确保 VSCode 插件能正常加载 Webview。

| # | 任务目标 | 详细 Prompt 提示词 | 验证标准（Pass Criteria） |
| :--- | :--- | :--- | :--- |
| **P1** | **初始化项目与 Python 后端骨架** | “请在一个空白目录下初始化一个 VSCode 插件项目（使用 TypeScript），并创建 `python/` 子目录。配置 `package.json` 依赖（包含 `@types/vscode`、`typescript`、`webpack`）。创建 `src/extension.ts` 仅打印激活日志。创建 `python/backend.py` 作为 Flask/FastAPI 风格的脚本（暂不实现逻辑），仅包含一个打印入参的 `main` 函数。同时配置好 `.vscode/launch.json` 以便按 F5 启动调试。” | 按 F5 能打开新的 VSCode 调试窗口，且在调试控制台能看到“Extension activated”日志。 |
| **P2** | **建立 Webview 面板宿主** | “在 `src/panel/manager.ts` 中实现 `QCOWebviewManager` 类。实现 `show()` 方法，在 VSCode 的终端区域（`ViewColumn.Beside`）创建 `WebviewPanel`。编写 `getWebviewContent()` 方法，注入最基础的 HTML（包含 `<div id="root">Hello QCO</div>`）。修改 `src/extension.ts`，注册命令 `qco.showPanel` 调用 `manager.show()`。添加 Content-Security-Policy 头确保安全性。” | 在调试窗口中按 `Ctrl+Shift+P` 输入 “QCO: Show Panel”，底部能弹出一个显示“Hello QCO”的 Webview 面板。 |
| **P3** | **集成 React 与前端构建** | “在项目根目录创建 `webview-ui/` 子目录。初始化一个 React + TypeScript 项目（使用 Vite 或 Webpack）。配置构建脚本，将产物输出到 `../out/webview/`。在 `webview-ui/src/App.tsx` 中写一个简单的 `useState` 计数器。修改 `manager.ts` 中的 `getWebviewContent`，通过 `asWebviewUri` 加载构建后的 `index.js` 和 `index.css`，使 Webview 显示 React 组件。” | Webview 面板中不再显示纯文本，而是显示 React 渲染的计数器界面（带有按钮和数字）。 |


### 🚀 第二阶段：后端核心逻辑与数据管道（最难的一步）

**目标**：实现 Python 后端解析 Python 文件中的量子电路，运行 QCO 并生成“渲染就绪 JSON”。这是前后端分离的关键。

| # | 任务目标 | 详细 Prompt 提示词 | 验证标准（Pass Criteria） |
| :--- | :--- | :--- | :--- |
| **P4** | **后端解析 AST 并生成 IR** | “完善 `python/backend.py`。使用 `argparse` 接收 `--file` 和 `--variable` 参数。实现 `load_circuit` 函数：使用 `ast` 模块（或执行 `exec`）读取 Python 文件并提取变量名对应的 `QuantumCircuit` 对象。安装 `quantum-circuit-observer` 依赖，调用 `QCObserver(circuit).run()` 并使用 `export_to_json` 导出。将导出的 JSON 通过 `print` 输出到 stdout。若变量不存在或文件报错，输出 `{"status": "error", "message": "..."}` 格式的 JSON。” | 在终端手动运行 `python python/backend.py --file examples/demo.py --variable qc`（需预先创建 demo.py），能正确打印出 IR v2 格式的 JSON 字符串。 |
| **P5** | **TypeScript 调用子进程解析数据** | “在 `src/backend/runner.ts` 中实现 `runObservation` 函数。使用 Node.js `child_process.spawn` 调用 `python` 执行 `backend.py`，传入当前编辑器打开的 `.py` 文件路径和变量名。捕获 `stdout` 输出，并使用 `JSON.parse` 解析。在 `src/extension.ts` 中注册命令 `qco.observe`，硬编码测试变量名（如 `qc`），调用 `runObservation` 并将结果打印到 VSCode 输出通道（OutputChannel）。” | 在打开的 Python 文件中，执行命令后，VSCode 的“输出”面板（Output）能看到从 Python 返回的 JSON 对象。 |
| **P6** | **后端解码 IR v2 为“渲染就绪格式”** | “修改 `backend.py`，在输出前对 IR 进行解码。导入 `quantum_circuit_observer.ir` 中的 `decode_ir` 函数。将解码后的 `steps` 转换为渲染所需结构：提取 `statevector` 为 `[[real, imag], ...]` 数组；提取 `entanglement.edges` 为三元组 `[source, target, value]`；生成 `circuit_layout`（遍历 steps，将 step_id 映射为 x_pos）。输出包含 `metadata`、`circuit_layout` 和 `steps` 三个顶级字段的新 JSON。” | 对比后端输出的 JSON 结构，确保 `steps` 下的 `statevector` 是可直接渲染的嵌套数组，而非 IR v2 的池索引格式。 |


### 🎮 第三阶段：核心交互引擎（回放控制器）

**目标**：Webview 前端接收到数据，实现时间轴与状态管理。

| # | 任务目标 | 详细 Prompt 提示词 | 验证标准（Pass Criteria） |
| :--- | :--- | :--- | :--- |
| **P7** | **前端数据接收与状态管理** | “在 `webview-ui` 中安装 `zustand` 和 `@vscode/webview-ui-toolkit`。创建 `src/store/useStore.ts`，定义 `AppState`：包含 `steps` 数组、`currentStep` 索引、`metadata`。编写 `src/hooks/useVSCode.ts`，实现 `acquireVsCodeApi` 和 `postMessage`，监听 `LOAD_DATA` 事件，将数据存入 store。修改 `App.tsx`，连接 store，显示当前步骤数（如 `Step: 0 / 10`）。” | 当 TypeScript 端发送 `LOAD_DATA` 消息后，Webview 界面上的“当前步骤数”会从 0 更新为总步数。 |
| **P8** | **回放控制栏（播放/暂停/步进）** | “创建 `src/components/Controls.tsx`。使用 `useStore` 获取 `currentStep` 和 `setStep`。实现：1）`handlePrev/Next` 增减索引；2）`handlePlay` 使用 `setInterval` 循环递增索引（速度默认为 1s/步）；3）`Slider` 滑块（使用 VSCode 原生样式）允许随意拖动跳转。确保组件卸载时清除定时器。” | 在 Webview 中点击“播放”，滑块自动前进；点击“暂停”停止；拖动滑块能跳转到指定步骤。 |
| **P9** | **打通全流程：CodeLens 触发观测** | “在 `src/codelens/provider.ts` 中实现 `provideCodeLenses`。使用 `vscode.languages.registerCodeLensProvider` 注册。解析当前文件中的 `QuantumCircuit` 实例（使用正则匹配 `\w+\s*=\s*QuantumCircuit`）。在匹配到的变量上方生成 CodeLens，标题为 `▶ Observe`，command 为 `qco.observe`，传递 `document.uri.fsPath` 和变量名。修改 `observe` 命令：调用 `runner.runObservation`，获取数据后调用 `panelManager.show()` 并发送 `LOAD_DATA`。” | 在打开的包含 `qc = QuantumCircuit(2)` 的 Python 文件中，变量名上方会出现“▶ Observe”按钮。点击后，Terminal 面板弹出并显示最新的回放控制栏和数据。 |


### 🎨 第四阶段：四大核心视图渲染（视觉攻坚）

**目标**：逐个实现电路图、Bloch球、热力图、纠缠图。

| # | 任务目标 | 详细 Prompt 提示词 | 验证标准（Pass Criteria） |
| :--- | :--- | :--- | :--- |
| **P10** | **视图一：电路图（与时间轴联动）** | “创建 `src/components/CircuitDiagram.tsx`。使用 `useRef` 和 `useEffect` 操作 Canvas。输入：`circuit_layout` 和 `currentStep`。绘制：左轴列出 qubit 轨道线；从 gates 列表中按 `x_pos` 绘制圆角矩形门，门内显示名称。高亮逻辑：当 `gate.step === currentStep` 时，边框和填充色设为亮橙色。自动滚动：使用 `canvas.scrollTo`，将当前高亮门移至 Canvas 水平中央。” | 回放时，电路图上的门会依次高亮，且 Canvas 会自动水平滚动，确保高亮门始终可见。 |
| **P11** | **视图二：3D Bloch 球（多比特轨迹）** | “安装 `three` 和 `@react-three/fiber`。创建 `src/components/BlochSphere.tsx`。接收当前步的 `statevector`。编写 `getBlochVectors` 工具函数计算每个 qubit 的 (x,y,z)。对每个 qubit，使用 Three.js 绘制球体、坐标轴和表示向量的箭头。额外维护一个历史数组（前 5 步），绘制半透明的轨迹点，展示向量漂移。” | 回放时，能看到对应量子比特数量的 3D 球体，且箭头方向随门操作发生变化，并带有历史拖尾痕迹。 |
| **P12** | **视图三：增强热力图（双轴滑动窗口）** | “创建 `src/components/Heatmap.tsx`。下方绘制‘态空间尺子’：一个带有左右手柄的矩形选择框（`mousedown` 拖拽改变宽高）。主 Canvas 仅渲染尺子范围内的列。纵轴实现滚动窗口（仅显示最近 20 步）。鼠标悬停时，`tooltip` 显示该坐标的 `\|振幅\|^2` 值。” | 拖动热力图下方的尺子手柄，主图显示的态数量会随之减少或增加；滚动鼠标纵轴，时间窗口会上下移动。 |
| **P13** | **视图四：动态纠缠图** | “安装 `d3`。创建 `src/components/EntanglementGraph.tsx`。使用 `useEffect` 监听 `currentStep` 变化。采用力导向图（Force Simulation）布局。节点为 qubit ID；边数据来自当前步的 `edges`（source, target, value）。边的 `stroke-width` 与 `value` 成正比，颜色深度也随值变化。每次步骤更新时，平滑过渡更新边的粗细。” | 回放 Bell 态电路时，能看到两个节点在 CNOT 门执行后，突然出现一条很粗的连线（表示纠缠生成）。 |


### 🧹 第五阶段：集成收尾与细节打磨

**目标**：侧边栏元数据、错误处理、发布配置。

| # | 任务目标 | 详细 Prompt 提示词 | 验证标准（Pass Criteria） |
| :--- | :--- | :--- | :--- |
| **P14** | **侧边栏元数据看板** | “使用 `vscode.TreeView` 或 `WebviewView` 创建侧边栏。实现 `src/sidebar/provider.ts`，注册到 `package.json` 的 `views` 贡献点。从主流程接收 `metadata` 和当前步的 `global_entropy`、`gate_name`。在侧边栏显示：量子比特数、总门数（静态）；当前门名、全局熵值（动态刷新）。” | 左侧侧边栏会出现“QCO Metadata”面板，回放时当前门名和熵值会实时变化。 |
| **P15** | **错误处理与环境诊断** | “在 `runner.ts` 中增加 `executable` 路径检测。若 Python 未安装或 `quantum-circuit-observer` 未找到，捕获异常并利用 `vscode.window.showErrorMessage` 弹出“请安装依赖”的提示，并提供一键打开终端的按钮。在后端 `backend.py` 中增加 `try-except` 捕获 `QiskitError`，返回友好 JSON。” | 故意将 Python 代码写错（如漏掉括号），点击 Observe 后，VSCode 不会崩溃，而是弹出清晰的红色错误弹窗。 |
| **P16** | **打包与发布准备** | “配置 `package.json` 的 `scripts`（`build`、`watch`、`package`）。使用 `vsce` 工具生成 `.vsix` 安装包。编写 `README.md` 和 `CHANGELOG.md`（可参考 PRD 概述）。确保 `.vscodeignore` 排除了 `node_modules`、`python/__pycache__` 等无用文件，减小插件体积。” | 运行 `vsce package` 能成功生成 `qco-vscode-plugin-0.1.0.vsix` 文件，且大小合理。 |

---

### 💡 给开发者的特别建议

1. **关于 Prompt P12（热力图尺子）**：这是最难啃的骨头。如果 AI 一次生成的代码有 BUG，不要气馁。你可以将报错信息直接贴给 AI，并说：“`Heatmap.tsx` 中的鼠标拖拽事件导致状态更新死循环，请用 `useRef` 避免重绘风暴。” 
2. **关于 P4（AST 解析）**：如果 AI 给出的 `exec` 方案存在安全问题，你可以要求它替换为 `ast.parse` + `ast.NodeVisitor` 的纯静态分析方案（虽然实现更复杂，但更可靠）。
3. **多轮对话**：每个 Prompt 是一个里程碑。如果当前 Prompt 生成的代码报错，**先别急着进行下一步**，把报错截图/文本发给 AI，让它修复到验证标准通过为止。

祝开发顺利！如果在某个环节卡住，随时可以针对该环节继续提问。