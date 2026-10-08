import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store/useStore';
import type { BlochVector } from '../utils/bloch';
import { resolveBlochVectors } from '../utils/bloch';

/** 轨迹保留的历史步数（含当前步） */
const HISTORY_LENGTH = 5;

const AXIS_COLOR = '#6c6c6c';
const VECTOR_COLOR = '#ff9f1c';

function Axes() {
  const geometry = useMemo(() => {
    const points = new Float32Array([
      -1.15, 0, 0, 1.15, 0, 0,
      0, -1.15, 0, 0, 1.15, 0,
      0, 0, -1.15, 0, 0, 1.15
    ]);
    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute('position', new THREE.BufferAttribute(points, 3));
    return buffer;
  }, []);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={AXIS_COLOR} />
    </lineSegments>
  );
}

function BlochArrow({ vector }: { vector: BlochVector }) {
  const arrow = useMemo(() => {
    const direction = new THREE.Vector3(vector.x, vector.y, vector.z);
    const length = Math.min(direction.length(), 1);

    if (length < 1e-6) {
      direction.set(0, 0, 0);
    } else {
      direction.normalize();
    }

    return new THREE.ArrowHelper(
      length < 1e-6 ? new THREE.Vector3(0, 0, 1) : direction,
      new THREE.Vector3(0, 0, 0),
      Math.max(length, 0.001),
      VECTOR_COLOR,
      0.2,
      0.12
    );
  }, [vector.x, vector.y, vector.z]);

  return <primitive object={arrow} />;
}

function Trail({ points }: { points: BlochVector[] }) {
  return (
    <>
      {points.map((point, index) => (
        <mesh key={index} position={[point.x, point.y, point.z]}>
          <sphereGeometry args={[0.05, 12, 12]} />
          <meshBasicMaterial color={VECTOR_COLOR} transparent opacity={0.25 + 0.15 * index} />
        </mesh>
      ))}
    </>
  );
}

function BlochScene({ vector, trail }: { vector: BlochVector; trail: BlochVector[] }) {
  return (
    <>
      <mesh>
        <sphereGeometry args={[1, 24, 24]} />
        <meshBasicMaterial color="#4a4a4a" wireframe transparent opacity={0.35} />
      </mesh>
      <Axes />
      <BlochArrow vector={vector} />
      <Trail points={trail} />
    </>
  );
}

export function BlochSphere() {
  const steps = useStore((state) => state.steps);
  const currentStep = useStore((state) => state.currentStep);
  const metadata = useStore((state) => state.metadata);

  if (!metadata || steps.length === 0) {
    return null;
  }

  const numQubits = metadata.n_qubits;
  const current = steps[currentStep];
  if (!current) {
    return null;
  }

  // 优先消费 engine 经 IR 下发的 Bloch 向量；仅旧 payload 时前端补算
  const { vectors, source } = resolveBlochVectors(current, numQubits);

  // 历史轨迹：最近 HISTORY_LENGTH 步（不含当前步，当前步由箭头表示）
  const historyStart = Math.max(0, currentStep - HISTORY_LENGTH + 1);
  const history = steps
    .slice(historyStart, currentStep)
    .map((step) => resolveBlochVectors(step, numQubits).vectors);

  const purities = current.purities ?? [];
  const entropies = current.qubit_entropies ?? [];

  return (
    <div className="bloch-grid" data-source={source}>
      {vectors.map((vector, qubit) => (
        <div className="bloch-cell" key={qubit}>
          <Canvas camera={{ position: [1.8, 1.4, 2.2], fov: 45 }}>
            <BlochScene vector={vector} trail={history.map((frame) => frame[qubit]).filter(Boolean)} />
          </Canvas>
          <span
            className="bloch-label"
            title={source === 'engine' ? 'Computed by qco-engine' : 'Computed in the webview (legacy payload)'}
          >
            q{qubit}
            {purities[qubit] !== undefined && ` · P=${purities[qubit].toFixed(3)}`}
            {entropies[qubit] !== undefined && ` · S=${entropies[qubit].toFixed(3)}`}
          </span>
        </div>
      ))}
    </div>
  );
}
