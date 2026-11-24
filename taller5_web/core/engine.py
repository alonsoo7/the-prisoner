"""Core simulation, analytics, caching, custom strategy registry, and tournament engine for Taller 5."""

from __future__ import annotations

import session_store
from contextvars import copy_context
import re
import codecs
import io
import json
import math
import os
import selectors
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import unittest
import uuid
from pathlib import Path
from typing import Any, Callable

import axelrod as axl
import numpy as np

CORE_DIR = Path(__file__).resolve().parent
APP_DIR = CORE_DIR.parent
ROOT_DIR = APP_DIR.parent

if str(CORE_DIR) not in sys.path:
    sys.path.insert(0, str(CORE_DIR))

from ipd_mdp import (
    ACTION_C,
    ACTION_D,
    ACTION_LABELS,
    ACTIONS,
    C,
    D,
    PAYOFF,
    STATE_MAP,
    STATES,
    UNIFORM_PRIOR_P,
    BellmanResult,
    FrequencyTableResult,
    build_mdp_transition_matrix,
    build_training_pool,
    collect_frequency_table,
    compute_cumulative_avg_scores,
    solve_bellman,
)
from agents import (
    EmpiricalPolicyAgent,
    ForgettingTransitionRLAgent,
)
from plot_learning import (
    CooperateThenDefect,
    ThreePhaseRival,
    rolling_round_scores,
)
from generations import (
    CloudMiope,
    CustomMemory1Agent,
    CustomPhaseRival,
    ExpectimaxMarkovAgent,
    PYTHON_TEMPLATES,
    RulitoBellman,
    STATES_TUP,
    compile_custom_python_strategy,
)

CUSTOM_STRATEGIES_PATH = APP_DIR / "custom_strategies.json"
FREQ_CACHE_PATH = APP_DIR / "freq_cache.json"
RING_CACHE_PATH = APP_DIR / "axelrod_ring_cache.json"
PAPER_TOURNAMENTS_JSON = ROOT_DIR / "tournaments_10seeds_and_harper.json"

_PLAY_SESSIONS: dict[str, dict[str, Any]] = {}
_PLAY_LOCK = threading.Lock()
_RING_CACHE: dict[str, Any] | None = None

CONTEXT_KEYS: list[tuple[int, int]] = [(s, a) for s in range(4) for a in ACTIONS]
CONTEXT_LABELS: list[str] = [f"({STATES[s]}, {ACTION_LABELS[a]})" for s, a in CONTEXT_KEYS]

# Canonical semantic colors matching evolucion_agentes_taller5.ipynb & Taller 5 report
GEN_COLORS = {
    "gen1_cloud": "#d62728",
    "gen2_rulito": "#ef6c00",
    "gen3_gary": "#7b3fa0",
    "gen4_base": "#1565c0",
    "gen5_rl": "#2e7d32",
}

HARPER_CLASSES = [
    axl.EvolvedLookerUp2_2_2,
    axl.EvolvedANN5,
    axl.EvolvedFSM16,
    axl.PSOGambler2_2_2,
    axl.Winner12,
    axl.FoolMeOnce,
    axl.DBS,
    axl.ZDExtort2,
    axl.ZDGTFT2,
    axl.ZDSet2,
    axl.OmegaTFT,
    axl.OriginalGradual,
    axl.Gradual,
    axl.APavlov2006,
    axl.APavlov2011,
    axl.WinStayLoseShift,
    axl.MetaHunter,
    axl.Prober,
    axl.Prober2,
    axl.HardProber,
    axl.CyclerCCD,
    axl.CyclerDDC,
    axl.CyclerCCCD,
    axl.Bully,
    axl.Alternator,
    axl.TitForTat,
    axl.Grudger,
    axl.FirstByDavis,
    axl.FirstByJoss,
    axl.FirstByDowning,
    axl.FirstByShubik,
    axl.FirstByNydegger,
    axl.FirstByGrofman,
    axl.Defector,
    axl.Cooperator,
    axl.Random,
]

# Minimal comparative summary for Gary (Expectimax H=2 + Markov)
GARY_ABLATION_PAPER = {
    "benchmarks": [
        "Torneo Axelrod 1980\n(16 jugadores)",
        "Benchmark Harper 2017\n(37 jugadores)",
        "Mega-Torneo General\n(171 jugadores)",
    ],
    "series": [
        {
            "label": "3. Gary: Expectimax H=2 + Markov en Hojas",
            "color": "#7b3fa0",
            "values": [2.692, 2.854, 2.877],
        },
        {
            "label": "5. Mitcha (RL MDP con Olvido λ=0.90)",
            "color": "#2e7d32",
            "values": [2.650, 2.685, 2.795],
        },
    ],
}

# Paper verified lambda sweep (resultados_experimento.png panel 4, 5 reps, seed=42)
DEFAULT_LAMBDA_SWEEP_CACHE: dict[str, Any] | None = None
_FREQ_CACHE: dict[str, FrequencyTableResult] = {}
_CUSTOM_COMPILED_CACHE: dict[str, type[axl.Player]] = {}
_JOBS: dict[str, dict[str, Any]] = {}
_JOBS_LOCK = threading.Lock()


def _serialize_ctx_dict(d: dict[tuple[int, int], Any]) -> dict[str, Any]:
    return {f"{s}_{a}": v for (s, a), v in d.items()}


def _deserialize_ctx_dict(d: dict[str, Any], cast_fn: Callable = float) -> dict[tuple[int, int], Any]:
    out: dict[tuple[int, int], Any] = {}
    for k, v in d.items():
        s_str, a_str = k.split("_")
        out[(int(s_str), int(a_str))] = cast_fn(v)
    return out


