import { useEffect } from 'react';
import { VSCodeButton } from '@vscode/webview-ui-toolkit/react';
import { BlochSphere } from './components/BlochSphere';
import { CircuitDiagram } from './components/CircuitDiagram';
import { Controls } from './components/Controls';
import { EntanglementGraph } from './components/EntanglementGraph';
import { Heatmap } from './components/Heatmap';
import { useVSCode } from './hooks/useVSCode';
import { useStore } from './store/useStore';

function App() {
  const { postMessage } = useVSCode();

  const steps = useStore((state) => state.steps);
  const currentStep = useStore((state) => state.currentStep);
  const metadata = useStore((state) => state.metadata);
  const reset = useStore((state) => state.reset);

  const total = steps.length;
  const current = steps[currentStep];

  // 当前步变化 -> 通知宿主（侧边栏元数据实时刷新）
  useEffect(() => {
    if (total === 0) {
      return;
    }
    postMessage('STEP_JUMP', { step: currentStep });
  }, [currentStep, total, postMessage]);

  return (
    <div className="app">
      <h1>QCO: Quantum Circuit Observer</h1>

      {total === 0 ? (
        <p className="hint">Waiting for data... (LOAD_DATA)</p>
      ) : (
        <>
          <p>
            qubit: {metadata?.n_qubits ?? '-'} | gate: {current?.gate_name ?? '-'} | entropy:{' '}
            {current?.global_entropy?.toFixed(3) ?? '-'}
          </p>
          <Controls />
          <CircuitDiagram />
          <BlochSphere />
          <Heatmap />
          <EntanglementGraph />
        </>
      )}

      <div className="card">
        <VSCodeButton appearance="secondary" onClick={reset}>
          reset
        </VSCodeButton>
      </div>
    </div>
  );
}

export default App;
