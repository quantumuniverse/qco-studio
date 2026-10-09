import * as path from 'path';
import { spawn } from 'child_process';
import * as vscode from 'vscode';

export type ObservationStatus = 'success' | 'error' | 'warning';

export interface ObservationResult {
    status: ObservationStatus;
    data?: unknown;
    message?: string;
}

export interface RunObservationOptions {
    /** Python 可执行文件，默认读取配置 qco.pythonPath，兜底为 'python' */
    pythonPath?: string;
    /** Python stderr 回调，便于写入 OutputChannel */
    onStderr?: (chunk: string) => void;
    /** 取消令牌：用户手动取消或超时触发 */
    token?: vscode.CancellationToken;
    /** 超时毫秒数，默认读取配置 qco.executionTimeout（30000） */
    timeoutMs?: number;
}

export type EnvironmentIssue = 'ok' | 'python-missing' | 'dependency-missing' | 'unknown';

export interface EnvironmentStatus {
    issue: EnvironmentIssue;
    pythonPath: string;
    message: string;
}

interface BackendRunResult {
    stdout: string;
    stderr: string;
    code: number | null;
    spawnError?: NodeJS.ErrnoException;
    timedOut?: boolean;
    cancelled?: boolean;
    truncated?: boolean;
}

/** stdout/stderr 累积上限（10 MB），防止恶意文件输出导致 OOM */
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

/** 默认超时（30 s），可被 qco.executionTimeout 配置覆盖 */
const DEFAULT_TIMEOUT_MS = 30_000;

/** backend.py 位于 <extension>/python/backend.py，打包后 __dirname 为 dist/ */
export function getBackendScriptPath(): string {
    return path.join(__dirname, '..', 'python', 'backend.py');
}

export function resolvePythonPath(explicit?: string): string {
    if (explicit) {
        return explicit;
    }
    const configured = vscode.workspace.getConfiguration('qco').get<string>('pythonPath');
    return configured && configured.trim().length > 0 ? configured : 'python';
}

function resolveTimeoutMs(explicit?: number): number {
    if (explicit !== undefined) {
        return Math.max(1_000, Math.min(300_000, explicit));
    }
    const configured = vscode.workspace.getConfiguration('qco').get<number>('executionTimeout');
    if (configured !== undefined && configured >= 1_000) {
        return Math.min(300_000, configured);
    }
    return DEFAULT_TIMEOUT_MS;
}

function runBackend(
    args: string[],
    python: string,
    options: { onStderr?: (chunk: string) => void; token?: vscode.CancellationToken; timeoutMs?: number } = {}
): Promise<BackendRunResult> {
    const script = getBackendScriptPath();
    const timeoutMs = resolveTimeoutMs(options.timeoutMs);

    return new Promise<BackendRunResult>((resolve) => {
        const child = spawn(python, args, { cwd: path.dirname(script) });

        let stdout = '';
        let stderr = '';
        let truncated = false;
        let settled = false;

        const settle = (result: BackendRunResult): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            tokenSub?.dispose();
            resolve(result);
        };

        // Timeout: kill child after timeoutMs
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            // Give the process a brief grace period, then force-kill
            const forceKill = setTimeout(() => {
                try { child.kill('SIGKILL'); } catch { /* already dead */ }
            }, 2_000);
            forceKill.unref();
            settle({ stdout, stderr, code: null, timedOut: true, truncated });
        }, timeoutMs);
        timer.unref();

        // Cancellation: user-triggered via CancellationToken
        const tokenSub = options.token?.onCancellationRequested(() => {
            child.kill('SIGTERM');
            settle({ stdout, stderr, code: null, cancelled: true, truncated });
        });

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (chunk: string) => {
            if (!truncated && stdout.length < MAX_OUTPUT_BYTES) {
                stdout += chunk;
            }
            if (!truncated && stdout.length >= MAX_OUTPUT_BYTES) {
                truncated = true;
                stdout = stdout.slice(0, MAX_OUTPUT_BYTES);
            }
        });

        child.stderr.on('data', (chunk: string) => {
            if (!truncated && stderr.length < MAX_OUTPUT_BYTES) {
                stderr += chunk;
            }
            options.onStderr?.(chunk);
        });

        child.on('error', (err: NodeJS.ErrnoException) => {
            settle({ stdout, stderr, code: null, spawnError: err, truncated });
        });

        child.on('close', (code: number | null) => {
            settle({ stdout, stderr, code, truncated });
        });
    });
}

