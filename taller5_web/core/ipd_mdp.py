"""Módulo MDP del Dilema del Prisionero Iterado (Taller 5 - Alonso Toro):
- Estados de memoria-1: S = {CC, CD, DC, DD}
- Acciones: A = {C, D} (8 contextos (s_{t-1}, A_t))
- Tabla de frecuencias supervisada exacta: p_0(s, a) = K_{s,a} / N_{s,a} (N = 173,130 transiciones)
- Matriz de transición del entorno 8x4: T_0[(s, a), s'] = P(s_t = s' | s_{t-1} = s, A_t = a)
- Solver de Bellman mediante Value Iteration (gamma = 0.90) -> política base pi_0 = CDDC.
"""

from dataclasses import dataclass
import axelrod as axl

C = axl.Action.C
D = axl.Action.D

ACTION_D = 0
ACTION_C = 1
ACTIONS = (ACTION_D, ACTION_C)
ACTION_LABELS = {ACTION_D: "D", ACTION_C: "C"}

STATES = ("CC", "CD", "DC", "DD")
STATE_MAP = {
    (C, C): 0,
    (C, D): 1,
    (D, C): 2,
    (D, D): 3,
}

# Matriz de pagos estándar de Axelrod: (mi_accion, accion_rival) -> pago
PAYOFF = {
    (ACTION_C, ACTION_C): 3.0,
    (ACTION_C, ACTION_D): 0.0,
    (ACTION_D, ACTION_C): 5.0,
    (ACTION_D, ACTION_D): 1.0,
}

UNIFORM_PRIOR_P = {(s, a): 0.5 for s in range(4) for a in ACTIONS}


@dataclass(frozen=True)
class FrequencyTableResult:
    """Tabla empírica de 8 contextos y matriz de transición 8x4 inducida."""

    counts_coop: dict[tuple[int, int], int]
    counts_total: dict[tuple[int, int], int]
    p_coop: dict[tuple[int, int], float]
    mdp_transitions: dict[tuple[int, int], dict[int, float]]
    total_transitions: int


@dataclass(frozen=True)
class BellmanResult:
    """Funciones de valor V*(s), Q*(s, a), ventaja Delta Q*(s) y política determinista pi[s]."""

    v_values: list[float]
    q_values: dict[tuple[int, int], float]
    delta_q: list[float]
    policy: list[int]
    iterations: int = 0


def build_training_pool() -> list[axl.Player]:
    """Retorna el conjunto diverso de 30 estrategias de Axelrod para estimar T_0."""
    strategy_classes = [
        axl.Cooperator,
        axl.Defector,
        axl.TitForTat,
        axl.TitFor2Tats,
        axl.TwoTitsForTat,
        axl.Grudger,
        axl.WinStayLoseShift,
        axl.Alternator,
        axl.Random,
        axl.Bully,
        axl.GTFT,
        axl.HardTitForTat,
        axl.SuspiciousTitForTat,
        axl.ZDExtort2,
        axl.ZDGTFT2,
        axl.Adaptive,
        axl.Detective,
        axl.Appeaser,
        axl.CyclerCCD,
        axl.CyclerDDC,
        axl.Prober,
        axl.Prober2,
        axl.Gradual,
        axl.FoolMeOnce,
        axl.GoByMajority,
        axl.HardGoByMajority,
        axl.ContriteTitForTat,
        axl.SlowTitForTwoTats2,
        axl.BackStabber,
        axl.AverageCopier,
    ]
    return [cls() for cls in strategy_classes]


def _record_perspective(
    my_history: list[axl.Action],
    opp_history: list[axl.Action],
    counts_coop: dict[tuple[int, int], int],
    counts_total: dict[tuple[int, int], int],
) -> None:
    """Acumula conteos de ventanas de 2 turnos (s_{t-1}, A_t) -> O_t de un jugador."""
    for t in range(1, len(my_history)):
        prev_state = STATE_MAP[(my_history[t - 1], opp_history[t - 1])]
        my_action = ACTION_C if my_history[t] == C else ACTION_D
        opp_coop = 1 if opp_history[t] == C else 0
        key = (prev_state, my_action)
        counts_total[key] += 1
        counts_coop[key] += opp_coop


def build_mdp_transition_matrix(
    p_coop: dict[tuple[int, int], float],
) -> dict[tuple[int, int], dict[int, float]]:
    """Construye la matriz de transición completa 8x4 T[(s, a), s'] = P(s_t = s' | s_{t-1} = s, A_t = a)."""
    transitions: dict[tuple[int, int], dict[int, float]] = {}
    for s in range(4):
        for a in ACTIONS:
            p_c = p_coop[(s, a)]
            if a == ACTION_C:
                row = {0: p_c, 1: 1.0 - p_c, 2: 0.0, 3: 0.0}
            else:
                row = {0: 0.0, 1: 0.0, 2: p_c, 3: 1.0 - p_c}
            transitions[(s, a)] = row
    return transitions


