import * as vscode from 'vscode';
import { checkEnvironment, runObservation, type EnvironmentStatus } from './backend/runner';
import { QCOCodeLensProvider } from './codelens/provider';
import { QCOWebviewManager } from './panel/manager';
import { QCOMetadataProvider } from './sidebar/provider';

/** 从命令面板触发、未携带变量名时的兆底值 */
const DEFAULT_VARIABLE_NAME = 'qc';
const INSTALL_ACTION = '打开终端安装依赖';
const RUN_ACTION = '继续执行';

/** 检查当前工作区是否受信任；未信任时提示并返回 false */
function requireWorkspaceTrust(): boolean {
    if (vscode.workspace.isTrusted) {
        return true;
    }
    void vscode.window.showWarningMessage(
        'QCO: 电路观测会执行 Python 文件。请先信任当前工作区后再运行。',
        '信任此工作区'
    ).then((choice) => {
        if (choice === '信任此工作区') {
            void vscode.commands.executeCommand('workbench.action.trustWorkspace');
        }
    });
    return false;
}

/** 执行前确认对话框：防御纵深，即使工作区已信任也显式确认 */
async function confirmExecution(filePath: string, variableName: string): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(
        `QCO 即将执行 ${filePath} 中的 Python 代码（变量: ${variableName}）。是否继续？`,
        { modal: true },
        RUN_ACTION
    );
    return choice === RUN_ACTION;
}

export function activate(context: vscode.ExtensionContext): void {
    console.log('Extension activated: qco-studio');

    const channel = vscode.window.createOutputChannel('QCO');
    channel.appendLine('Extension activated: qco-studio');

    const metadataProvider = new QCOMetadataProvider();
    const panelManager = new QCOWebviewManager(context.extensionUri, (step) =>
        metadataProvider.setStep(step)
    );

    const showPanelCommand = vscode.commands.registerCommand('qco.showPanel', () => {
        panelManager.show();
    });

    const observeCommand = vscode.commands.registerCommand(
        'qco.observe',
        async (filePath?: string, variableName?: string) => {
            // 安全门禁 1：工作区信任
            if (!requireWorkspaceTrust()) {
                return;
            }

            const target = resolveTarget(filePath, variableName);
            if (!target) {
                return;
            }

            // 安全门禁 2：执行前确认
            const confirmed = await confirmExecution(target.filePath, target.variableName);
            if (!confirmed) {
                channel.appendLine('[observe] cancelled by user (confirmation dialog)');
                return;
            }

            channel.show(true);
            channel.appendLine(`[observe] file=${target.filePath} variable=${target.variableName}`);

            // 安全门禁 3：超时/取消
            const cancellationSource = new vscode.CancellationTokenSource();
            const result = await runObservation(target.filePath, target.variableName, {
                onStderr: (chunk) => channel.append(chunk),
                token: cancellationSource.token
            });

            channel.appendLine(`[observe] status=${result.status}`);
            if (result.message) {
                channel.appendLine(`[observe] message=${result.message}`);
            }
            if (result.data !== undefined) {
                channel.appendLine(JSON.stringify(result.data, null, 2));
            }

            if (result.status === 'error') {
                // 失败时做一次环境诊断，给出「缺 Python」还是「缺依赖」的具体提示
                const environment = await checkEnvironment();
                if (environment.issue === 'ok') {
                    vscode.window.showErrorMessage(`QCO: ${result.message ?? '观测失败'}`);
                } else {
                    showEnvironmentError(channel, context.extensionUri, environment);
                }
                return;
            }

            if (result.data === undefined) {
                vscode.window.showWarningMessage('QCO: 后端未返回数据。');
                return;
            }

            metadataProvider.setData(result.data);
            panelManager.show(result.data);
        }
    );

    const checkCommand = vscode.commands.registerCommand('qco.check', async () => {
        channel.show(true);
        channel.appendLine('[check] 正在检查 Python 环境...');

        const environment = await checkEnvironment({
            onStderr: (chunk) => channel.append(chunk)
        });

        channel.appendLine(
            `[check] python=${environment.pythonPath} issue=${environment.issue} message=${environment.message}`
        );

        if (environment.issue === 'ok') {
            vscode.window.showInformationMessage(`QCO 环境正常：${environment.message}`);
        } else {
            showEnvironmentError(channel, context.extensionUri, environment);
        }
    });

    // 只按 scheme 过滤：不用 pattern（相对工作区，工作区外文件会漏）、不依赖 languageId
    const codeLensProvider = vscode.languages.registerCodeLensProvider(
        [{ language: 'python' }, { scheme: 'file' }, { scheme: 'untitled' }],
        new QCOCodeLensProvider()
    );

    const metadataView = vscode.window.registerTreeDataProvider('qcoMetadata', metadataProvider);

    // 启动时静默体检：仅写入输出通道，不打扰用户
    void checkEnvironment().then((environment) => {
        if (environment.issue !== 'ok') {
            channel.appendLine(`[env] ${environment.issue}: ${environment.message}`);
        }
    });

    // 工作区信任状态变化时刷新 CodeLens（信任后显示 Observe 按钮，取消信任后隐藏）
    context.subscriptions.push(
        vscode.workspace.onDidGrantWorkspaceTrust(() => {
            // 触发 CodeLens 重新计算
            void vscode.commands.executeCommand('vscode.executeCodeLensProvider');
        })
    );

    context.subscriptions.push(
        channel,
        showPanelCommand,
        observeCommand,
        checkCommand,
        codeLensProvider,
        metadataView,
        { dispose: () => panelManager.dispose() }
    );
}

/** 环境异常提示：附带一键打开终端安装依赖 */
function showEnvironmentError(
    channel: vscode.OutputChannel,
    extensionUri: vscode.Uri,
    environment: EnvironmentStatus
): void {
    channel.appendLine(`[env] ${environment.issue}: ${environment.message}`);

    void vscode.window.showErrorMessage(`QCO: ${environment.message}`, INSTALL_ACTION).then((choice) => {
        if (choice !== INSTALL_ACTION) {
            return;
        }

        const requirements = vscode.Uri.joinPath(extensionUri, 'python', 'requirements.txt').fsPath;
        const terminal = vscode.window.createTerminal('QCO');
        terminal.show();
        terminal.sendText(`pip install -r "${requirements}"`);
    });
}

/** CodeLens 会传入 (filePath, variableName)；从命令面板触发时回退到当前编辑器 */
function resolveTarget(
    filePath?: string,
    variableName?: string
): { filePath: string; variableName: string } | undefined {
    if (filePath && variableName) {
        return { filePath, variableName };
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('QCO: 请先打开一个 Python 文件。');
        return undefined;
    }

    const document = editor.document;
    if (document.languageId !== 'python') {
        vscode.window.showErrorMessage('QCO: 当前文件不是 Python 文件。');
        return undefined;
    }

    return {
        filePath: filePath ?? document.uri.fsPath,
        variableName: variableName ?? DEFAULT_VARIABLE_NAME
    };
}

export function deactivate(): void {
    console.log('Extension deactivated: qco-studio');
}
