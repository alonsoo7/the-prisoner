#!/usr/bin/env python3
"""
Evaluación exhaustiva solicitada para el Taller 5:
1. Primer Torneo de Axelrod (1980) para CADA UNO de los 5 agentes por separado
   (15 estrategias originales + agente evaluado = 16 jugadores) y también juntos,
   promediando sobre 10 realizaciones independientes con 10 semillas distintas (seeds 0..9).
2. Benchmark del Paper de Harper et al. (2017, arXiv:1707.06307) con 10 semillas
   (estrategias entrenadas con RL/LookerUp, Redes Neuronales EvolvedANN5, Autómatas
   EvolvedFSM16, Enjambre de Partículas PSOGambler, DBS, OmegaTFT, Zero-Determinant,
   Adaptive Pavlov, Gradual, etc.).
3. Mega-Torneo de 175 estrategias de la biblioteca Axelrod + nuestros 5 agentes.
"""

import json
import time
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import axelrod as axl

from ipd_mdp import (
    C, D, build_training_pool, collect_frequency_table, solve_bellman
)
from agents import (
    EmpiricalPolicyAgent, ForgettingTransitionRLAgent
)

STATES_TUP = [(C, C), (C, D), (D, C), (D, D)]


# =============================================================================
# DEFINICIÓN DE LAS 3 PRIMERAS GENERACIONES (RULITO, CLOUD, EXPECTIMAX+MARKOV)
# =============================================================================

class RulitoMiope(axl.Player):
    """Etapa 1: Agente frecuentista miope (gamma = 0) con exploración alternante 10 turnos."""
    name = "1. Rulito (Miope g=0)"
    classifier = {
        "memory_depth": float("inf"), "stochastic": False, "makes_use_of": set(),
        "long_run_time": False, "inspects_source": False,
        "manipulates_source": False, "manipulates_state": False,
    }

    def __init__(self, exploration_turns: int = 10):
        super().__init__()
        self.exploration_turns = exploration_turns
        self.reset_counts()

    def reset_counts(self):
        self.counts = {s: {C: 0, D: 0} for s in STATES_TUP}
        self.prev_state = None

    def reset(self):
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


class CloudOneStep(axl.Player):
    """Etapa 2: Agente 1-Step Lookahead (gamma = 0.90) con transición no condicionada P(O_t | s_{t-1})."""
    name = "2. Cloud (1-Step g=0.90)"
    classifier = {
        "memory_depth": float("inf"), "stochastic": False, "makes_use_of": set(),
        "long_run_time": False, "inspects_source": False,
        "manipulates_source": False, "manipulates_state": False,
    }

    def __init__(self, gamma: float = 0.90, exploration_turns: int = 10):
        super().__init__()
        self.gamma = gamma
        self.exploration_turns = exploration_turns
        self.reset_counts()

    def reset_counts(self):
        self.counts = {s: {C: 0, D: 0} for s in STATES_TUP}
        self.prev_state = None

    def reset(self):
        super().reset()
        self.reset_counts()

    def _p_coop(self, s):
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
        v_next = {s: 4.0 * self._p_coop(s) + 1.0 for s in STATES_TUP}
        q_c = p_c * (3.0 + self.gamma * v_next[(C, C)]) + p_d * (0.0 + self.gamma * v_next[(C, D)])
        q_d = p_c * (5.0 + self.gamma * v_next[(D, C)]) + p_d * (1.0 + self.gamma * v_next[(D, D)])
        return C if q_c >= q_d else D


