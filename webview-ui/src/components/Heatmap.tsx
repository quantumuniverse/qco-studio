import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { useElementWidth } from '../hooks/useElementWidth';
import type { ProbabilitySource } from '../utils/amplitude';
import { buildProbabilityGrid } from '../utils/amplitude';

/** 纵轴滚动窗口：一次最多显示最近 20 步 */
const VISIBLE_STEPS = 20;
const DEFAULT_CELL_WIDTH = 16;
const MIN_CELL_WIDTH = 3;
const MAX_CELL_WIDTH = 24;
const CELL_HEIGHT = 14;
const LABEL_WIDTH = 36;
const HEADER_HEIGHT = 18;
/** 选择窗口最小宽度（basis 数） */
const MIN_WINDOW = 1;

type DragMode = 'left' | 'right' | 'move' | null;

interface Range {
  start: number;
  end: number;
}

interface HoverInfo {
  step: number;
  basis: number;
  value: number;
  phase: number | null;
  x: number;
  y: number;
}

const SOURCE_LABEL: Record<ProbabilitySource, string> = {
  engine: 'source: qco-engine amplitude',
  statevector: 'source: statevector |ψ|²',
  'engine-topk': 'source: qco-engine top-k (other basis states not shown)'
};

function probabilityColor(value: number): string {
  const clamped = Math.min(Math.max(value, 0), 1);
  const hue = 240 - 230 * clamped;
  const lightness = 18 + 40 * clamped;
  return `hsl(${hue}, 75%, ${lightness}%)`;
}

