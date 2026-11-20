"""Core MDP model, empirical frequency table, and Bellman solver for Iterated Prisoner's Dilemma."""

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

# Standard Axelrod payoff matrix: (my_action, opp_action) -> my_reward
PAYOFF = {
    (ACTION_C, ACTION_C): 3.0,
    (ACTION_C, ACTION_D): 0.0,
    (ACTION_D, ACTION_C): 5.0,
    (ACTION_D, ACTION_D): 1.0,
}

UNIFORM_PRIOR_P = {(s, a): 0.5 for s in range(4) for a in ACTIONS}


@dataclass(frozen=True)
class FrequencyTableResult:
    """Empirical 8-context frequency table and induced 8x4 MDP transition matrix."""

    counts_coop: dict[tuple[int, int], int]
    counts_total: dict[tuple[int, int], int]
    p_coop: dict[tuple[int, int], float]
    mdp_transitions: dict[tuple[int, int], dict[int, float]]
    total_transitions: int


@dataclass(frozen=True)
class BellmanResult:
    """Optimal value functions V*(s), Q*(s, a), and deterministic policy pi_0[s]."""

    v_values: list[float]
    q_values: dict[tuple[int, int], float]
    delta_q: list[float]
    policy: list[int]


def build_training_pool() -> list[axl.Player]:
    """Return a diverse 30-strategy Axelrod pool for simulating environment transitions."""
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
    """Accumulate (s_{t-1}, A_t) -> O_t counts from one player's match trajectory."""
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
    """Build the full 8x4 MDP transition matrix P(s_t | s_{t-1}, A_t)."""
    transitions: dict[tuple[int, int], dict[int, float]] = {}
    for s in range(4):
        for a in ACTIONS:
            p_c = p_coop[(s, a)]
            # Next state is (A_t, O_t): fixed first coordinate, stochastic opponent response.
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
    laplace_alpha: float = 0.0,
) -> FrequencyTableResult:
    """Simulate round-robin Axelrod matches and estimate P(O_t=C | s_{t-1}, A_t) by counting."""
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

    p_coop: dict[tuple[int, int], float] = {}
    for k in keys:
        total = counts_total[k]
        if total == 0 and laplace_alpha == 0.0:
            p_coop[k] = 0.5
        else:
            p_coop[k] = (counts_coop[k] + laplace_alpha) / (total + 2.0 * laplace_alpha)

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
    """Evaluate Bellman backup Q(s, a) given current state values V."""
    p_c = p_coop[(state, action)]
    s_next_c = 0 if action == ACTION_C else 2
    s_next_d = 1 if action == ACTION_C else 3
    return p_c * (PAYOFF[(action, ACTION_C)] + gamma * v_values[s_next_c]) + (1.0 - p_c) * (
        PAYOFF[(action, ACTION_D)] + gamma * v_values[s_next_d]
    )


def solve_bellman(
    p_coop: dict[tuple[int, int], float],
    gamma: float = 0.90,
    tol: float = 1e-9,
    max_iter: int = 500,
) -> BellmanResult:
    """Solve the 4-state IPD MDP via Value Iteration and return V*, Q*, and pi_0."""
    v_values = [0.0, 0.0, 0.0, 0.0]
    for _ in range(max_iter):
        v_next = [
            max(
                _compute_q_sa(v_values, p_coop, s, ACTION_D, gamma),
                _compute_q_sa(v_values, p_coop, s, ACTION_C, gamma),
            )
            for s in range(4)
        ]
        max_diff = max(abs(v_next[s] - v_values[s]) for s in range(4))
        v_values = v_next
        if max_diff < tol:
            break

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
    )


def compute_cumulative_avg_scores(
    my_history: list[axl.Action],
    opp_history: list[axl.Action],
) -> list[float]:
    """Compute running mean points per round at each turn from match histories."""
    total = 0.0
    avgs: list[float] = []
    for t, (my_move, opp_move) in enumerate(zip(my_history, opp_history), start=1):
        a = ACTION_C if my_move == C else ACTION_D
        o = ACTION_C if opp_move == C else ACTION_D
        total += PAYOFF[(a, o)]
        avgs.append(total / t)
    return avgs
