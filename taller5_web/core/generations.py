"""All 5 Taller 5 agent generations, non-stationary rivals, and custom strategy builders."""

from __future__ import annotations

import math
import random
from typing import Any, Callable

import axelrod as axl
import numpy as np

from ipd_mdp import (
    ACTION_C,
    ACTION_D,
    ACTIONS,
    C,
    D,
    PAYOFF,
    STATE_MAP,
    STATES,
    UNIFORM_PRIOR_P,
    build_mdp_transition_matrix,
    solve_bellman,
)
from agents import (
    BayesianFrequencyRLAgent,
    EmpiricalPolicyAgent,
    ForgettingTransitionRLAgent,
)
from plot_learning import CooperateThenDefect, ThreePhaseRival

STATES_TUP = [(C, C), (C, D), (D, C), (D, D)]


class RulitoMiope(axl.Player):
    """Etapa I: Agente frecuentista miope (gamma = 0) con exploración alternante de 10 turnos."""

    name = "1. Rulito (Miope g=0)"
    classifier = {
        "memory_depth": float("inf"),
        "stochastic": False,
        "makes_use_of": set(),
        "long_run_time": False,
        "inspects_source": False,
        "manipulates_source": False,
        "manipulates_state": False,
    }

    def __init__(
        self,
        exploration_turns: int = 10,
        player_name: str | None = None,
        record_trace: bool = False,
    ):
        super().__init__()
        self.exploration_turns = int(exploration_turns)
        self.record_trace = bool(record_trace)
        if player_name is not None:
            self.name = player_name
        self.reset_counts()

    def reset_counts(self) -> None:
        self.counts = {s: {C: 0, D: 0} for s in STATES_TUP}
        self.prev_state = None
        self.trace_log: list[dict[str, Any]] = []

    def reset(self) -> None:
        super().reset()
        self.reset_counts()

    def _p_vec(self) -> list[float]:
        out = []
        for s in STATES_TUP:
            tot = self.counts[s][C] + self.counts[s][D]
            out.append((self.counts[s][C] / tot) if tot > 0 else 0.5)
        return out

    def strategy(self, opponent: axl.Player) -> axl.Action:
        t = len(self.history)
        if t == 0:
            self.reset_counts()
            if self.record_trace:
                self.trace_log.append(
                    {
                        "kind": "rulito",
                        "p_state": self._p_vec(),
                        "q_c": 1.5,
                        "q_d": 3.0,
                        "delta_q_state": [-1.5] * 4,
                        "policy": [ACTION_C, ACTION_C, ACTION_C, ACTION_C],
                        "phase": "apertura",
                    }
                )
            return C

        curr = (self.history[-1], opponent.history[-1])
        if self.prev_state is not None:
            self.counts[self.prev_state][opponent.history[-1]] += 1
        self.prev_state = curr

        p_vec = self._p_vec()
        tot = self.counts[curr][C] + self.counts[curr][D]
        p_c = (self.counts[curr][C] / tot) if tot > 0 else 0.5
        q_c = 3.0 * p_c
        q_d = 4.0 * p_c + 1.0

        if t < self.exploration_turns:
            act = C if t % 2 == 0 else D
            phase = "exploracion"
        else:
            act = C if q_c >= q_d else D
            phase = "explotacion_miope"

        if self.record_trace:
            dq = [3.0 * p - (4.0 * p + 1.0) for p in p_vec]
            pol = [ACTION_C if d >= 0 else ACTION_D for d in dq]
            self.trace_log.append(
                {
                    "kind": "rulito",
                    "p_state": p_vec,
                    "q_c": float(q_c),
                    "q_d": float(q_d),
                    "delta_q_state": [float(d) for d in dq],
                    "policy": pol,
                    "phase": phase,
                }
            )
        return act


