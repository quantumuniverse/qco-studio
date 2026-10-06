import * as vscode from 'vscode';
import { checkEnvironment, runObservation, type EnvironmentStatus } from './backend/runner';
import { QCOCodeLensProvider } from './codelens/provider';
import { QCOWebviewManager } from './panel/manager';
import { QCOMetadataProvider } from './sidebar/provider';

/** 从命令面板触发、未携带变量名时的兜底值 */
const DEFAULT_VARIABLE_NAME = 'qc';
const INSTALL_ACTION = '打开终端安装依赖';

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
            const target = resolveTarget(filePath, variableName);
            if (!target) {
                return;
            }

            channel.show(true);
            channel.appendLine(`[observe] file=${target.filePath} variable=${target.variableName}`);

            const result = await runObservation(target.filePath, target.variableName, {
                onStderr: (chunk) => channel.append(chunk)
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