/** stdout 中取最后一行非空内容（python 侧保证只输出一行 JSON） */
function extractJsonLine(stdout: string): string | undefined {
    const lines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    return lines.length > 0 ? lines[lines.length - 1] : undefined;
}

/**
 * 调用 python 子进程执行 backend.py，解析 stdout 中的单行 JSON。
 */
export async function runObservation(
    filePath: string,
    variableName: string,
    options: RunObservationOptions = {}
): Promise<ObservationResult> {
    const python = resolvePythonPath(options.pythonPath);
    const script = getBackendScriptPath();

    const { stdout, stderr, code, spawnError, timedOut, cancelled, truncated } = await runBackend(
        [script, '--file', filePath, '--variable', variableName],
        python,
        { onStderr: options.onStderr, token: options.token, timeoutMs: options.timeoutMs }
    );

    if (timedOut) {
        return {
            status: 'error',
            message: `Observation timed out (>${resolveTimeoutMs(options.timeoutMs)} ms). The Python process was killed. Consider increasing 'qco.executionTimeout' for large circuits.`
        };
    }

    if (cancelled) {
        return {
            status: 'error',
            message: 'Observation was cancelled by the user.'
        };
    }

    if (spawnError) {
        return {
            status: 'error',
            message:
                spawnError.code === 'ENOENT'
                    ? `Cannot run '${python}'. Check the 'qco.pythonPath' setting.`
                    : spawnError.message
        };
    }

    const payload = extractJsonLine(stdout);
    if (!payload) {
        return {
            status: 'error',
            message: `No JSON output from python (exit code ${code}).${
                stderr ? ` stderr: ${stderr.trim()}` : ''
            }`
        };
    }

    try {
        return JSON.parse(payload) as ObservationResult;
    } catch {
        return {
            status: 'error',
            message: `Failed to parse python output: ${payload.slice(0, 500)}`
        };
    }
}

/**
 * 环境诊断：先确认 python 可执行，再通过 backend.py 的 /health 路由检查依赖。
 */
export async function checkEnvironment(
    options: RunObservationOptions = {}
): Promise<EnvironmentStatus> {
    const python = resolvePythonPath(options.pythonPath);
    const script = getBackendScriptPath();

    const version = await runBackend(['--version'], python);
    if (version.spawnError) {
        return {
            issue: 'python-missing',
            pythonPath: python,
            message:
                version.spawnError.code === 'ENOENT'
                    ? `未找到 Python 解释器 '${python}'，请在设置 qco.pythonPath 中指定正确路径。`
                    : version.spawnError.message
        };
    }

    const health = await runBackend([script, '--route', '/health'], python, { onStderr: options.onStderr });
    const payload = extractJsonLine(health.stdout);

    if (!payload) {
        return {
            issue: 'unknown',
            pythonPath: python,
            message: `无法运行 python/backend.py（exit ${health.code}）。${
                health.stderr ? ` ${health.stderr.trim()}` : ''
            }`
        };
    }

    try {
        const parsed = JSON.parse(payload) as {
            status?: string;
            data?: { python?: string; qco_engine?: string };
        };
        const dependency = parsed.data?.qco_engine ?? 'unknown';

        if (dependency.startsWith('missing')) {
            return {
                issue: 'dependency-missing',
                pythonPath: python,
                message: `缺少 Python 依赖：${dependency}。请执行 pip install -r python/requirements.txt`
            };
        }

        return {
            issue: 'ok',
            pythonPath: python,
            message: `Python ${parsed.data?.python ?? '?'} · qco-engine ${
                dependency === 'unknown' ? '已安装' : dependency
            }`
        };
    } catch {
        return {
            issue: 'unknown',
            pythonPath: python,
            message: `无法解析环境诊断输出：${payload.slice(0, 200)}`
        };
    }
}
