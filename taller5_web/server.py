#!/usr/bin/env python3
"""Interactive Web Server for Taller 5 — Iterated Prisoner's Dilemma & Online MDP RL Lab."""

from __future__ import annotations

import argparse
import json
import mimetypes
import sys
import traceback
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

APP_DIR = Path(__file__).resolve().parent
CORE_DIR = APP_DIR / "core"
STATIC_DIR = APP_DIR / "static"
ROOT_DIR = APP_DIR.parent

if str(CORE_DIR) not in sys.path:
    sys.path.insert(0, str(CORE_DIR))

import session_store

from engine import (
    ALLOWED_OUTPUT_IMAGES,
    ScriptRunLimit,
    build_strategy_catalog,
    compute_mdp_payload,
    delete_custom_strategy,
    get_bootstrap_payload,
    get_default_frequency_table,
    get_script_job,
    get_script_output,
    get_source_code_bundle,
    get_tournament_job,
    register_custom_strategy,
    run_duel_analysis,
    run_evolution_suite,
    run_gary_dynamics,
    run_h2h_matrix,
    run_lambda_sweep_axelrod,
    run_online_learning_suite,
    run_unit_tests_live,
    start_human_match,
    start_script_job,
    start_tournament_job,
    step_human_match,
    stop_script_job,
    test_custom_strategy_payload,
)

# Pre-warmed bootstrap cache (invalidated when custom strategies change)
_BOOTSTRAP_CACHE: dict | None = None


def _invalidate_bootstrap() -> None:
    global _BOOTSTRAP_CACHE
    _BOOTSTRAP_CACHE = None


