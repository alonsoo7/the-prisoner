"""Unit tests for the IPD frequency-table MDP, Bellman solver, and Axelrod agents."""

import unittest
import axelrod as axl

from agents import BayesianFrequencyRLAgent, EmpiricalPolicyAgent, ForgettingTransitionRLAgent
from ipd_mdp import (
    ACTION_C,
    ACTION_D,
    ACTIONS,
    C,
    D,
    PAYOFF,
    UNIFORM_PRIOR_P,
    build_mdp_transition_matrix,
    collect_frequency_table,
    compute_cumulative_avg_scores,
    solve_bellman,
)


class TestIpdMdpAndAgents(unittest.TestCase):
    def test_frequency_table_exact_counts_and_mdp_rows(self) -> None:
        pool = [axl.Cooperator(), axl.Defector(), axl.TitForTat(), axl.Alternator()]
        freq = collect_frequency_table(pool, turns=20, repetitions=1, seed=42)

        self.assertEqual(freq.total_transitions, sum(freq.counts_total.values()))
        self.assertEqual(len(freq.p_coop), 8)
        self.assertEqual(len(freq.mdp_transitions), 8)

        for key, prob in freq.p_coop.items():
            self.assertGreaterEqual(prob, 0.0)
            self.assertLessEqual(prob, 1.0)
            total = freq.counts_total[key]
            if total > 0:
                self.assertAlmostEqual(prob, freq.counts_coop[key] / total, places=12)

            row = freq.mdp_transitions[key]
            self.assertAlmostEqual(sum(row.values()), 1.0, places=12)
            _, action = key
            if action == ACTION_C:
                self.assertEqual(row[2], 0.0)
                self.assertEqual(row[3], 0.0)
            else:
                self.assertEqual(row[0], 0.0)
                self.assertEqual(row[1], 0.0)

    def test_bellman_optimality_and_cd_dc_dd_emergence(self) -> None:
        p_coop = build_mdp_transition_matrix(UNIFORM_PRIOR_P)
        self.assertEqual(len(p_coop), 8)

        gamma = 0.90
        res = solve_bellman(UNIFORM_PRIOR_P, gamma=gamma, tol=1e-10)
        for s in range(4):
            self.assertAlmostEqual(
                res.v_values[s],
                max(res.q_values[(s, ACTION_C)], res.q_values[(s, ACTION_D)]),
                places=8,
            )
            for a in ACTIONS:
                p_c = UNIFORM_PRIOR_P[(s, a)]
                s_c = 0 if a == ACTION_C else 2
                s_d = 1 if a == ACTION_C else 3
                expected_q = p_c * (PAYOFF[(a, ACTION_C)] + gamma * res.v_values[s_c]) + (
                    1.0 - p_c
                ) * (PAYOFF[(a, ACTION_D)] + gamma * res.v_values[s_d])
                self.assertAlmostEqual(res.q_values[(s, a)], expected_q, places=7)

    def test_bayesian_agent_clone_and_match_reset(self) -> None:
        custom_prior = {(s, a): 0.75 for s in range(4) for a in ACTIONS}
        m0 = 4.0
        agent = BayesianFrequencyRLAgent(
            prior_p=custom_prior,
            gamma=0.90,
            prior_strength=m0,
            player_name="Custom Bayesian",
        )
        cloned = agent.clone()
        self.assertEqual(cloned.name, "Custom Bayesian")
        self.assertEqual(cloned.prior_p, custom_prior)
        self.assertEqual(cloned.prior_strength, m0)

        # Play 10 turns vs Defector; pure Bayes adds +1 per observed 2-turn window (8 updates).
        axl.Match((cloned, axl.Defector()), turns=10).play()
        total_beta_added = sum(cloned.beta.values()) - sum(m0 * (1.0 - p) for p in custom_prior.values())
        self.assertAlmostEqual(total_beta_added, 8.0, places=12)
        # Unobserved (CC, C) and (DC, C) must stay untouched (no heuristic spillover).
        self.assertAlmostEqual(cloned.beta[(0, ACTION_C)], m0 * 0.25, places=12)
        self.assertAlmostEqual(cloned.beta[(2, ACTION_C)], m0 * 0.25, places=12)

        # Starting a new match (empty history) must cleanly reset counters to prior.
        cloned.reset()
        move_1 = cloned.strategy(axl.Cooperator())
        self.assertEqual(move_1, C)
        self.assertAlmostEqual(cloned.alpha[(3, ACTION_C)], m0 * 0.75, places=12)
        self.assertAlmostEqual(cloned.beta[(3, ACTION_C)], m0 * 0.25, places=12)

    def test_empirical_policy_agent_follows_policy(self) -> None:
        # Policy: CC->C, CD->D, DC->D, DD->C (Pavlov / CDDC)
        agent = EmpiricalPolicyAgent(policy=[ACTION_C, ACTION_D, ACTION_D, ACTION_C])
        opp = axl.Alternator()
        match = axl.Match((agent, opp), turns=5)
        match.play()
        # Turn 1: agent C, opp C -> CC -> Turn 2: agent C, opp D -> CD
        # Turn 3: agent D, opp C -> DC -> Turn 4: agent D, opp D -> DD -> Turn 5: agent C
        self.assertEqual(list(agent.history), [C, C, D, D, C])

    def test_trace_logging_and_cumulative_scores(self) -> None:
        agent = BayesianFrequencyRLAgent(
            prior_p=UNIFORM_PRIOR_P,
            gamma=0.90,
            prior_strength=1.0,
            record_trace=True,
        )
        opp = axl.Defector()
        axl.Match((agent, opp), turns=6).play()
        self.assertEqual(len(agent.trace_log), 6)
        avgs = compute_cumulative_avg_scores(agent.history, opp.history)
        self.assertEqual(len(avgs), 6)
        self.assertAlmostEqual(avgs[0], 0.0, places=12)  # Turn 1: (C, D) -> 0 pts

    def test_forgetting_agent_effective_counts_and_matrix_invariants(self) -> None:
        custom_prior = {(s, a): 0.75 for s in range(4) for a in ACTIONS}
        lam = 0.80
        n0 = 2.0
        agent = ForgettingTransitionRLAgent(
            prior_p=custom_prior,
            gamma=0.90,
            initial_count=n0,
            forgetting_factor=lam,
            player_name="Forgetting Custom",
            record_trace=True,
        )
        cloned = agent.clone()
        self.assertEqual(cloned.name, "Forgetting Custom")
        self.assertEqual(cloned.initial_count, n0)
        self.assertEqual(cloned.forgetting_factor, lam)

        axl.Match((cloned, axl.Defector()), turns=12).play()

        # Every 8x4 transition row must stay normalized with structural zeros intact.
        for (_, action), row in cloned.mdp_transitions.items():
            self.assertAlmostEqual(sum(row.values()), 1.0, places=12)
            if action == ACTION_C:
                self.assertEqual(row[2], 0.0)
                self.assertEqual(row[3], 0.0)
            else:
                self.assertEqual(row[0], 0.0)
                self.assertEqual(row[1], 0.0)

        # Unvisited contexts keep initial count; visited (DD, D) follows n <- lambda * n + 1.
        self.assertAlmostEqual(cloned.effective_counts[(0, ACTION_C)], n0, places=12)
        self.assertGreater(cloned.effective_counts[(3, ACTION_D)], n0)
        self.assertLess(cloned.effective_counts[(3, ACTION_D)], 1.0 / (1.0 - lam))
        self.assertAlmostEqual(
            cloned.last_eta[(3, ACTION_D)],
            1.0 / cloned.effective_counts[(3, ACTION_D)],
            places=12,
        )

        cloned.reset()
        move_1 = cloned.strategy(axl.Cooperator())
        self.assertEqual(move_1, C)
        self.assertAlmostEqual(cloned.effective_counts[(3, ACTION_C)], n0, places=12)
        self.assertAlmostEqual(cloned.current_transition_probs()[(3, ACTION_C)], 0.75, places=12)

    def test_forgetting_agent_matches_bayesian_when_lambda_is_one(self) -> None:
        prior = {(s, a): 0.2 + 0.08 * s + 0.05 * a for s in range(4) for a in ACTIONS}
        m0 = 2.0
        bayes_agent = BayesianFrequencyRLAgent(prior_p=prior, gamma=0.90, prior_strength=m0)
        forget_agent = ForgettingTransitionRLAgent(
            prior_p=prior,
            gamma=0.90,
            initial_count=m0,
            forgetting_factor=1.0,
        )

        axl.Match((bayes_agent, axl.Alternator()), turns=40).play()
        axl.Match((forget_agent, axl.Alternator()), turns=40).play()

        self.assertEqual(list(bayes_agent.history), list(forget_agent.history))
        p_bayes = bayes_agent.current_transition_probs()
        p_forget = forget_agent.current_transition_probs()
        for key in prior:
            self.assertAlmostEqual(p_bayes[key], p_forget[key], places=12)

    def test_forgetting_agent_adapts_faster_after_regime_switch(self) -> None:
        class CooperateThenDefect(axl.Player):
            name = "CooperateThenDefect"

            def strategy(self, opponent: axl.Player) -> axl.Action:
                return C if len(self.history) < 50 else D

        prior = {(s, a): 0.80 for s in range(4) for a in ACTIONS}
        no_forgetting = ForgettingTransitionRLAgent(
            prior_p=prior, initial_count=1.0, forgetting_factor=1.0
        )
        with_forgetting = ForgettingTransitionRLAgent(
            prior_p=prior, initial_count=1.0, forgetting_factor=0.80
        )

        axl.Match((no_forgetting, CooperateThenDefect()), turns=100).play()
        axl.Match((with_forgetting, CooperateThenDefect()), turns=100).play()

        post_switch_d_no_forget = sum(1 for m in no_forgetting.history[50:] if m == D)
        post_switch_d_forget = sum(1 for m in with_forgetting.history[50:] if m == D)
        self.assertGreater(post_switch_d_forget, post_switch_d_no_forget)

    def test_forgetting_agent_validates_hyperparameters(self) -> None:
        with self.assertRaises(ValueError):
            ForgettingTransitionRLAgent(forgetting_factor=1.1)
        with self.assertRaises(ValueError):
            ForgettingTransitionRLAgent(forgetting_factor=-0.1)
        with self.assertRaises(ValueError):
            ForgettingTransitionRLAgent(initial_count=-0.5)


if __name__ == "__main__":
    unittest.main()
