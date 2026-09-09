"""QCO VSCode Plugin - Python backend.

Style: FastAPI-like handler registration (decorator based routing), but run as a
one-shot CLI script invoked by the TypeScript extension host via subprocess.

Contract (see TDD 2.1):
    python backend.py --file /path/to/circuit.py --variable qc
    -> prints a single-line JSON to stdout: {"status": "success", "data": {...}}

All human readable logs go to **stderr** so that stdout stays a clean,
parseable single-line JSON payload.
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path
from typing import Any, Callable, Dict, Optional

# --------------------------------------------------------------------------- #
# Data models
# --------------------------------------------------------------------------- #


class ObservationRequest:
    """Incoming request from the extension host."""

    def __init__(self, file: str, variable: str, options: Optional[Dict[str, Any]] = None) -> None:
        self.file = file
        self.variable = variable
        self.options: Dict[str, Any] = options or {}

    def __repr__(self) -> str:
        return f"ObservationRequest(file={self.file!r}, variable={self.variable!r}, options={self.options!r})"


class ObservationResponse:
    """Outgoing response, serialized as a single-line JSON on stdout."""

    def __init__(
        self,
        status: str = "success",
        data: Optional[Dict[str, Any]] = None,
        message: Optional[str] = None,
    ) -> None:
        self.status = status
        self.data = data
        self.message = message

    def to_dict(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"status": self.status}
        if self.data is not None:
            payload["data"] = self.data
        if self.message is not None:
            payload["message"] = self.message
        return payload

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, default=str)

    def __repr__(self) -> str:
        return f"ObservationResponse(status={self.status!r}, message={self.message!r})"


# --------------------------------------------------------------------------- #
# FastAPI-like app (route registry, no HTTP server)
# --------------------------------------------------------------------------- #

Handler = Callable[[ObservationRequest], ObservationResponse]


class App:
    """Minimal FastAPI-style container: handlers are bound to a route name."""

    def __init__(self) -> None:
        self.routes: Dict[str, Handler] = {}

    def post(self, path: str) -> Callable[[Handler], Handler]:
        def decorator(handler: Handler) -> Handler:
            self.routes[path] = handler
            return handler

        return decorator

    def dispatch(self, path: str, request: ObservationRequest) -> ObservationResponse:
        try:
            handler = self.routes.get(path)
            if handler is None:
                return ObservationResponse(status="error", message=f"No handler for route '{path}'")
            return handler(request)
        except FileNotFoundError as exc:
            return ObservationResponse(status="error", message=str(exc) or "File not found")
        except ValueError as exc:
            return ObservationResponse(status="error", message=str(exc))
        except SyntaxError as exc:
            return ObservationResponse(
                status="error",
                message=f"Syntax error in {request.file}: {exc.msg} (line {exc.lineno})",
            )
        except ImportError as exc:
            return ObservationResponse(
                status="error",
                message=f"Missing python dependency: {exc}. Run: pip install -r python/requirements.txt",
            )
        except Exception as exc:  # noqa: BLE001 - last resort, still emit valid JSON
            if QiskitError is not None and isinstance(exc, QiskitError):
                return ObservationResponse(status="error", message=f"Qiskit error: {exc}")

            log(f"Unhandled error: {exc}")
            log(traceback.format_exc())
            return ObservationResponse(status="error", message=f"{type(exc).__name__}: {exc}")


app = App()


try:
    from qiskit import QiskitError
except ImportError:  # pragma: no cover - qiskit 缺失时仅降级处理
    QiskitError = None


def log(message: str) -> None:
    """Diagnostic output - always on stderr so stdout keeps only the JSON payload."""
    print(f"[backend] {message}", file=sys.stderr)


# --------------------------------------------------------------------------- #
# Circuit loading
# --------------------------------------------------------------------------- #


def load_circuit(filepath: str, var_name: str) -> Any:
    """Execute a python file and extract the object bound to ``var_name``.

    Note: the file is executed in an isolated namespace; only the top level
    module code runs (``__name__`` is set to ``"__qco__"`` to avoid running
    user ``main`` guards).
    """
    path = Path(filepath)
    if not path.is_file():
        raise FileNotFoundError(f"File not found: {filepath}")

    source = path.read_text(encoding="utf-8")
    namespace: Dict[str, Any] = {"__name__": "__qco__", "__file__": str(path)}

    exec(compile(source, str(path), "exec"), namespace)  # noqa: S102 - required to build the circuit

    circuit = namespace.get(var_name)
    if circuit is None:
        raise ValueError(f"Variable '{var_name}' not found in file")
    return circuit


# --------------------------------------------------------------------------- #
# Handlers
# --------------------------------------------------------------------------- #


def _as_complex_pair(value: Any) -> list[float]:
    """Normalize one amplitude into the render-friendly ``[real, imag]`` pair."""
    if isinstance(value, complex):
        return [float(value.real), float(value.imag)]
    if isinstance(value, (int, float)):
        return [float(value), 0.0]
    if isinstance(value, dict):
        return [float(value.get("real", 0.0)), float(value.get("imag", 0.0))]
    if isinstance(value, (list, tuple)):
        real = float(value[0]) if len(value) > 0 else 0.0
        imag = float(value[1]) if len(value) > 1 else 0.0
        return [real, imag]
    return [0.0, 0.0]


def build_render_payload(circuit: Any, decoded: Dict[str, Any]) -> Dict[str, Any]:
    """Convert decoded IR into the render-ready structure (TDD 2.1)."""
    decoded_steps = decoded.get("steps", []) or []

    gates = [
        {
            "name": step.get("gate", {}).get("name", ""),
            "qubits": list(step.get("gate", {}).get("qubits", []) or []),
            "step": step.get("step_id", index),
            "x_pos": step.get("step_id", index),  # 每个 step 占一列
        }
        for index, step in enumerate(decoded_steps)
    ]

    steps = []
    for index, step in enumerate(decoded_steps):
        gate = step.get("gate", {}) or {}
        state = step.get("state", {}) or {}
        entanglement = step.get("entanglement", {}) or {}

        statevector = [_as_complex_pair(amp) for amp in (state.get("statevector") or [])]
        edges = [
            [int(edge[0]), int(edge[1]), float(edge[2])]
            for edge in (entanglement.get("edges") or [])
            if len(edge) >= 3
        ]

        steps.append(
            {
                "step_id": step.get("step_id", index),
                "gate_name": gate.get("name", ""),
                "qubits": list(gate.get("qubits", []) or []),
                "statevector": statevector,
                "edges": edges,
                "global_entropy": float(entanglement.get("global_entropy", 0.0) or 0.0),
            }
        )

    return {
        "metadata": {
            "n_qubits": int(getattr(circuit, "num_qubits", 0) or 0),
            "total_steps": len(steps),
            "depth": int(circuit.depth()) if hasattr(circuit, "depth") else len(steps),
        },
        "circuit_layout": {
            "gates": gates,
            "num_qubits": int(getattr(circuit, "num_qubits", 0) or 0),
            "width": len(steps),
        },
        "steps": steps,
    }


@app.post("/observe")
def observe(request: ObservationRequest) -> ObservationResponse:
    """Run the observation pipeline for a circuit variable in a python file."""
    from quantum_circuit_observer import QCObserver, decode_ir, encode_ir  # lazy -> friendly errors

    if not request.file or not request.variable:
        raise ValueError("Both --file and --variable are required for /observe")

    circuit = load_circuit(request.file, request.variable)
    log(f"loaded circuit: {type(circuit).__name__} (num_qubits={getattr(circuit, 'num_qubits', '?')})")

    result = QCObserver(circuit).run()

    profile = str(request.options.get("profile", "compact"))
    ir = encode_ir(result, profile=profile, circuit_name=request.variable)

    if request.options.get("raw"):  # 调试用：直接输出未解码的 IR v2
        return ObservationResponse(status="success", data=ir)

    decoded = decode_ir(ir)
    return ObservationResponse(status="success", data=build_render_payload(circuit, decoded))


@app.post("/health")
def health(request: ObservationRequest) -> ObservationResponse:
    """Environment diagnostics: python version / dependency availability."""
    info: Dict[str, Any] = {"python": sys.version.split()[0]}
    try:
        import quantum_circuit_observer as qco

        info["quantum_circuit_observer"] = getattr(qco, "__version__", "unknown")
        info["ir_version"] = getattr(qco, "IR_VERSION", "unknown")
    except ImportError as exc:  # pragma: no cover - reported to the extension host
        info["quantum_circuit_observer"] = f"missing ({exc})"
    return ObservationResponse(status="success", data=info)


# --------------------------------------------------------------------------- #
# CLI entry
# --------------------------------------------------------------------------- #


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="backend.py",
        description="QCO python backend: observe a QuantumCircuit and emit IR JSON on stdout.",
    )
    parser.add_argument(
        "--file",
        default="",
        help="Path to the python file containing the circuit (required for /observe)",
    )
    parser.add_argument(
        "--variable",
        default="",
        help="Name of the QuantumCircuit variable (required for /observe)",
    )
    parser.add_argument(
        "--route",
        default="/observe",
        choices=sorted(app.routes.keys()),
        help="Route to dispatch (default: /observe)",
    )
    parser.add_argument(
        "--profile",
        default="compact",
        help="IR encoding profile (default: compact)",
    )
    parser.add_argument(
        "--raw",
        action="store_true",
        help="Output the raw (undecoded) IR v2 instead of the render-ready structure",
    )
    return parser.parse_args(argv)


def main(
    file: str,
    variable: str,
    route: str = "/observe",
    profile: str = "compact",
    raw: bool = False,
) -> int:
    """Entry point: dispatch the route and print a single-line JSON on stdout."""
    request = ObservationRequest(file=file, variable=variable, options={"profile": profile, "raw": raw})

    log(f"--file     = {file}")
    log(f"--variable = {variable}")
    log(f"--route    = {route}")
    log(f"request: {request!r}")

    response = app.dispatch(route, request)
    log(f"response: {response!r}")

    print(response.to_json())
    return 0 if response.status in ("success", "warning") else 1


if __name__ == "__main__":
    args = parse_args()
    sys.exit(
        main(
            file=args.file,
            variable=args.variable,
            route=args.route,
            profile=args.profile,
            raw=args.raw,
        )
    )