class CloudOneStep(axl.Player):
    """Etapa II: Agente 1-Step Lookahead (gamma = 0.90) con transición no condicionada P(O_t | s_{t-1})."""

    name = "2. Cloud (1-Step g=0.90)"
    classifier = {
        "memory_depth": float("inf"),
        "stochastic": False,
        "makes_use_of": set(),
        "long_run_time": False,
        "inspects_source": False,
        "manipulates_source": False,
        "manipulates_state": False,
    }

    def __init__(
        self,
        gamma: float = 0.90,
        exploration_turns: int = 10,
        player_name: str | None = None,
        record_trace: bool = False,
    ):
        super().__init__()
        self.gamma = float(gamma)
        self.exploration_turns = int(exploration_turns)
        self.record_trace = bool(record_trace)
        if player_name is not None:
            self.name = player_name
        self.reset_counts()

    def reset_counts(self) -> None:
        self.counts = {s: {C: 0, D: 0} for s in STATES_TUP}
        self.prev_state = None
        self.trace_log: list[dict[str, Any]] = []

    def reset(self) -> None:
        super().reset()
        self.reset_counts()

    def _p_coop(self, s: tuple[axl.Action, axl.Action]) -> float:
        tot = self.counts[s][C] + self.counts[s][D]
        return (self.counts[s][C] / tot) if tot > 0 else 0.5

    def _q_pair(self, s: tuple[axl.Action, axl.Action]) -> tuple[float, float]:
        p_c = self._p_coop(s)
        p_d = 1.0 - p_c
        v_next = {st: 4.0 * self._p_coop(st) + 1.0 for st in STATES_TUP}
        q_c = p_c * (3.0 + self.gamma * v_next[(C, C)]) + p_d * (0.0 + self.gamma * v_next[(C, D)])
        q_d = p_c * (5.0 + self.gamma * v_next[(D, C)]) + p_d * (1.0 + self.gamma * v_next[(D, D)])
        return float(q_c), float(q_d)

    def strategy(self, opponent: axl.Player) -> axl.Action:
        t = len(self.history)
        if t == 0:
            self.reset_counts()
            if self.record_trace:
                self.trace_log.append(
                    {
                        "kind": "cloud",
                        "p_state": [0.5, 0.5, 0.5, 0.5],
                        "q_c": 4.2,
                        "q_d": 5.7,
                        "delta_q_state": [-1.5] * 4,
                        "policy": [ACTION_D] * 4,
                        "phase": "apertura",
                    }
                )
            return C

        curr = (self.history[-1], opponent.history[-1])
        if self.prev_state is not None:
            self.counts[self.prev_state][opponent.history[-1]] += 1
        self.prev_state = curr

        q_c, q_d = self._q_pair(curr)
        if t < self.exploration_turns:
            act = C if t % 2 == 0 else D
            phase = "exploracion"
        else:
            act = C if q_c >= q_d else D
            phase = "lookahead_1step"

        if self.record_trace:
            p_vec = [self._p_coop(s) for s in STATES_TUP]
            dqs = []
            pol = []
            for st in STATES_TUP:
                qc_s, qd_s = self._q_pair(st)
                dqs.append(float(qc_s - qd_s))
                pol.append(ACTION_C if qc_s >= qd_s else ACTION_D)
            self.trace_log.append(
                {
                    "kind": "cloud",
                    "p_state": p_vec,
                    "q_c": q_c,
                    "q_d": q_d,
                    "delta_q_state": dqs,
                    "policy": pol,
                    "phase": phase,
                }
            )
        return act


