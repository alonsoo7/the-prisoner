"""Agentes del Taller 5 (Alonso Toro - TEL-351 Agentes Inteligentes):
0. Preámbulo (Taller IV):
   - CloudMiope (Sección 7: gamma = 0, transición pasiva P(O_t | s_{t-1}) y exploración alternante t <= 10)
   - RulitoBellman (Sección 8: gamma = 0.90, transición pasiva no condicionada en A_t y exploración alternante t <= 10)
1. Agente Base (Secciones 1 y 2):
   - EmpiricalPolicyAgent: política estacionaria fija pi_0 = [C, D, D, C] (CDDC) obtenida offline de T_0 + Bellman.
2. Agente con Aprendizaje 'Mitcha' (Secciones 3 y 4):
   - ForgettingTransitionRLAgent: parte del prior poblacional p_0(s, a) anclado con peso inicial n_0 = 2.0,
     actualiza en línea la matriz 8x4 T_t[(s, a), s'] mediante el contador efectivo con factor de olvido
         n_k(s, a) = lambda * n_{k-1}(s, a) + 1,   eta_k = 1 / n_k(s, a)
         T_k[(s, a), s'] = (1 - eta_k) * T_{k-1}[(s, a), s'] + eta_k * I(s' = s_next)
     se reinicia al inicio de cada enfrentamiento (reset_model()) para evitar contaminación cruzada entre rivales,
     y replanifica la política pi_t con Value Iteration en cada turno.
"""

from __future__ import annotations

import axelrod as axl

from ipd_mdp import (
    ACTION_C,
    ACTION_D,
    C,
    D,
    STATE_MAP,
    UNIFORM_PRIOR_P,
    BellmanResult,
    build_mdp_transition_matrix,
    solve_bellman,
)

STATES_TUP = [(C, C), (C, D), (D, C), (D, D)]


class CloudMiope(axl.Player):
    """Preámbulo Taller IV, Sección 7 ('Cloud', política miope gamma = 0):
    Exploración alternante forzada (C, D, C, D...) durante t <= 10, conteo pasivo de 4 estados P(O_t=C | s_{t-1})
    y maximización del pago inmediato E[R_t]. Falla porque E[D] = 4p + 1 > 3p = E[C] para todo p en [0, 1].
    """

    name = "Cloud (Taller IV Sec. 7, gamma=0)"

    def __init__(self, exploration_turns: int = 10, player_name: str | None = None):
        super().__init__()
        self.exploration_turns = int(exploration_turns)
        if player_name is not None:
            self.name = player_name
        self.reset_counts()

    def reset_counts(self) -> None:
        self.counts = {s: {C: 0, D: 0} for s in STATES_TUP}
        self.prev_state: tuple[axl.Action, axl.Action] | None = None

    def reset(self) -> None:
        super().reset()
        self.reset_counts()

    def strategy(self, opponent: axl.Player) -> axl.Action:
        t = len(self.history)
        if t == 0:
            self.reset_counts()
            return C

        curr = (self.history[-1], opponent.history[-1])
        if self.prev_state is not None:
            self.counts[self.prev_state][opponent.history[-1]] += 1
        self.prev_state = curr

        if t < self.exploration_turns:
            return C if t % 2 == 0 else D

        tot = self.counts[curr][C] + self.counts[curr][D]
        p_c = (self.counts[curr][C] / tot) if tot > 0 else 0.5
        q_c = 3.0 * p_c
        q_d = 4.0 * p_c + 1.0
        return C if q_c >= q_d else D


