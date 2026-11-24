"""Pruebas unitarias del modelo MDP, tabla de frecuencias de 8 contextos, Bellman, Agente Base y Mitcha."""

import unittest
import axelrod as axl

from agents import CloudMiope, EmpiricalPolicyAgent, ForgettingTransitionRLAgent, RulitoBellman
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


class TestTaller5IpdMdpAndAgents(unittest.TestCase):
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

    def test_bellman_optimality_equations(self) -> None:
        p_coop = build_mdp_transition_matrix(UNIFORM_PRIOR_P)
        self.assertEqual(len(p_coop), 8)

        gamma = 0.90
        res = solve_bellman(UNIFORM_PRIOR_P, gamma=gamma, tol=1e-6, max_iter=2000)
        self.assertGreater(res.iterations, 0)
        self.assertLess(res.iterations, 2000)
        for s in range(4):
            self.assertLessEqual(
                abs(res.v_values[s] - max(res.q_values[(s, ACTION_C)], res.q_values[(s, ACTION_D)])),
                1e-6,
            )
            for a in ACTIONS:
                p_c = UNIFORM_PRIOR_P[(s, a)]
                s_c = 0 if a == ACTION_C else 2
                s_d = 1 if a == ACTION_C else 3
                expected_q = p_c * (PAYOFF[(a, ACTION_C)] + gamma * res.v_values[s_c]) + (
                    1.0 - p_c
                ) * (PAYOFF[(a, ACTION_D)] + gamma * res.v_values[s_d])
                self.assertAlmostEqual(res.q_values[(s, a)], expected_q, places=7)

        res_tight = solve_bellman(UNIFORM_PRIOR_P, gamma=gamma, tol=1e-10, max_iter=2000)
        for s in range(4):
            self.assertAlmostEqual(
                res_tight.v_values[s],
                max(res_tight.q_values[(s, ACTION_C)], res_tight.q_values[(s, ACTION_D)]),
                places=8,
            )

    def test_empirical_policy_agent_follows_cddc(self) -> None:
        agent = EmpiricalPolicyAgent(policy=[ACTION_C, ACTION_D, ACTION_D, ACTION_C])
        opp = axl.Alternator()
        axl.Match((agent, opp), turns=5).play()
        self.assertEqual(list(agent.history), [C, C, D, D, C])

    def test_taller4_preamble_prototypes_run_and_reset(self) -> None:
        cloud = CloudMiope()
        rulito = RulitoBellman()
        axl.Match((cloud, axl.TitForTat()), turns=15).play()
        axl.Match((rulito, axl.TitForTat()), turns=15).play()
        self.assertEqual(len(cloud.history), 15)
        self.assertEqual(len(rulito.history), 15)

    def test_trace_logging_and_cumulative_scores(self) -> None:
        agent = ForgettingTransitionRLAgent(
            prior_p=UNIFORM_PRIOR_P,
            gamma=0.90,
            initial_count=2.0,
            forgetting_factor=0.90,
            record_trace=True,
        )
        opp = axl.Defector()
        axl.Match((agent, opp), turns=6).play()
        self.assertEqual(len(agent.trace_log), 6)
        avgs = compute_cumulative_avg_scores(agent.history, opp.history)
        self.assertEqual(len(avgs), 6)
        self.assertAlmostEqual(avgs[0], 0.0, places=12)

    def test_mitcha_effective_counts_matrix_invariants_and_match_reset(self) -> None:
        custom_prior = {(s, a): 0.75 for s in range(4) for a in ACTIONS}
        lam = 0.90
        n0 = 2.0
        agent = ForgettingTransitionRLAgent(
            prior_p=custom_prior,
            gamma=0.90,
            initial_count=n0,
            forgetting_factor=lam,
            player_name="Mitcha Test",
            record_trace=True,
        )
        cloned = agent.clone()
        self.assertEqual(cloned.name, "Mitcha Test")
        self.assertEqual(cloned.initial_count, n0)
        self.assertEqual(cloned.forgetting_factor, lam)

        axl.Match((cloned, axl.Defector()), turns=12).play()

        for (_, action), row in cloned.mdp_transitions.items():
            self.assertAlmostEqual(sum(row.values()), 1.0, places=12)
            if action == ACTION_C:
                self.assertEqual(row[2], 0.0)
                self.assertEqual(row[3], 0.0)
            else:
                self.assertEqual(row[0], 0.0)
                self.assertEqual(row[1], 0.0)

        self.assertAlmostEqual(cloned.effective_counts[(0, ACTION_C)], n0, places=12)
        self.assertGreater(cloned.effective_counts[(3, ACTION_D)], n0)
        self.assertLess(cloned.effective_counts[(3, ACTION_D)], 1.0 / (1.0 - lam))
        self.assertAlmostEqual(
            cloned.last_eta[(3, ACTION_D)],
            1.0 / cloned.effective_counts[(3, ACTION_D)],
            places=12,
        )

        # Al iniciar un nuevo enfrentamiento, reset_model() restaura el prior y n_0.
        cloned.reset()
        move_1 = cloned.strategy(axl.Cooperator())
        self.assertEqual(move_1, C)
        self.assertAlmostEqual(cloned.effective_counts[(3, ACTION_C)], n0, places=12)
        self.assertAlmostEqual(cloned.current_transition_probs()[(3, ACTION_C)], 0.75, places=12)

    def test_mitcha_adapts_faster_with_forgetting_after_regime_switch(self) -> None:
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

    def test_mitcha_validates_hyperparameters(self) -> None:
        with self.assertRaises(ValueError):
            ForgettingTransitionRLAgent(forgetting_factor=1.1)
        with self.assertRaises(ValueError):
            ForgettingTransitionRLAgent(forgetting_factor=-0.1)
        with self.assertRaises(ValueError):
            ForgettingTransitionRLAgent(initial_count=-0.5)


if __name__ == "__main__":
    unittest.main()