class ExpectimaxMarkovAgent(axl.Player):
    """
    Etapa III: Agente Expectimax + A* (Gary, H=4, 256 hojas) con heurística terminal de
    Cadena de Markov Bellman cerrada (I - gamma P_TFT)^{-1} P_TFT R.
    """

    name = "3. Expectimax H=4 + Markov"
    classifier = {
        "memory_depth": float("inf"),
        "stochastic": False,
        "makes_use_of": set(),
        "long_run_time": False,
        "inspects_source": False,
        "manipulates_source": False,
        "manipulates_state": False,
    }
    R_VEC = np.array([3.0, 0.0, 5.0, 1.0], dtype=np.float64)

    def __init__(
        self,
        horizon: int = 4,
        gamma: float = 0.95,
        use_markov_leaves: bool = True,
        player_name: str | None = None,
        record_trace: bool = False,
    ):
        super().__init__()
        self.horizon = int(horizon)
        self.gamma = float(gamma)
        self.use_markov_leaves = bool(use_markov_leaves)
        self.record_trace = bool(record_trace)
        if player_name is not None:
            self.name = player_name
        self.reset_learning()

    def reset_learning(self) -> None:
        self.counts = {s: {C: 0, D: 0} for s in STATES_TUP}
        self.last_state = None
        self.prev_state = None
        self.trace_log: list[dict[str, Any]] = []

    def reset(self) -> None:
        super().reset()
        self.reset_learning()

    def get_strategy_vector_E(self) -> dict[tuple[axl.Action, axl.Action], float]:
        E = {}
        for s in STATES_TUP:
            n_c = self.counts[s][C]
            n_d = self.counts[s][D]
            total = n_c + n_d
            E[s] = (n_c / total) if total > 0 else 0.0
        return E

    def observe_and_update_E(self, opponent: axl.Player) -> None:
        if not self.history or not opponent.history:
            return
        current_obs = (self.history[-1], opponent.history[-1])
        opp_response = opponent.history[-1]
        if self.last_state is not None:
            self.counts[self.last_state][opp_response] += 1
        else:
            self.counts[(C, C)][opp_response] += 1
        self.last_state = current_obs
        self.prev_state = current_obs

    def build_markov_transition_matrix(self, E: dict) -> np.ndarray:
        p_cc, p_cd, p_dc, p_dd = E[(C, C)], E[(C, D)], E[(D, C)], E[(D, D)]
        return np.array(
            [
                [p_cc, 1.0 - p_cc, 0.0, 0.0],
                [0.0, 0.0, p_cd, 1.0 - p_cd],
                [p_dc, 1.0 - p_dc, 0.0, 0.0],
                [0.0, 0.0, p_dd, 1.0 - p_dd],
            ],
            dtype=np.float64,
        )

    def solve_bellman_markov_leaves(self, E: dict) -> tuple[dict, list[float]]:
        if not self.use_markov_leaves:
            zeros = {s: 0.0 for s in STATES_TUP}
            return zeros, [0.0, 0.0, 0.0, 0.0]
        P = self.build_markov_transition_matrix(E)
        I_minus_gamma_P = np.eye(4, dtype=np.float64) - self.gamma * P
        v_markov = np.linalg.solve(I_minus_gamma_P, P @ self.R_VEC)
        gamma_H = self.gamma**self.horizon
        leaf_h = {STATES_TUP[i]: float(gamma_H * v_markov[i]) for i in range(4)}
        return leaf_h, [float(x) for x in v_markov]

    def _expectimax_a_star(
        self,
        depth: int,
        current_state: tuple[axl.Action, axl.Action],
        g_accum: float,
        discount_step: float,
        E: dict,
        leaf_h: dict,
    ) -> float:
        if depth == self.horizon:
            if self.use_markov_leaves:
                return (1.0 - self.gamma) * (g_accum + leaf_h[current_state])
            norm_denom = (1.0 - self.gamma**self.horizon) / (1.0 - self.gamma)
            return g_accum / norm_denom

        p_c = E[current_state]
        p_d = 1.0 - p_c
        next_disc = discount_step * self.gamma

        val_cc = self._expectimax_a_star(depth + 1, (C, C), g_accum + discount_step * 3.0, next_disc, E, leaf_h)
        val_cd = self._expectimax_a_star(depth + 1, (C, D), g_accum + discount_step * 0.0, next_disc, E, leaf_h)
        exp_c = p_c * val_cc + p_d * val_cd

        val_dc = self._expectimax_a_star(depth + 1, (D, C), g_accum + discount_step * 5.0, next_disc, E, leaf_h)
        val_dd = self._expectimax_a_star(depth + 1, (D, D), g_accum + discount_step * 1.0, next_disc, E, leaf_h)
        exp_d = p_c * val_dc + p_d * val_dd

        return exp_c if exp_c >= exp_d else exp_d

    def _evaluate_root_detailed(self, state, E: dict, leaf_h: dict) -> dict[str, Any]:
        p_c = float(E[state])
        p_d = 1.0 - p_c
        val_cc = float(self._expectimax_a_star(1, (C, C), 3.0, self.gamma, E, leaf_h))
        val_cd = float(self._expectimax_a_star(1, (C, D), 0.0, self.gamma, E, leaf_h))
        val_dc = float(self._expectimax_a_star(1, (D, C), 5.0, self.gamma, E, leaf_h))
        val_dd = float(self._expectimax_a_star(1, (D, D), 1.0, self.gamma, E, leaf_h))
        f_c = p_c * val_cc + p_d * val_cd
        f_d = p_c * val_dc + p_d * val_dd
        return {
            "p_c": round(p_c, 4),
            "p_d": round(p_d, 4),
            "val_cc": round(val_cc, 4),
            "val_cd": round(val_cd, 4),
            "val_dc": round(val_dc, 4),
            "val_dd": round(val_dd, 4),
            "f_c": round(float(f_c), 4),
            "f_d": round(float(f_d), 4),
        }

    def _evaluate_root(self, state, E: dict, leaf_h: dict) -> tuple[float, float]:
        det = self._evaluate_root_detailed(state, E, leaf_h)
        return det["f_c"], det["f_d"]

    def _snapshot_counts(self) -> list[list[int]]:
        return [[int(self.counts[s][C]), int(self.counts[s][D])] for s in STATES_TUP]

    def strategy(self, opponent: axl.Player) -> axl.Action:
        if len(self.history) == 0:
            self.reset_learning()
            if self.record_trace:
                self.trace_log.append(
                    {
                        "kind": "gary",
                        "turn": 1,
                        "is_opening": True,
                        "current_state": None,
                        "updated_state": None,
                        "opp_observed": None,
                        "counts": self._snapshot_counts(),
                        "E": [0.0, 0.0, 0.0, 0.0],
                        "v_markov": [0.0, 0.0, 0.0, 0.0],
                        "leaf_h": [0.0, 0.0, 0.0, 0.0],
                        "p_c": 0.0,
                        "p_d": 1.0,
                        "val_cc": 3.0,
                        "val_cd": 0.0,
                        "val_dc": 5.0,
                        "val_dd": 1.0,
                        "f_c": 3.0,
                        "f_d": 1.0,
                        "chosen": "C",
                        "delta_q_state": [2.0, 0.0, 0.0, 0.0],
                        "policy": [ACTION_C, ACTION_D, ACTION_C, ACTION_D],
                    }
                )
            return C

        prev_before_obs = self.last_state
        opp_resp = opponent.history[-1]
        updated_bucket = prev_before_obs if prev_before_obs is not None else (C, C)
        self.observe_and_update_E(opponent)
        E_t = self.get_strategy_vector_E()
        leaf_h, v_markov = self.solve_bellman_markov_leaves(E_t)
        root_det = self._evaluate_root_detailed(self.last_state, E_t, leaf_h)
        f_c, f_d = root_det["f_c"], root_det["f_d"]
        chosen = C if f_c >= f_d else D

        if self.record_trace:
            dqs = []
            pol = []
            for st in STATES_TUP:
                fc_s, fd_s = self._evaluate_root(st, E_t, leaf_h)
                dqs.append(round(float(fc_s - fd_s), 4))
                pol.append(ACTION_C if fc_s >= fd_s else ACTION_D)
            st_lbl = lambda tup: f"{tup[0].name}{tup[1].name}" if tup is not None else None
            self.trace_log.append(
                {
                    "kind": "gary",
                    "turn": len(self.history) + 1,
                    "is_opening": False,
                    "current_state": st_lbl(self.last_state),
                    "updated_state": st_lbl(updated_bucket),
                    "opp_observed": opp_resp.name,
                    "counts": self._snapshot_counts(),
                    "E": [round(float(E_t[s]), 4) for s in STATES_TUP],
                    "v_markov": [round(float(v), 4) for v in v_markov],
                    "leaf_h": [round(float(leaf_h[s]), 4) for s in STATES_TUP],
                    "p_c": root_det["p_c"],
                    "p_d": root_det["p_d"],
                    "val_cc": root_det["val_cc"],
                    "val_cd": root_det["val_cd"],
                    "val_dc": root_det["val_dc"],
                    "val_dd": root_det["val_dd"],
                    "f_c": f_c,
                    "f_d": f_d,
                    "chosen": chosen.name,
                    "delta_q_state": dqs,
                    "policy": pol,
                }
            )
        return chosen