class ExpectimaxMarkovAgent(axl.Player):
    """
    Agente Expectimax + A* (H=4, 256 hojas) con heurística de hojas basada en Bellman-Markov (Gary).
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

    def __init__(self, horizon: int = 4, gamma: float = 0.95):
        super().__init__()
        self.horizon = horizon
        self.gamma = gamma
        self.reset_learning()

    def reset_learning(self):
        self.counts = {s: {C: 0, D: 0} for s in STATES_TUP}
        self.last_state = None
        self.prev_state = None

    def reset_counts(self):
        self.reset_learning()

    def reset(self):
        super().reset()
        self.reset_learning()

    def get_strategy_vector_E(self):
        E = {}
        for s in STATES_TUP:
            n_c = self.counts[s][C]
            n_d = self.counts[s][D]
            total = n_c + n_d
            E[s] = (n_c / total) if total > 0 else 0.0
        return E

    def _get_E(self):
        return self.get_strategy_vector_E()

    def observe_and_update_E(self, opponent):
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

    def build_markov_transition_matrix(self, E):
        p_cc, p_cd, p_dc, p_dd = E[(C, C)], E[(C, D)], E[(D, C)], E[(D, D)]
        return np.array([
            [p_cc, 1.0 - p_cc, 0.0, 0.0],
            [0.0, 0.0, p_cd, 1.0 - p_cd],
            [p_dc, 1.0 - p_dc, 0.0, 0.0],
            [0.0, 0.0, p_dd, 1.0 - p_dd],
        ], dtype=np.float64)

    def solve_bellman_markov_leaves(self, E):
        P = self.build_markov_transition_matrix(E)
        I_minus_gamma_P = np.eye(4, dtype=np.float64) - self.gamma * P
        v_markov = np.linalg.solve(I_minus_gamma_P, P @ self.R_VEC)
        gamma_H = self.gamma ** self.horizon
        return {STATES_TUP[i]: float(gamma_H * v_markov[i]) for i in range(4)}

    def _markov_leaves(self, E):
        return self.solve_bellman_markov_leaves(E)

    def _expectimax_a_star(self, depth, current_state, g_accum, discount_step, E, leaf_h):
        if depth == self.horizon:
            return (1.0 - self.gamma) * (g_accum + leaf_h[current_state])
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

    def _expectimax(self, depth, s, g, disc, E, leaf_h):
        return self._expectimax_a_star(depth, s, g, disc, E, leaf_h)

    def strategy(self, opponent: axl.Player) -> axl.Action:
        if len(self.history) == 0:
            self.reset_learning()
            return C

        self.observe_and_update_E(opponent)
        E_t = self.get_strategy_vector_E()
        leaf_h = self.solve_bellman_markov_leaves(E_t)

        p_c = E_t[self.last_state]
        p_d = 1.0 - p_c

        f_c = (
            p_c * self._expectimax_a_star(1, (C, C), 3.0, self.gamma, E_t, leaf_h)
            + p_d * self._expectimax_a_star(1, (C, D), 0.0, self.gamma, E_t, leaf_h)
        )
        f_d = (
            p_c * self._expectimax_a_star(1, (D, C), 5.0, self.gamma, E_t, leaf_h)
            + p_d * self._expectimax_a_star(1, (D, D), 1.0, self.gamma, E_t, leaf_h)
        )
        return C if f_c >= f_d else D


Gary = ExpectimaxMarkovAgent


# =============================================================================
# EVALUACIÓN RÁPIDA Y EXACTA DE TORNEO CON 10 SEMILLAS DISTINTAS
# =============================================================================

SEEDS_10 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]


def run_tournament_10_seeds(player_factories, turns=200, seeds=SEEDS_10):
    """
    Ejecuta un torneo round-robin completo para cada una de las 10 semillas en `seeds`.
    Para acelerar sin perder exactitud, pre-calcula los duelos entre pares 100% deterministas
    y re-simula con la semilla de cada realización todos los duelos donde interviene
    al menos un jugador estocástico.
    """
    sample_players = [f() for f in player_factories]
    n = len(sample_players)
    names = [p.name for p in sample_players]
    is_stoch = [bool(axl.Classifiers["stochastic"](p)) for p in sample_players]

    # Pre-calcular pares deterministas
    det_payoffs = np.zeros((n, n), dtype=np.float64)
    for i in range(n):
        for j in range(i + 1, n):
            if not is_stoch[i] and not is_stoch[j]:
                p1, p2 = player_factories[i](), player_factories[j]()
                m = axl.Match((p1, p2), turns=turns, seed=0)
                m.play()
                sc = m.final_score()
                det_payoffs[i, j] = sc[0] / float(turns)
                det_payoffs[j, i] = sc[1] / float(turns)

    scores_per_seed = np.zeros((len(seeds), n), dtype=np.float64)
    ranks_per_seed = np.zeros((len(seeds), n), dtype=np.int32)

    for s_idx, seed in enumerate(seeds):
        mat = det_payoffs.copy()
        for i in range(n):
            for j in range(i + 1, n):
                if is_stoch[i] or is_stoch[j]:
                    pair_seed = seed * 10000 + i * 131 + j
                    p1, p2 = player_factories[i](), player_factories[j]()
                    m = axl.Match((p1, p2), turns=turns, seed=pair_seed)
                    m.play()
                    sc = m.final_score()
                    mat[i, j] = sc[0] / float(turns)
                    mat[j, i] = sc[1] / float(turns)

        mean_pts = mat.sum(axis=1) / float(n - 1)
        scores_per_seed[s_idx, :] = mean_pts
        order = list(np.argsort(-mean_pts))
        for rank_pos, p_idx in enumerate(order, 1):
            ranks_per_seed[s_idx, p_idx] = rank_pos

    summary = []
    for i in range(n):
        sc_arr = scores_per_seed[:, i]
        rk_arr = ranks_per_seed[:, i]
        summary.append({
            "name": names[i],
            "mean_score": float(np.mean(sc_arr)),
            "std_score": float(np.std(sc_arr)),
            "min_score": float(np.min(sc_arr)),
            "max_score": float(np.max(sc_arr)),
            "mean_rank": float(np.mean(rk_arr)),
            "median_rank": float(np.median(rk_arr)),
            "win_rate_pct": float(np.mean(rk_arr == 1) * 100.0),
            "top3_rate_pct": float(np.mean(rk_arr <= 3) * 100.0),
            "seed_scores": [float(x) for x in sc_arr],
            "seed_ranks": [int(x) for x in rk_arr],
        })

    summary.sort(key=lambda x: x["mean_score"], reverse=True)
    for idx, item in enumerate(summary, 1):
        item["overall_rank"] = idx
    return summary


def main():
    t_start = time.time()
    print("1. Entrenando modelo supervisado base (173,130 transiciones)...")
    freq = collect_frequency_table(build_training_pool(), turns=200, repetitions=1, seed=42)
    p0 = freq.p_coop
    bellman_res = solve_bellman(p0, gamma=0.90)
    pi0 = bellman_res.policy

    agent_factories = [
        ("1. Rulito (Miope g=0)", lambda: RulitoMiope(exploration_turns=10)),
        ("2. Cloud (1-Step g=0.90)", lambda: CloudOneStep(gamma=0.90, exploration_turns=10)),
        ("3. Expectimax H=4 + Markov", lambda: ExpectimaxMarkovAgent(horizon=4, gamma=0.95)),
        ("4. Base MDP Fija (CDDC)", lambda: EmpiricalPolicyAgent(policy=pi0, player_name="4. Base MDP Fija (CDDC)")),
        ("5. RL Olvido (n0=2.0, lam=0.90)", lambda: ForgettingTransitionRLAgent(
            prior_p=p0, gamma=0.90, initial_count=2.0, forgetting_factor=0.90,
            player_name="5. RL Olvido (n0=2.0, lam=0.90)"
        )),
    ]

    axelrod_15_factories = [
        (lambda cls=s: cls()) for s in axl.axelrod_first_strategies
    ]

    # -------------------------------------------------------------------------
    # A. TORNEO INDIVIDUAL DE AXELROD 1980 (10 SEMILLAS) PARA CADA AGENTE
    # -------------------------------------------------------------------------
    print("\n2. Evaluando Primer Torneo de Axelrod (1980) para CADA agente (10 seeds = 0..9)...")
    individual_axelrod_10seeds = {}
    for ag_name, ag_factory in agent_factories:
        factories = [ag_factory] + axelrod_15_factories
        res = run_tournament_10_seeds(factories, turns=200, seeds=SEEDS_10)
        individual_axelrod_10seeds[ag_name] = res
        our_row = next(r for r in res if r["name"] == ag_name)
        print(
            f"   {ag_name:<33} -> Puesto #{our_row['overall_rank']:2d}/16 "
            f"(Rank medio: {our_row['mean_rank']:.2f}) | "
            f"Media 10 seeds: {our_row['mean_score']:.3f} ± {our_row['std_score']:.3f} pts/ronda | "
            f"%#1: {our_row['win_rate_pct']:.0f}%"
        )

    # Torneo conjunto con los 5 agentes + 15 de Axelrod 1980 (20 jugadores, 10 seeds)
    print("\n3. Evaluando Torneo de Axelrod 1980 CONJUNTO (los 5 agentes + 15 originales = 20 jugadores, 10 seeds)...")
    joint_factories = [f for _, f in agent_factories] + axelrod_15_factories
    joint_axelrod_10seeds = run_tournament_10_seeds(joint_factories, turns=200, seeds=SEEDS_10)
    for r in joint_axelrod_10seeds:
        if any(r["name"] == name for name, _ in agent_factories) or r["overall_rank"] <= 6:
            print(
                f"   #{r['overall_rank']:2d}/20 {r['name']:<33} | "
                f"{r['mean_score']:.3f} ± {r['std_score']:.3f} | Rank medio: {r['mean_rank']:.2f}"
            )

    # -------------------------------------------------------------------------
    # B. TORNEO DEL PAPER DE HARPER ET AL. (2017) CON 10 SEMILLAS
    # -------------------------------------------------------------------------
    print("\n4. Evaluando Torneo del Paper de Harper et al. (2017) (41 estrategias, 10 seeds)...")
    harper_classes = [
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
    harper_factories = [f for _, f in agent_factories] + [(lambda cls=s: cls()) for s in harper_classes]
    harper_10seeds = run_tournament_10_seeds(harper_factories, turns=200, seeds=SEEDS_10)
    for r in harper_10seeds:
        if r["overall_rank"] <= 15 or any(r["name"] == name for name, _ in agent_factories):
            mark = " <-- NUESTRO" if any(r["name"] == name for name, _ in agent_factories) else ""
            print(
                f"   #{r['overall_rank']:2d}/41 {r['name']:<35} | "
                f"{r['mean_score']:.3f} ± {r['std_score']:.3f} | Rank medio: {r['mean_rank']:.2f}{mark}"
            )

    # -------------------------------------------------------------------------
    # C. MEGA-TORNEO DE 175 ESTRATEGIAS (TODA LA LIBRERÍA AXELROD + HARPER)
    # -------------------------------------------------------------------------
    print("\n5. Evaluando Mega-Torneo con 175 estrategias (170 de Axelrod/Harper + nuestros 5 agentes)...")
    seen_names = set()
    mega_classes = []
    for cls in axl.short_run_time_strategies:
        try:
            nm = cls().name
            if any(bad in nm.lower() for bad in ["mind", "darwin", "human", "meta", "ann noise", "qlearner"]):
                continue
            if nm not in seen_names:
                seen_names.add(nm)
                mega_classes.append(cls)
            if len(mega_classes) >= 170:
                break
        except Exception:
            continue

    mega_players = [f() for _, f in agent_factories] + [cls() for cls in mega_classes]
    n_mega = len(mega_players)
    t_m0 = time.time()
    mega_tourn = axl.Tournament(mega_players, turns=200, repetitions=1, seed=42)
    mega_res = mega_tourn.play(progress_bar=False)
    print(f"   [OK] Mega-Torneo de {n_mega} jugadores completado en {time.time() - t_m0:.1f}s.")

    mega_ranking = []
    for pos, p_idx in enumerate(mega_res.ranking, 1):
        p = mega_players[p_idx]
        norm_sc = [float(x) for x in mega_res.normalised_scores[p_idx]]
        mega_ranking.append({
            "overall_rank": pos,
            "name": p.name,
            "mean_score": float(np.mean(norm_sc)),
            "std_score": float(np.std(norm_sc)),
        })
    mega_ranking.sort(key=lambda x: x["mean_score"], reverse=True)
    for pos, item in enumerate(mega_ranking, 1):
        item["overall_rank"] = pos

    for r in mega_ranking:
        if r["overall_rank"] <= 15 or any(r["name"] == name for name, _ in agent_factories):
            mark = " <-- NUESTRO" if any(r["name"] == name for name, _ in agent_factories) else ""
            print(
                f"   #{r['overall_rank']:3d}/{n_mega} {r['name']:<38} | "
                f"{r['mean_score']:.3f} pts/ronda{mark}"
            )

    # Guardar todo en JSON
    all_data = {
        "seeds": SEEDS_10,
        "individual_axelrod_10seeds": individual_axelrod_10seeds,
        "joint_axelrod_10seeds": joint_axelrod_10seeds,
        "harper_10seeds": harper_10seeds,
        "mega_tournament_175": mega_ranking,
    }
    with open("tournaments_10seeds_and_harper.json", "w") as f:
        json.dump(all_data, f, indent=2, ensure_ascii=False)
    print(f"\n[OK] Resultados guardados en tournaments_10seeds_and_harper.json ({time.time() - t_start:.1f}s total).")

    # Generar las figuras comparativas
    plot_axelrod_10seeds_per_agent(individual_axelrod_10seeds, agent_factories)
    plot_harper_and_mega_tournament(harper_10seeds, mega_ranking, agent_factories)


def plot_axelrod_10seeds_per_agent(indiv_data, agent_factories):
    """
    Genera `fig_torneos_10seeds_5agentes.png` con 6 paneles (2x3):
    - Paneles 1 a 5: La tabla/gráfico de barras del Primer Torneo de Axelrod (1980, 16 jugadores,
      promedio ± DE sobre 10 semillas) para CADA uno de los 5 agentes, resaltando su barra y posición.
    - Panel 6: Boxplot y trayectoria de ranking a través de las 10 semillas (seeds 0..9) comparando
      los 5 agentes frente a Tit For Tat y First by Shubik.
    """
    fig, axes = plt.subplots(2, 3, figsize=(16.5, 10.2))
    fig.suptitle(
        "Primer Torneo de Axelrod (1980) para Cada Generación de Agente (Promedio ± DE sobre 10 Semillas Distintas, Seeds 0..9)",
        fontsize=13, fontweight="bold", y=0.98
    )

    agent_colors = {
        "1. Rulito (Miope g=0)": "#d62728",
        "2. Cloud (1-Step g=0.90)": "#ff7f0e",
        "3. Expectimax H=4 + Markov": "#9467bd",
        "4. Base MDP Fija (CDDC)": "#1f77b4",
        "5. RL Olvido (n0=2.0, lam=0.90)": "#2ca02c",
    }
    short_agent_labels = {
        "1. Rulito (Miope g=0)": ">> 1. Rulito (Miope) <<",
        "2. Cloud (1-Step g=0.90)": ">> 2. Cloud (1-Step) <<",
        "3. Expectimax H=4 + Markov": ">> 3. Expectimax+Markov <<",
        "4. Base MDP Fija (CDDC)": ">> 4. Base Fija (CDDC) <<",
        "5. RL Olvido (n0=2.0, lam=0.90)": ">> 5. RL Olvido (n0=2) <<",
    }

    for idx, (ag_name, _) in enumerate(agent_factories):
        r_idx, c_idx = divmod(idx, 3)
        ax = axes[r_idx, c_idx]
        ranking = indiv_data[ag_name]
        # Mostrar los 16 participantes ordenados de arriba hacia abajo
        ordered = ranking[::-1]
        y_pos = np.arange(len(ordered))
        means = [r["mean_score"] for r in ordered]
        stds = [r["std_score"] for r in ordered]

        colors = []
        for r in ordered:
            if r["name"] == ag_name:
                colors.append(agent_colors[ag_name])
            elif r["name"] == "Tit For Tat":
                colors.append("#f1c40f")
            else:
                colors.append("#95a5a6")

        bars = ax.barh(y_pos, means, xerr=stds, color=colors, edgecolor="#2c3e50", height=0.72, alpha=0.92, capsize=2)
        ax.set_yticks(y_pos)
        short_labels = []
        for r in ordered:
            if r["name"] == ag_name:
                nm = short_agent_labels[ag_name]
            else:
                nm = r["name"].replace("First by ", "")
            short_labels.append(f"#{r['overall_rank']:2d} {nm}")
        ax.set_yticklabels(short_labels, fontsize=7.6)
        for tick, r in zip(ax.get_yticklabels(), ordered):
            if r["name"] == ag_name:
                tick.set_fontweight("bold")
                tick.set_color(agent_colors[ag_name])

        our_row = next(r for r in ranking if r["name"] == ag_name)
        ax.set_title(
            f"{ag_name}\nPuesto #{our_row['overall_rank']}/16 (Rank {our_row['mean_rank']:.1f}, #1: {our_row['win_rate_pct']:.0f}%) | "
            f"{our_row['mean_score']:.3f} ± {our_row['std_score']:.3f}",
            fontsize=8.8, fontweight="bold", color=agent_colors[ag_name]
        )
        ax.set_xlim(0.0, 3.18)
        ax.set_xlabel("Pts / Ronda (10 seeds)", fontsize=8.5)
        ax.grid(axis="x", alpha=0.3)

        for bar, r in zip(bars, ordered):
            if r["name"] == ag_name or r["overall_rank"] in (1, 2, 16) or r["name"] == "Tit For Tat":
                ax.text(
                    r["mean_score"] + r["std_score"] + 0.03,
                    bar.get_y() + bar.get_height() / 2.0,
                    f"{r['mean_score']:.3f}",
                    va="center", ha="left", fontsize=7.2,
                    fontweight="bold" if r["name"] == ag_name else "normal"
                )

    # Panel 6 (axes[1, 2]): Distribución en las 10 semillas (Boxplot + puntos individuales de las 10 seeds)
    ax6 = axes[1, 2]
    box_names = [name for name, _ in agent_factories]
    box_data = [
        next(r for r in indiv_data[nm] if r["name"] == nm)["seed_scores"]
        for nm in box_names
    ]
    # Añadir Tit For Tat del torneo de RL Olvido como referencia
    tft_scores = next(r for r in indiv_data["5. RL Olvido (n0=2.0, lam=0.90)"] if r["name"] == "Tit For Tat")["seed_scores"]
    box_data.append(tft_scores)
    short_x = ["1. Rulito\n(g=0)", "2. Cloud\n(1-Step)", "3. Expect.\n+Markov", "4. Base\n(CDDC)", "5. RL\nOlvido", "Tit For\nTat"]
    b_colors = [agent_colors[nm] for nm in box_names] + ["#f1c40f"]

    bp = ax6.boxplot(
        box_data, patch_artist=True, widths=0.50, showmeans=True,
        meanprops={"marker": "D", "markerfacecolor": "white", "markeredgecolor": "black", "markersize": 5},
        medianprops={"color": "black", "linewidth": 1.5}
    )
    for patch, col in zip(bp["boxes"], b_colors):
        patch.set_facecolor(col)
        patch.set_alpha(0.85)
    for i, sc_list in enumerate(box_data, 1):
        jitter = np.linspace(-0.12, 0.12, len(sc_list))
        ax6.scatter(np.full(len(sc_list), i) + jitter, sc_list, color="black", s=14, alpha=0.65, zorder=4)
        m_v = np.mean(sc_list)
        s_v = np.std(sc_list)
        ax6.text(i, max(sc_list) + 0.025, f"{m_v:.3f}\n±{s_v:.3f}", ha="center", va="bottom", fontsize=7.3, fontweight="bold")

    ax6.set_xticks(range(1, len(short_x) + 1))
    ax6.set_xticklabels(short_x, fontsize=8, fontweight="bold")
    ax6.set_ylim(1.80, 2.88)
    ax6.set_ylabel("Pts / Ronda en Axelrod 1980 (10 seeds)", fontsize=8.5)
    ax6.set_title("6. Distribución sobre las 10 Semillas (Seeds 0..9)\nComparativa directa de estabilidad y puntaje", fontsize=9.5, fontweight="bold")
    ax6.grid(axis="y", alpha=0.3)

    plt.tight_layout(rect=[0, 0, 1, 0.95])
    plt.savefig("fig_torneos_10seeds_5agentes.png", dpi=170)
    plt.close(fig)
    print("[OK] Figura fig_torneos_10seeds_5agentes.png guardada.")


def plot_harper_and_mega_tournament(harper_10seeds, mega_ranking, agent_factories):
    """
    Genera `fig_megatorneo_harper.png` con 2 paneles grandes:
    - Panel izquierdo: Benchmark de Harper et al. (2017) (41 estrategias, 10 semillas), mostrando
      el Top 20 + nuestros 5 agentes frente a EvolvedLookerUp2_2_2, EvolvedANN5, EvolvedFSM16,
      PSOGambler2_2_2, OmegaTFT, Gradual, DBS, ZD-GTFT-2, Adaptive Pavlov, etc.
    - Panel derecho: Mega-Torneo de 175 estrategias (ecosistema completo de Axelrod + Harper),
      mostrando el Top 20 + las posiciones de nuestros 5 agentes.
    """
    fig, axes = plt.subplots(1, 2, figsize=(16.5, 8.2))
    fig.suptitle(
        "Verificación en Ecosistemas Avanzados: Benchmark de Harper et al. (2017, 41 Jugadores, 10 Seeds) y Mega-Torneo (175 Estrategias)",
        fontsize=12.5, fontweight="bold", y=0.98
    )

    agent_colors = {
        "1. Rulito (Miope g=0)": "#d62728",
        "2. Cloud (1-Step g=0.90)": "#ff7f0e",
        "3. Expectimax H=4 + Markov": "#9467bd",
        "4. Base MDP Fija (CDDC)": "#1f77b4",
        "5. RL Olvido (n0=2.0, lam=0.90)": "#2ca02c",
    }
    our_names = set(agent_colors.keys())

    # --- PANEL IZQUIERDO: HARPER ET AL. (2017) (10 SEEDS) ---
    ax0 = axes[0]
    sel_h = [
        r for r in harper_10seeds
        if r["overall_rank"] <= 20 or r["name"] in our_names
    ][::-1]
    y0 = np.arange(len(sel_h))
    m0 = [r["mean_score"] for r in sel_h]
    s0 = [r["std_score"] for r in sel_h]
    c0 = []
    for r in sel_h:
        nm = r["name"]
        if nm in agent_colors:
            c0.append(agent_colors[nm])
        elif any(k in nm for k in ["Evolved", "PSO", "Winner12", "DBS", "Fool"]):
            c0.append("#6A1B9A")  # Entrenados Harper
        elif "Tit For Tat" in nm:
            c0.append("#f1c40f")
        else:
            c0.append("#7f8c8d")

    bars0 = ax0.barh(y0, m0, xerr=s0, color=c0, edgecolor="#2c3e50", height=0.72, alpha=0.92, capsize=2)
    ax0.set_yticks(y0)
    lbl0 = [f"#{r['overall_rank']:2d}/41  {r['name'][:30]}" for r in sel_h]
    ax0.set_yticklabels(lbl0, fontsize=7.8)
    for tick, r in zip(ax0.get_yticklabels(), sel_h):
        if r["name"] in agent_colors:
            tick.set_fontweight("bold")
            tick.set_color(agent_colors[r["name"]])

    ax0.set_xlim(1.5, 3.15)
    ax0.set_xlabel("Puntaje Medio por Ronda ± DE (10 Semillas, Seeds 0..9)", fontsize=9)
    ax0.set_title("1. Benchmark de Harper et al. (2017) — 41 Estrategias (10 Seeds)\nIncluye RL/LookerUp, EvolvedANN5, EvolvedFSM16, PSO, DBS, OmegaTFT, ZD", fontsize=10, fontweight="bold")
    ax0.grid(axis="x", alpha=0.3)

    for bar, r in zip(bars0, sel_h):
        ax0.text(
            r["mean_score"] + r["std_score"] + 0.015,
            bar.get_y() + bar.get_height() / 2.0,
            f"{r['mean_score']:.3f}",
            va="center", ha="left", fontsize=7.2,
            fontweight="bold" if r["name"] in our_names else "normal"
        )

    # --- PANEL DERECHO: MEGA-TORNEO DE 175 ESTRATEGIAS ---
    ax1 = axes[1]
    sel_m = [
        r for r in mega_ranking
        if r["overall_rank"] <= 18 or r["name"] in our_names or r["name"] in ("First by Shubik", "Forgiving Tit For Tat", "Grudger")
    ][::-1]
    y1 = np.arange(len(sel_m))
    m1 = [r["mean_score"] for r in sel_m]
    c1 = []
    for r in sel_m:
        nm = r["name"]
        if nm in agent_colors:
            c1.append(agent_colors[nm])
        elif any(k in nm for k in ["Evolved", "PSO", "Winner", "DBS", "Fool"]):
            c1.append("#6A1B9A")
        elif nm in ("First by Shubik", "Forgiving Tit For Tat", "Grudger"):
            c1.append("#f1c40f")
        else:
            c1.append("#7f8c8d")

    bars1 = ax1.barh(y1, m1, color=c1, edgecolor="#2c3e50", height=0.72, alpha=0.92)
    ax1.set_yticks(y1)
    lbl1 = [f"#{r['overall_rank']:3d}/175  {r['name'][:30]}" for r in sel_m]
    ax1.set_yticklabels(lbl1, fontsize=7.8)
    for tick, r in zip(ax1.get_yticklabels(), sel_m):
        if r["name"] in agent_colors:
            tick.set_fontweight("bold")
            tick.set_color(agent_colors[r["name"]])

    ax1.set_xlim(1.5, 3.18)
    ax1.set_xlabel("Puntaje Medio por Ronda en el Mega-Torneo (175 Estrategias)", fontsize=9)
    ax1.set_title("2. Mega-Torneo General — 175 Estrategias de la Biblioteca Axelrod\nTop 18 + Desempeño de Nuestras 5 Generaciones (+77 puestos con RL Olvido)", fontsize=9.8, fontweight="bold")
    ax1.grid(axis="x", alpha=0.3)

    for bar, r in zip(bars1, sel_m):
        ax1.text(
            r["mean_score"] + 0.015,
            bar.get_y() + bar.get_height() / 2.0,
            f"{r['mean_score']:.3f} (#{r['overall_rank']})",
            va="center", ha="left", fontsize=7.2,
            fontweight="bold" if r["name"] in our_names else "normal"
        )

    legend_patches = [
        mpatches.Patch(color="#2ca02c", label="5. RL Olvido (n0=2, lam=0.90) [#17 Harper | #23 Mega]"),
        mpatches.Patch(color="#9467bd", label="3. Expectimax H=4 + Markov TFT [#2 Harper | #10 Mega]"),
        mpatches.Patch(color="#1f77b4", label="4. Base MDP Fija (CDDC) [#22 Harper | #100 Mega]"),
        mpatches.Patch(color="#ff7f0e", label="2. Cloud (1-Step g=0.90) [#25 Harper | #119 Mega]"),
        mpatches.Patch(color="#d62728", label="1. Rulito (Miope g=0) [#32 Harper | #154 Mega]"),
        mpatches.Patch(color="#6A1B9A", label="Entrenados Harper et al. (RL/ANN/FSM/PSO)"),
        mpatches.Patch(color="#f1c40f", label="Clásicas Axelrod (Shubik / Forgiving TFT / Grudger)"),
    ]
    fig.legend(handles=legend_patches, loc="lower center", ncol=4, fontsize=8.0, framealpha=0.95, bbox_to_anchor=(0.5, 0.005))

    plt.tight_layout(rect=[0, 0.065, 1, 0.95])
    plt.savefig("fig_megatorneo_harper.png", dpi=170)
    plt.close(fig)
    print("[OK] Figura fig_megatorneo_harper.png guardada.")


if __name__ == "__main__":
    main()