class RulitoBellman(axl.Player):
    """Preámbulo Taller IV, Sección 8 ('Rulito', 1-Step Bellman gamma = 0.90 sin condicionar en A_t):
    Exploración alternante forzada para t <= 10 (traiciona en t=2 activando a Grudger) y estima solo 4
    probabilidades pasivas por estado sin condicionar en la acción propia A_t.
    """

    name = "Rulito (Taller IV Sec. 8, gamma=0.90)"

    def __init__(self, gamma: float = 0.90, exploration_turns: int = 10, player_name: str | None = None):
        super().__init__()
        self.gamma = float(gamma)
        self.exploration_turns = int(exploration_turns)
        if player_name is not None:
            self.name = player_name
        self.reset_counts()

    def reset_counts(self) -> None:
        self.counts = {s: {C: 0, D: 0} for s in STATES_TUP}
        self.prev_state: tuple[axl.Action, axl.Action] | None = None

    def reset(self) -> None:
        super().reset()
        self.reset_counts()

    def _p_coop(self, s: tuple[axl.Action, axl.Action]) -> float:
        tot = self.counts[s][C] + self.counts[s][D]
        return (self.counts[s][C] / tot) if tot > 0 else 0.5

    def strategy(self, opponent: axl.Player) -> axl.Action:
        t = len(self.history)
        if t == 0:
            self.reset_counts()
            return C

        curr = (self.history[-1], opponent.history[-1])
        if self.prev_state is not None:
            self.counts[self.prev_state][opponent.history[-1]] += 1
        self.prev_state = curr

        if t < self.exploration_turns:
            return C if t % 2 == 0 else D

        p_c = self._p_coop(curr)
        p_d = 1.0 - p_c
        v_next = {st: 4.0 * self._p_coop(st) + 1.0 for st in STATES_TUP}
        q_c = p_c * (3.0 + self.gamma * v_next[(C, C)]) + p_d * (0.0 + self.gamma * v_next[(C, D)])
        q_d = p_c * (5.0 + self.gamma * v_next[(D, C)]) + p_d * (1.0 + self.gamma * v_next[(D, D)])
        return C if q_c >= q_d else D


class EmpiricalPolicyAgent(axl.Player):
    """Agente Base del Taller 5 (sin aprendizaje en línea):
    Aplica la política estacionaria determinista pi_0 = [C, D, D, C] (CDDC / Pavlov) obtenida offline
    al resolver Bellman (gamma = 0.90) sobre la matriz de transición 8x4 T_0 (N = 173,130 transiciones).
    """

    name = "Etapa 1: Politica Fija (Tabla Frecuencias)"

    def __init__(self, policy: list[int], player_name: str | None = None):
        super().__init__()
        self.policy = list(policy)
        if player_name is not None:
            self.name = player_name

    def strategy(self, opponent: axl.Player) -> axl.Action:
        """Abre cooperando en t=1 (Nice), y desde t>=2 aplica pi_0[s_{t-1}]."""
        if not self.history:
            return C
        current_s = STATE_MAP[(self.history[-1], opponent.history[-1])]
        return C if self.policy[current_s] == ACTION_C else D