class CustomMemory1Agent(axl.Player):
    """Estrategia Memoria-1 configurable visualmente (determinista o estocástica)."""

    name = "Custom Memory-1"
    classifier = {
        "memory_depth": 1,
        "stochastic": True,
        "makes_use_of": set(),
        "long_run_time": False,
        "inspects_source": False,
        "manipulates_source": False,
        "manipulates_state": False,
    }

    def __init__(
        self,
        first_move: str = "C",
        probs: list[float] | None = None,
        player_name: str = "Custom Memory-1",
    ):
        super().__init__()
        self.first_move = "C" if str(first_move).upper() == "C" else "D"
        self.probs = [float(x) for x in (probs or [1.0, 0.0, 1.0, 0.0])]
        self.name = player_name
        self.classifier = dict(self.classifier)
        self.classifier["stochastic"] = any(0.0 < p < 1.0 for p in self.probs)

    def strategy(self, opponent: axl.Player) -> axl.Action:
        if not self.history:
            return C if self.first_move == "C" else D
        s_idx = STATE_MAP[(self.history[-1], opponent.history[-1])]
        p = self.probs[s_idx]
        if p >= 1.0:
            return C
        if p <= 0.0:
            return D
        return C if self._random.random() < p else D


class CustomPhaseRival(axl.Player):
    """Rival no estacionario configurable por fases arbitrarias."""

    name = "Custom Phase Rival"
    classifier = {
        "memory_depth": float("inf"),
        "stochastic": True,
        "makes_use_of": set(),
        "long_run_time": False,
        "inspects_source": False,
        "manipulates_source": False,
        "manipulates_state": False,
    }

    def __init__(
        self,
        phases: list[dict[str, Any]] | None = None,
        player_name: str = "Custom Phase Rival",
    ):
        super().__init__()
        self.phases = list(
            phases
            or [
                {"until": 60, "mode": "C"},
                {"until": 130, "mode": "D"},
                {"until": 200, "mode": "C"},
            ]
        )
        self.name = player_name
        self._grudge = False
        is_st = any(p.get("mode") in ("Random", "Joss") for p in self.phases)
        self.classifier = dict(self.classifier)
        self.classifier["stochastic"] = is_st

    def reset(self) -> None:
        super().reset()
        self._grudge = False

    def strategy(self, opponent: axl.Player) -> axl.Action:
        t = len(self.history) + 1
        mode = self.phases[-1].get("mode", "C")
        for seg in self.phases:
            if t <= int(seg.get("until", 200)):
                mode = seg.get("mode", "C")
                break
        if opponent.history and opponent.history[-1] == D:
            self._grudge = True

        if mode == "C":
            return C
        if mode == "D":
            return D
        if mode == "Alternator":
            return C if (t % 2 == 1) else D
        if mode == "TFT":
            return C if not opponent.history else opponent.history[-1]
        if mode == "WSLS":
            if not self.history:
                return C
            return C if self.history[-1] == opponent.history[-1] else D
        if mode == "Grudger":
            return D if self._grudge else C
        if mode == "Random":
            return C if self._random.random() < 0.5 else D
        if mode == "Joss":
            if not opponent.history:
                return C
            if opponent.history[-1] == D:
                return D
            return D if self._random.random() < 0.1 else C
        return C


