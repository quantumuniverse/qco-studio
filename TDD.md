## 1. 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      VSCode Extension Host                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │  CodeLens       │  │  Webview Panel  │  │  Sidebar Tree   │ │
│  │  Provider       │  │  (Terminal)     │  │  (Metadata)     │ │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘ │
│           │                    │                     │          │
│           └────────────────────┼─────────────────────┘          │
│                                │                                 │
│                        ┌───────▼───────┐                        │
│                        │  Python       │                        │
│                        │  Subprocess   │                        │
│                        └───────┬───────┘                        │
└────────────────────────────────┼─────────────────────────────────┘
                                 │
                         ┌───────▼───────┐
                         │ quantum-      │
                         │ circuit-      │
                         │ observer      │
                         └───────────────┘
```

### 1.1 数据流

```text
[VSCode Editor]
    -> (CodeLens 点击)
    -> [Extension Host (TypeScript)]
    -> 启动 Python 子进程，传入 [文件路径, 变量名]
    -> [Python Backend]
        -> AST 解析获取 QuantumCircuit 对象
        -> QCObserver(circuit).run()
        -> export_to_json() 生成 IR v2
        -> decode_ir() 解码为“渲染就绪 JSON”
        -> 通过 stdout 输出
    -> [Extension Host] 读取 JSON
    -> Webview.postMessage(renderData)
    -> [Webview] 渲染 Four Views
```


## 2. Python 后端设计

### 2.1 接口规范

**输入**（通过命令行参数）：
```bash
python backend.py --file /path/to/circuit.py --variable qc
```

**输出**（stdout，单行 JSON）：
```json
{
  "status": "success",
  "data": {
    "metadata": { "n_qubits": 2, "total_steps": 2, "depth": 2 },
    "circuit_layout": {
      "gates": [
        { "name": "h", "qubits": [0], "step": 0, "x_pos": 0 },
        { "name": "cx", "qubits": [0, 1], "step": 1, "x_pos": 1 }
      ],
      "num_qubits": 2,
      "width": 2
    },
    "steps": [
      {
        "step_id": 0,
        "gate_name": "h",
        "qubits": [0],
        "statevector": [[0.707, 0], [0.707, 0], [0, 0], [0, 0]],
        "edges": [],
        "global_entropy": 0.0
      },
      {
        "step_id": 1,
        "gate_name": "cx",
        "qubits": [0, 1],
        "statevector": [[0.707, 0], [0, 0], [0, 0], [0.707, 0]],
        "edges": [[0, 1, 1.999]],
        "global_entropy": 0.999
      }
    ]
  }
}
```

**错误输出**：
```json
{
  "status": "error",
  "message": "Variable 'qc' not found in file"
}
```

### 2.2 核心实现逻辑

```python
# backend.py 核心伪代码

import ast
import json
import sys
from pathlib import Path
from quantum_circuit_observer import QCObserver, export_to_json
from quantum_circuit_observer.ir import decode_ir

def extract_circuit_from_file(filepath: str, var_name: str):
    """通过 AST 解析获取 QuantumCircuit 对象"""
    with open(filepath) as f:
        code = f.read()
    # 方法1：exec 执行后 eval（简单直接）
    namespace = {}
    exec(code, namespace)
    circuit = namespace.get(var_name)
    if circuit is None:
        raise ValueError(f"Variable '{var_name}' not found")
    return circuit

def observe_and_render(circuit):
    """执行观测并生成渲染就绪 JSON"""
    result = QCObserver(circuit).run()
    ir_json = export_to_json(result, profile="compact")
    decoded = decode_ir(ir_json)
    
    # 构建 circuit_layout
    gates = []
    for step in decoded["steps"]:
        gates.append({
            "name": step["gate"]["name"],
            "qubits": step["gate"]["qubits"],
            "step": step["step_id"],
            "x_pos": step["step_id"]  # 每个 step 占一列
        })
    
    return {
        "metadata": {
            "n_qubits": circuit.num_qubits,
            "total_steps": len(decoded["steps"]),
            "depth": circuit.depth()
        },
        "circuit_layout": {
            "gates": gates,
            "num_qubits": circuit.num_qubits,
            "width": len(decoded["steps"])
        },
        "steps": [
            {
                "step_id": s["step_id"],
                "gate_name": s["gate"]["name"],
                "qubits": s["gate"]["qubits"],
                "statevector": s["state"]["statevector"],  # 已解码为 [[re, im], ...]
                "edges": s["entanglement"]["edges"],
                "global_entropy": s["entanglement"]["global_entropy"]
            }
            for s in decoded["steps"]
        ]
    }

