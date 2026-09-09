import { useEffect, useMemo, useRef } from 'react';
import * as d3 from 'd3';
import { useStore } from '../store/useStore';
import { useElementWidth } from '../hooks/useElementWidth';

const MIN_WIDTH = 220;
const HEIGHT = 200;
const NODE_RADIUS = 16;
const TRANSITION_MS = 400;

interface NodeDatum extends d3.SimulationNodeDatum {
  id: number;
}

interface LinkDatum extends d3.SimulationLinkDatum<NodeDatum> {
  value: number;
  key: string;
}

type SvgSelection = d3.Selection<SVGSVGElement, unknown, null, undefined>;

function linkKey(source: number, target: number): string {
  return source < target ? `${source}-${target}` : `${target}-${source}`;
}

/** 每次 tick（或容器尺寸变化）时刷新位置；重新查询 DOM，避免用到失效的 selection */
function updatePositions(svg: SvgSelection): void {
  svg
    .selectAll<SVGLineElement, LinkDatum>('.links line')
    .attr('x1', (d) => (d.source as NodeDatum).x ?? 0)
    .attr('y1', (d) => (d.source as NodeDatum).y ?? 0)
    .attr('x2', (d) => (d.target as NodeDatum).x ?? 0)
    .attr('y2', (d) => (d.target as NodeDatum).y ?? 0);

  svg
    .selectAll<SVGGElement, NodeDatum>('.nodes g')
    .attr('transform', (d) => `translate(${d.x ?? 0}, ${d.y ?? 0})`);
}

