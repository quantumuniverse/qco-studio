import { useEffect, useState } from 'react';
import { VSCodeButton } from '@vscode/webview-ui-toolkit/react';
import { useStore } from '../store/useStore';

/** 默认播放速度：1 秒 / 步 */
const STEP_INTERVAL_MS = 1000;

export function Controls() {
  const steps = useStore((state) => state.steps);
  const currentStep = useStore((state) => state.currentStep);
  const setStep = useStore((state) => state.setStep);

  const [playing, setPlaying] = useState(false);

  const total = steps.length;
  const disabled = total === 0;

  // 播放：循环递增 step，到达末尾回到 0；卸载或暂停时清理定时器
  useEffect(() => {
    if (!playing || total === 0) {
      return;
    }

    const timer = window.setInterval(() => {
      const state = useStore.getState();
      if (state.steps.length === 0) {
        return;
      }
      state.setStep((state.currentStep + 1) % state.steps.length);
    }, STEP_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [playing, total]);

  // 数据被清空时停止播放
  useEffect(() => {
    if (total === 0 && playing) {
      setPlaying(false);
    }
  }, [total, playing]);

  const handlePrev = () => setStep(currentStep - 1);
  const handleNext = () => setStep(currentStep + 1);
  const handlePlay = () => setPlaying((value) => !value);
  const handleSlider = (event: React.ChangeEvent<HTMLInputElement>) => setStep(Number(event.target.value));

  return (
    <div className="controls">
      <div className="controls-buttons">
        <VSCodeButton appearance="icon" disabled={disabled} onClick={handlePrev} title="上一步">
          ⏮
        </VSCodeButton>
        <VSCodeButton appearance="icon" disabled={disabled} onClick={handlePlay} title={playing ? '暂停' : '播放'}>
          {playing ? '⏸' : '▶'}
        </VSCodeButton>
        <VSCodeButton appearance="icon" disabled={disabled} onClick={handleNext} title="下一步">
          ⏭
        </VSCodeButton>
      </div>

      <input
        className="controls-slider"
        type="range"
        min={0}
        max={Math.max(total - 1, 0)}
        step={1}
        value={currentStep}
        disabled={disabled}
        onChange={handleSlider}
      />

      <span className="controls-label">
        Step: {disabled ? 0 : currentStep} / {total}
      </span>
    </div>
  );
}