def compile_custom_python_strategy(code: str, display_name: str | None = None) -> tuple[type[axl.Player], str]:
    """
    Compila código Python enviado por el usuario buscando una subclase de axelrod.Player.
    Bloquea imports peligrosos de sistema/red para mantener una ejecución limpia y segura.
    """
    forbidden_tokens = [
        "import os",
        "import sys",
        "import subprocess",
        "import socket",
        "import shutil",
        "__import__",
        "open(",
        "eval(",
        "exec(",
        "pathlib",
    ]
    lowered = code.lower()
    for tok in forbidden_tokens:
        if tok in lowered:
            raise ValueError(f"Instrucción no permitida en el editor de estrategias: '{tok}'")

    safe_builtins = {
        "abs": abs,
        "all": all,
        "any": any,
        "bool": bool,
        "dict": dict,
        "enumerate": enumerate,
        "float": float,
        "int": int,
        "len": len,
        "list": list,
        "max": max,
        "min": min,
        "pow": pow,
        "range": range,
        "round": round,
        "set": set,
        "sorted": sorted,
        "str": str,
        "sum": sum,
        "tuple": tuple,
        "zip": zip,
        "super": super,
        "isinstance": isinstance,
        "hasattr": hasattr,
        "getattr": getattr,
        "setattr": setattr,
        "__build_class__": __build_class__,
        "Exception": Exception,
        "ValueError": ValueError,
    }

    namespace: dict[str, Any] = {
        "__builtins__": safe_builtins,
        "__name__": "custom_strategy_sandbox",
        "axl": axl,
        "Action": axl.Action,
        "Player": axl.Player,
        "C": C,
        "D": D,
        "np": np,
        "math": math,
        "random": random,
        "STATES": STATES,
        "STATE_MAP": STATE_MAP,
        "PAYOFF": PAYOFF,
        "ACTION_C": ACTION_C,
        "ACTION_D": ACTION_D,
        "ACTIONS": ACTIONS,
        "UNIFORM_PRIOR_P": UNIFORM_PRIOR_P,
        "solve_bellman": solve_bellman,
        "build_mdp_transition_matrix": build_mdp_transition_matrix,
        "EmpiricalPolicyAgent": EmpiricalPolicyAgent,
        "ForgettingTransitionRLAgent": ForgettingTransitionRLAgent,
        "BayesianFrequencyRLAgent": BayesianFrequencyRLAgent,
    }

    exec(compile(code, "<custom_strategy>", "exec"), namespace)  # noqa: S102

    found_classes = [
        obj
        for obj in namespace.values()
        if isinstance(obj, type)
        and issubclass(obj, axl.Player)
        and obj
        not in (
            axl.Player,
            EmpiricalPolicyAgent,
            ForgettingTransitionRLAgent,
            BayesianFrequencyRLAgent,
        )
        and getattr(obj, "__module__", "") != "axelrod.player"
    ]
    if not found_classes:
        raise ValueError("El código debe definir al menos una clase que herede de axl.Player.")

    cls = found_classes[-1]
    inst = cls()
    final_name = display_name.strip() if display_name and display_name.strip() else str(inst.name)

    # Ensure clone() works cleanly with no-arg init and preserves display_name
    orig_init = cls.__init__

    def _wrapped_init(self, *args, **kwargs):
        orig_init(self, *args, **kwargs)
        self.name = final_name

    cls.__init__ = _wrapped_init
    cls.name = final_name
    return cls, final_name