export function EntanglementGraph() {
  const steps = useStore((state) => state.steps);
  const currentStep = useStore((state) => state.currentStep);
  const metadata = useStore((state) => state.metadata);

  const [containerRef, containerWidth] = useElementWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simulationRef = useRef<d3.Simulation<NodeDatum, LinkDatum> | null>(null);

  const numQubits = metadata?.n_qubits ?? 0;
  const width = Math.max(containerWidth || MIN_WIDTH, MIN_WIDTH);

  // 宽度只用于「尺寸自适应」effect，避免参与仿真重建
  const widthRef = useRef(width);
  widthRef.current = width;

  const maxValue = useMemo(() => {
    let max = 1;
    steps.forEach((step) => {
      step.edges.forEach(([, , value]) => {
        max = Math.max(max, value);
      });
    });
    return max;
  }, [steps]);

  const widthScale = useMemo(
    () => d3.scaleLinear().domain([0, maxValue]).range([0.5, 9]).clamp(true),
    [maxValue]
  );

  const colorScale = useMemo(
    () =>
      d3
        .scaleLinear<string>()
        .domain([0, maxValue])
        .range(['#6c6c6c', '#ff9f1c'])
        .interpolate(d3.interpolateRgb),
    [maxValue]
  );

  // 初始化：节点与力导向仿真（只在 qubit 数或纠缠标尺变化时重建）
  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement || numQubits === 0) {
      return;
    }

    const initialWidth = widthRef.current;
    const svg = d3.select(svgElement);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${initialWidth} ${HEIGHT}`);

    const nodes: NodeDatum[] = d3.range(numQubits).map((id) => ({
      id,
      x: initialWidth / 2 + Math.cos((id / numQubits) * Math.PI * 2) * 50,
      y: HEIGHT / 2 + Math.sin((id / numQubits) * Math.PI * 2) * 50
    }));

    svg.append('g').attr('class', 'links');
    const nodeLayer = svg.append('g').attr('class', 'nodes');

    const nodeSelection = nodeLayer
      .selectAll<SVGGElement, NodeDatum>('g')
      .data(nodes, (d) => String(d.id))
      .join('g')
      .attr('class', 'node');

    nodeSelection
      .append('circle')
      .attr('r', NODE_RADIUS)
      .attr('fill', 'var(--vscode-button-background, #0e639c)')
      .attr('stroke', 'var(--vscode-panel-border, #3c3c3c)');

    nodeSelection
      .append('text')
      .text((d) => `q${d.id}`)
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('font-size', 11)
      .attr('fill', 'var(--vscode-button-foreground, #ffffff)');

    const simulation = d3
      .forceSimulation<NodeDatum, LinkDatum>(nodes)
      .force(
        'link',
        d3
          .forceLink<NodeDatum, LinkDatum>([])
          .id((d) => d.id)
          .distance(Math.min(90, initialWidth / 3))
          .strength((link) => Math.min(link.value / Math.max(maxValue, 0.001), 1) * 0.9)
      )
      .force('charge', d3.forceManyBody().strength(-220))
      .force('center', d3.forceCenter(initialWidth / 2, HEIGHT / 2))
      .force('collide', d3.forceCollide<NodeDatum>().radius(NODE_RADIUS + 6))
      .on('tick', () => updatePositions(svg));

    simulationRef.current = simulation;

    return () => {
      simulation.stop();
      simulationRef.current = null;
    };
  }, [numQubits, maxValue]);

  // 尺寸自适应：只改 viewBox 与布局参数，不重建节点、不重启仿真
  useEffect(() => {
    const svgElement = svgRef.current;
    const simulation = simulationRef.current;
    if (!svgElement || !simulation) {
      return;
    }

    const svg = d3.select(svgElement);
    svg.attr('viewBox', `0 0 ${width} ${HEIGHT}`);

    (simulation.force('center') as d3.ForceCenter<NodeDatum>).x(width / 2);
    (simulation.force('link') as d3.ForceLink<NodeDatum, LinkDatum>).distance(
      Math.min(90, width / 3)
    );

    // 把落在可视区外的节点拉回边界内（直接改坐标，不触发散开动画）
    const margin = NODE_RADIUS + 4;
    simulation.nodes().forEach((node) => {
      node.x = Math.min(Math.max(node.x ?? width / 2, margin), Math.max(width - margin, margin));
      node.y = Math.min(Math.max(node.y ?? HEIGHT / 2, margin), HEIGHT - margin);
    });

    updatePositions(svg);
  }, [width]);

  // 当前步更新：平滑过渡边的粗细与颜色
  useEffect(() => {
    const svgElement = svgRef.current;
    const simulation = simulationRef.current;
    if (!svgElement || !simulation) {
      return;
    }

    const edges = steps[currentStep]?.edges ?? [];
    const links: LinkDatum[] = edges.map(([source, target, value]) => ({
      source,
      target,
      value,
      key: linkKey(source, target)
    }));

    const linkLayer = d3.select(svgElement).select<SVGGElement>('.links');

    const selection = linkLayer
      .selectAll<SVGLineElement, LinkDatum>('line')
      .data(links, (d) => d.key);

    selection.exit<LinkDatum>().transition().duration(TRANSITION_MS).style('opacity', 0).remove();

    const entered = selection
      .enter()
      .append('line')
      .attr('stroke-linecap', 'round')
      .attr('stroke', (d) => colorScale(d.value))
      .attr('stroke-width', 0)
      .style('opacity', 0);

    // enter 后立刻按当前节点位置定位，避免出现 (0,0) 的线
    entered
      .attr('x1', (d) => (d.source as NodeDatum).x ?? 0)
      .attr('y1', (d) => (d.source as NodeDatum).y ?? 0)
      .attr('x2', (d) => (d.target as NodeDatum).x ?? 0)
      .attr('y2', (d) => (d.target as NodeDatum).y ?? 0);

    entered
      .merge(selection)
      .transition()
      .duration(TRANSITION_MS)
      .attr('stroke', (d) => colorScale(d.value))
      .attr('stroke-width', (d) => widthScale(d.value))
      .style('opacity', 0.9);

    (simulation.force('link') as d3.ForceLink<NodeDatum, LinkDatum>).links(links);
    simulation.alpha(0.5).restart();
  }, [steps, currentStep, colorScale, widthScale]);

  if (numQubits === 0) {
    return null;
  }

  return (
    <div className="entanglement" ref={containerRef}>
      <svg ref={svgRef} />
    </div>
  );
}