if __name__ == "__main__":
    # 解析命令行参数
    # 执行 observe_and_render
    # 输出 JSON 到 stdout
```

### 2.3 异常处理

| 异常类型 | 处理方式 | 输出 |
|----------|----------|------|
| 文件不存在 | 捕获 `FileNotFoundError` | `{"status":"error","message":"File not found"}` |
| 变量不存在 | 捕获 `ValueError` | `{"status":"error","message":"Variable 'x' not found"}` |
| 线路含 `measure` | QCObserver 跳过，返回警告 | `{"status":"warning","message":"measure gates skipped"}` |
| IR 解码失败 | 捕获解码异常 | `{"status":"error","message":"IR decode failed"}` |


## 3. VSCode 扩展 TypeScript 设计

### 3.1 目录结构

```
qco-vscode-plugin/
├── package.json
├── tsconfig.json
├── src/
│   ├── extension.ts           # 扩展激活入口
│   ├── codelens/
│   │   └── provider.ts        # CodeLens Provider
│   ├── commands/
│   │   └── observe.ts         # "QCO: Observe" 命令实现
│   ├── panel/
│   │   ├── manager.ts         # Webview 面板管理
│   │   └── messageHandler.ts  # Webview 消息处理
│   ├── backend/
│   │   ├── runner.ts          # Python 子进程管理
│   │   └── parser.ts          # 输出 JSON 解析
│   └── sidebar/
│       └── provider.ts        # 侧边栏数据提供
├── webview-ui/                # Webview 前端（独立构建）
│   ├── src/
│   │   ├── index.tsx          # 入口
│   │   ├── components/
│   │   │   ├── CircuitDiagram.tsx
│   │   │   ├── BlochSphere.tsx
│   │   │   ├── Heatmap.tsx
│   │   │   ├── EntanglementGraph.tsx
│   │   │   └── Controls.tsx
│   │   └── hooks/
│   │       └── useVSCode.ts   # VSCode API 封装
│   └── package.json
└── python/
    └── backend.py             # Python 后端脚本
```

### 3.2 CodeLens Provider 实现

```typescript
// src/codelens/provider.ts

import * as vscode from 'vscode';
import * as parser from 'web-tree-sitter';

export class QCOCodeLensProvider implements vscode.CodeLensProvider {
    private pythonLanguage: any;

    async provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): Promise<vscode.CodeLens[]> {
        if (document.languageId !== 'python') return [];

        const code = document.getText();
        const tree = this.parser.parse(code);
        
        // 遍历 AST，查找 QuantumCircuit 实例
        const circuitVariables: string[] = [];
        this.findQuantumCircuitInstances(tree.rootNode, circuitVariables);

        return circuitVariables.map(varName => {
            // 定位变量定义行
            const range = this.findVariableRange(tree.rootNode, varName);
            return new vscode.CodeLens(range, {
                title: '▶ Observe',
                command: 'qco.observe',
                arguments: [document.uri.fsPath, varName]
            });
        });
    }

    private findQuantumCircuitInstances(node: any, result: string[]) {
        // 匹配模式: "xxx = QuantumCircuit(...)"
        // 或 "QuantumCircuit(...)" 直接赋值
    }
}
```

### 3.3 Python 子进程管理

```typescript
// src/backend/runner.ts

import { spawn } from 'child_process';

export interface ObservationResult {
    status: 'success' | 'error' | 'warning';
    data?: RenderReadyData;
    message?: string;
}

export async function runObservation(
    filePath: string,
    variableName: string
): Promise<ObservationResult> {
    return new Promise((resolve, reject) => {
        const pythonProcess = spawn('python', [
            path.join(__dirname, 'python/backend.py'),
            '--file', filePath,
            '--variable', variableName
        ]);

        let output = '';
        pythonProcess.stdout.on('data', (data) => {
            output += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            console.error('Python stderr:', data.toString());
        });

        pythonProcess.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`Python process exited with code ${code}`));
                return;
            }
            try {
                const result = JSON.parse(output);
                resolve(result);
            } catch (e) {
                reject(new Error('Failed to parse Python output'));
            }
        });
    });
}
```

### 3.4 Webview 面板管理

```typescript
// src/panel/manager.ts

import * as vscode from 'vscode';

export class QCOWebviewManager {
    private panel: vscode.WebviewPanel | null = null;

