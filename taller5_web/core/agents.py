"""Axelrod-compatible agents built from the empirical frequency table and online MDP updates."""

import math
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


class EmpiricalPolicyAgent(axl.Player):
    """Stage-1 fixed memory-1 agent using pi_0 derived from the frequency table + Bellman."""

    name = "Etapa 1: Politica Fija (Tabla Frecuencias)"

    def __init__(self, policy: list[int], player_name: str | None = None):
        """Initialize fixed memory-1 policy agent."""
        super().__init__()
        self.policy = list(policy)
        if player_name is not None:
            self.name = player_name

    def strategy(self, opponent: axl.Player) -> axl.Action:
        """Cooperate on turn 1, then follow pi_0[s_{t-1}]."""
        if not self.history:
            return C
        current_s = STATE_MAP[(self.history[-1], opponent.history[-1])]
        return C if self.policy[current_s] == ACTION_C else D


class _BaseTransitionRLAgent(axl.Player):
    """Shared online Bellman planning and 2-turn window loop for transition-updating agents."""

    def _init_rl_state(
        self,
        prior_p: dict[tuple[int, int], float] | None,
        gamma: float,
        bellman_tol: float,
        bellman_max_iter: int,
        player_name: str | None,
        record_trace: bool,
    ) -> None:
        """Initialize shared MDP planning configuration and trace storage."""
        super().__init__()
        self.prior_p = dict(prior_p) if prior_p is not None else dict(UNIFORM_PRIOR_P)
        self.gamma = gamma
        self.bellman_tol = bellman_tol
        self.bellman_max_iter = bellman_max_iter
        self.record_trace = record_trace
        if player_name is not None:
            self.name = player_name
        self.last_bellman: BellmanResult | None = None
        self.trace_log: list[dict] = []

    def reset_model(self) -> None:
        """Reset internal transition model state at the start of a match."""
        raise NotImplementedError

    def current_transition_probs(self) -> dict[tuple[int, int], float]:
        """Return current cooperation probabilities P_t(O_t=C | s, a) for Bellman."""
        raise NotImplementedError

    def _update_model(self, prev_s: int, act_idx: int, opp_last_move: axl.Action) -> None:
        """Update internal transition model from a complete (s_{t-1}, A_t) -> O_t observation."""
        raise NotImplementedError

    def _extra_trace_fields(self) -> dict:
        """Return optional extra fields to record in each trace_log snapshot."""
        return {}

    def _solve_and_maybe_record(self) -> BellmanResult:
        """Solve Bellman on current transition probabilities and log snapshot if enabled."""
        p_t = self.current_transition_probs()
        bellman = solve_bellman(
            p_t,
            gamma=self.gamma,
            tol=self.bellman_tol,
            max_iter=self.bellman_max_iter,
        )
        self.last_bellman = bellman
        if self.record_trace:
            snapshot = {
                "probs": p_t,
                "delta_q": list(bellman.delta_q),
                "policy": list(bellman.policy),
            }
            snapshot.update(self._extra_trace_fields())
            self.trace_log.append(snapshot)
        return bellman

    def strategy(self, opponent: axl.Player) -> axl.Action:
        """Update transition model online, re-solve Bellman, and pick optimal action."""
        if not self.history:
            self.reset_model()
            if self.record_trace:
                self._solve_and_maybe_record()
            return C

        # Update only once we have a complete 2-turn window: (s_{t-1}, A_t) -> O_t.
        if len(self.history) >= 2:
            prev_s = STATE_MAP[(self.history[-2], opponent.history[-2])]
            act_idx = ACTION_C if self.history[-1] == C else ACTION_D
            self._update_model(prev_s, act_idx, opponent.history[-1])

        bellman = self._solve_and_maybe_record()
        current_s = STATE_MAP[(self.history[-1], opponent.history[-1])]
        return C if bellman.policy[current_s] == ACTION_C else D


class BayesianFrequencyRLAgent(_BaseTransitionRLAgent):
    """Stage-2 pure Beta-Bernoulli Bayesian RL agent initialized from an empirical prior."""

    name = "Etapa 2: RL Bayesiano Puro (M0=1.0)"

    def __init__(
        self,
        prior_p: dict[tuple[int, int], float] | None = None,
        gamma: float = 0.90,
        prior_strength: float = 1.0,
        bellman_tol: float = 1e-5,
        bellman_max_iter: int = 35,
        player_name: str | None = None,
        record_trace: bool = False,
    ):
        """Initialize pure Beta-Bernoulli Bayesian RL agent with prior strength M_0."""
        self._init_rl_state(
            prior_p=prior_p,
            gamma=gamma,
            bellman_tol=bellman_tol,
            bellman_max_iter=bellman_max_iter,
            player_name=player_name,
            record_trace=record_trace,
        )
        self.prior_strength = prior_strength
        self.alpha: dict[tuple[int, int], float] = {}
        self.beta: dict[tuple[int, int], float] = {}
        self.reset_bayesian_model()

    def reset_model(self) -> None:
        """Reset Beta(alpha, beta) counters to the configured empirical prior with weight M_0."""
        self.alpha = {k: self.prior_strength * p for k, p in self.prior_p.items()}
        self.beta = {k: self.prior_strength * (1.0 - p) for k, p in self.prior_p.items()}
        self.last_bellman = None
        self.trace_log = []

    def reset_bayesian_model(self) -> None:
        """Alias kept for backwards compatibility with earlier Bayesian tests."""
        self.reset_model()

    def current_transition_probs(self) -> dict[tuple[int, int], float]:
        """Compute current posterior mean P_t(O_t=C | s, a) = alpha / (alpha + beta)."""
        return {k: self.alpha[k] / (self.alpha[k] + self.beta[k]) for k in self.prior_p}

    def _update_model(self, prev_s: int, act_idx: int, opp_last_move: axl.Action) -> None:
        """Apply pure Beta-Bernoulli conjugate update (+1 to alpha or beta)."""
        key = (prev_s, act_idx)
        if opp_last_move == C:
            self.alpha[key] += 1.0
        else:
            self.beta[key] += 1.0


