import { useCallback, useEffect } from 'react';
import { useStore } from '../store/useStore';
import type { RenderReadyData } from '../types';

interface VSCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VSCodeApi;

/** acquireVsCodeApi 每个 webview 只能调用一次，这里在模块加载时取到单例。 */
function resolveVsCodeApi(): VSCodeApi | undefined {
  return typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
}

export const vscode = resolveVsCodeApi();

export interface UseVSCodeResult {
  postMessage: (type: string, payload?: unknown) => void;
}

/**
 * 监听宿主发来的消息：LOAD_DATA 时把数据写入 store。
 * 挂载后向宿主发送 VIEW_READY，宿主可据此（重）发数据。
 */
export function useVSCode(): UseVSCodeResult {
  const setData = useStore((state) => state.setData);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data as { type?: string; payload?: unknown } | undefined;
      if (message?.type === 'LOAD_DATA') {
        setData(message.payload as RenderReadyData);
      }
    };

    window.addEventListener('message', handler);
    vscode?.postMessage({ type: 'VIEW_READY' });

    return () => window.removeEventListener('message', handler);
  }, [setData]);

  const postMessage = useCallback((type: string, payload?: unknown) => {
    vscode?.postMessage({ type, payload });
  }, []);

  return { postMessage };
}