PYTHON_TEMPLATES: dict[str, dict[str, str]] = {
    "tf2t_forgiving": {
        "title": "Tit For Two Tats con Perdón",
        "description": "Tolera una traición aislada y solo castiga tras dos traiciones consecutivas del rival.",
        "code": '''class MiTitForTwoTats(axl.Player):
    """Coopera salvo que el rival haya traicionado en los últimos 2 turnos."""
    name = "Mi Tit For 2 Tats"
    classifier = {"memory_depth": 2, "stochastic": False}

    def strategy(self, opponent):
        if len(opponent.history) < 2:
            return C
        if opponent.history[-1] == D and opponent.history[-2] == D:
            return D
        return C
''',
    },
    "q_learning_mem1": {
        "title": "Q-Learning Tabular (RL Model-Free)",
        "description": "Agente RL libre de modelo que aprende Q(s, a) turno a turno con tasa alpha y exploración epsilon.",
        "code": '''class MiQLearningMem1(axl.Player):
    """Q-Learning tabular sobre los 4 estados de memoria-1 {CC, CD, DC, DD}."""
    name = "Mi Q-Learning (Model-Free)"
    classifier = {"memory_depth": float("inf"), "stochastic": True}

    def __init__(self, alpha=0.25, gamma=0.90, epsilon=0.05):
        super().__init__()
        self.alpha = alpha
        self.gamma = gamma
        self.epsilon = epsilon
        self._init_q()

    def _init_q(self):
        # Inicialización optimista hacia cooperación mutua
        self.Q = {s: {C: 3.0, D: 2.5} for s in range(4)}

    def reset(self):
        super().reset()
        self._init_q()

    def strategy(self, opponent):
        if not self.history:
            return C
        curr_s = STATE_MAP[(self.history[-1], opponent.history[-1])]
        if len(self.history) >= 2:
            prev_s = STATE_MAP[(self.history[-2], opponent.history[-2])]
            a_prev = self.history[-1]
            o_prev = opponent.history[-1]
            r = PAYOFF[(ACTION_C if a_prev == C else ACTION_D,
                        ACTION_C if o_prev == C else ACTION_D)]
            best_next = max(self.Q[curr_s][C], self.Q[curr_s][D])
            self.Q[prev_s][a_prev] += self.alpha * (r + self.gamma * best_next - self.Q[prev_s][a_prev])

        if self._random.random() < self.epsilon:
            return C if self._random.random() < 0.5 else D
        return C if self.Q[curr_s][C] >= self.Q[curr_s][D] else D
''',
    },
    "grudger_forgiving": {
        "title": "Grudger con Reconciliación (k=4)",
        "description": "Castiga por 4 turnos tras una traición, luego ofrece una rama de olivo para restaurar CC.",
        "code": '''class GrudgerReconciliador(axl.Player):
    """Castiga durante k turnos tras una traición y luego intenta reconciliar."""
    name = "Grudger Reconciliador (k=4)"
    classifier = {"memory_depth": float("inf"), "stochastic": False}

    def __init__(self, punish_turns=4):
        super().__init__()
        self.punish_turns = punish_turns
        self.remaining_punish = 0

    def reset(self):
        super().reset()
        self.remaining_punish = 0

    def strategy(self, opponent):
        if not opponent.history:
            return C
        if opponent.history[-1] == D and self.remaining_punish == 0:
            self.remaining_punish = self.punish_turns
        if self.remaining_punish > 0:
            self.remaining_punish -= 1
            return D
        return C
''',
    },
    "mdp_custom_forget": {
        "title": "MDP RL Personalizado (Olvido Asimétrico)",
        "description": "Extiende el modelo MDP 8x4 del Taller 5 olvidando más rápido ante traiciones que ante cooperaciones.",
        "code": '''class RLAsimetricoMDP(axl.Player):
    """RL MDP 8x4 con olvido asimétrico: reacciona más rápido a traiciones (lam_d=0.75)."""
    name = "RL MDP Olvido Asimetrico"
    classifier = {"memory_depth": float("inf"), "stochastic": False}

    def __init__(self, gamma=0.90, n0=2.0, lam_c=0.93, lam_d=0.75):
        super().__init__()
        self.gamma = gamma
        self.n0 = n0
        self.lam_c = lam_c
        self.lam_d = lam_d
        self._init_model()

    def _init_model(self):
        # Prior empírico del Taller 5 (Tabla 1)
        self.p = {
            (0, ACTION_D): 0.8220, (0, ACTION_C): 0.9530,
            (1, ACTION_D): 0.5128, (1, ACTION_C): 0.3631,
            (2, ACTION_D): 0.4818, (2, ACTION_C): 0.3348,
            (3, ACTION_D): 0.1574, (3, ACTION_C): 0.2586,
        }
        self.n = {k: self.n0 for k in self.p}

    def reset(self):
        super().reset()
        self._init_model()

    def strategy(self, opponent):
        if not self.history:
            self._init_model()
            return C
        if len(self.history) >= 2:
            prev_s = STATE_MAP[(self.history[-2], opponent.history[-2])]
            act = ACTION_C if self.history[-1] == C else ACTION_D
            y = 1.0 if opponent.history[-1] == C else 0.0
            lam = self.lam_c if y == 1.0 else self.lam_d
            key = (prev_s, act)
            self.n[key] = lam * self.n[key] + 1.0
            eta = 1.0 / self.n[key]
            self.p[key] = (1.0 - eta) * self.p[key] + eta * y

        bellman = solve_bellman(self.p, gamma=self.gamma, tol=1e-5, max_iter=35)
        curr_s = STATE_MAP[(self.history[-1], opponent.history[-1])]
        return C if bellman.policy[curr_s] == ACTION_C else D
''',
    },
    "prober_adaptativo": {
        "title": "Prober Inteligente (Detecta Explotables)",
        "description": "Abre con C, D, C, C: si el rival no castiga la traición del turno 2, lo explota con D; si castiga, juega TFT.",
        "code": '''class ProberInteligente(axl.Player):
    """Sondea al rival en turno 2; explota incondicionales y coopera con recíprocos."""
    name = "Prober Inteligente"
    classifier = {"memory_depth": float("inf"), "stochastic": False}

    def strategy(self, opponent):
        t = len(self.history)
        opening = [C, D, C, C]
        if t < 4:
            return opening[t]
        # Si el rival cooperó en turnos 3 y 4 pese a nuestra D en turno 2 -> explotar
        if opponent.history[2] == C and opponent.history[3] == C:
            return D
        return opponent.history[-1]
''',
    },
}
