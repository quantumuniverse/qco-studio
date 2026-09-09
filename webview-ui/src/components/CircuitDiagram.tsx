import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { useElementWidth } from '../hooks/useElementWidth';
import type { CircuitLayout, GateLayout } from '../types';

const STEP_WIDTH = 60;
const QUBIT_HEIGHT = 50;
const PADDING_LEFT = 44;
const PADDING_TOP = 26;
const GATE_WIDTH = 40;
const GATE_HEIGHT = 30;
const GATE_RADIUS = 6;

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
}

function qubitY(index: number): number {
  return PADDING_TOP + index * QUBIT_HEIGHT + QUBIT_HEIGHT / 2;
}

function gateX(gate: GateLayout): number {
  return PADDING_LEFT + gate.x_pos * STEP_WIDTH + (STEP_WIDTH - GATE_WIDTH) / 2;
}

function contentWidthOf(layout: CircuitLayout): number {
  return PADDING_LEFT + layout.width * STEP_WIDTH + 24;
}

/** 画布宽度：内容不足时撑满容器，内容超出时保持内容宽度（横向滚动） */
function canvasWidthOf(layout: CircuitLayout, containerWidth: number): number {
  return Math.max(contentWidthOf(layout), containerWidth);
}

function canvasHeightOf(layout: CircuitLayout): number {
  return PADDING_TOP + layout.num_qubits * QUBIT_HEIGHT + 16;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/** 绘制电路图：qubit 轨道线 + 按 x_pos 排列的门，当前步高亮 */
function draw(
  canvas: HTMLCanvasElement,
  layout: CircuitLayout,
  currentStep: number,
  cssWidth: number
): void {
  const cssHeight = canvasHeightOf(layout);
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.font = '12px system-ui, -apple-system, sans-serif';

  const fg = cssVar('--vscode-editor-foreground', '#cccccc');
  const dim = cssVar('--vscode-descriptionForeground', '#8c8c8c');
  const line = cssVar('--vscode-panel-border', '#3c3c3c');
  const accent = cssVar('--vscode-charts-orange', '#ff9f1c');
  const bg = cssVar('--vscode-editor-background', '#1e1e1e');

  for (let index = 0; index < layout.num_qubits; index += 1) {
    const y = qubitY(index);

    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PADDING_LEFT - 12, y);
    ctx.lineTo(cssWidth - 12, y);
    ctx.stroke();

    ctx.fillStyle = dim;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`q${index}`, PADDING_LEFT - 18, y);
  }

  layout.gates.forEach((gate) => {
    const highlighted = gate.step === currentStep;
    const x = gateX(gate);
    const qubits = gate.qubits.length > 0 ? gate.qubits : [0];

    if (qubits.length > 1) {
      const centerX = x + GATE_WIDTH / 2;
      const yTop = qubitY(Math.min(...qubits));
      const yBottom = qubitY(Math.max(...qubits));

      ctx.strokeStyle = highlighted ? accent : fg;
      ctx.lineWidth = highlighted ? 2 : 1.5;
      ctx.beginPath();
      ctx.moveTo(centerX, yTop);
      ctx.lineTo(centerX, yBottom);
      ctx.stroke();

      const controlY = qubitY(qubits[0]);
      ctx.fillStyle = highlighted ? accent : fg;
      ctx.beginPath();
      ctx.arc(centerX, controlY, 5, 0, Math.PI * 2);
      ctx.fill();

      const targetY = qubitY(qubits[qubits.length - 1]);
      ctx.beginPath();
      ctx.arc(centerX, targetY, 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(centerX - 11, targetY);
      ctx.lineTo(centerX + 11, targetY);
      ctx.moveTo(centerX, targetY - 11);
      ctx.lineTo(centerX, targetY + 11);
      ctx.stroke();

      ctx.fillStyle = highlighted ? accent : dim;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(gate.name, centerX, yTop - 16);
      return;
    }

    const y = qubitY(qubits[0]) - GATE_HEIGHT / 2;

    roundRect(ctx, x, y, GATE_WIDTH, GATE_HEIGHT, GATE_RADIUS);
    ctx.fillStyle = highlighted ? accent : bg;
    ctx.fill();
    ctx.strokeStyle = highlighted ? accent : fg;
    ctx.lineWidth = highlighted ? 2 : 1;
    ctx.stroke();

    ctx.fillStyle = highlighted ? bg : fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(gate.name, x + GATE_WIDTH / 2, y + GATE_HEIGHT / 2);
  });
}

export function CircuitDiagram() {
  const layout = useStore((state) => state.layout);
  const currentStep = useStore((state) => state.currentStep);
  const setStep = useStore((state) => state.setStep);

  const [containerRef, containerWidth] = useElementWidth<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layout) {
      return;
    }
    draw(canvas, layout, currentStep, canvasWidthOf(layout, containerWidth));
  }, [layout, currentStep, containerWidth]);

  // 自动滚动：把当前高亮的门移到可视区水平中央
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !layout) {
      return;
    }

    const gate = layout.gates.find((item) => item.step === currentStep);
    if (!gate) {
      return;
    }

    const center = gateX(gate) + GATE_WIDTH / 2;
    container.scrollTo({
      left: Math.max(0, center - container.clientWidth / 2),
      behavior: 'smooth'
    });
  }, [layout, currentStep]);

  // 交互：点击或拖过某一列即跳到对应步骤
  useEffect(() => {
    const stopDragging = () => {
      draggingRef.current = false;
    };
    window.addEventListener('mouseup', stopDragging);
    return () => window.removeEventListener('mouseup', stopDragging);
  }, []);

  const applyStepFromPointer = (clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !layout) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) {
      return;
    }

    const logicalWidth = canvasWidthOf(layout, containerWidth);
    const x = (clientX - rect.left) * (logicalWidth / rect.width);
    const column = Math.floor((x - PADDING_LEFT) / STEP_WIDTH);

    const gate = layout.gates.find((item) => item.x_pos === column);
    if (gate) {
      setStep(gate.step);
    }
  };

  const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    draggingRef.current = true;
    applyStepFromPointer(event.clientX);
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!draggingRef.current) {
      return;
    }
    applyStepFromPointer(event.clientX);
  };

  if (!layout) {
    return null;
  }

  const width = canvasWidthOf(layout, containerWidth);

  return (
    <div className="circuit" ref={containerRef}>
      <div className="circuit-scroll" ref={scrollRef}>
        <canvas
          ref={canvasRef}
          style={{ width, height: canvasHeightOf(layout) }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={() => {
            draggingRef.current = false;
          }}
        />
      </div>
    </div>
  );
}