def collect_frequency_table(
    strategies: list[axl.Player],
    turns: int = 200,
    repetitions: int = 1,
    seed: int | None = 42,
) -> FrequencyTableResult:
    """Simula duelos todos contra todos y estima p_0(s, a) = K_{s,a} / N_{s,a} por conteo exacto."""
    keys = [(s, a) for s in range(4) for a in ACTIONS]
    counts_coop = {k: 0 for k in keys}
    counts_total = {k: 0 for k in keys}

    num_players = len(strategies)
    match_seed = seed
    for _ in range(repetitions):
        for i in range(num_players):
            for j in range(i + 1, num_players):
                p1 = strategies[i].clone()
                p2 = strategies[j].clone()
                match = axl.Match((p1, p2), turns=turns, seed=match_seed)
                match.play()
                _record_perspective(p1.history, p2.history, counts_coop, counts_total)
                _record_perspective(p2.history, p1.history, counts_coop, counts_total)
                if match_seed is not None:
                    match_seed += 1

    p_coop: dict[tuple[int, int], float] = {
        k: (counts_coop[k] / counts_total[k]) if counts_total[k] > 0 else 0.5 for k in keys
    }
    mdp_transitions = build_mdp_transition_matrix(p_coop)
    return FrequencyTableResult(
        counts_coop=counts_coop,
        counts_total=counts_total,
        p_coop=p_coop,
        mdp_transitions=mdp_transitions,
        total_transitions=sum(counts_total.values()),
    )


def _compute_q_sa(
    v_values: list[float],
    p_coop: dict[tuple[int, int], float],
    state: int,
    action: int,
    gamma: float,
) -> float:
    """Evalúa Q(s, a) = p(s,a)[R(a,C) + gamma V((a,C))] + (1 - p(s,a))[R(a,D) + gamma V((a,D))]."""
    p_c = p_coop[(state, action)]
    s_next_c = 0 if action == ACTION_C else 2
    s_next_d = 1 if action == ACTION_C else 3
    return p_c * (PAYOFF[(action, ACTION_C)] + gamma * v_values[s_next_c]) + (1.0 - p_c) * (
        PAYOFF[(action, ACTION_D)] + gamma * v_values[s_next_d]
    )


def solve_bellman(
    p_coop: dict[tuple[int, int], float],
    gamma: float = 0.90,
    tol: float = 1e-6,
    max_iter: int = 2000,
) -> BellmanResult:
    """Resuelve Bellman por Value Iteration hasta que max_s |V^(k)(s) - V^(k-1)(s)| <= tol (1e-6)."""
    p0c = p_coop[(0, ACTION_C)]
    p0d = p_coop[(0, ACTION_D)]
    p1c = p_coop[(1, ACTION_C)]
    p1d = p_coop[(1, ACTION_D)]
    p2c = p_coop[(2, ACTION_C)]
    p2d = p_coop[(2, ACTION_D)]
    p3c = p_coop[(3, ACTION_C)]
    p3d = p_coop[(3, ACTION_D)]

    v0 = v1 = v2 = v3 = 0.0
    iters = 0
    for it in range(1, max_iter + 1):
        iters = it
        gv0 = gamma * v0
        gv1 = gamma * v1
        gv2 = gamma * v2
        gv3 = gamma * v3

        c_t = p0c * (3.0 + gv0) + (1.0 - p0c) * gv1
        d_t = p0d * (5.0 + gv2) + (1.0 - p0d) * (1.0 + gv3)
        n0 = c_t if c_t >= d_t else d_t

        c_t = p1c * (3.0 + gv0) + (1.0 - p1c) * gv1
        d_t = p1d * (5.0 + gv2) + (1.0 - p1d) * (1.0 + gv3)
        n1 = c_t if c_t >= d_t else d_t

        c_t = p2c * (3.0 + gv0) + (1.0 - p2c) * gv1
        d_t = p2d * (5.0 + gv2) + (1.0 - p2d) * (1.0 + gv3)
        n2 = c_t if c_t >= d_t else d_t

        c_t = p3c * (3.0 + gv0) + (1.0 - p3c) * gv1
        d_t = p3d * (5.0 + gv2) + (1.0 - p3d) * (1.0 + gv3)
        n3 = c_t if c_t >= d_t else d_t

        max_diff = max(abs(n0 - v0), abs(n1 - v1), abs(n2 - v2), abs(n3 - v3))
        v0, v1, v2, v3 = n0, n1, n2, n3
        if max_diff <= tol:
            break

    v_values = [v0, v1, v2, v3]
    q_values = {
        (s, a): _compute_q_sa(v_values, p_coop, s, a, gamma) for s in range(4) for a in ACTIONS
    }
    delta_q = [q_values[(s, ACTION_C)] - q_values[(s, ACTION_D)] for s in range(4)]
    policy = [ACTION_C if delta_q[s] >= 0.0 else ACTION_D for s in range(4)]
    return BellmanResult(
        v_values=v_values,
        q_values=q_values,
        delta_q=delta_q,
        policy=policy,
        iterations=iters,
    )


def compute_cumulative_avg_scores(
    my_history: list[axl.Action],
    opp_history: list[axl.Action],
) -> list[float]:
    """Calcula el puntaje medio acumulado por ronda en cada turno t = 1..T."""
    total = 0.0
    avgs: list[float] = []
    for t, (my_move, opp_move) in enumerate(zip(my_history, opp_history), start=1):
        a = ACTION_C if my_move == C else ACTION_D
        o = ACTION_C if opp_move == C else ACTION_D
        total += PAYOFF[(a, o)]
        avgs.append(total / t)
    return avgs
