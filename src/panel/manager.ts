import * as vscode from 'vscode';

const VIEW_TYPE = 'qcoVisualizer';

export class QCOWebviewManager {
    private panel: vscode.WebviewPanel | null = null;
    /** 待发送的数据；webview 就绪（VIEW_READY）后重发，避免消息丢失 */
    private pendingData: unknown = null;

    constructor(
        private readonly extensionUri: vscode.Uri,
        /** Webview 回放时回传当前步（供侧边栏刷新） */
        private readonly onStepChange?: (step: number) => void
    ) {}

    /**
     * 显示（或复用）Webview 面板。面板创建在 ViewColumn.Beside，
     * 即终端/侧边区域旁并排打开。传入 data 时会向 webview 发送 LOAD_DATA。
     */
    public show(data?: unknown): void {
        if (data !== undefined) {
            this.postData(data);
        }

        if (this.panel) {
            this.panel.reveal(this.panel.viewColumn ?? vscode.ViewColumn.Beside);
            return;
        }

        const webviewRoot = vscode.Uri.joinPath(this.extensionUri, 'out', 'webview');

        this.panel = vscode.window.createWebviewPanel(
            VIEW_TYPE,
            'QCO: Quantum Circuit Observer',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true, // 减少切换回来时的重载开销
                localResourceRoots: [webviewRoot]
            }
        );

        this.panel.webview.html = this.getWebviewContent(this.panel.webview, webviewRoot);

        this.panel.webview.onDidReceiveMessage(
            (message: { type?: string; payload?: { step?: number } }) => {
                if (message?.type === 'VIEW_READY' && this.pendingData !== null) {
                    this.panel?.webview.postMessage({ type: 'LOAD_DATA', payload: this.pendingData });
                    return;
                }

                if (message?.type === 'STEP_JUMP' && typeof message.payload?.step === 'number') {
                    this.onStepChange?.(message.payload.step);
                }
            }
        );

        this.panel.onDidDispose(() => {
            this.panel = null;
        });
    }

    /** 发送数据到 webview；面板尚未创建时先缓存 */
    public postData(data: unknown): void {
        this.pendingData = data;
        this.panel?.webview.postMessage({ type: 'LOAD_DATA', payload: data });
    }

    /**
     * 生成 Webview HTML：通过 asWebviewUri 加载 Vite 构建产物
     * （out/webview/index.js 与 out/webview/index.css），并注入 CSP。
     */
    private getWebviewContent(webview: vscode.Webview, webviewRoot: vscode.Uri): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'index.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'index.css'));

        const csp = [
            "default-src 'none';",
            `script-src ${webview.cspSource};`,
            `style-src ${webview.cspSource};`,
            `img-src ${webview.cspSource} data:;`,
            `font-src ${webview.cspSource};`
        ].join(' ');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>QCO Visualizer</title>
    <link rel="stylesheet" type="text/css" href="${styleUri}">
</head>
<body>
    <div id="root"></div>
    <script type="module" src="${scriptUri}"></script>
</body>
</html>`;
    }

    public dispose(): void {
        this.panel?.dispose();
        this.panel = null;
    }
}