export function Heatmap() {
  const steps = useStore((state) => state.steps);
  const currentStep = useStore((state) => state.currentStep);
  const metadata = useStore((state) => state.metadata);

  const [range, setRange] = useState<Range>({ start: 0, end: 0 });
  const [timeStart, setTimeStart] = useState(0);
  const [hover, setHover] = useState<HoverInfo | null>(null);

  const [wrapRef, containerWidth] = useElementWidth<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ mode: DragMode; startX: number; origin: Range } | null>(null);

  const numQubits = metadata?.n_qubits ?? 0;

  /** 优先消费 engine 振幅快照；快照不完整时回退态向量；大电路无态向量时用 top-k 稀疏列 */
  const grid = useMemo(() => buildProbabilityGrid(steps, numQubits), [steps, numQubits]);

  /** magnitudes[step][col] = |振幅|²；col → 基底索引见 basisOf */
  const magnitudes = grid?.probs ?? [];
  const columnCount = grid?.basis.length ?? 0;
  const totalSteps = grid ? magnitudes.length : 0;
  const basisOf = (col: number) => grid?.basis[col] ?? col;

  const cols = Math.max(range.end - range.start + 1, 1);

  /** 列宽自适应容器宽度：列多时变窄，保证铺满面板 */
  const cellWidth = useMemo(() => {
    if (containerWidth <= LABEL_WIDTH + MIN_CELL_WIDTH) {
      return DEFAULT_CELL_WIDTH;
    }
    return Math.min(
      Math.max(Math.floor((containerWidth - LABEL_WIDTH) / cols), MIN_CELL_WIDTH),
      MAX_CELL_WIDTH
    );
  }, [containerWidth, cols]);

  const canvasWidth = LABEL_WIDTH + cols * cellWidth;

  useEffect(() => {
    setRange({ start: 0, end: Math.max(columnCount - 1, 0) });
    setTimeStart(0);
    setHover(null);
  }, [columnCount, totalSteps]);

  // 当前步超出可视窗口时，跟随滚动
  useEffect(() => {
    if (totalSteps <= VISIBLE_STEPS) {
      return;
    }
    const maxStart = totalSteps - VISIBLE_STEPS;
    if (currentStep < timeStart || currentStep >= timeStart + VISIBLE_STEPS) {
      setTimeStart(Math.min(Math.max(currentStep - Math.floor(VISIBLE_STEPS / 2), 0), maxStart));
    }
  }, [currentStep, timeStart, totalSteps]);

  // 绘制主热力图
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || columnCount === 0 || totalSteps === 0) {
      return;
    }

    const rows = Math.min(VISIBLE_STEPS, totalSteps - timeStart);
    const cssWidth = canvasWidth;
    const cssHeight = HEADER_HEIGHT + rows * CELL_HEIGHT;
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
    ctx.font = '10px system-ui, -apple-system, sans-serif';

    const fg = getComputedStyle(document.body).getPropertyValue('--vscode-editor-foreground').trim() || '#cccccc';
    const accent =
      getComputedStyle(document.body).getPropertyValue('--vscode-charts-orange').trim() || '#ff9f1c';

    for (let row = 0; row < rows; row += 1) {
      const stepIndex = timeStart + row;
      const y = HEADER_HEIGHT + row * CELL_HEIGHT;

      if (stepIndex % 4 === 0) {
        ctx.fillStyle = fg;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(stepIndex), 4, y + CELL_HEIGHT / 2);
      }

      for (let col = 0; col < cols; col += 1) {
        const basis = range.start + col;
        const value = magnitudes[stepIndex]?.[basis] ?? 0;
        ctx.fillStyle = probabilityColor(value);
        ctx.fillRect(LABEL_WIDTH + col * cellWidth, y, Math.max(cellWidth - 1, 1), CELL_HEIGHT - 1);
      }

      if (stepIndex === currentStep) {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.strokeRect(LABEL_WIDTH, y + 1, cols * cellWidth - 1, CELL_HEIGHT - 2);
      }
    }

    // 顶部 basis 刻度（按可用宽度抽稀）
    const labelStep = Math.max(1, Math.ceil(cols / Math.max(2, Math.floor((cssWidth - LABEL_WIDTH) / 34))));
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let col = 0; col < cols; col += labelStep) {
      ctx.fillText(
        String(basisOf(range.start + col)),
        LABEL_WIDTH + col * cellWidth + cellWidth / 2,
        HEADER_HEIGHT / 2
      );
    }
  }, [grid, magnitudes, range, timeStart, currentStep, columnCount, totalSteps, cols, cellWidth, canvasWidth]);

  // 纵轴：滚轮滚动时间窗口
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) {
      return;
    }

    const onWheel = (event: WheelEvent) => {
      const maxStart = Math.max(totalSteps - VISIBLE_STEPS, 0);
      if (maxStart === 0) {
        return;
      }
      event.preventDefault();
      setTimeStart((current) =>
        Math.min(Math.max(current + (event.deltaY > 0 ? 1 : -1), 0), maxStart)
      );
    };

    wrap.addEventListener('wheel', onWheel, { passive: false });
    return () => wrap.removeEventListener('wheel', onWheel);
  }, [wrapRef, totalSteps]);

  // 尺子拖拽
  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const drag = dragRef.current;
      const ruler = rulerRef.current;
      if (!drag || !drag.mode || !ruler || columnCount === 0) {
        return;
      }

      const pxPerBasis = ruler.clientWidth / columnCount;
      const delta = Math.round((event.clientX - drag.startX) / pxPerBasis);
      const { start, end } = drag.origin;

      if (drag.mode === 'left') {
        setRange({
          start: Math.min(Math.max(start + delta, 0), end - MIN_WINDOW + 1),
          end
        });
      } else if (drag.mode === 'right') {
        setRange({
          start,
          end: Math.max(Math.min(end + delta, columnCount - 1), start + MIN_WINDOW - 1)
        });
      } else {
        const width = end - start;
        const nextStart = Math.min(Math.max(start + delta, 0), columnCount - 1 - width);
        setRange({ start: nextStart, end: nextStart + width });
      }
    };

    const onMouseUp = () => {
      dragRef.current = null;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [columnCount]);

  const startDrag = (mode: DragMode) => (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { mode, startX: event.clientX, origin: range };
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || columnCount === 0) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const scale = rect.width > 0 ? canvasWidth / rect.width : 1;
    const x = (event.clientX - rect.left) * scale;
    const y = (event.clientY - rect.top) * scale;

    const col = Math.floor((x - LABEL_WIDTH) / cellWidth);
    const row = Math.floor((y - HEADER_HEIGHT) / CELL_HEIGHT);

    if (col < 0 || row < 0) {
      setHover(null);
      return;
    }

    const column = range.start + col;
    const stepIndex = timeStart + row;
    if (column >= columnCount || stepIndex >= totalSteps) {
      setHover(null);
      return;
    }

    setHover({
      step: stepIndex,
      basis: basisOf(column),
      value: magnitudes[stepIndex]?.[column] ?? 0,
      phase: grid?.phases[stepIndex]?.[column] ?? null,
      x: LABEL_WIDTH + col * cellWidth + cellWidth,
      y: HEADER_HEIGHT + row * CELL_HEIGHT
    });
  };

  const rows = Math.min(VISIBLE_STEPS, Math.max(totalSteps - timeStart, 0));

  if (columnCount === 0 || totalSteps === 0) {
    return null;
  }

  return (
    <div className="heatmap">
      <div className="heatmap-canvas-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          style={{ width: canvasWidth, height: HEADER_HEIGHT + rows * CELL_HEIGHT }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHover(null)}
        />
        {hover && (
          <div className="heatmap-tooltip" style={{ left: hover.x, top: hover.y }}>
            |{hover.basis.toString(2).padStart(numQubits, '0')}⟩ step {hover.step}: |ψ|²=
            {hover.value.toFixed(4)}
            {hover.phase !== null && hover.value > 0 && ` φ=${hover.phase.toFixed(3)}`}
          </div>
        )}
      </div>

      {/* 态空间尺子 */}
      <div className="ruler" ref={rulerRef}>
        <div className="ruler-track">
          <div
            className="selection-window"
            style={{
              left: `${(range.start / Math.max(columnCount, 1)) * 100}%`,
              width: `${(cols / Math.max(columnCount, 1)) * 100}%`
            }}
          >
            <div className="handle left" onMouseDown={startDrag('left')} />
            <div className="drag-area" onMouseDown={startDrag('move')} />
            <div className="handle right" onMouseDown={startDrag('right')} />
          </div>
        </div>
        <div className="ruler-labels">
          <span>{grid?.source === 'engine-topk' ? `|${basisOf(0)}⟩` : '|0…0⟩'}</span>
          <span>
            {grid?.source === 'engine-topk'
              ? `columns ${range.start} – ${range.end} / ${Math.max(columnCount - 1, 0)} of ${grid.totalBasis} basis`
              : `basis ${range.start} – ${range.end} / ${Math.max(columnCount - 1, 0)}`}
          </span>
          <span>{grid?.source === 'engine-topk' ? `|${basisOf(columnCount - 1)}⟩` : '|1…1⟩'}</span>
        </div>
        {grid && <div className="heatmap-source">{SOURCE_LABEL[grid.source]}</div>}
      </div>
    </div>
  );
}