class ForgettingTransitionRLAgent(_BaseTransitionRLAgent):
    """Online MDP agent updating the 8x4 transition matrix via effective counts with forgetting."""

    name = "RL Online: Matriz Incremental (Olvido)"

    def __init__(
        self,
        prior_p: dict[tuple[int, int], float] | None = None,
        gamma: float = 0.90,
        initial_count: float = 2.0,
        forgetting_factor: float = 0.90,
        bellman_tol: float = 1e-5,
        bellman_max_iter: int = 35,
        player_name: str | None = None,
        record_trace: bool = False,
    ):
        """Initialize incremental transition-matrix agent with effective counter n <- lambda * n + 1."""
        if not (0.0 <= forgetting_factor <= 1.0):
            raise ValueError(f"forgetting_factor must be in [0.0, 1.0], got {forgetting_factor}")
        if initial_count < 0.0:
            raise ValueError(f"initial_count must be >= 0.0, got {initial_count}")

        self._init_rl_state(
            prior_p=prior_p,
            gamma=gamma,
            bellman_tol=bellman_tol,
            bellman_max_iter=bellman_max_iter,
            player_name=player_name,
            record_trace=record_trace,
        )
        self.initial_count = float(initial_count)
        self.forgetting_factor = float(forgetting_factor)
        self.effective_counts: dict[tuple[int, int], float] = {}
        self.mdp_transitions: dict[tuple[int, int], dict[int, float]] = {}
        self.last_eta: dict[tuple[int, int], float] = {}
        self.reset_model()

    def reset_model(self) -> None:
        """Reset the 8x4 transition matrix to the learned prior and effective counts to n_0."""
        self.mdp_transitions = build_mdp_transition_matrix(self.prior_p)
        self.effective_counts = {k: self.initial_count for k in self.prior_p}
        self.last_eta = {k: 0.0 for k in self.prior_p}
        self.last_bellman = None
        self.trace_log = []

    def current_transition_probs(self) -> dict[tuple[int, int], float]:
        """Extract P_t(O_t=C | s, a) directly from the 8x4 MDP transition matrix."""
        return {
            (s, a): self.mdp_transitions[(s, a)][0 if a == ACTION_C else 2]
            for (s, a) in self.prior_p
        }

    def _extra_trace_fields(self) -> dict:
        """Record current effective counts and last learning rates per context."""
        return {
            "effective_counts": dict(self.effective_counts),
            "etas": dict(self.last_eta),
        }

    def _update_model(self, prev_s: int, act_idx: int, opp_last_move: axl.Action) -> None:
        """Incrementally update the observed transition-matrix row with step eta = 1 / n."""
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


class SafeUCBForgettingRLAgent(ForgettingTransitionRLAgent):
    """Stage-6 Hybrid Proposal (Jacinto): Forgetting 8x4 MDP RL + Safe UCB Exploration on s != CC."""

    name = "6. Jacinto (RL + Safe UCB)"

    def __init__(
        self,
        prior_p: dict[tuple[int, int], float] | None = None,
        gamma: float = 0.90,
        initial_count: float = 2.0,
        forgetting_factor: float = 0.90,
        ucb_c: float = 1.5,
        safe_cc_threshold: float = 0.85,
        bellman_tol: float = 1e-5,
        bellman_max_iter: int = 35,
        player_name: str | None = None,
        record_trace: bool = False,
    ):
        self.ucb_c = float(ucb_c)
        self.safe_cc_threshold = float(safe_cc_threshold)
        self.visit_counts: dict[tuple[int, int], int] = {}
        super().__init__(
            prior_p=prior_p,
            gamma=gamma,
            initial_count=initial_count,
            forgetting_factor=forgetting_factor,
            bellman_tol=bellman_tol,
            bellman_max_iter=bellman_max_iter,
            player_name=player_name,
            record_trace=record_trace,
        )

    def reset_model(self) -> None:
        super().reset_model()
        self.visit_counts = {k: 0 for k in self.prior_p}

    def _update_model(self, prev_s: int, act_idx: int, opp_last_move: axl.Action) -> None:
        super()._update_model(prev_s, act_idx, opp_last_move)
        self.visit_counts[(prev_s, act_idx)] += 1

    def strategy(self, opponent: axl.Player) -> axl.Action:
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

        # Safe Exploration Gate: never explore away from cooperation in CC while cooperative
        if current_s == 0 and self.current_transition_probs()[(0, ACTION_C)] >= self.safe_cc_threshold:
            return C if bellman.policy[current_s] == ACTION_C else D

        t = len(self.history) + 1
        q_c = bellman.q_values[(current_s, ACTION_C)] + self.ucb_c * math.sqrt(
            math.log(t + 1.0) / (1.0 + self.visit_counts[(current_s, ACTION_C)])
        )
        q_d = bellman.q_values[(current_s, ACTION_D)] + self.ucb_c * math.sqrt(
            math.log(t + 1.0) / (1.0 + self.visit_counts[(current_s, ACTION_D)])
        )
        return C if q_c >= q_d else D