class ForgettingTransitionRLAgent(axl.Player):
    """Agente con Aprendizaje del Taller 5 ('Mitcha'):
    - Parte de la distribución condicional previa p_0(s, a) = P_0(O_t = C | s_{t-1}=s, A_t=a) (matriz 8x4 T_0),
      anclada con un peso inicial ligero n_0 = 2.0 ('ancla débil').
    - Al inicio de cada enfrentamiento (t=1, `not self.history`) invoca `reset_model()` para restaurar (T_0, n_0)
      y evitar contaminación cruzada entre distintos rivales del torneo.
    - En cada turno t >= 3 (`len(self.history) >= 2`), captura la ventana cerrada de 2 turnos
      (s_{t-2}, A_{t-1}) -> O_{t-1}, actualiza únicamente el contador efectivo del contexto observado:
          n_k(s, a) = lambda * n_{k-1}(s, a) + 1,   eta_k = 1 / n_k(s, a)
      pondera convexamente la fila de la matriz 8x4 T_t[(s, a), s']:
          T_k[(s, a), s'] = (1 - eta_k) * T_{k-1}[(s, a), s'] + eta_k * I(s' = s_next)
      (equivalente a sumar eta_k * (1 - p_{k-1}) si O_{t-1}=C o restar eta_k * p_{k-1} si O_{t-1}=D),
      y replanifica la política pi_t ejecutando Value Iteration (gamma = 0.90) hasta que max_s |V^(k)(s) - V^(k-1)(s)| <= 1e-6 (0.000001).
    - Nota: Con `forgetting_factor=1.0` reproduce exactamente el aprendizaje acumulativo sin olvido (lambda = 1.00).
    """

    name = "RL Online: Matriz Incremental (Olvido)"

    def __init__(
        self,
        prior_p: dict[tuple[int, int], float] | None = None,
        gamma: float = 0.90,
        initial_count: float = 2.0,
        forgetting_factor: float = 0.90,
        bellman_tol: float = 1e-6,
        bellman_max_iter: int = 2000,
        player_name: str | None = None,
        record_trace: bool = False,
    ):
        if not (0.0 <= forgetting_factor <= 1.0):
            raise ValueError(f"forgetting_factor must be in [0.0, 1.0], got {forgetting_factor}")
        if initial_count < 0.0:
            raise ValueError(f"initial_count must be >= 0.0, got {initial_count}")

        super().__init__()
        self.prior_p = dict(prior_p) if prior_p is not None else dict(UNIFORM_PRIOR_P)
        self.gamma = float(gamma)
        self.initial_count = float(initial_count)
        self.forgetting_factor = float(forgetting_factor)
        self.bellman_tol = float(bellman_tol)
        self.bellman_max_iter = int(bellman_max_iter)
        self.record_trace = bool(record_trace)
        if player_name is not None:
            self.name = player_name

        self.effective_counts: dict[tuple[int, int], float] = {}
        self.mdp_transitions: dict[tuple[int, int], dict[int, float]] = {}
        self.last_eta: dict[tuple[int, int], float] = {}
        self.last_bellman: BellmanResult | None = None
        self.trace_log: list[dict] = []
        self.reset_model()

    def reset_model(self) -> None:
        """Restaura la matriz 8x4 al prior poblacional T_0 y los contadores efectivos a n_0."""
        self.mdp_transitions = build_mdp_transition_matrix(self.prior_p)
        self.effective_counts = {k: self.initial_count for k in self.prior_p}
        self.last_eta = {k: 0.0 for k in self.prior_p}
        self.last_bellman = None
        self.trace_log = []

    def current_transition_probs(self) -> dict[tuple[int, int], float]:
        """Extrae las 8 probabilidades P_t(O_t = C | s, a) desde la matriz 8x4 activa."""
        return {
            (s, a): self.mdp_transitions[(s, a)][0 if a == ACTION_C else 2]
            for (s, a) in self.prior_p
        }

    def _update_model(self, prev_s: int, act_idx: int, opp_last_move: axl.Action) -> None:
        """Actualiza el contador efectivo n_k = lambda * n_{k-1} + 1 y la fila observada con paso eta_k = 1 / n_k."""
        key = (prev_s, act_idx)
        self.effective_counts[key] = self.forgetting_factor * self.effective_counts[key] + 1.0
        eta = 1.0 / self.effective_counts[key]
        self.last_eta[key] = eta

        my_last_action = C if act_idx == ACTION_C else D
        next_s = STATE_MAP[(my_last_action, opp_last_move)]
        row = self.mdp_transitions[key]
        for s_idx in range(4):
            target = 1.0 if s_idx == next_s else 0.0
            row[s_idx] = (1.0 - eta) * row[s_idx] + eta * target

    def _solve_and_maybe_record(self) -> BellmanResult:
        """Resuelve Bellman sobre la matriz actual T_t y registra la traza si record_trace=True."""
        p_t = self.current_transition_probs()
        bellman = solve_bellman(
            p_t,
            gamma=self.gamma,
            tol=self.bellman_tol,
            max_iter=self.bellman_max_iter,
        )
        self.last_bellman = bellman
        if self.record_trace:
            self.trace_log.append(
                {
                    "probs": p_t,
                    "delta_q": list(bellman.delta_q),
                    "policy": list(bellman.policy),
                    "effective_counts": dict(self.effective_counts),
                    "etas": dict(self.last_eta),
                    "iterations": bellman.iterations,
                }
            )
        return bellman

    def strategy(self, opponent: axl.Player) -> axl.Action:
        """Ciclo de decisión en línea por turno."""
        if not self.history:
            self.reset_model()
            if self.record_trace:
                self._solve_and_maybe_record()
            return C

        if len(self.history) >= 2:
            prev_s = STATE_MAP[(self.history[-2], opponent.history[-2])]
            act_idx = ACTION_C if self.history[-1] == C else ACTION_D
            self._update_model(prev_s, act_idx, opponent.history[-1])

        bellman = self._solve_and_maybe_record()
        current_s = STATE_MAP[(self.history[-1], opponent.history[-1])]
        return C if bellman.policy[current_s] == ACTION_C else D