    public show(data: RenderReadyData) {
        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                'qcoVisualizer',
                'QCO: Quantum Circuit Observer',
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,  // 减少重载开销
                    localResourceRoots: [
                        vscode.Uri.file(path.join(__dirname, 'webview-ui/build'))
                    ]
                }
            );

            this.panel.webview.html = this.getWebviewContent();
            
            this.panel.onDidDispose(() => {
                this.panel = null;
            });
        }

        // 发送数据到 Webview
        this.panel.webview.postMessage({
            type: 'LOAD_DATA',
            payload: data
        });

        this.panel.reveal();
    }

    private getWebviewContent(): string {
        // 注入 CSP 安全策略
        // 加载构建后的 HTML/CSS/JS
        const scriptUri = this.panel!.webview.asWebviewUri(
            vscode.Uri.file(path.join(__dirname, 'webview-ui/build/index.js'))
        );
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" 
                      content="default-src 'none'; 
                               script-src ${this.panel!.webview.cspSource}; 
                               style-src ${this.panel!.webview.cspSource};">
                <title>QCO Visualizer</title>
            </head>
            <body>
                <div id="root"></div>
                <script src="${scriptUri}"></script>
            </body>
            </html>
        `;
    }
}
```


## 4. Webview 前端设计

### 4.1 技术选型

| 组件 | 技术 | 说明 |
|------|------|------|
| 框架 | React 18 | 组件化开发 |
| 3D 渲染 | Three.js + @react-three/fiber | Bloch 球 |
| 2D 渲染 | Canvas 2D | 热力图、电路图 |
| 图渲染 | D3.js | 纠缠图 |
| 状态管理 | Zustand | 轻量级全局状态 |
| 通信 | `acquireVsCodeApi()` | VSCode 消息传递 |

### 4.2 组件架构

```
<App>
  ├── <Controls>
  │   ├── PlayButton
  │   ├── StepButtons (Prev/Next)
  │   ├── SpeedSelector (0.5x/1x/2x)
  │   └── StepSlider
  ├── <Accordion>
  │   ├── <CircuitDiagram>      (Canvas 2D + 高亮联动)
  │   ├── <BlochSphereView>     (React Three Fiber)
  │   ├── <HeatmapView>         (Canvas 2D + 双轴尺子)
  │   └── <EntanglementGraph>   (D3.js)
  └── <StatusBar>
      └── CurrentGate + Entropy
```

### 4.3 电路图渲染（Canvas 2D）

```typescript
// 布局算法
function layoutCircuit(gates: Gate[], numQubits: number) {
    const stepWidth = 60;   // 每列宽度
    const qubitHeight = 50; // 每行高度
    
    return gates.map(gate => ({
        ...gate,
        x: gate.step * stepWidth + 20,
        y: gate.qubits[0] * qubitHeight + 25,  // 简化：门放在第一个作用比特轨道
        width: 40,
        height: 30
    }));
}

// 高亮联动：自动滚动到当前门
function scrollToCurrentGate(currentStep: number) {
    const x = currentStep * stepWidth + 20 - canvasWidth / 2;
    canvas.scrollTo({ left: Math.max(0, x), behavior: 'smooth' });
}
```

### 4.4 热力图“尺子”交互

```typescript
// 态空间尺子组件
function StateSpaceRuler({ totalBasis, windowStart, windowEnd, onWindowChange }) {
    return (
        <div className="ruler">
            <div className="ruler-track">
                {/* 半透明选择框 */}
                <div 
                    className="selection-window"
                    style={{
                        left: `${(windowStart / totalBasis) * 100}%`,
                        width: `${((windowEnd - windowStart) / totalBasis) * 100}%`
                    }}
                >
                    {/* 左手柄 */}
                    <div 
                        className="handle left"
                        onMouseDown={() => startDrag('left')}
                    />
                    {/* 右手柄 */}
                    <div 
                        className="handle right"
                        onMouseDown={() => startDrag('right')}
                    />
                    {/* 拖拽平移区域 */}
                    <div 
                        className="drag-area"
                        onMouseDown={() => startDrag('move')}
                    />
                </div>
            </div>
            <div className="ruler-labels">
                <span>|0...0⟩</span>
                <span>|1...1⟩</span>
            </div>
        </div>
    );
}
```

### 4.5 VSCode 通信封装

```typescript
// hooks/useVSCode.ts

import { useEffect, useState } from 'react';

declare function acquireVsCodeApi(): any;

const vscode = acquireVsCodeApi();

export function useVSCode<T>() {
    const [data, setData] = useState<T | null>(null);

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === 'LOAD_DATA') {
                setData(message.payload);
            }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, []);

    const postMessage = (type: string, payload: any) => {
        vscode.postMessage({ type, payload });
    };

    return { data, postMessage };
}
```


## 5. 通信协议

### 5.1 Extension → Webview

| 消息类型 | Payload | 说明 |
|----------|---------|------|
| `LOAD_DATA` | `RenderReadyData` | 加载完整观测数据 |
| `STEP_CHANGE` | `{ step: number }` | 跳转到指定步骤 |
| `PLAY_STATE_CHANGE` | `{ playing: boolean, speed: number }` | 播放状态变化 |

### 5.2 Webview → Extension

| 消息类型 | Payload | 说明 |
|----------|---------|------|
| `REQUEST_DATA` | `{ filePath, variableName }` | 请求观测数据 |
| `STEP_JUMP` | `{ step: number }` | 用户拖动时间轴 |
| `VIEW_READY` | `{}` | Webview 加载完成 |


## 6. 关键技术难点与解决方案

### 6.1 IR v2 解码不在前端做

**问题**：IR v2 采用高度压缩编码（值池、游程编码、帧编码），前端无法直接理解。

**解决方案**：Python 后端使用 `quantum_circuit_observer.ir.decode_ir` 完成解码，向前端发送“渲染就绪”的简单 JSON 结构。

### 6.2 Python 环境检测

**问题**：用户可能未安装 `quantum-circuit-observer` 或 Python 版本不兼容。

**解决方案**：
- 插件启动时检测 Python 环境
- 若缺少依赖，提示用户安装：`pip install quantum-circuit-observer`
- 提供 `qco.check` 命令用于诊断

### 6.3 大线路性能

**问题**：≥12 量子比特时，statevector 规模超过 4096 个复数。

**解决方案**：
- 利用 QCObserver 的 `summary_mode`，不保存完整态向量
- 热力图自动降采样（仅显示 top-k 振幅）
- 前端实现虚拟滚动，仅渲染可视区域

### 6.4 Webview 安全性

**问题**：Webview 可执行任意脚本，存在安全风险。

**解决方案**：
- 严格配置 CSP（Content Security Policy）
- 不使用 `eval()` 或 `innerHTML` 注入
- 所有用户数据通过 `postMessage` 传递，不拼接 HTML


## 7. 开发环境与构建

### 7.1 开发依赖

```json
{
  "devDependencies": {
    "@types/vscode": "^1.80.0",
    "typescript": "^5.0.0",
    "webpack": "^5.0.0",
    "webpack-cli": "^5.0.0",
    "ts-loader": "^9.0.0",
    "@vscode/test-electron": "^2.0.0"
  }
}
```

### 7.2 构建流程

```bash
# 1. 构建 Webview 前端
cd webview-ui
npm run build  # 输出到 webview-ui/build/

# 2. 构建扩展
npm run compile  # TypeScript -> dist/

# 3. 打包 VSIX
vsce package
```

### 7.3 调试配置（`.vscode/launch.json`）

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}"
      ]
    }
  ]
}
```


## 8. 测试策略

| 测试层级 | 工具 | 覆盖范围 |
|----------|------|----------|
| 单元测试 | Jest (TS) / pytest (Python) | 解码函数、布局算法 |
| 集成测试 | @vscode/test-electron | 端到端流程（CodeLens → 观测 → 渲染） |
| 手动测试 | 内部测试计划 | UI 交互、跨平台兼容性 |


## 9. 后续扩展路线（Phase 2+）

| 阶段 | 新增功能 |
|------|----------|
| **Phase 2** | 张量网络视图（MPS bond dimension）、噪声对比（理想 vs  noisy） |
| **Phase 3** | 量子调试器（断点、条件断点）、执行对比（transpiled vs original） |
| **Phase 4** | 硬件集成（IBM Quantum 实时遥测）、AI 辅助分析 |


# 附录

## A. IR 数据样例（bell_state.json）

```json
{
  "metadata": { "circuit_name": "bell_state", "num_qubits": 2, "num_steps": 2 },
  "steps": [
    {
      "step_id": 0,
      "gate": { "name": "h", "qubits": [0] },
      "state": { "statevector": [{"real": 0.707107, "imag": 0}, {"real": 0.707107, "imag": 0}, 0, 0] },
      "entanglement": { "edges": [], "global_entropy": 0 }
    },
    {
      "step_id": 1,
      "gate": { "name": "cx", "qubits": [0, 1] },
      "state": { "statevector": [{"real": 0.707107, "imag": 0}, 0, 0, {"real": 0.707107, "imag": 0}] },
      "entanglement": { "edges": [[0, 1, 1.999]], "global_entropy": 0.999 }
    }
  ]
}
```

## B. 参考资源

- [VSCode Webview API 官方文档](https://code.visualstudio.com/api/extension-guides/webview)
- [VSCode CodeLens Provider 指南](https://code.visualstudio.com/api/references/vscode-api#CodeLensProvider)
- [Three.js 官方文档](https://threejs.org/)
- [D3.js 官方文档](https://d3js.org/)
- [Qiskit 文档](https://docs.quantum.ibm.com/)