class Taller5Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        # Concise server logging
        sys.stderr.write(f"[Taller5Web] {self.address_string()} - {format % args}\n")

    def _send_json(self, data: object, status: int = HTTPStatus.OK, retry_after: int | None = None) -> None:
        raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        if retry_after is not None:
            self.send_header("Retry-After", str(retry_after))
        self.end_headers()
        self.wfile.write(raw)

    def _send_file(self, path: Path) -> None:
        if not path.exists() or not path.is_file():
            self._send_json({"error": "Archivo no encontrado"}, status=HTTPStatus.NOT_FOUND)
            return
        mime, _ = mimetypes.guess_type(str(path))
        if path.suffix == ".js":
            mime = "application/javascript; charset=utf-8"
        elif path.suffix == ".css":
            mime = "text/css; charset=utf-8"
        elif path.suffix == ".html":
            mime = "text/html; charset=utf-8"
        elif mime is None:
            mime = "application/octet-stream"
        raw = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(raw)))
        if path.suffix in (".html", ".js", ".css"):
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        else:
            self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(raw)

    def _read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        if length > 1_048_576:
            raise ValueError("Payload demasiado grande (máximo 1 MB)")
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def do_GET(self) -> None:
        session_store.bind(self.headers.get("X-IPD-Session",""))
        global _BOOTSTRAP_CACHE
        parsed = urlparse(self.path)
        path = parsed.path

        try:
            if path == "/" or path == "/index.html":
                self._send_file(STATIC_DIR / "index.html")
                return
            if path == "/taller.pdf":
                self._send_file(ROOT_DIR / "taller.pdf")
                return
            if path == "/gary.pdf":
                self._send_file(ROOT_DIR / "gary_expectimax.pdf")
                return
            if path == "/api/download-notebook":
                nb_path = ROOT_DIR / "evolucion_agentes_taller5.ipynb"
                if not nb_path.exists():
                    self._send_json({"error": "Notebook no encontrado"}, status=HTTPStatus.NOT_FOUND)
                    return
                raw = nb_path.read_bytes()
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "application/x-ipynb+json")
                self.send_header("Content-Disposition", 'attachment; filename="evolucion_agentes_taller5.ipynb"')
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
                return
            if path.startswith("/project-img/"):
                img_name = path[len("/project-img/") :].strip("/")
                if img_name not in ALLOWED_OUTPUT_IMAGES:
                    self._send_json({"error": "Imagen no autorizada"}, status=HTTPStatus.FORBIDDEN)
                    return
                self._send_file(get_script_output(img_name))
                return
            if path.startswith("/api/scripts/status/"):
                job_id = path[len("/api/scripts/status/") :].strip("/")
                job = get_script_job(job_id)
                if job is None:
                    self._send_json({"error": "Ejecución no encontrada"}, status=HTTPStatus.NOT_FOUND)
                    return
                self._send_json(job)
                return
            if path.startswith("/static/"):
                rel = path[len("/static/") :]
                target = (STATIC_DIR / rel).resolve()
                if not target.is_relative_to(STATIC_DIR.resolve()):
                    self._send_json({"error": "Acceso denegado"}, status=HTTPStatus.FORBIDDEN)
                    return
                self._send_file(target)
                return

            if path == "/api/bootstrap":
                self._send_json({**_BOOTSTRAP_CACHE, "catalog": build_strategy_catalog()})
                return

            if path == "/api/catalog":
                self._send_json({"catalog": build_strategy_catalog()})
                return

            if path == "/api/code":
                self._send_json({"files": get_source_code_bundle()})
                return

            if path.startswith("/api/tournament/status/"):
                job_id = path[len("/api/tournament/status/") :].strip("/")
                job = get_tournament_job(job_id)
                if job is None:
                    self._send_json({"error": "Torneo no encontrado"}, status=HTTPStatus.NOT_FOUND)
                    return
                self._send_json(job)
                return

            self._send_json({"error": f"Ruta GET desconocida: {path}"}, status=HTTPStatus.NOT_FOUND)
        except Exception as exc:
            self._send_json(
                {"error": "No se pudo completar la solicitud."},
                status=HTTPStatus.INTERNAL_SERVER_ERROR,
            )

    def do_POST(self) -> None:
        session_store.bind(self.headers.get("X-IPD-Session",""))
        if not session_store.owner.get():
            self.close_connection = True
            self._send_json({"error":"Recarga la página para iniciar la sesión."}, status=HTTPStatus.FORBIDDEN)
            return
        parsed = urlparse(self.path)
        path = parsed.path

        try:
            body = self._read_json_body()

            if path == "/api/mdp":
                res = compute_mdp_payload(
                    gamma=float(body.get("gamma", 0.90)),
                    initial_count=float(body.get("initial_count", 2.0)),
                    forgetting_factor=float(body.get("forgetting_factor", 0.90)),
                    custom_p_coop=body.get("custom_p_coop"),
                    defector_turns=int(body.get("defector_turns", 30)),
                )
                self._send_json(res)
                return

            if path == "/api/evolution":
                res = run_evolution_suite(
                    turns=int(body.get("turns", 200)),
                    repetitions=int(body.get("repetitions", 5)),
                    seed=int(body.get("seed", 42)),
                    include_axelrod=bool(body.get("include_axelrod", True)),
                )
                self._send_json(res)
                return

            if path == "/api/lambda-sweep":
                res = run_lambda_sweep_axelrod(
                    initial_count=float(body.get("initial_count", 2.0)),
                    gamma=float(body.get("gamma", 0.90)),
                    lambdas=body.get("lambdas"),
                    turns=int(body.get("turns", 200)),
                    repetitions=int(body.get("repetitions", 5)),
                    seed=int(body.get("seed", 42)),
                )
                self._send_json(res)
                return

            if path == "/api/online-learning":
                res = run_online_learning_suite(
                    initial_count=float(body.get("initial_count", 2.0)),
                    default_lambda=float(body.get("default_lambda", 0.90)),
                    lambdas_compare=body.get("lambdas_compare"),
                    gamma=float(body.get("gamma", 0.90)),
                    switch_turn=int(body.get("switch_turn", 50)),
                    phase1_end=int(body.get("phase1_end", 60)),
                    phase2_end=int(body.get("phase2_end", 130)),
                    rolling_window=int(body.get("rolling_window", 15)),
                    matrix_rival_id=str(body.get("matrix_rival_id", "axl_Alternator")),
                    seed=int(body.get("seed", 42)),
                )
                self._send_json(res)
                return

            if path == "/api/gary-dynamics":
                res = run_gary_dynamics(
                    horizon=int(body.get("horizon", 2)),
                    gamma=float(body.get("gamma", 0.90)),
                    rival_id=str(body.get("rival_id", "axl_FirstByJoss")),
                    turns=int(body.get("turns", 200)),
                    seed=int(body.get("seed", 42)),
                )
                self._send_json(res)
                return

            if path == "/api/duel":
                res = run_duel_analysis(
                    agent_a_id=str(body.get("agent_a_id", "gen5_rl")),
                    agent_b_id=str(body.get("agent_b_id", "axl_Defector")),
                    params_a=body.get("params_a"),
                    params_b=body.get("params_b"),
                    turns=int(body.get("turns", 200)),
                    seed=int(body.get("seed", 42)),
                    rolling_window=int(body.get("rolling_window", 15)),
                )
                self._send_json(res)
                return

            if path == "/api/h2h":
                sids = body.get("strategy_ids") or [
                    "gen1_cloud",
                    "gen2_rulito",
                    "gen3_gary",
                    "gen4_base",
                    "gen5_rl",
                    "axl_TitForTat",
                    "axl_Grudger",
                    "axl_Defector",
                    "axl_Alternator",
                ]
                res = run_h2h_matrix(
                    strategy_ids=sids,
                    turns=int(body.get("turns", 200)),
                    seed=int(body.get("seed", 42)),
                )
                self._send_json(res)
                return

            if path == "/api/tournament/start":
                res = start_tournament_job(
                    preset=str(body.get("preset", "axelrod1980")),
                    selected_ids=body.get("selected_ids") or ["gen5_rl"],
                    turns=int(body.get("turns", 200)),
                    seeds=body.get("seeds") or [0, 1, 2, 3, 4],
                )
                self._send_json(res)
                return

            if path == "/api/strategies/test":
                res = test_custom_strategy_payload(body)
                self._send_json(res)
                return

            if path == "/api/strategies":
                res = register_custom_strategy(body)
                self._send_json(res)
                return

            if path == "/api/tests/run":
                res = run_unit_tests_live()
                self._send_json(res)
                return

            if path == "/api/scripts/run":
                res = start_script_job(script_id=str(body.get("script_id", "")))
                self._send_json(res)
                return

            if path.startswith("/api/scripts/stop/"):
                job_id = path[len("/api/scripts/stop/") :].strip("/")
                res = stop_script_job(job_id)
                self._send_json(res)
                return

            if path == "/api/play/start":
                res = start_human_match(
                    opponent_id=str(body.get("opponent_id", "axl_TitForTat")),
                    seed=int(body.get("seed", 42)),
                )
                self._send_json(res)
                return

            if path == "/api/play/move":
                res = step_human_match(
                    session_id=str(body.get("session_id", "")),
                    human_move=str(body.get("human_move", "C")),
                )
                self._send_json(res)
                return

            self._send_json({"error": f"Ruta POST desconocida: {path}"}, status=HTTPStatus.NOT_FOUND)
        except ScriptRunLimit as exc:
            status = HTTPStatus.CONFLICT if exc.retry_after is None else HTTPStatus.TOO_MANY_REQUESTS
            self._send_json({"error": str(exc)}, status=status, retry_after=exc.retry_after)
        except Exception as exc:
            self._send_json(
                {"error": "No se pudo completar la solicitud."},
                status=HTTPStatus.BAD_REQUEST,
            )

    def do_DELETE(self) -> None:
        session_store.bind(self.headers.get("X-IPD-Session",""))
        if not session_store.owner.get():
            self.close_connection = True
            self._send_json({"error":"Recarga la página para iniciar la sesión."}, status=HTTPStatus.FORBIDDEN)
            return
        parsed = urlparse(self.path)
        path = parsed.path
        try:
            if path.startswith("/api/strategies/"):
                cid = path[len("/api/strategies/") :].strip("/")
                res = delete_custom_strategy(cid)
                self._send_json(res)
                return
            self._send_json({"error": f"Ruta DELETE desconocida: {path}"}, status=HTTPStatus.NOT_FOUND)
        except Exception as exc:
            self._send_json({"error": "Solicitud no válida."}, status=HTTPStatus.BAD_REQUEST)


def main() -> None:
    parser = argparse.ArgumentParser(description="Servidor web interactivo del Taller 5 (IPD & MDP RL)")
    parser.add_argument("--host", default="127.0.0.1", help="Host de escucha (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8055, help="Puerto HTTP (default: 8055)")
    args = parser.parse_args()

    print("[Taller5Web] Pre-calentando tabla empírica MDP (N=173,130 transiciones)...", flush=True)
    freq = get_default_frequency_table()
    print(f"[Taller5Web] Tabla MDP lista ({freq.total_transitions:,} transiciones).", flush=True)

    global _BOOTSTRAP_CACHE
    session_store.initialize()
    _BOOTSTRAP_CACHE = get_bootstrap_payload()
    print("[Taller5Web] Datos iniciales y benchmarks del paper cacheados en RAM.", flush=True)

    server = ThreadingHTTPServer((args.host, args.port), Taller5Handler)
    print(f"[Taller5Web] Servidor corriendo en http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[Taller5Web] Servidor detenido.")
        server.server_close()


if __name__ == "__main__":
    main()