def get_default_frequency_table() -> FrequencyTableResult:
    """Return cached 173,130-transition empirical frequency table from 30-strategy pool."""
    cache_key = "default_exact"
    if cache_key in _FREQ_CACHE:
        return _FREQ_CACHE[cache_key]

    if FREQ_CACHE_PATH.exists():
        try:
            raw = json.loads(FREQ_CACHE_PATH.read_text(encoding="utf-8"))
            counts_coop = _deserialize_ctx_dict(raw["counts_coop"], int)
            counts_total = _deserialize_ctx_dict(raw["counts_total"], int)
            p_coop = _deserialize_ctx_dict(raw["p_coop"], float)
            res = FrequencyTableResult(
                counts_coop=counts_coop,
                counts_total=counts_total,
                p_coop=p_coop,
                mdp_transitions=build_mdp_transition_matrix(p_coop),
                total_transitions=int(raw["total_transitions"]),
            )
            _FREQ_CACHE[cache_key] = res
            return res
        except Exception:
            pass

    res = collect_frequency_table(build_training_pool(), turns=200, repetitions=1, seed=42)
    _FREQ_CACHE[cache_key] = res
    try:
        FREQ_CACHE_PATH.write_text(
            json.dumps(
                {
                    "counts_coop": _serialize_ctx_dict(res.counts_coop),
                    "counts_total": _serialize_ctx_dict(res.counts_total),
                    "p_coop": _serialize_ctx_dict(res.p_coop),
                    "total_transitions": res.total_transitions,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
    except Exception:
        pass
    return res


def get_default_bellman(gamma: float = 0.90) -> BellmanResult:
    freq = get_default_frequency_table()
    return solve_bellman(freq.p_coop, gamma=gamma, tol=1e-6, max_iter=2000)


# =============================================================================
# CUSTOM STRATEGIES STORAGE & FACTORY RESOLUTION
# =============================================================================


def load_custom_strategies() -> list[dict[str, Any]]:
    return session_store.records()


def _build_custom_player(item: dict[str, Any], record_trace: bool = False) -> axl.Player:
    kind = item.get("kind")
    name = item.get("name", "Estrategia Personalizada")
    cfg = item.get("config", {})
    freq = get_default_frequency_table()

    if kind == "visual_mem1":
        return CustomMemory1Agent(
            first_move=cfg.get("first_move", "C"),
            probs=[
                float(cfg.get("p_cc", 1.0)),
                float(cfg.get("p_cd", 0.0)),
                float(cfg.get("p_dc", 1.0)),
                float(cfg.get("p_dd", 0.0)),
            ],
            player_name=name,
        )
    if kind == "visual_rl":
        use_uniform = bool(cfg.get("uniform_prior", False))
        custom_p_raw = cfg.get("prior_p")
        if use_uniform:
            prior_p = dict(UNIFORM_PRIOR_P)
        elif isinstance(custom_p_raw, dict) and len(custom_p_raw) == 8:
            prior_p = _deserialize_ctx_dict(custom_p_raw, float)
        else:
            prior_p = freq.p_coop
        return ForgettingTransitionRLAgent(
            prior_p=prior_p,
            gamma=float(cfg.get("gamma", 0.90)),
            initial_count=float(cfg.get("initial_count", 2.0)),
            forgetting_factor=float(cfg.get("forgetting_factor", 0.90)),
            player_name=name,
            record_trace=record_trace,
        )
    if kind == "visual_gary":
        return ExpectimaxMarkovAgent(
            horizon=int(cfg.get("horizon", 2)),
            gamma=float(cfg.get("gamma", 0.90)),
            use_markov_leaves=bool(cfg.get("use_markov_leaves", True)),
            player_name=name,
            record_trace=record_trace,
        )
    if kind == "visual_phase":
        return CustomPhaseRival(
            phases=cfg.get("phases", []),
            player_name=name,
        )
    if kind == "python_code":
        code = item.get("code", "")
        if code not in {template["code"] for template in PYTHON_TEMPLATES.values()}:
            raise ValueError("Elige una de las plantillas Python del taller.")
        cls, _ = compile_custom_python_strategy(code, display_name=name)
        inst = cls()
        inst.name = name
        return inst

    raise ValueError(f"Tipo de estrategia personalizada no reconocido: {kind}")


def build_strategy_catalog() -> list[dict[str, Any]]:
    """Return full structured catalog of all selectable strategies."""
    catalog: list[dict[str, Any]] = [
        # Group 1: 5 Generations of Taller 5
        {
            "id": "gen1_cloud",
            "name": "1. Cloud (Miope g=0)",
            "short": "1. Cloud",
            "group": "5 Generaciones de Agentes",
            "color": "#d62728",
            "traceable": True,
            "description": "Etapa I (Taller IV Sec. 7 — Cloud): Frecuentista miope (γ=0) con exploración alternante de 10 turnos. Colapsa al equilibrio de Nash (D,D).",
        },
        {
            "id": "gen2_rulito",
            "name": "2. Rulito (1-Step g=0.90)",
            "short": "2. Rulito",
            "group": "5 Generaciones de Agentes",
            "color": "#ef6c00",
            "traceable": True,
            "description": "Etapa II (Taller IV Sec. 8 — Rulito): Proyección Bellman 1-step (γ=0.90) sobre P(O_t | s_{t-1}) sin condicionar en A_t.",
        },
        {
            "id": "gen3_gary",
            "name": "3. Expectimax H=2 + Markov",
            "short": "3. Gary (Expectimax)",
            "group": "5 Generaciones de Agentes",
            "color": "#7b3fa0",
            "traceable": True,
            "description": "Etapa III (Gary): Expectimax H=2 (16 hojas, γ=0.90) con cierre terminal Markov (referencia de búsqueda).",
        },
        {
            "id": "gen4_base",
            "name": "4. Base MDP Fija (CDDC)",
            "short": "4. Base CDDC",
            "group": "5 Generaciones de Agentes",
            "color": "#1565c0",
            "traceable": False,
            "description": "Etapa IV (Agente Base): Política fija Pavlov (CDDC) emergente de la tabla 8×4 (N=173,130) + Value Iteration.",
        },
        {
            "id": "gen5_rl",
            "name": "5. Mitcha (RL Olvido)",
            "short": "5. Mitcha (RL)",
            "group": "5 Generaciones de Agentes",
            "color": "#2e7d32",
            "traceable": True,
            "description": "Etapa V (Final Taller 5 — Mitcha): RL online sobre matriz MDP 8×4 con contador efectivo n_k=λn_{k-1}+1 (n0=2.0, λ=0.90).",
        },
        # Group 2: Paper variants & ablations
        {
            "id": "rl_lam_070",
            "name": "RL Olvido (n0=2.0, lam=0.70)",
            "short": "RL λ=0.70",
            "group": "Variantes y Ablaciones",
            "color": "#00897b",
            "traceable": True,
            "description": "Olvido rápido (piso η_∞ = 0.30). Máxima velocidad de adaptación en cambios de régimen.",
        },
        {
            "id": "rl_lam_080",
            "name": "RL Olvido (n0=2.0, lam=0.80)",
            "short": "RL λ=0.80",
            "group": "Variantes y Ablaciones",
            "color": "#0d9488",
            "traceable": True,
            "description": "Olvido ágil (piso η_∞ = 0.20). Alcanza 2.955 pts/ronda en el rival de 3 fases C-D-C.",
        },
        {
            "id": "rl_lam_085",
            "name": "RL Olvido (n0=2.0, lam=0.85)",
            "short": "RL λ=0.85",
            "group": "Variantes y Ablaciones",
            "color": "#16a34a",
            "traceable": True,
            "description": "Balance intermedio (piso η_∞ = 0.15).",
        },
        {
            "id": "rl_lam_095",
            "name": "RL Olvido (n0=2.0, lam=0.95)",
            "short": "RL λ=0.95",
            "group": "Variantes y Ablaciones",
            "color": "#6a1b9a",
            "traceable": True,
            "description": "Memoria prolongada (piso η_∞ = 0.05, n_∞ = 20).",
        },
        {
            "id": "rl_lam_100",
            "name": "RL Sin Olvido (lam=1.00)",
            "short": "RL λ=1.00",
            "group": "Variantes y Ablaciones",
            "color": "#8e24aa",
            "traceable": True,
            "description": "Contador clásico acumulativo n_k = n_0 + k sin olvido (λ=1.00). Sufre rigidez asintótica (η_k → 0).",
        },
        {
            "id": "rl_no_prior",
            "name": "RL Sin Prior (0.50 uniforme)",
            "short": "RL Sin Prior",
            "group": "Variantes y Ablaciones",
            "color": "#64748b",
            "traceable": True,
            "description": "Mismo algoritmo RL con olvido pero iniciando desde matriz uniforme 0.50 (sin tabla supervisada).",
        },
        # Group 3: Controlled & Non-stationary Rivals (C2-C6)
        {
            "id": "rival_switch_50",
            "name": "CooperateThenDefect (C->D t=50)",
            "short": "Cambio C→D",
            "group": "Rivales No Estacionarios (C5-C6)",
            "color": "#b91c1c",
            "traceable": False,
            "description": "Condición C5: Coopera 50 turnos y luego traiciona indefinidamente (150 turnos).",
        },
        {
            "id": "rival_3phase",
            "name": "ThreePhaseRival (C 1-60, D 61-130, C 131-200)",
            "short": "3 Fases C-D-C",
            "group": "Rivales No Estacionarios (C5-C6)",
            "color": "#9333ea",
            "traceable": False,
            "description": "Condición C6: Coopera en Fase 1 (1..60), traiciona en Fase 2 (61..130), vuelve a cooperar en Fase 3 (131..200).",
        },
    ]

    # Group 4: Axelrod 1980 (15 classic strategies)
    seen_axl = set()
    for cls in axl.axelrod_first_strategies:
        sid = f"axl_{cls.__name__}"
        seen_axl.add(cls.__name__)
        inst = cls()
        catalog.append(
            {
                "id": sid,
                "name": inst.name,
                "short": inst.name.replace("First by ", ""),
                "group": "Axelrod 1980 (15 Clásicas)",
                "color": "#eab308" if cls.__name__ == "TitForTat" else "#64748b",
                "traceable": False,
                "description": f"Estrategia oficial del Primer Torneo de Axelrod (1980): {inst.name}.",
            }
        )

    # Group 5: Extra key archetypes & Harper 2017 strategies
    for cls in HARPER_CLASSES:
        if cls.__name__ in seen_axl:
            continue
        seen_axl.add(cls.__name__)
        inst = cls()
        is_trained = any(k in inst.name for k in ["Evolved", "PSO", "Winner", "DBS", "Fool"])
        catalog.append(
            {
                "id": f"axl_{cls.__name__}",
                "name": inst.name,
                "short": inst.name[:22],
                "group": "Harper et al. (2017) & Clásicas",
                "color": "#6A1B9A" if is_trained else "#475569",
                "traceable": False,
                "description": f"Estrategia del Benchmark de Harper et al. (2017): {inst.name}.",
            }
        )

    # Group 6: User Custom Strategies
    for item in load_custom_strategies():
        catalog.append(
            {
                "id": f"custom_{item['id']}",
                "name": item["name"],
                "short": item["name"][:22],
                "group": "Mis Estrategias Personalizadas",
                "color": item.get("color", "#0ea5e9"),
                "traceable": item.get("kind") in ("visual_rl", "visual_gary"),
                "description": item.get("description", f"Estrategia creada por el usuario ({item.get('kind')})."),
                "custom_meta": item,
            }
        )

    return catalog


def instantiate_strategy(
    strategy_id: str,
    params: dict[str, Any] | None = None,
    record_trace: bool = False,
) -> axl.Player:
    """Instantiate any built-in, Axelrod, Harper, or user custom strategy."""
    p = params or {}
    freq = get_default_frequency_table()
    bellman0 = get_default_bellman(0.90)

    if strategy_id == "gen1_cloud":
        return CloudMiope(
            exploration_turns=int(p.get("exploration_turns", 10)),
            record_trace=record_trace,
        )
    if strategy_id == "gen2_rulito":
        return RulitoBellman(
            gamma=float(p.get("gamma", 0.90)),
            exploration_turns=int(p.get("exploration_turns", 10)),
            record_trace=record_trace,
        )
    if strategy_id == "gen3_gary":
        return ExpectimaxMarkovAgent(
            horizon=int(p.get("horizon", 2)),
            gamma=float(p.get("gamma", 0.90)),
            use_markov_leaves=bool(p.get("use_markov_leaves", True)),
            record_trace=record_trace,
        )
    if strategy_id == "gen4_base":
        return EmpiricalPolicyAgent(
            policy=bellman0.policy,
            player_name="4. Base MDP Fija (CDDC)",
        )
    if strategy_id == "gen5_rl":
        return ForgettingTransitionRLAgent(
            prior_p=freq.p_coop,
            gamma=float(p.get("gamma", 0.90)),
            initial_count=float(p.get("initial_count", 2.0)),
            forgetting_factor=float(p.get("forgetting_factor", 0.90)),
            player_name="5. Mitcha (RL Olvido)",
            record_trace=record_trace,
        )
    if strategy_id == "rl_lam_070":
        return ForgettingTransitionRLAgent(
            prior_p=freq.p_coop,
            gamma=0.90,
            initial_count=2.0,
            forgetting_factor=0.70,
            player_name="RL Olvido (n0=2.0, lam=0.70)",
            record_trace=record_trace,
        )
    if strategy_id == "rl_lam_080":
        return ForgettingTransitionRLAgent(
            prior_p=freq.p_coop,
            gamma=0.90,
            initial_count=2.0,
            forgetting_factor=0.80,
            player_name="RL Olvido (n0=2.0, lam=0.80)",
            record_trace=record_trace,
        )
    if strategy_id == "rl_lam_085":
        return ForgettingTransitionRLAgent(
            prior_p=freq.p_coop,
            gamma=0.90,
            initial_count=2.0,
            forgetting_factor=0.85,
            player_name="RL Olvido (n0=2.0, lam=0.85)",
            record_trace=record_trace,
        )
    if strategy_id == "rl_lam_095":
        return ForgettingTransitionRLAgent(
            prior_p=freq.p_coop,
            gamma=0.90,
            initial_count=2.0,
            forgetting_factor=0.95,
            player_name="RL Olvido (n0=2.0, lam=0.95)",
            record_trace=record_trace,
        )
    if strategy_id == "rl_lam_100":
        return ForgettingTransitionRLAgent(
            prior_p=freq.p_coop,
            gamma=0.90,
            initial_count=2.0,
            forgetting_factor=1.00,
            player_name="RL Sin Olvido (lam=1.00)",
            record_trace=record_trace,
        )
    if strategy_id == "rl_no_prior":
        return ForgettingTransitionRLAgent(
            prior_p=None,
            gamma=0.90,
            initial_count=2.0,
            forgetting_factor=0.90,
            player_name="RL Sin Prior (0.50 uniforme)",
            record_trace=record_trace,
        )
    if strategy_id == "rival_switch_50":
        return CooperateThenDefect(switch_turn=int(p.get("switch_turn", 50)))
    if strategy_id == "rival_3phase":
        return ThreePhaseRival()

    if strategy_id.startswith("axl_"):
        cls_name = strategy_id[4:]
        cls = getattr(axl, cls_name, None)
        if cls is None:
            raise ValueError(f"Estrategia Axelrod desconocida: {cls_name}")
        return cls()

    if strategy_id.startswith("custom_"):
        cid = strategy_id[7:]
        for item in load_custom_strategies():
            if item.get("id") == cid:
                return _build_custom_player(item, record_trace=record_trace)
        raise ValueError(f"Estrategia personalizada no encontrada: {cid}")

    # Fallback: try direct axl attribute
    cls = getattr(axl, strategy_id, None)
    if cls is not None:
        return cls()
    raise ValueError(f"Estrategia desconocida: {strategy_id}")


# =============================================================================
# 1. MDP, BELLMAN & DEFECTOR TRACE (resultados_experimento.png)
# =============================================================================


def compute_mdp_payload(
    gamma: float = 0.90,
    initial_count: float = 2.0,
    forgetting_factor: float = 0.90,
    custom_p_coop: dict[str, float] | None = None,
    defector_turns: int = 30,
) -> dict[str, Any]:
    freq = get_default_frequency_table()
    if custom_p_coop and len(custom_p_coop) == 8:
        p_coop = {k: max(0.0, min(1.0, float(custom_p_coop[f"{k[0]}_{k[1]}"]))) for k in CONTEXT_KEYS}
    else:
        p_coop = dict(freq.p_coop)

    mdp_mat = build_mdp_transition_matrix(p_coop)
    bellman = solve_bellman(p_coop, gamma=gamma, tol=1e-6, max_iter=2000)

    # Trace vs Defector (Panel 3 of resultados_experimento.png)
    agent = ForgettingTransitionRLAgent(
        prior_p=p_coop,
        gamma=gamma,
        initial_count=initial_count,
        forgetting_factor=forgetting_factor,
        record_trace=True,
    )
    opp = axl.Defector()
    axl.Match((agent, opp), turns=defector_turns, seed=42).play()
    cum_avg = compute_cumulative_avg_scores(agent.history, opp.history)

    trace_rows = []
    for t in range(1, defector_turns + 1):
        snap = agent.trace_log[t - 1]
        eta_val = None
        ctx_label = "—"
        if t >= 3:
            prev_s = STATE_MAP[(agent.history[t - 3], opp.history[t - 3])]
            act_prev = ACTION_C if agent.history[t - 2] == C else ACTION_D
            eta_val = round(float(snap["etas"][(prev_s, act_prev)]), 4)
            ctx_label = f"({STATES[prev_s]}, {ACTION_LABELS[act_prev]}) → {opp.history[t-2].name}"
        trace_rows.append(
            {
                "turn": t,
                "my_move": agent.history[t - 1].name,
                "opp_move": opp.history[t - 1].name,
                "context_updated": ctx_label,
                "eta": eta_val,
                "p_dd_c": round(float(snap["probs"][(3, ACTION_C)]), 4),
                "p_cd_d": round(float(snap["probs"][(1, ACTION_D)]), 4),
                "delta_q_dd": round(float(snap["delta_q"][3]), 4),
                "policy": "".join(ACTION_LABELS[a] for a in snap["policy"]),
                "pi_dd": ACTION_LABELS[snap["policy"][3]],
                "iterations": int(snap.get("iterations", 0)),
                "cum_avg": round(float(cum_avg[t - 1]), 4),
            }
        )

    context_rows = []
    for (s, a), lbl in zip(CONTEXT_KEYS, CONTEXT_LABELS):
        row = mdp_mat[(s, a)]
        context_rows.append(
            {
                "key": f"{s}_{a}",
                "state_idx": s,
                "state": STATES[s],
                "action_idx": a,
                "action": ACTION_LABELS[a],
                "label": lbl,
                "coop": int(freq.counts_coop[(s, a)]),
                "total": int(freq.counts_total[(s, a)]),
                "p_coop": round(float(p_coop[(s, a)]), 4),
                "row": [round(float(row[i]), 4) for i in range(4)],
            }
        )

    bellman_rows = []
    for s_idx, s_name in enumerate(STATES):
        bellman_rows.append(
            {
                "state": s_name,
                "p_c": round(float(p_coop[(s_idx, ACTION_C)]), 4),
                "p_d": round(float(p_coop[(s_idx, ACTION_D)]), 4),
                "v_star": round(float(bellman.v_values[s_idx]), 4),
                "q_c": round(float(bellman.q_values[(s_idx, ACTION_C)]), 4),
                "q_d": round(float(bellman.q_values[(s_idx, ACTION_D)]), 4),
                "delta_q": round(float(bellman.delta_q[s_idx]), 4),
                "policy": ACTION_LABELS[bellman.policy[s_idx]],
            }
        )

    return {
        "total_transitions": freq.total_transitions,
        "gamma": gamma,
        "bellman_iterations": int(bellman.iterations),
        "initial_count": initial_count,
        "forgetting_factor": forgetting_factor,
        "policy_str": "".join(ACTION_LABELS[a] for a in bellman.policy),
        "contexts": context_rows,
        "bellman": bellman_rows,
        "defector_trace": trace_rows,
    }


def run_lambda_sweep_axelrod(
    initial_count: float = 2.0,
    gamma: float = 0.90,
    lambdas: list[float] | None = None,
    turns: int = 200,
    repetitions: int = 5,
    seed: int = 42,
) -> dict[str, Any]:
    """Reproduce Panel 4 of resultados_experimento.png live on Axelrod 1980."""
    lam_list = lambdas or [0.70, 0.80, 0.85, 0.90, 0.95, 1.0]
    freq = get_default_frequency_table()
    bellman0 = solve_bellman(freq.p_coop, gamma=gamma, tol=1e-6, max_iter=2000)

    def _eval_one(agent: axl.Player) -> tuple[dict[str, Any], dict[str, Any]]:
        players = [cls() for cls in axl.axelrod_first_strategies] + [agent.clone()]
        res = axl.Tournament(players=players, turns=turns, repetitions=repetitions, seed=seed).play(
            progress_bar=False
        )
        rows = []
        for idx, pl in enumerate(players):
            ns = res.normalised_scores[idx]
            rows.append(
                {
                    "name": pl.name,
                    "mean": float(np.mean(ns)),
                    "std": float(np.std(ns)),
                }
            )
        rows.sort(key=lambda r: r["mean"], reverse=True)
        for rk, r in enumerate(rows, 1):
            r["rank"] = rk
        our = next(r for r in rows if r["name"] == agent.name)
        tft = next(r for r in rows if r["name"] == "Tit For Tat")
        return our, tft

    bars: list[dict[str, Any]] = []
    # Sin Prior (0.50)
    ag_noprior = ForgettingTransitionRLAgent(
        prior_p=None,
        gamma=gamma,
        initial_count=initial_count,
        forgetting_factor=0.90,
        player_name="Sin Prior (0.50)",
    )
    r_np, _ = _eval_one(ag_noprior)
    bars.append(
        {
            "label": "Sin Prior\n(0.50)",
            "mean": round(r_np["mean"], 4),
            "std": round(r_np["std"], 4),
            "rank": r_np["rank"],
            "color": "#78909c",
        }
    )

    palette = ["#42a5f5", "#00897b", "#2e7d32", "#1565c0", "#6a1b9a", "#8d6e63"]
    tft_ref = None
    for idx, lam in enumerate(lam_list):
        ag = ForgettingTransitionRLAgent(
            prior_p=freq.p_coop,
            gamma=gamma,
            initial_count=initial_count,
            forgetting_factor=float(lam),
            player_name=f"RL lam={lam:.2f}",
        )
        r_lam, tft = _eval_one(ag)
        if abs(lam - 0.90) < 1e-6 or tft_ref is None:
            tft_ref = tft
        bars.append(
            {
                "label": f"lam={lam:.2f}" if lam < 1.0 else "lam=1.0\n(sin olvido)",
                "mean": round(r_lam["mean"], 4),
                "std": round(r_lam["std"], 4),
                "rank": r_lam["rank"],
                "color": palette[idx % len(palette)],
            }
        )

    ag_fixed = EmpiricalPolicyAgent(policy=bellman0.policy, player_name="Fija CDDC")
    r_fix, _ = _eval_one(ag_fixed)
    bars.append(
        {
            "label": "Fija\n(eta=0)",
            "mean": round(r_fix["mean"], 4),
            "std": round(r_fix["std"], 4),
            "rank": r_fix["rank"],
            "color": "#ef6c00",
        }
    )
    if tft_ref is not None:
        bars.append(
            {
                "label": "Tit For\nTat",
                "mean": round(tft_ref["mean"], 4),
                "std": round(tft_ref["std"], 4),
                "rank": tft_ref["rank"],
                "color": "#eab308",
            }
        )

    return {
        "initial_count": initial_count,
        "gamma": gamma,
        "repetitions": repetitions,
        "seed": seed,
        "bars": bars,
    }


# =============================================================================
# 2. EVOLUTION SUITE (5 GENERACIONES)
# =============================================================================


def run_evolution_suite(turns: int = 200, repetitions: int = 5, seed: int = 42, include_axelrod: bool = True) -> dict[str, Any]:
    """Reproduce the 5-generation evolution panels live."""
    gen_ids = ["gen1_cloud", "gen2_rulito", "gen3_gary", "gen4_base", "gen5_rl"]
    short_labels = {
        "gen1_cloud": "1. Cloud\n(Miope g=0)",
        "gen2_rulito": "2. Rulito\n(1-Step g=0.9)",
        "gen3_gary": "3. Expectimax\nH=2 + Markov",
        "gen4_base": "4. Base MDP\nFija (CDDC)",
        "gen5_rl": "5. Mitcha\n(RL Olvido)",
    }

    # Panel 1: Axelrod 1980 (5 reps)
    axelrod_bars = []
    if include_axelrod:
        for gid in gen_ids:
            ag = instantiate_strategy(gid)
            players = [cls() for cls in axl.axelrod_first_strategies] + [ag.clone()]
            res = axl.Tournament(players=players, turns=turns, repetitions=repetitions, seed=seed).play(
                progress_bar=False
            )
            rows = []
            for idx, pl in enumerate(players):
                ns = res.normalised_scores[idx]
                rows.append((pl.name, float(np.mean(ns)), float(np.std(ns))))
            rows.sort(key=lambda x: x[1], reverse=True)
            rk = next(i + 1 for i, r in enumerate(rows) if r[0] == ag.name)
            val = next(r for r in rows if r[0] == ag.name)
            axelrod_bars.append(
                {
                    "id": gid,
                    "name": ag.name,
                    "short": short_labels[gid],
                    "color": GEN_COLORS[gid],
                    "mean": round(val[1], 4),
                    "std": round(val[2], 4),
                    "rank": rk,
                }
            )
    else:
        # Verified fast baseline (seed=42, 5 reps, tol=1e-6)
        paper_vals = [
            ("gen1_cloud", "1. Cloud (Miope g=0)", 1.938, 0.013, 11),
            ("gen2_rulito", "2. Rulito (1-Step g=0.90)", 2.468, 0.025, 6),
            ("gen3_gary", "3. Expectimax H=2 + Markov", 2.652, 0.073, 1),
            ("gen4_base", "4. Base MDP Fija (CDDC)", 2.559, 0.018, 3),
            ("gen5_rl", "5. Mitcha (RL Olvido)", 2.662, 0.024, 1),
        ]
        for gid, nm, m, s, rk in paper_vals:
            axelrod_bars.append(
                {
                    "id": gid,
                    "name": nm,
                    "short": short_labels[gid],
                    "color": GEN_COLORS[gid],
                    "mean": m,
                    "std": s,
                    "rank": rk,
                }
            )

    # Panel 2: Cumulative points vs Grudger
    grudger_series = []
    for gid in gen_ids:
        ag = instantiate_strategy(gid)
        opp = axl.Grudger()
        axl.Match((ag, opp), turns=turns, seed=seed).play()
        pts = np.cumsum(
            [
                PAYOFF[(ACTION_C if x == C else ACTION_D, ACTION_C if y == C else ACTION_D)]
                for x, y in zip(ag.history, opp.history)
            ]
        )
        grudger_series.append(
            {
                "id": gid,
                "name": ag.name,
                "color": GEN_COLORS[gid],
                "dashed": gid == "gen4_base",
                "final_total": int(pts[-1]),
                "values": [float(v) for v in pts],
            }
        )

    # Panel 3: Cumulative average vs Defector
    defector_series = []
    for gid in gen_ids:
        ag = instantiate_strategy(gid)
        opp = axl.Defector()
        axl.Match((ag, opp), turns=turns, seed=seed).play()
        avgs = compute_cumulative_avg_scores(ag.history, opp.history)
        defector_series.append(
            {
                "id": gid,
                "name": ag.name,
                "color": GEN_COLORS[gid],
                "dashed": gid == "gen4_base",
                "final_avg": round(float(avgs[-1]), 4),
                "values": [round(float(v), 4) for v in avgs],
            }
        )

    # Panel 4: Grouped bars across 6 experimental 1v1 conditions
    conds = [
        ("TitForTat", lambda: axl.TitForTat()),
        ("Grudger", lambda: axl.Grudger()),
        ("Defector", lambda: axl.Defector()),
        ("Alternator", lambda: axl.Alternator()),
        ("Cambio C->D", lambda: CooperateThenDefect(50)),
        ("3 Fases C-D-C", lambda: ThreePhaseRival()),
    ]
    cond_matrix: dict[str, dict[str, float]] = {}
    for gid in gen_ids:
        cond_matrix[gid] = {}
        for cname, opp_fn in conds:
            ag = instantiate_strategy(gid)
            opp = opp_fn()
            axl.Match((ag, opp), turns=turns, seed=seed).play()
            av = compute_cumulative_avg_scores(ag.history, opp.history)[-1]
            cond_matrix[gid][cname] = round(float(av), 3)

    return {
        "turns": turns,
        "repetitions": repetitions,
        "seed": seed,
        "tft_reference": 2.560,
        "axelrod_bars": axelrod_bars,
        "grudger_series": grudger_series,
        "defector_series": defector_series,
        "conditions": [c[0] for c in conds],
        "condition_scores": cond_matrix,
    }


# =============================================================================
# 3. ONLINE LEARNING CURVES (aprendizaje_olvido.png & aprendizaje_detalle_rl.png)
# =============================================================================


def run_online_learning_suite(
    initial_count: float = 2.0,
    default_lambda: float = 0.90,
    lambdas_compare: list[float] | None = None,
    gamma: float = 0.90,
    switch_turn: int = 50,
    phase1_end: int = 60,
    phase2_end: int = 130,
    rolling_window: int = 15,
    matrix_rival_id: str = "axl_Alternator",
    seed: int = 42,
) -> dict[str, Any]:
    """Reproduce ALL 8 panels of aprendizaje_olvido.png & aprendizaje_detalle_rl.png live."""
    freq = get_default_frequency_table()
    bellman0 = solve_bellman(freq.p_coop, gamma=gamma, tol=1e-6, max_iter=2000)
    lam_cmp = lambdas_compare or [0.70, 0.85, 0.90, 1.00]
    lam_colors = {0.70: "#00897b", 0.80: "#00897b", 0.85: "#2e7d32", 0.90: "#1565c0", 0.95: "#6a1b9a", 1.00: "#8e24aa"}

    def _color_for(lam: float, idx: int) -> str:
        fallback = ["#00897b", "#2e7d32", "#1565c0", "#8e24aa", "#ef6c00"]
        for k, col in lam_colors.items():
            if abs(lam - k) < 1e-6:
                return col
        return fallback[idx % len(fallback)]

    # Panel A1: P_t(C | DD, C) vs Defector (turns 1..35) + star at first D in pi_t[DD]
    defector_speed = []
    # Panel A2: C->D regime switch at switch_turn (turns 1..200)
    switch_curves = []

    fixed_ag = EmpiricalPolicyAgent(policy=bellman0.policy)
    fixed_opp = CooperateThenDefect(switch_turn=switch_turn)
    axl.Match((fixed_ag, fixed_opp), turns=200, seed=seed).play()
    fixed_sw_scores = compute_cumulative_avg_scores(fixed_ag.history, fixed_opp.history)
    switch_curves.append(
        {
            "label": f"Política Fija CDDC (final {fixed_sw_scores[-1]:.3f})",
            "color": "#d32f2f",
            "dashed": True,
            "final": round(float(fixed_sw_scores[-1]), 4),
            "values": [round(float(v), 4) for v in fixed_sw_scores],
        }
    )

    for idx, lam in enumerate(lam_cmp):
        col = _color_for(lam, idx)
        # Defector speed
        ag_d = ForgettingTransitionRLAgent(
            prior_p=freq.p_coop,
            gamma=gamma,
            initial_count=initial_count,
            forgetting_factor=lam,
            record_trace=True,
        )
        axl.Match((ag_d, axl.Defector()), turns=200, seed=seed).play()
        p_dd_c = [round(float(s["probs"][(3, ACTION_C)]), 4) for s in ag_d.trace_log[:35]]
        pol_dd = [s["policy"][3] for s in ag_d.trace_log[:35]]
        first_d_idx = next((i for i, a in enumerate(pol_dd) if a == ACTION_D), None)
        defector_speed.append(
            {
                "lam": lam,
                "label": f"λ = {lam:.2f}" + (" (sin olvido)" if abs(lam - 1.0) < 1e-6 else f" (η_∞={1-lam:.2f})"),
                "color": col,
                "values": p_dd_c,
                "first_d_turn": (first_d_idx + 1) if first_d_idx is not None else None,
                "first_d_val": p_dd_c[first_d_idx] if first_d_idx is not None else None,
            }
        )

        # Regime switch C->D
        ag_sw = ForgettingTransitionRLAgent(
            prior_p=freq.p_coop,
            gamma=gamma,
            initial_count=initial_count,
            forgetting_factor=lam,
            record_trace=True,
        )
        opp_sw = CooperateThenDefect(switch_turn=switch_turn)
        axl.Match((ag_sw, opp_sw), turns=200, seed=seed).play()
        sc_sw = compute_cumulative_avg_scores(ag_sw.history, opp_sw.history)
        switch_curves.append(
            {
                "lam": lam,
                "label": f"λ={lam:.2f} (final {sc_sw[-1]:.3f})",
                "color": col,
                "dashed": False,
                "final": round(float(sc_sw[-1]), 4),
                "values": [round(float(v), 4) for v in sc_sw],
            }
        )

    # Panel A3 & A4: 4 archetypes (60 turns) -> learned probs & 40-turn policy mutation heatmap
    rivals_4 = [
        ("Cooperator", axl.Cooperator()),
        ("Alternator", axl.Alternator()),
        ("Random", axl.Random()),
        ("Defector", axl.Defector()),
    ]
    rival_agents: dict[str, ForgettingTransitionRLAgent] = {}
    for rname, ropp in rivals_4:
        ag = ForgettingTransitionRLAgent(
            prior_p=freq.p_coop,
            gamma=gamma,
            initial_count=initial_count,
            forgetting_factor=default_lambda,
            record_trace=True,
        )
        axl.Match((ag, ropp.clone()), turns=60, seed=seed).play()
        rival_agents[rname] = ag

    archetype_specs = [
        ("vs Cooperator: P(C | CC, C)", "Cooperator", (0, ACTION_C), "#2e7d32", False),
        ("vs Alternator: P(C | CD, D)", "Alternator", (1, ACTION_D), "#0277bd", False),
        ("vs Alternator: P(C | DC, C)", "Alternator", (2, ACTION_C), "#0277bd", True),
        ("vs Random: P(C | CC, C)", "Random", (0, ACTION_C), "#ef6c00", False),
        ("vs Defector: P(C | DD, C)", "Defector", (3, ACTION_C), "#c62828", False),
    ]
    archetype_curves = []
    for label, rkey, ctx, col, dashed in archetype_specs:
        ag = rival_agents[rkey]
        archetype_curves.append(
            {
                "label": label,
                "color": col,
                "dashed": dashed,
                "values": [round(float(s["probs"][ctx]), 4) for s in ag.trace_log[:60]],
            }
        )

    policy_heatmap_rows = []
    for rname, _ in rivals_4:
        ag = rival_agents[rname]
        for s_idx, s_name in enumerate(STATES):
            policy_heatmap_rows.append(
                {
                    "label": f"{rname[:4]}: {s_name}",
                    "rival": rname,
                    "state": s_name,
                    "values": [int(ag.trace_log[t]["policy"][s_idx]) for t in range(40)],
                }
            )

    # Panel B1: Variable learning rate eta_k = 1 / n_k (k=1..25)
    eta_curves = []
    for idx, lam in enumerate(lam_cmp):
        n_val = initial_count
        vals = []
        for _ in range(25):
            n_val = lam * n_val + 1.0
            vals.append(round(1.0 / n_val, 4))
        eta_curves.append(
            {
                "lam": lam,
                "label": f"λ={lam:.2f} (piso η={1-lam:.2f})" if lam < 1.0 else "λ=1.00 (η → 0, sin olvido)",
                "color": _color_for(lam, idx),
                "floor": round(1.0 - lam, 4) if lam < 1.0 else None,
                "values": vals,
            }
        )

    # Panel B2: DeltaQ_t(s) vs matrix_rival (default Alternator, 60 turns)
    mat_rival = instantiate_strategy(matrix_rival_id)
    ag_mat = ForgettingTransitionRLAgent(
        prior_p=freq.p_coop,
        gamma=gamma,
        initial_count=initial_count,
        forgetting_factor=default_lambda,
        record_trace=True,
    )
    axl.Match((ag_mat, mat_rival), turns=60, seed=seed).play()

    state_colors = ["#2e7d32", "#1565c0", "#ef6c00", "#8e24aa"]
    delta_q_curves = [
        {
            "state": s_name,
            "label": f"ΔQ_t({s_name})",
            "color": state_colors[s_idx],
            "values": [round(float(s["delta_q"][s_idx]), 4) for s in ag_mat.trace_log[:60]],
        }
        for s_idx, s_name in enumerate(STATES)
    ]

    # Panel B3: 3-phase rolling window score (C -> D -> C)
    phase_rival_factory = lambda: CustomPhaseRival(
        phases=[
            {"until": phase1_end, "mode": "C"},
            {"until": phase2_end, "mode": "D"},
            {"until": 200, "mode": "C"},
        ],
        player_name="ThreePhaseRival",
    )
    phase_specs = [
        ("Fija CDDC", "#d32f2f", True, EmpiricalPolicyAgent(policy=bellman0.policy)),
        (
            "λ=1.00 (sin olvido)",
            "#8e24aa",
            False,
            ForgettingTransitionRLAgent(
                prior_p=freq.p_coop, gamma=gamma, initial_count=initial_count, forgetting_factor=1.0
            ),
        ),
        (
            f"λ={default_lambda:.2f}",
            "#1565c0",
            False,
            ForgettingTransitionRLAgent(
                prior_p=freq.p_coop, gamma=gamma, initial_count=initial_count, forgetting_factor=default_lambda
            ),
        ),
        (
            "λ=0.80",
            "#00897b",
            False,
            ForgettingTransitionRLAgent(
                prior_p=freq.p_coop, gamma=gamma, initial_count=initial_count, forgetting_factor=0.80
            ),
        ),
    ]
    phase_curves = []
    for label, col, dashed, ag in phase_specs:
        opp = phase_rival_factory()
        axl.Match((ag, opp), turns=200, seed=seed).play()
        roll = rolling_round_scores(ag.history, opp.history, window=rolling_window)
        mean_total = compute_cumulative_avg_scores(ag.history, opp.history)[-1]
        # Phase 3 average
        p3_pts = [
            PAYOFF[(ACTION_C if a == C else ACTION_D, ACTION_C if o == C else ACTION_D)]
            for a, o in zip(ag.history[phase2_end:], opp.history[phase2_end:])
        ]
        p3_mean = sum(p3_pts) / max(1, len(p3_pts))
        phase_curves.append(
            {
                "label": f"{label} ({mean_total:.3f})",
                "color": col,
                "dashed": dashed,
                "mean_total": round(float(mean_total), 4),
                "phase3_mean": round(float(p3_mean), 4),
                "values": [round(float(v), 4) for v in roll],
            }
        )

    # Panel B4: 8x4 matrix T_0 vs T_60 against matrix_rival
    t0_mat = build_mdp_transition_matrix(freq.p_coop)
    t60_mat = ag_mat.mdp_transitions
    matrix_before = [[round(float(t0_mat[k][j]), 3) for j in range(4)] for k in CONTEXT_KEYS]
    matrix_after = [[round(float(t60_mat[k][j]), 3) for j in range(4)] for k in CONTEXT_KEYS]

    return {
        "params": {
            "initial_count": initial_count,
            "default_lambda": default_lambda,
            "gamma": gamma,
            "switch_turn": switch_turn,
            "phase1_end": phase1_end,
            "phase2_end": phase2_end,
            "rolling_window": rolling_window,
            "matrix_rival_name": mat_rival.name,
        },
        "defector_speed": defector_speed,
        "switch_curves": switch_curves,
        "archetype_curves": archetype_curves,
        "policy_heatmap": policy_heatmap_rows,
        "eta_curves": eta_curves,
        "delta_q_curves": delta_q_curves,
        "phase_curves": phase_curves,
        "matrix_context_labels": CONTEXT_LABELS,
        "matrix_before": matrix_before,
        "matrix_after": matrix_after,
    }


# =============================================================================
# 4. GARY EXPECTIMAX + MARKOV DYNAMICS (REFERENCIA HEURISTICA)
# =============================================================================


def run_gary_dynamics(
    horizon: int = 2,
    gamma: float = 0.90,
    rival_id: str = "axl_FirstByJoss",
    turns: int = 200,
    seed: int = 42,
) -> dict[str, Any]:
    """Simulate Expectimax H=2 + Markov dynamics and turn-by-turn root values."""
    l_gamma = 1.0 / max(1e-6, (1.0 - gamma))
    t_arr = list(range(1, turns + 1))
    w_fut = [round(100.0 * l_gamma / (t + l_gamma), 3) for t in t_arr]
    w_pas = [round(100.0 * t / (t + l_gamma), 3) for t in t_arr]

    # Root evaluation f_t(C) vs f_t(D) against TitForTat + Cloud collapse reference
    gary_tft = ExpectimaxMarkovAgent(horizon=horizon, gamma=gamma, record_trace=True)
    axl.Match((gary_tft, axl.TitForTat()), turns=turns, seed=seed).play()
    cloud_tft = CloudMiope(exploration_turns=10, record_trace=True)
    axl.Match((cloud_tft, axl.TitForTat()), turns=turns, seed=seed).play()

    f_c_tft = [round(float(s["f_c"]), 4) for s in gary_tft.trace_log]
    f_d_tft = [round(float(s["f_d"]), 4) for s in gary_tft.trace_log]
    cloud_qd_tft = [round(float(s["q_d"]), 4) for s in cloud_tft.trace_log]

    # Panel 3: Frequentist E_t vector vs selected rival (default Joss)
    rival = instantiate_strategy(rival_id)
    gary_riv = ExpectimaxMarkovAgent(horizon=horizon, gamma=gamma, record_trace=True)
    axl.Match((gary_riv, rival), turns=turns, seed=seed).play()
    avgs_riv = compute_cumulative_avg_scores(gary_riv.history, rival.history)

    e_cc = [round(float(s["E"][0]), 4) for s in gary_riv.trace_log]
    e_cd = [round(float(s["E"][1]), 4) for s in gary_riv.trace_log]
    e_dc = [round(float(s["E"][2]), 4) for s in gary_riv.trace_log]
    e_dd = [round(float(s["E"][3]), 4) for s in gary_riv.trace_log]
    v_markov_hist = [[round(x, 3) for x in s["v_markov"]] for s in gary_riv.trace_log]
    f_c_riv = [round(float(s["f_c"]), 4) for s in gary_riv.trace_log]
    f_d_riv = [round(float(s["f_d"]), 4) for s in gary_riv.trace_log]

    round_scores_gary = [
        PAYOFF[(ACTION_C if a == C else ACTION_D, ACTION_C if o == C else ACTION_D)]
        for a, o in zip(gary_riv.history, rival.history)
    ]
    steps_detailed = []
    for idx, snap in enumerate(gary_riv.trace_log):
        item = dict(snap)
        item["my_move"] = gary_riv.history[idx].name
        item["opp_move"] = rival.history[idx].name
        item["outcome_state"] = f"{gary_riv.history[idx].name}{rival.history[idx].name}"
        item["round_score"] = round_scores_gary[idx]
        item["cum_avg"] = round(float(avgs_riv[idx]), 4)
        steps_detailed.append(item)

    return {
        "horizon": horizon,
        "leaves_count": 4**horizon,
        "gamma": gamma,
        "effective_horizon": round(l_gamma, 2),
        "turns": turns,
        "rival_name": rival.name,
        "rival_final_avg": round(float(avgs_riv[-1]), 4),
        "horizon_weights": {"w_fut": w_fut, "w_pas": w_pas},
        "root_vs_tft": {
            "f_c": f_c_tft,
            "f_d": f_d_tft,
            "cloud_qd": cloud_qd_tft,
            "mean_f_c": round(float(np.mean(f_c_tft)), 3),
            "mean_f_d": round(float(np.mean(f_d_tft[1:])), 3) if len(f_d_tft) > 1 else 1.2,
        },
        "e_vector_vs_rival": {
            "e_cc": e_cc,
            "e_cd": e_cd,
            "e_dc": e_dc,
            "e_dd": e_dd,
            "v_markov": v_markov_hist,
            "f_c": f_c_riv,
            "f_d": f_d_riv,
            "moves_gary": [m.name for m in gary_riv.history],
            "moves_rival": [m.name for m in rival.history],
            "steps": steps_detailed,
        },
        "ablation": GARY_ABLATION_PAPER,
    }


# =============================================================================
# 5. DUEL ANALYZER (1v1 TURN-BY-TURN TELEMETRY) & HEAD-TO-HEAD MATRIX
# =============================================================================


def _compute_t_est(my_hist: list[axl.Action], opp_hist: list[axl.Action]) -> int | None:
    """
    First turn t (1-indexed) from which the agent plays D without ever being exploited (C, D) again,
    computed only when the agent experienced at least one exploitation (C, D).
    """
    sucker_turns = [i + 1 for i, (a, o) in enumerate(zip(my_hist, opp_hist)) if a == C and o == D]
    if not sucker_turns:
        return None
    last_sucker = sucker_turns[-1]
    if last_sucker >= len(my_hist):
        return None
    # First D after last sucker
    for t_idx in range(last_sucker, len(my_hist)):
        if my_hist[t_idx] == D:
            # Verify stays defended (no more C,D) — already guaranteed since > last_sucker
            return t_idx + 1
    return None


def _extract_agent_trace(agent: axl.Player) -> dict[str, Any] | None:
    trace_log = getattr(agent, "trace_log", None)
    if not trace_log:
        return None

    first = trace_log[0]
    if "probs" in first:
        # MDP RL agent (Forgetting RL)
        gamma = float(getattr(agent, "gamma", 0.90))
        turns_out = []
        for snap in trace_log:
            probs = snap["probs"]
            mat = build_mdp_transition_matrix(probs)
            b_res = solve_bellman(probs, gamma=gamma, tol=1e-6, max_iter=2000)
            turns_out.append(
                {
                    "probs": {f"{s}_{a}": round(float(probs[(s, a)]), 4) for s, a in CONTEXT_KEYS},
                    "delta_q": [round(float(x), 4) for x in snap["delta_q"]],
                    "q_c": [round(float(b_res.q_values[(s, ACTION_C)]), 3) for s in range(4)],
                    "q_d": [round(float(b_res.q_values[(s, ACTION_D)]), 3) for s in range(4)],
                    "v_star": [round(float(v), 3) for v in b_res.v_values],
                    "policy": [int(x) for x in snap["policy"]],
                    "policy_str": "".join(ACTION_LABELS[x] for x in snap["policy"]),
                    "iterations": int(snap.get("iterations", b_res.iterations)),
                    "effective_counts": {
                        f"{s}_{a}": round(float(snap["effective_counts"][(s, a)]), 3)
                        for s, a in CONTEXT_KEYS
                    }
                    if "effective_counts" in snap
                    else None,
                    "etas": {
                        f"{s}_{a}": round(float(snap["etas"][(s, a)]), 4) for s, a in CONTEXT_KEYS
                    }
                    if "etas" in snap
                    else None,
                    "matrix": [[round(float(mat[k][j]), 3) for j in range(4)] for k in CONTEXT_KEYS],
                }
            )
        return {"kind": "mdp_rl", "turns": turns_out}

    if first.get("kind") == "gary":
        return {"kind": "gary", "turns": trace_log}

    if first.get("kind") in ("rulito", "cloud"):
        return {"kind": first["kind"], "turns": trace_log}

    return None


def run_duel_analysis(
    agent_a_id: str,
    agent_b_id: str,
    params_a: dict[str, Any] | None = None,
    params_b: dict[str, Any] | None = None,
    turns: int = 200,
    seed: int = 42,
    rolling_window: int = 15,
) -> dict[str, Any]:
    """Run any 1v1 duel and return comprehensive turn-by-turn telemetry."""
    pa = instantiate_strategy(agent_a_id, params=params_a, record_trace=True)
    pb = instantiate_strategy(agent_b_id, params=params_b, record_trace=True)

    axl.Match((pa, pb), turns=turns, seed=seed).play()

    moves_a = [m.name for m in pa.history]
    moves_b = [m.name for m in pb.history]

    round_a: list[float] = []
    round_b: list[float] = []
    states_seq: list[str] = []
    state_counts = {"CC": 0, "CD": 0, "DC": 0, "DD": 0}

    for ma, mb in zip(pa.history, pb.history):
        aa = ACTION_C if ma == C else ACTION_D
        ab = ACTION_C if mb == C else ACTION_D
        round_a.append(PAYOFF[(aa, ab)])
        round_b.append(PAYOFF[(ab, aa)])
        st = f"{ma.name}{mb.name}"
        states_seq.append(st)
        state_counts[st] += 1

    cum_total_a = [float(x) for x in np.cumsum(round_a)]
    cum_total_b = [float(x) for x in np.cumsum(round_b)]
    cum_avg_a = [round(x / (i + 1), 4) for i, x in enumerate(cum_total_a)]
    cum_avg_b = [round(x / (i + 1), 4) for i, x in enumerate(cum_total_b)]
    roll_a = [round(float(x), 4) for x in rolling_round_scores(pa.history, pb.history, window=rolling_window)]
    roll_b = [round(float(x), 4) for x in rolling_round_scores(pb.history, pa.history, window=rolling_window)]

    l100_slice = min(100, turns)
    last100_a = sum(round_a[-l100_slice:]) / l100_slice
    last100_b = sum(round_b[-l100_slice:]) / l100_slice

    return {
        "turns": turns,
        "seed": seed,
        "rolling_window": rolling_window,
        "player_a": {
            "id": agent_a_id,
            "name": pa.name,
            "mean_score": round(cum_avg_a[-1], 4),
            "total_score": int(cum_total_a[-1]),
            "last100_score": round(last100_a, 4),
            "coop_rate": round(100.0 * sum(1 for m in moves_a if m == "C") / turns, 2),
            "n_sucker": state_counts["CD"],
            "t_est": _compute_t_est(pa.history, pb.history),
            "moves": moves_a,
            "round_scores": round_a,
            "cum_total": cum_total_a,
            "cum_avg": cum_avg_a,
            "rolling_avg": roll_a,
            "trace": _extract_agent_trace(pa),
        },
        "player_b": {
            "id": agent_b_id,
            "name": pb.name,
            "mean_score": round(cum_avg_b[-1], 4),
            "total_score": int(cum_total_b[-1]),
            "last100_score": round(last100_b, 4),
            "coop_rate": round(100.0 * sum(1 for m in moves_b if m == "C") / turns, 2),
            "n_sucker": state_counts["DC"],
            "t_est": _compute_t_est(pb.history, pa.history),
            "moves": moves_b,
            "round_scores": round_b,
            "cum_total": cum_total_b,
            "cum_avg": cum_avg_b,
            "rolling_avg": roll_b,
            "trace": _extract_agent_trace(pb),
        },
        "states": states_seq,
        "state_counts": state_counts,
    }


def run_h2h_matrix(strategy_ids: list[str], turns: int = 200, seed: int = 42) -> dict[str, Any]:
    """Compute NxN pairwise payoff and cooperation matrix for instant duel exploration."""
    n = len(strategy_ids)
    names = [instantiate_strategy(sid).name for sid in strategy_ids]
    payoffs = [[0.0 for _ in range(n)] for _ in range(n)]
    coops = [[0.0 for _ in range(n)] for _ in range(n)]

    for i in range(n):
        for j in range(i, n):
            p1 = instantiate_strategy(strategy_ids[i])
            p2 = instantiate_strategy(strategy_ids[j])
            pair_seed = seed * 1000 + i * 37 + j
            axl.Match((p1, p2), turns=turns, seed=pair_seed).play()
            a1 = compute_cumulative_avg_scores(p1.history, p2.history)[-1]
            a2 = compute_cumulative_avg_scores(p2.history, p1.history)[-1]
            c1 = 100.0 * sum(1 for m in p1.history if m == C) / turns
            c2 = 100.0 * sum(1 for m in p2.history if m == C) / turns
            payoffs[i][j] = round(float(a1), 3)
            payoffs[j][i] = round(float(a2), 3)
            coops[i][j] = round(float(c1), 1)
            coops[j][i] = round(float(c2), 1)

    row_means = [
        round(float(sum(payoffs[i][j] for j in range(n) if j != i) / max(1, n - 1)), 3)
        for i in range(n)
    ]
    return {
        "strategy_ids": strategy_ids,
        "names": names,
        "payoffs": payoffs,
        "coops": coops,
        "row_means": row_means,
        "turns": turns,
        "seed": seed,
    }


# =============================================================================
# 6. LIVE TOURNAMENT RUNNER (BACKGROUND THREAD WITH PROGRESS)
# =============================================================================


def load_verified_paper_tournaments() -> dict[str, Any] | None:
    if not get_script_output(PAPER_TOURNAMENTS_JSON.name).exists():
        return None
    try:
        return json.loads(get_script_output(PAPER_TOURNAMENTS_JSON.name).read_text(encoding="utf-8"))
    except Exception:
        return None


def _resolve_tournament_pool(preset: str, selected_ids: list[str]) -> list[tuple[str, Callable[[], axl.Player]]]:
    entries: list[tuple[str, Callable[[], axl.Player]]] = []
    seen_ids: set[str] = set()

    def _add(sid: str):
        if sid not in seen_ids:
            seen_ids.add(sid)
            entries.append((sid, lambda s=sid: instantiate_strategy(s)))

    for sid in selected_ids:
        _add(sid)

    if preset == "axelrod1980":
        for cls in axl.axelrod_first_strategies:
            _add(f"axl_{cls.__name__}")
    elif preset in ("harper37", "harper41"):
        for cls in HARPER_CLASSES:
            _add(f"axl_{cls.__name__}")
    elif preset == "mini10":
        for sid in [
            "axl_TitForTat",
            "axl_Grudger",
            "axl_Defector",
            "axl_Cooperator",
            "axl_Alternator",
            "axl_WinStayLoseShift",
            "axl_FirstByJoss",
            "axl_FirstByShubik",
            "axl_Random",
            "rival_switch_50",
            "rival_3phase",
        ]:
            _add(sid)
    elif preset == "custom":
        pass

    return entries


def start_tournament_job(
    preset: str = "axelrod1980",
    selected_ids: list[str] | None = None,
    turns: int = 200,
    seeds: list[int] | None = None,
) -> dict[str, Any]:
    """Launch an async round-robin tournament job with live progress tracking."""
    job_id = uuid.uuid4().hex[:10]
    sel = selected_ids or ["gen5_rl"]
    seed_list = [int(s) for s in (seeds or [0, 1, 2, 3, 4])]

    with _JOBS_LOCK:
        _JOBS[job_id] = {
            "owner": session_store.owner.get(),
            "job_id": job_id,
            "status": "running",
            "progress": 0,
            "message": "Preparando competidores...",
            "result": None,
            "error": None,
            "started_at": time.time(),
        }

    def _worker():
        try:
            entries = _resolve_tournament_pool(preset, sel)
            if len(entries) < 2:
                raise ValueError("Selecciona al menos 2 estrategias para ejecutar un torneo.")

            sample_players = [fn() for _, fn in entries]
            n = len(sample_players)
            ids = [eid for eid, _ in entries]
            names = [p.name for p in sample_players]
            is_stoch = [bool(axl.Classifiers["stochastic"](p)) for p in sample_players]

            det_pairs = [(i, j) for i in range(n) for j in range(i + 1, n) if not is_stoch[i] and not is_stoch[j]]
            stoch_pairs = [(i, j) for i in range(n) for j in range(i + 1, n) if is_stoch[i] or is_stoch[j]]
            total_matches = max(1, len(det_pairs) + len(stoch_pairs) * len(seed_list))
            done_matches = 0

            det_payoffs = np.zeros((n, n), dtype=np.float64)
            for i, j in det_pairs:
                p1, p2 = entries[i][1](), entries[j][1]()
                m = axl.Match((p1, p2), turns=turns, seed=0)
                m.play()
                sc = m.final_score()
                det_payoffs[i, j] = sc[0] / float(turns)
                det_payoffs[j, i] = sc[1] / float(turns)
                done_matches += 1
                if done_matches % 10 == 0 or done_matches == len(det_pairs):
                    with _JOBS_LOCK:
                        _JOBS[job_id]["progress"] = int(100 * done_matches / total_matches)
                        _JOBS[job_id]["message"] = f"Duelos deterministas ({done_matches}/{len(det_pairs)})..."

            scores_per_seed = np.zeros((len(seed_list), n), dtype=np.float64)
            ranks_per_seed = np.zeros((len(seed_list), n), dtype=np.int32)
            mean_payoff_mat = np.zeros((n, n), dtype=np.float64)

            for s_idx, seed in enumerate(seed_list):
                mat = det_payoffs.copy()
                for i, j in stoch_pairs:
                    pair_seed = seed * 10000 + i * 131 + j
                    p1, p2 = entries[i][1](), entries[j][1]()
                    m = axl.Match((p1, p2), turns=turns, seed=pair_seed)
                    m.play()
                    sc = m.final_score()
                    mat[i, j] = sc[0] / float(turns)
                    mat[j, i] = sc[1] / float(turns)
                    done_matches += 1
                    if done_matches % 8 == 0:
                        with _JOBS_LOCK:
                            _JOBS[job_id]["progress"] = min(99, int(100 * done_matches / total_matches))
                            _JOBS[job_id]["message"] = f"Semilla {seed} ({s_idx+1}/{len(seed_list)})..."

                mean_payoff_mat += mat
                mean_pts = mat.sum(axis=1) / float(n - 1)
                scores_per_seed[s_idx, :] = mean_pts
                order = list(np.argsort(-mean_pts))
                for rank_pos, p_idx in enumerate(order, 1):
                    ranks_per_seed[s_idx, p_idx] = rank_pos

            mean_payoff_mat /= float(len(seed_list))

            summary = []
            for i in range(n):
                sc_arr = scores_per_seed[:, i]
                rk_arr = ranks_per_seed[:, i]
                summary.append(
                    {
                        "id": ids[i],
                        "orig_idx": i,
                        "name": names[i],
                        "is_selected": ids[i] in sel,
                        "mean_score": round(float(np.mean(sc_arr)), 4),
                        "std_score": round(float(np.std(sc_arr)), 4),
                        "min_score": round(float(np.min(sc_arr)), 4),
                        "max_score": round(float(np.max(sc_arr)), 4),
                        "mean_rank": round(float(np.mean(rk_arr)), 2),
                        "win_rate_pct": round(float(np.mean(rk_arr == 1) * 100.0), 1),
                        "top3_rate_pct": round(float(np.mean(rk_arr <= 3) * 100.0), 1),
                        "seed_scores": [round(float(x), 4) for x in sc_arr],
                        "seed_ranks": [int(x) for x in rk_arr],
                    }
                )

            summary.sort(key=lambda x: x["mean_score"], reverse=True)
            for pos, item in enumerate(summary, 1):
                item["overall_rank"] = pos

            # Reorder payoff matrix according to ranking (for crisp sorted H2H heatmap)
            ordered_idx = [item["orig_idx"] for item in summary]
            ordered_payoffs = None
            if n <= 45:
                ordered_payoffs = [
                    [round(float(mean_payoff_mat[r, c]), 3) for c in ordered_idx]
                    for r in ordered_idx
                ]

            elapsed = round(time.time() - _JOBS[job_id]["started_at"], 2)
            with _JOBS_LOCK:
                _JOBS[job_id]["status"] = "done"
                _JOBS[job_id]["progress"] = 100
                _JOBS[job_id]["message"] = f"Torneo completado en {elapsed}s ({n} jugadores, {len(seed_list)} semillas)"
                _JOBS[job_id]["result"] = {
                    "preset": preset,
                    "turns": turns,
                    "seeds": seed_list,
                    "n_players": n,
                    "elapsed_sec": elapsed,
                    "standings": summary,
                    "payoff_matrix": ordered_payoffs,
                }
        except Exception as exc:
            with _JOBS_LOCK:
                _JOBS[job_id]["status"] = "error"
                _JOBS[job_id]["error"] = "No se pudo completar el torneo."
                traceback.print_exc()

    threading.Thread(target=copy_context().run, args=(_worker,), daemon=True).start()
    return {"job_id": job_id, "status": "running"}


def get_tournament_job(job_id: str) -> dict[str, Any] | None:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        return {k:v for k,v in job.items() if k != "owner"} if job and job["owner"] == session_store.owner.get() else None


# =============================================================================
# 7. CUSTOM STRATEGY TESTING & PERSISTENCE
# =============================================================================


def test_custom_strategy_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Compile and run quick diagnostic duels vs TFT, Defector, Alternator, Grudger."""
    if not re.fullmatch(r"#[A-Fa-f0-9]{6}", payload.get("color", "#0ea5e9")):
        raise ValueError("Elige un color hexadecimal.")
    if len(payload.get("name","")) > 100 or len(payload.get("description","")) > 2000:
        raise ValueError("Nombre o descripción demasiado largos.")
    if payload.get("kind") == "visual_gary" and not 1 <= int(payload.get("config",{}).get("horizon",4)) <= 6:
        raise ValueError("Horizonte fuera de rango.")
    player = _build_custom_player(payload, record_trace=False)
    benchmarks = [
        ("Tit For Tat", axl.TitForTat()),
        ("Grudger", axl.Grudger()),
        ("Defector", axl.Defector()),
        ("Alternator", axl.Alternator()),
        ("Cambio C->D", CooperateThenDefect(50)),
    ]
    results = []
    for label, opp in benchmarks:
        p_clone = _build_custom_player(payload, record_trace=False)
        axl.Match((p_clone, opp), turns=100, seed=42).play()
        avg_me = compute_cumulative_avg_scores(p_clone.history, opp.history)[-1]
        avg_opp = compute_cumulative_avg_scores(opp.history, p_clone.history)[-1]
        coop_pct = 100.0 * sum(1 for m in p_clone.history if m == C) / 100.0
        results.append(
            {
                "rival": label,
                "my_avg": round(float(avg_me), 3),
                "opp_avg": round(float(avg_opp), 3),
                "coop_pct": round(float(coop_pct), 1),
                "first_10": "".join(m.name for m in p_clone.history[:10]),
            }
        )
    return {
        "ok": True,
        "name": player.name,
        "stochastic": bool(axl.Classifiers["stochastic"](player)),
        "diagnostics": results,
    }


def register_custom_strategy(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate, persist, and return newly saved custom strategy."""
    diag = test_custom_strategy_payload(payload)
    sid = uuid.uuid4().hex
    record = {
        "id": sid,
        "name": payload.get("name") or diag["name"],
        "kind": payload.get("kind"),
        "description": payload.get("description", ""),
        "color": payload.get("color", "#0ea5e9"),
        "config": payload.get("config", {}),
        "code": payload.get("code", ""),
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    session_store.put(record)
    return {"saved": record, "diagnostics": diag, "catalog": build_strategy_catalog()}


def delete_custom_strategy(cid: str) -> dict[str, Any]:
    return {"deleted": session_store.remove(cid), "catalog": build_strategy_catalog()}


# =============================================================================
# 8. SOURCE CODE EXPLORER, EXECUTABLE SCRIPT RUNNER & LIVE UNIT TESTS
# =============================================================================

_SCRIPT_JOBS: dict[str, dict[str, Any]] = {}
_SCRIPT_CANCEL: dict[str, threading.Event] = {}
_SCRIPT_START: dict[str, float] = {}
_SCRIPT_LOCK = threading.Lock()
_SCRIPT_SLOT = threading.BoundedSemaphore()
_SCRIPT_NEXT_START = 0.0
_SCRIPT_COOLDOWN = 10
_SCRIPT_DEADLINE = 180
_SCRIPT_HISTORY_LIMIT = 32
_SCRIPT_OUTPUT_LIMIT = 32_768
_SCRIPT_OUTPUT_DIR = Path(tempfile.gettempdir()) / "taller5-script-output"


class ScriptRunLimit(Exception):
    """The single script slot is busy or cooling down."""

    def __init__(self, message: str, retry_after: int | None = None):
        super().__init__(message)
        self.retry_after = retry_after

ALLOWED_OUTPUT_IMAGES = {
    "resultados_experimento.png",
    "aprendizaje_olvido.png",
    "aprendizaje_detalle_rl.png",
}

EXECUTABLE_SCRIPTS: dict[str, dict[str, Any]] = {
    "test_ipd.py": {
        "path": ROOT_DIR / "test_ipd.py",
        "description": "Suite oficial de 8 pruebas unitarias: invariantes 8×4, Bellman (<=1e-6), agentes Taller IV, olvido exponencial y adaptación.",
        "cli": "python3 -m unittest test_ipd.py -v",
        "cmd": [sys.executable, "-u", "-m", "unittest", "test_ipd.py", "-v"],
        "est": "~0.1 s",
        "outputs": [],
    },
    "plot_learning.py": {
        "path": ROOT_DIR / "plot_learning.py",
        "description": "Simula rivales no estacionarios (CooperateThenDefect, ThreePhaseRival), imprime trazas y genera curvas RL.",
        "cli": "python3 plot_learning.py",
        "cmd": [sys.executable, "-u", "plot_learning.py"],
        "est": "~2 s",
        "outputs": ["aprendizaje_olvido.png", "aprendizaje_detalle_rl.png"],
    },
    "run_experiment.py": {
        "path": ROOT_DIR / "run_experiment.py",
        "description": "Experimento completo: tabla empírica 8×4 (173,130 transiciones), Bellman, traza Defector y barrido λ en Axelrod 1980.",
        "cli": "python3 run_experiment.py",
        "cmd": [sys.executable, "-u", "run_experiment.py"],
        "est": "~10 s",
        "outputs": ["resultados_experimento.png"],
    },
    "ipd_mdp.py": {
        "path": ROOT_DIR / "ipd_mdp.py",
        "description": "Modelo MDP 8×4, recolección empírica de frecuencias y solver Value Iteration de Bellman.",
        "cli": "python3 -c \"import ipd_mdp as m; f=m.collect_frequency_table(m.build_training_pool()); b=m.solve_bellman(f.p_coop); ...\"",
        "cmd": [
            sys.executable,
            "-u",
            "-c",
            (
                "import ipd_mdp as m; "
                "f = m.collect_frequency_table(m.build_training_pool(), turns=200, repetitions=1, seed=42); "
                "b = m.solve_bellman(f.p_coop, gamma=0.90); "
                "print(f'Transiciones recolectadas: {f.total_transitions:,}'); "
                "print('Probabilidades empiricas P(O_t=C | s, a):'); "
                "[print(f'  ({m.STATES[s]}, {m.ACTION_LABELS[a]}): {f.counts_coop[(s,a)]:>6,}/{f.counts_total[(s,a)]:<6,} = {f.p_coop[(s,a)]:.4f}') for s in range(4) for a in m.ACTIONS]; "
                "print('Solucion de Bellman (gamma=0.90):'); "
                "[print(f'  Estado {m.STATES[s]}: V*={b.v_values[s]:.2f} | Q(C)={b.q_values[(s,1)]:.2f} vs Q(D)={b.q_values[(s,0)]:.2f} | dQ={b.delta_q[s]:+.2f} -> pi_0={m.ACTION_LABELS[b.policy[s]]}') for s in range(4)]; "
                "print('Politica emergente:', ''.join(m.ACTION_LABELS[x] for x in b.policy))"
            ),
        ],
        "est": "~1.5 s",
        "outputs": [],
    },
    "agents.py": {
        "path": ROOT_DIR / "agents.py",
        "description": "Agentes Taller IV (CloudMiope, RulitoBellman), Agente Base (CDDC) y Mitcha (ForgettingTransitionRLAgent).",
        "cli": "python3 (prueba rápida de EmpiricalPolicyAgent vs ForgettingTransitionRLAgent)",
        "cmd": [
            sys.executable,
            "-u",
            "-c",
            (
                "import axelrod as axl, ipd_mdp as m, agents as ag\n"
                "from plot_learning import CooperateThenDefect, ThreePhaseRival\n"
                "f = m.collect_frequency_table(m.build_training_pool(), turns=200, repetitions=1, seed=42)\n"
                "b = m.solve_bellman(f.p_coop, gamma=0.90)\n"
                "rivals = [('TitForTat', axl.TitForTat), ('Defector', axl.Defector), ('Alternator', axl.Alternator), ('Cambio C->D', lambda: CooperateThenDefect(50)), ('3 Fases C-D-C', ThreePhaseRival)]\n"
                "print(f'{\"Rival\":<16} {\"Base CDDC\":>10} {\"RL lam=1.0\":>12} {\"RL lam=0.90\":>12}')\n"
                "print('-' * 54)\n"
                "for nm, rfn in rivals:\n"
                "    res = []\n"
                "    for pl in [ag.EmpiricalPolicyAgent(b.policy), ag.ForgettingTransitionRLAgent(f.p_coop, initial_count=2.0, forgetting_factor=1.0), ag.ForgettingTransitionRLAgent(f.p_coop, initial_count=2.0, forgetting_factor=0.90)]:\n"
                "        op = rfn()\n"
                "        axl.Match((pl, op), turns=200, seed=42).play()\n"
                "        res.append(m.compute_cumulative_avg_scores(pl.history, op.history)[-1])\n"
                "    print(f'{nm:<16} {res[0]:>10.3f} {res[1]:>12.3f} {res[2]:>12.3f}')\n"
            ),
        ],
        "est": "~2 s",
        "outputs": [],
    },
    "generations.py": {
        "path": CORE_DIR / "generations.py",
        "description": "Implementación traceable de las 5 generaciones: Cloud (Miope), Rulito (1-Step), Expectimax H=2 + Markov (ref.), Base CDDC y Mitcha.",
        "cli": "python3 (comparativa rápida de las 5 generaciones frente a 5 arquetipos)",
        "cmd": [
            sys.executable,
            "-u",
            "-c",
            (
                "import sys\n"
                "sys.path.insert(0, 'taller5_web/core')\n"
                "import axelrod as axl, ipd_mdp as m, generations as g\n"
                "f = m.collect_frequency_table(m.build_training_pool(), turns=200, repetitions=1, seed=42)\n"
                "b = m.solve_bellman(f.p_coop, gamma=0.90, tol=1e-6, max_iter=2000)\n"
                "gens = [('1. Cloud', g.CloudMiope), ('2. Rulito', g.RulitoBellman), ('3. Expectimax', lambda: g.ExpectimaxMarkovAgent(2, 0.90)), ('4. Base CDDC', lambda: g.EmpiricalPolicyAgent(b.policy)), ('5. Mitcha', lambda: g.ForgettingTransitionRLAgent(f.p_coop, initial_count=2.0, forgetting_factor=0.90))]\n"
                "opps = [('TFT', axl.TitForTat), ('Grudger', axl.Grudger), ('Defector', axl.Defector), ('Altern.', axl.Alternator), ('C->D t50', lambda: g.CooperateThenDefect(50))]\n"
                "print(f'{\"Agente\":<15} ' + ' '.join(f'{o[0]:>9}' for o in opps))\n"
                "print('-' * 68)\n"
                "for an, af in gens:\n"
                "    vals = []\n"
                "    for _, of in opps:\n"
                "        p, q = af(), of()\n"
                "        axl.Match((p, q), turns=200, seed=42).play()\n"
                "        vals.append(m.compute_cumulative_avg_scores(p.history, q.history)[-1])\n"
                "    print(f'{an:<15} ' + ' '.join(f'{v:>9.3f}' for v in vals))\n"
            ),
        ],
        "est": "~2 s",
        "outputs": [],
    },
    "evolucion_agentes_taller5.ipynb": {
        "path": ROOT_DIR / "evolucion_agentes_taller5.ipynb",
        "description": "Notebook reproducible oficial del Taller 5 con todas las celdas de código, Value Iteration <=1e-6 y figuras.",
        "cli": "jupyter nbconvert --execute evolucion_agentes_taller5.ipynb",
        "cmd": None,
        "est": "Notebook",
        "outputs": ["resultados_experimento.png", "aprendizaje_olvido.png", "aprendizaje_detalle_rl.png"],
    },
}


def _notebook_to_readable_py(nb_path: Path) -> str:
    nb = json.loads(nb_path.read_text(encoding="utf-8"))
    parts = ["# Vista legible de celdas de codigo de evolucion_agentes_taller5.ipynb\n"]
    code_idx = 0
    for cell in nb.get("cells", []):
        ctype = cell.get("cell_type")
        src = "".join(cell.get("source", []))
        if ctype == "markdown":
            parts.append("\n# " + "=" * 74)
            for line in src.splitlines():
                parts.append("# " + line)
            parts.append("# " + "=" * 74 + "\n")
        elif ctype == "code":
            code_idx += 1
            parts.append(f"\n# --- [Celda de codigo {code_idx}] ---\n{src}\n")
    return "\n".join(parts)


def get_source_code_bundle() -> list[dict[str, Any]]:
    out = []
    for fname, meta in EXECUTABLE_SCRIPTS.items():
        path: Path = meta["path"]
        if not path.exists():
            continue
        if fname.endswith(".ipynb"):
            content = _notebook_to_readable_py(path)
        else:
            content = path.read_text(encoding="utf-8")
        out.append(
            {
                "id": fname,
                "filename": fname,
                "description": meta["description"],
                "cli": meta["cli"],
                "runnable": meta["cmd"] is not None,
                "est": meta["est"],
                "outputs": meta["outputs"],
                "lines": len(content.splitlines()),
                "bytes": len(content.encode("utf-8")),
                "content": content,
            }
        )
    return out


def _reserve_execution() -> None:
    with _SCRIPT_LOCK:
        if not _SCRIPT_SLOT.acquire(blocking=False):
            raise ScriptRunLimit("Ya hay una ejecución de IPD en curso. Espera a que termine.")
        wait = math.ceil(_SCRIPT_NEXT_START - time.monotonic())
        if wait > 0:
            _SCRIPT_SLOT.release()
            raise ScriptRunLimit(f"Espera {wait} s antes de iniciar otra ejecución.", retry_after=wait)


def _release_execution() -> None:
    global _SCRIPT_NEXT_START
    with _SCRIPT_LOCK:
        _SCRIPT_NEXT_START = time.monotonic() + _SCRIPT_COOLDOWN
        _SCRIPT_SLOT.release()


def _append_script_output(job: dict[str, Any], text: str) -> None:
    output = job["output"] + text
    job["output_truncated"] |= len(output) > _SCRIPT_OUTPUT_LIMIT
    job["output"] = output[-_SCRIPT_OUTPUT_LIMIT:]


def _run_script_process(cmd, workspace: Path, cancel: threading.Event, on_output) -> tuple[str, int]:
    env = dict(os.environ)
    env.update(PYTHONUNBUFFERED="1", MPLBACKEND="Agg")
    env["PYTHONPATH"] = os.pathsep.join(filter(None, (str(CORE_DIR), env.get("PYTHONPATH"))))
    for key in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
        env[key] = "1"
    proc = subprocess.Popen(
        ["nice", "-n", "10", *cmd],
        cwd=workspace,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        start_new_session=True,
        env=env,
    )
    deadline = time.monotonic() + _SCRIPT_DEADLINE
    decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
    finished = False
    try:
        with proc.stdout as stream, selectors.DefaultSelector() as selector:
            selector.register(stream, selectors.EVENT_READ)
            while True:
                if cancel.is_set():
                    status = "stopped"
                    break
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    status = "timed_out"
                    break
                if not selector.get_map() and proc.poll() is not None:
                    finished = True
                    status = "done" if proc.returncode == 0 else "error"
                    break
                for event, _ in selector.select(min(0.25, remaining)):
                    chunk = os.read(event.fd, 4096)
                    if chunk:
                        on_output(decoder.decode(chunk))
                    else:
                        selector.unregister(event.fileobj)
            on_output(decoder.decode(b"", final=True))
    finally:
        if not finished:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        rc = proc.wait()
    return status, rc


def get_script_output(name: str) -> Path:
    generated = _SCRIPT_OUTPUT_DIR / name
    return generated if generated.is_file() else ROOT_DIR / name


def _publish_script_outputs(workspace: Path, script_id: str, outputs: list[str]) -> list[dict[str, str]]:
    filenames = list(outputs)
    files = [workspace / name for name in filenames if (workspace / name).is_file()]
    if any(file.stat().st_size > 8 * 1024 * 1024 for file in files):
        raise ValueError("El script generó un archivo mayor que el límite permitido.")
    for file in files:
        file.replace(_SCRIPT_OUTPUT_DIR / file.name)
    stamp = time.time_ns()
    return [
        {"name": file.name, "url": f"/project-img/{file.name}?t={stamp}"}
        for file in files
        if file.name in outputs
    ]


def start_script_job(script_id: str) -> dict[str, Any]:
    """Run one predefined script in a bounded background job."""
    meta = EXECUTABLE_SCRIPTS.get(script_id)
    if meta is None or meta["cmd"] is None:
        raise ValueError(f"Script no ejecutable directamente: {script_id}")

    _reserve_execution()
    job_id = uuid.uuid4().hex
    start_ts = time.monotonic()
    cancel = threading.Event()
    job = {
        "job_id": job_id,
        "owner": session_store.owner.get(),
        "script_id": script_id,
        "cli": meta["cli"],
        "status": "running",
        "returncode": None,
        "output": f"$ {meta['cli']}\n",
        "output_truncated": False,
        "elapsed_sec": 0.0,
        "generated_images": [],
        "started_at": time.time(),
    }
    with _SCRIPT_LOCK:
        if len(_SCRIPT_JOBS) >= _SCRIPT_HISTORY_LIMIT:
            oldest = next(iter(_SCRIPT_JOBS))
            del _SCRIPT_JOBS[oldest]
        _SCRIPT_JOBS[job_id] = job
        _SCRIPT_CANCEL[job_id] = cancel
        _SCRIPT_START[job_id] = start_ts

    def append(text):
        with _SCRIPT_LOCK:
            _append_script_output(job, text)

    def runner():
        status, rc, images = "error", None, []
        try:
            _SCRIPT_OUTPUT_DIR.mkdir(mode=0o700, exist_ok=True)
            with tempfile.TemporaryDirectory(prefix=".ipd-script-", dir=_SCRIPT_OUTPUT_DIR) as tmp:
                workspace = Path(tmp)
                for source in ROOT_DIR.glob("*.py"):
                    shutil.copyfile(source, workspace / source.name)
                if cancel.is_set():
                    status = "stopped"
                else:
                    status, rc = _run_script_process(meta["cmd"], workspace, cancel, append)
                if status == "done":
                    images = _publish_script_outputs(workspace, script_id, meta["outputs"])
            if status == "stopped":
                append("\n[Ejecución detenida por el usuario]\n")
            elif status == "timed_out":
                append(f"\n[Se alcanzó el límite de {_SCRIPT_DEADLINE} segundos]\n")
        except Exception:
            status = "error"
            traceback.print_exc()
            append("\n[No se pudo completar la ejecución del script]\n")
        finally:
            with _SCRIPT_LOCK:
                _SCRIPT_CANCEL.pop(job_id, None)
                _SCRIPT_START.pop(job_id, None)
                job.update(
                    status=status,
                    returncode=rc,
                    elapsed_sec=round(time.monotonic() - start_ts, 2),
                    generated_images=images,
                )
            _release_execution()

    try:
        threading.Thread(target=runner, daemon=True).start()
    except Exception:
        with _SCRIPT_LOCK:
            _SCRIPT_JOBS.pop(job_id, None)
            _SCRIPT_CANCEL.pop(job_id, None)
            _SCRIPT_START.pop(job_id, None)
        _release_execution()
        raise
    return {"job_id": job_id, "status": "running", "script_id": script_id}


def _script_status(job_id: str) -> dict[str, Any] | None:
    job = _SCRIPT_JOBS.get(job_id)
    if job is None:
        return None
    out = dict(job)
    out.pop("owner", None)
    if job_id in _SCRIPT_START:
        out["elapsed_sec"] = round(time.monotonic() - _SCRIPT_START[job_id], 2)
    if job["output_truncated"]:
        out["output"] = "[Salida anterior recortada]\n" + out["output"]
    return out


def get_script_job(job_id: str) -> dict[str, Any] | None:
    with _SCRIPT_LOCK:
        if _SCRIPT_JOBS.get(job_id, {}).get("owner") != session_store.owner.get():
            return None
        return _script_status(job_id)


def stop_script_job(job_id: str) -> dict[str, Any]:
    with _SCRIPT_LOCK:
        if _SCRIPT_JOBS.get(job_id, {}).get("owner") != session_store.owner.get():
            return {"status":"not_found"}
        cancel = _SCRIPT_CANCEL.get(job_id)
        if cancel is not None:
            cancel.set()
        return _script_status(job_id) or {"status": "not_found"}


def run_unit_tests_live() -> dict[str, Any]:
    _reserve_execution()
    try:
        return _run_unit_tests_live()
    finally:
        _release_execution()


def _run_unit_tests_live() -> dict[str, Any]:
    """Run core/test_ipd.py live via unittest and return structured test results."""
    t0 = time.time()
    loader = unittest.TestLoader()
    suite = loader.discover(start_dir=str(CORE_DIR), pattern="test_ipd.py")
    buf = io.StringIO()
    runner = unittest.TextTestRunner(stream=buf, verbosity=2)
    result = runner.run(suite)
    elapsed = round(time.time() - t0, 3)

    raw_output = buf.getvalue()
    parsed = []
    for line in raw_output.splitlines():
        if " ... " in line:
            left, status = line.rsplit(" ... ", 1)
            test_name = left.strip().split(" ")[0]
            parsed.append({"name": test_name, "status": status.strip()})

    return {
        "passed": result.wasSuccessful(),
        "tests_run": result.testsRun,
        "failures": len(result.failures),
        "errors": len(result.errors),
        "elapsed_sec": elapsed,
        "tests": parsed,
        "raw_output": raw_output,
    }


# =============================================================================
# 9. HUMAN-VS-AI INTERACTIVE GAME & AXELROD 1980 VOXEL RING DATA
# =============================================================================

AXELROD_1980_META: dict[str, dict[str, Any]] = {
    "TitForTat": {"short": "Tit For Tat", "nice": True, "trait": "Recíproca: coopera primero y copia tu última jugada"},
    "FirstByTidemanAndChieruzzi": {"short": "Tideman & Chieruzzi", "nice": True, "trait": "Castigo creciente con reconciliación tras racha"},
    "FirstByNydegger": {"short": "Nydegger", "nice": True, "trait": "Memoria de 3 turnos ponderada por patrones"},
    "FirstByGrofman": {"short": "Grofman", "nice": True, "trait": "Cooperación resiliente con 2/7 ante desacuerdos"},
    "FirstByShubik": {"short": "Shubik", "nice": True, "trait": "Represalia progresiva ante cada traición nueva"},
    "FirstBySteinAndRapoport": {"short": "Stein & Rapoport", "nice": True, "trait": "Detecta rivales aleatorios con prueba Chi²"},
    "Grudger": {"short": "Friedman (Grudger)", "nice": True, "trait": "Rencorosa: perdona cero; traición eterna si fallas"},
    "FirstByDavis": {"short": "Davis", "nice": True, "trait": "Coopera 10 turnos iniciales; luego actúa como Grudger"},
    "FirstByGraaskamp": {"short": "Graaskamp", "nice": False, "trait": "Sondeadora: prueba defensas traicionando en turno 51"},
    "FirstByDowning": {"short": "Downing", "nice": False, "trait": "Estima tu respuesta esperada; pesimista al inicio"},
    "FirstByFeld": {"short": "Feld", "nice": False, "trait": "TFT que reduce lentamente su probabilidad de cooperar"},
    "FirstByJoss": {"short": "Joss", "nice": False, "trait": "Sigilosa: copia tu jugada pero traiciona 10% al azar"},
    "FirstByTullock": {"short": "Tullock", "nice": False, "trait": "Coopera 11 turnos; luego iguala tu tasa menos 10%"},
    "FirstByAnonymous": {"short": "Anónimo", "nice": False, "trait": "Estocástica con tasa variable de cooperación"},
    "Random": {"short": "Random", "nice": False, "trait": "Caótica: lanza una moneda 50% C / 50% D cada turno"},
}


class _HumanShadowPlayer(axl.Player):
    """Lightweight placeholder tracking human moves so axelrod opponents read opponent.history."""

    name = "Humano"

    def strategy(self, opponent: axl.Player) -> axl.Action:
        return C


def start_human_match(opponent_id: str = "axl_TitForTat", seed: int = 42) -> dict[str, Any]:
    """Create a stateful interactive Human-vs-AI match session."""
    sid = uuid.uuid4().hex[:10]
    opp = instantiate_strategy(opponent_id, record_trace=True)
    opp.set_seed(int(seed))
    human = _HumanShadowPlayer()
    with _PLAY_LOCK:
        if len(_PLAY_SESSIONS) > 60:
            oldest = next(iter(_PLAY_SESSIONS))
            _PLAY_SESSIONS.pop(oldest, None)
        _PLAY_SESSIONS[sid] = {
            "owner": session_store.owner.get(),
            "opponent_id": opponent_id,
            "opp": opp,
            "human": human,
            "human_moves": [],
            "opp_moves": [],
            "human_scores": [],
            "opp_scores": [],
        }
    return {
        "session_id": sid,
        "opponent_id": opponent_id,
        "opponent_name": opp.name,
    }


def step_human_match(session_id: str, human_move: str) -> dict[str, Any]:
    """Advance one round of Human-vs-AI and return move, payoffs, and AI internal insight."""
    with _PLAY_LOCK:
        sess = _PLAY_SESSIONS.get(session_id)
        if sess is None or sess["owner"] != session_store.owner.get():
            raise ValueError("Sesión de juego expirada; reinicia la partida.")

        opp: axl.Player = sess["opp"]
        human: _HumanShadowPlayer = sess["human"]
        h_act = C if str(human_move).upper() == "C" else D

        # Opponent chooses simultaneously based ONLY on prior history
        o_act = opp.strategy(human)

        # Record simultaneous moves into Axelrod histories
        human.update_history(h_act, o_act)
        opp.update_history(o_act, h_act)

        h_idx = ACTION_C if h_act == C else ACTION_D
        o_idx = ACTION_C if o_act == C else ACTION_D
        h_pts = PAYOFF[(h_idx, o_idx)]
        o_pts = PAYOFF[(o_idx, h_idx)]

        sess["human_moves"].append(h_act.name)
        sess["opp_moves"].append(o_act.name)
        sess["human_scores"].append(h_pts)
        sess["opp_scores"].append(o_pts)

        # Extract compact AI internal thought if opponent is traceable
        ai_thought = None
        trace_log = getattr(opp, "trace_log", None)
        if trace_log:
            last = trace_log[-1]
            if "probs" in last:
                pol = "".join(ACTION_LABELS[a] for a in last["policy"])
                ai_thought = {
                    "kind": "mdp_rl",
                    "policy": pol,
                    "p_cc_c": round(float(last["probs"][(0, ACTION_C)]), 3),
                    "p_dd_c": round(float(last["probs"][(3, ACTION_C)]), 3),
                    "delta_q_dd": round(float(last["delta_q"][3]), 2),
                }
            elif last.get("kind") == "gary":
                ai_thought = {
                    "kind": "gary",
                    "f_c": round(float(last["f_c"]), 3),
                    "f_d": round(float(last["f_d"]), 3),
                    "E": [round(float(x), 2) for x in last["E"]],
                }
            elif last.get("kind") in ("rulito", "cloud"):
                ai_thought = {
                    "kind": last["kind"],
                    "q_c": round(float(last["q_c"]), 2),
                    "q_d": round(float(last["q_d"]), 2),
                    "phase": last["phase"],
                }

        turn = len(sess["human_moves"])
        tot_h = sum(sess["human_scores"])
        tot_o = sum(sess["opp_scores"])
        return {
            "turn": turn,
            "human_move": h_act.name,
            "opp_move": o_act.name,
            "state": f"{h_act.name}{o_act.name}",
            "human_pts": h_pts,
            "opp_pts": o_pts,
            "human_total": int(tot_h),
            "opp_total": int(tot_o),
            "human_avg": round(tot_h / turn, 3),
            "opp_avg": round(tot_o / turn, 3),
            "human_moves": list(sess["human_moves"]),
            "opp_moves": list(sess["opp_moves"]),
            "human_scores": list(sess["human_scores"]),
            "opp_scores": list(sess["opp_scores"]),
            "ai_thought": ai_thought,
        }


def get_axelrod1980_ring_data() -> dict[str, Any]:
    """Compute (and cache) the 15-player Axelrod 1980 round-robin ring + 5 AI generations."""
    global _RING_CACHE
    if _RING_CACHE is not None:
        return _RING_CACHE

    if RING_CACHE_PATH.exists():
        try:
            _RING_CACHE = json.loads(RING_CACHE_PATH.read_text(encoding="utf-8"))
            return _RING_CACHE
        except Exception:
            pass

    turns = 200
    classic_classes = list(axl.axelrod_first_strategies)
    n15 = len(classic_classes)
    classic_entries = []
    for cls in classic_classes:
        meta = AXELROD_1980_META.get(cls.__name__, {"short": cls().name, "nice": True, "trait": "Estrategia clásica"})
        classic_entries.append(
            {
                "id": f"axl_{cls.__name__}",
                "cls_name": cls.__name__,
                "name": cls().name,
                "short": meta["short"],
                "nice": bool(meta["nice"]),
                "trait": meta["trait"],
            }
        )

    # 15x15 pairwise round-robin scores (total over 200 turns & per-round)
    mat15 = [[0.0 for _ in range(n15)] for _ in range(n15)]
    for i in range(n15):
        for j in range(i, n15):
            p1, p2 = classic_classes[i](), classic_classes[j]()
            axl.Match((p1, p2), turns=turns, seed=42 + i * 31 + j).play()
            s1 = sum(
                PAYOFF[(ACTION_C if a == C else ACTION_D, ACTION_C if b == C else ACTION_D)]
                for a, b in zip(p1.history, p2.history)
            )
            s2 = sum(
                PAYOFF[(ACTION_C if b == C else ACTION_D, ACTION_C if a == C else ACTION_D)]
                for a, b in zip(p1.history, p2.history)
            )
            mat15[i][j] = round(float(s1), 1)
            mat15[j][i] = round(float(s2), 1)

    # Probe signature (7 turns vs a mixed C,D,C,C,C,D,C player) for character cards
    class _ProbeScript(axl.Player):
        name = "Probe"
        def strategy(self, opponent):
            seq = [C, D, C, C, C, D, C]
            return seq[len(self.history) % len(seq)]

    for idx, cls in enumerate(classic_classes):
        p = cls()
        pr = _ProbeScript()
        axl.Match((p, pr), turns=7, seed=42).play()
        classic_entries[idx]["sample_moves"] = [m.name for m in p.history]
        classic_entries[idx]["sample_opp"] = [m.name for m in pr.history]
        avg_total = sum(mat15[idx][j] for j in range(n15) if j != idx) / float(n15 - 1)
        classic_entries[idx]["avg_total_15"] = round(avg_total, 1)
        classic_entries[idx]["avg_round_15"] = round(avg_total / turns, 3)

    # Also compute each of the 5 AI generations against the 15 classics!
    gen_specs = [
        ("gen1_cloud", "1. Cloud (Miope γ=0)", False, "Taller IV Sec. 7: frecuentista miope (γ=0), colapsa a traición mutua"),
        ("gen2_rulito", "2. Rulito (1-Step γ=0.90)", False, "Taller IV Sec. 8: Bellman 1-step (γ=0.90) con transición no condicionada"),
        ("gen3_gary", "3. Expectimax H=2 + Markov", True, "Referencia de búsqueda: Expectimax H=2 (16 hojas) + cierre Markov"),
        ("gen4_base", "4. Base MDP Fija (CDDC)", True, "Política Pavlov emergente de T_0 (sin aprendizaje online)"),
        ("gen5_rl", "5. Mitcha (RL Olvido)", True, "MDP 8×4 online con contador efectivo n₀=2, λ=0.90"),
    ]
    generations_vs_15 = {}
    for gid, gname, gnice, gtrait in gen_specs:
        vs_opp = []
        opp_vs = []
        for j, cls in enumerate(classic_classes):
            ag = instantiate_strategy(gid)
            op = cls()
            axl.Match((ag, op), turns=turns, seed=42 + j * 17).play()
            s1 = sum(
                PAYOFF[(ACTION_C if a == C else ACTION_D, ACTION_C if b == C else ACTION_D)]
                for a, b in zip(ag.history, op.history)
            )
            s2 = sum(
                PAYOFF[(ACTION_C if b == C else ACTION_D, ACTION_C if a == C else ACTION_D)]
                for a, b in zip(ag.history, op.history)
            )
            vs_opp.append(round(float(s1), 1))
            opp_vs.append(round(float(s2), 1))
        ag_p = instantiate_strategy(gid)
        pr = _ProbeScript()
        axl.Match((ag_p, pr), turns=7, seed=42).play()
        generations_vs_15[gid] = {
            "id": gid,
            "name": gname,
            "short": gname.split(" (")[0],
            "nice": gnice,
            "trait": gtrait,
            "vs_15": vs_opp,
            "15_vs": opp_vs,
            "avg_total": round(sum(vs_opp) / float(n15), 1),
            "avg_round": round(sum(vs_opp) / float(n15 * turns), 3),
            "sample_moves": [m.name for m in ag_p.history],
            "sample_opp": [m.name for m in pr.history],
        }

    result = {
        "turns": turns,
        "players_15": classic_entries,
        "matrix_15": mat15,
        "generations_vs_15": generations_vs_15,
    }
    _RING_CACHE = result
    try:
        RING_CACHE_PATH.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass
    return result


def get_bootstrap_payload() -> dict[str, Any]:
    """Return all cached/initial data for near-instant frontend startup."""
    mdp = compute_mdp_payload(gamma=0.90, initial_count=2.0, forgetting_factor=0.90)
    evolution = run_evolution_suite(turns=200, repetitions=5, seed=42, include_axelrod=False)
    online = run_online_learning_suite()
    gary = run_gary_dynamics()
    tournaments = load_verified_paper_tournaments()
    axelrod_ring = get_axelrod1980_ring_data()

    # Verified lambda sweep (tol=1e-6, seed=42, 5 reps)
    paper_lambda_sweep = {
        "initial_count": 2.0,
        "gamma": 0.90,
        "repetitions": 5,
        "seed": 42,
        "bars": [
            {"label": "Sin Prior\n(0.50)", "mean": 2.010, "std": 0.020, "rank": 11, "color": "#78909c"},
            {"label": "lam=0.70", "mean": 2.638, "std": 0.021, "rank": 1, "color": "#42a5f5"},
            {"label": "lam=0.80", "mean": 2.633, "std": 0.025, "rank": 1, "color": "#00897b"},
            {"label": "lam=0.85", "mean": 2.648, "std": 0.027, "rank": 1, "color": "#2e7d32"},
            {"label": "lam=0.90", "mean": 2.662, "std": 0.024, "rank": 1, "color": "#1565c0"},
            {"label": "lam=0.95", "mean": 2.661, "std": 0.051, "rank": 1, "color": "#6a1b9a"},
            {"label": "lam=1.0\n(sin olvido)", "mean": 2.641, "std": 0.027, "rank": 1, "color": "#8d6e63"},
            {"label": "Fija\n(eta=0)", "mean": 2.559, "std": 0.018, "rank": 3, "color": "#ef6c00"},
            {"label": "Tit For\nTat", "mean": 2.560, "std": 0.020, "rank": 3, "color": "#eab308"},
        ],
    }

    return {
        "catalog": build_strategy_catalog(),
        "python_templates": PYTHON_TEMPLATES,
        "mdp": mdp,
        "lambda_sweep": paper_lambda_sweep,
        "evolution": evolution,
        "online": online,
        "gary": gary,
        "tournaments_verified": tournaments,
        "axelrod_ring": axelrod_ring,
    }
