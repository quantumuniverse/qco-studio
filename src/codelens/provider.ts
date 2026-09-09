import * as vscode from 'vscode';

/** 匹配 `xxx = QuantumCircuit(...)` 或 `xxx = qiskit.QuantumCircuit(...)` */
const CIRCUIT_ASSIGNMENT = /^([ \t]*)([A-Za-z_]\w*)[ \t]*=[ \t]*(?:[\w.]+\.)?QuantumCircuit[ \t]*\(/gm;

/**
 * 注册选择器按 scheme 匹配（不依赖 languageId / 工作区 pattern），
 * 因此这里自行判断：languageId 是 python，或文件为 .py。
 */
function isPythonLike(document: vscode.TextDocument): boolean {
    return document.languageId === 'python' || document.uri.fsPath.toLowerCase().endsWith('.py');
}

export class QCOCodeLensProvider implements vscode.CodeLensProvider {
    public provideCodeLenses(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.CodeLens[] {
        if (!isPythonLike(document)) {
            return [];
        }

        const text = document.getText();
        const lenses: vscode.CodeLens[] = [];

        CIRCUIT_ASSIGNMENT.lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = CIRCUIT_ASSIGNMENT.exec(text)) !== null) {
            const indentLength = match[1].length;
            const variableName = match[2];

            // CodeLens 落在变量定义行（去掉缩进），显示在赋值语句上方
            const position = document.positionAt(match.index + indentLength);
            const range = new vscode.Range(position, position);

            lenses.push(
                new vscode.CodeLens(range, {
                    title: '▶ Observe',
                    command: 'qco.observe',
                    arguments: [document.uri.fsPath, variableName]
                })
            );
        }

        return lenses;
    }
}
