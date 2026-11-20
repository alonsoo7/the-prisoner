#!/usr/bin/env python3
"""
Benchmark completo para Jacinto (Taller 6 — Propuesta Híbrida: RL Olvido + Safe UCB)
comparado con Mitcha (5. RL Olvido) y Gary (3. Expectimax H=4 + Markov).
"""

import json
import time
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import axelrod as axl

from ipd_mdp import C, D, build_training_pool, collect_frequency_table
from agents import ForgettingTransitionRLAgent, SafeUCBForgettingRLAgent
from plot_learning import CooperateThenDefect, ThreePhaseRival
from run_tournaments_10seeds_and_harper import SEEDS_10, run_tournament_10_seeds


def main():
    t0 = time.time()
    freq = collect_frequency_table(build_training_pool(), turns=200, repetitions=1, seed=42)
    p0 = freq.p_coop

    jacinto_factory = lambda: SafeUCBForgettingRLAgent(
        prior_p=p0, gamma=0.90, initial_count=2.0, forgetting_factor=0.90,
        ucb_c=1.5, player_name="6. Jacinto (RL + Safe UCB)"
    )
    mitcha_factory = lambda: ForgettingTransitionRLAgent(
        prior_p=p0, gamma=0.90, initial_count=2.0, forgetting_factor=0.90,
        player_name="5. Mitcha (RL Olvido)"
    )

    # 1. Duelos 1v1 C2..C6
    rivals = [
        ("TitForTat", axl.TitForTat),
        ("Grudger", axl.Grudger),
        ("Defector", axl.Defector),
        ("Alternator", axl.Alternator),
        ("Cambio C->D", lambda: CooperateThenDefect(switch_turn=50)),
        ("3 Fases C-D-C", ThreePhaseRival),
    ]
    duel_results = {}
    for r_name, r_cls in rivals:
        row = {}
        for label, fac in [("Mitcha", mitcha_factory), ("Jacinto", jacinto_factory)]:
            m = axl.Match((fac(), r_cls()), turns=200, seed=42)
            m.play()
            sc = m.final_score()
            l100 = sum(s[0] for s in m.scores()[100:]) / 100.0
            f3 = sum(s[0] for s in m.scores()[130:]) / 70.0
            row[label] = {
                "mean": sc[0] / 200.0,
                "l100": l100,
                "f3": f3,
                "cum_avg": [sum(s[0] for s in m.scores()[:k+1]) / (k + 1) for k in range(200)],
            }
        duel_results[r_name] = row
        print(f"1v1 {r_name:<15}: Mitcha={row['Mitcha']['mean']:.3f} (L100={row['Mitcha']['l100']:.3f}) | Jacinto={row['Jacinto']['mean']:.3f} (L100={row['Jacinto']['l100']:.3f})")

    # 2. Barrido ucb_c in [0.0, 0.5, 1.0, 1.5, 2.0, 3.0]
    c_values = [0.0, 0.5, 1.0, 1.5, 2.0, 3.0]
    sweep = []
    axelrod_15_factories = [(lambda cls=s: cls()) for s in axl.axelrod_first_strategies]
    for c_val in c_values:
        fac = lambda cv=c_val: SafeUCBForgettingRLAgent(
            prior_p=p0, gamma=0.90, initial_count=2.0, forgetting_factor=0.90,
            ucb_c=cv, player_name=f"Jacinto (c={cv})"
        )
        m_alt = axl.Match((fac(), axl.Alternator()), turns=200, seed=42)
        m_alt.play()
        m_def = axl.Match((fac(), axl.Defector()), turns=200, seed=42)
        m_def.play()
        t_ax = axl.Tournament([fac()] + [s() for s in axl.axelrod_first_strategies], turns=200, repetitions=5, seed=42).play(progress_bar=False)
        rk_ax = t_ax.ranking.index(0) + 1
        sc_ax = float(np.mean(t_ax.normalised_scores[0]))
        sweep.append({
            "c": c_val,
            "alt": m_alt.final_score()[0] / 200.0,
            "def": m_def.final_score()[0] / 200.0,
            "axelrod_score": sc_ax,
            "axelrod_rank": rk_ax,
        })
        print(f"Sweep c={c_val:.1f}: Alt={sweep[-1]['alt']:.3f} | Def={sweep[-1]['def']:.3f} | Axelrod=#{rk_ax} ({sc_ax:.3f})")

    # 3. Axelrod 1980 (10 seeds = 0..9)
    res_ax10 = run_tournament_10_seeds([jacinto_factory] + axelrod_15_factories, turns=200, seeds=SEEDS_10)
    jac_ax10 = next(r for r in res_ax10 if "Jacinto" in r["name"])
    print(f"Axelrod 1980 (10 seeds): #{jac_ax10['overall_rank']}/16 | Rank medio={jac_ax10['mean_rank']:.2f} | %#1={jac_ax10['win_rate_pct']:.0f}% | {jac_ax10['mean_score']:.3f} ± {jac_ax10['std_score']:.3f}")

    # 4. Harper et al. (41 jugadores, 10 seeds)
    harper_classes = [
        axl.EvolvedLookerUp2_2_2, axl.EvolvedANN5, axl.EvolvedFSM16, axl.PSOGambler2_2_2,
        axl.Winner12, axl.FoolMeOnce, axl.DBS, axl.ZDExtort2, axl.ZDGTFT2, axl.ZDSet2,
        axl.OmegaTFT, axl.OriginalGradual, axl.Gradual, axl.APavlov2006, axl.APavlov2011,
        axl.WinStayLoseShift, axl.MetaHunter, axl.Prober, axl.Prober2, axl.HardProber,
        axl.CyclerCCD, axl.CyclerDDC, axl.CyclerCCCD, axl.Bully, axl.Alternator,
        axl.TitForTat, axl.Grudger, axl.FirstByDavis, axl.FirstByJoss, axl.FirstByDowning,
        axl.FirstByShubik, axl.FirstByNydegger, axl.FirstByGrofman, axl.Defector,
        axl.Cooperator, axl.Random,
    ]
    res_h10 = run_tournament_10_seeds([jacinto_factory] + [(lambda cls=s: cls()) for s in harper_classes], turns=200, seeds=SEEDS_10)
    jac_h10 = next(r for r in res_h10 if "Jacinto" in r["name"])
    print(f"Harper (37 jug, 10 seeds): #{jac_h10['overall_rank']}/37 | {jac_h10['mean_score']:.3f} ± {jac_h10['std_score']:.3f}")

    # 5. Mega-Torneo (171 jugadores: 170 base + Jacinto)
    seen = set()
    mega_cls = []
    for cls in axl.short_run_time_strategies:
        try:
            nm = cls().name
            if any(b in nm.lower() for b in ["mind", "darwin", "human", "meta", "ann noise", "qlearner"]):
                continue
            if nm not in seen:
                seen.add(nm)
                mega_cls.append(cls)
            if len(mega_cls) >= 170:
                break
        except Exception:
            continue
    mega_players = [jacinto_factory()] + [cls() for cls in mega_cls]
    mega_res = axl.Tournament(mega_players, turns=200, repetitions=1, seed=42).play(progress_bar=False)
    jac_mega_rank = mega_res.ranking.index(0) + 1
    jac_mega_score = float(np.mean(mega_res.normalised_scores[0]))
    print(f"Mega-Torneo (171 jug): #{jac_mega_rank}/171 | {jac_mega_score:.3f} pts/ronda")

    out = {
        "duels": {k: {ag: {"mean": v["mean"], "l100": v["l100"], "f3": v["f3"]} for ag, v in row.items()} for k, row in duel_results.items()},
        "sweep_ucb_c": sweep,
        "axelrod_10seeds": {k: v for k, v in jac_ax10.items() if k not in ("seed_scores", "seed_ranks")},
        "harper_10seeds": {k: v for k, v in jac_h10.items() if k not in ("seed_scores", "seed_ranks")},
        "mega_tournament": {"rank": jac_mega_rank, "total": len(mega_players), "mean_score": jac_mega_score},
    }
    with open("jacinto_taller6_results.json", "w") as f:
        json.dump(out, f, indent=2)

    # Plot fig_jacinto_taller6.png (2x2)
    fig, axes = plt.subplots(2, 2, figsize=(13.5, 8.0))
    fig.suptitle("Taller 6 — Jacinto (Guacamayo Jacinto): RL Olvido + Exploración Segura UCB (s ≠ CC)", fontsize=12.5, fontweight="bold", y=0.98)

    # Panel 1: vs Alternator trajectory
    ax = axes[0, 0]
    t_arr = np.arange(1, 201)
    ax.plot(t_arr, duel_results["Alternator"]["Jacinto"]["cum_avg"], color="#1d4ed8", lw=2.4, label=f"6. Jacinto (c=1.5): {duel_results['Alternator']['Jacinto']['mean']:.3f} pts/r (L100={duel_results['Alternator']['Jacinto']['l100']:.3f})")
    ax.plot(t_arr, duel_results["Alternator"]["Mitcha"]["cum_avg"], color="#2e7d32", lw=2.1, ls="--", label=f"5. Mitcha (c=0.0): {duel_results['Alternator']['Mitcha']['mean']:.3f} pts/r (L100={duel_results['Alternator']['Mitcha']['l100']:.3f})")
    ax.axhline(3.0, color="#0f172a", ls=":", lw=1.2, label="Óptimo Teórico vs Alternator (3.000)")
    ax.set_title("1. Ruptura del Óptimo Local frente a Alternator", fontsize=10, fontweight="bold")
    ax.set_xlabel("Turno (t)")
    ax.set_ylabel("Puntos Acumulados / Ronda")
    ax.set_ylim(1.5, 3.15)
    ax.legend(loc="lower right", fontsize=8.0)
    ax.grid(True, linestyle=":", alpha=0.5)

    # Panel 2: Sweep of ucb_c
    ax = axes[0, 1]
    cs = [x["c"] for x in sweep]
    ax.plot(cs, [x["alt"] for x in sweep], marker="o", lw=2.2, color="#1d4ed8", label="vs Alternator (Explotación)")
    ax.plot(cs, [x["axelrod_score"] for x in sweep], marker="s", lw=2.2, color="#2e7d32", label="Torneo Axelrod 1980 (5 reps)")
    ax.plot(cs, [x["def"] for x in sweep], marker="^", lw=2.0, color="#d62728", label="vs Defector (Defensa)")
    ax.axvline(1.5, color="#f59e0b", ls="--", lw=1.3, label="Punto elegido c = 1.5")
    ax.set_title("2. Sensibilidad al Coeficiente de Exploración UCB (c)", fontsize=10, fontweight="bold")
    ax.set_xlabel("Constante UCB (c)")
    ax.set_ylabel("Puntos / Ronda")
    ax.legend(loc="center right", fontsize=8.0)
    ax.grid(True, linestyle=":", alpha=0.5)

    # Panel 3: 6 conditions bar comparison Mitcha vs Jacinto
    ax = axes[1, 0]
    cond_names = ["TitForTat", "Grudger", "Defector", "Alternator", "Cambio C->D", "3 Fases C-D-C"]
    m_vals = [duel_results[c]["Mitcha"]["mean"] for c in cond_names]
    j_vals = [duel_results[c]["Jacinto"]["mean"] for c in cond_names]
    xc = np.arange(len(cond_names))
    wb = 0.34
    b1 = ax.bar(xc - wb/2, m_vals, width=wb, color="#22c55e", edgecolor="#1e293b", label="5. Mitcha (RL Olvido, c=0)")
    b2 = ax.bar(xc + wb/2, j_vals, width=wb, color="#1d4ed8", edgecolor="#1e293b", label="6. Jacinto (RL + Safe UCB, c=1.5)")
    for b in list(b1) + list(b2):
        ax.text(b.get_x() + b.get_width()/2, b.get_height() + 0.04, f"{b.get_height():.2f}", ha="center", va="bottom", fontsize=7.5, fontweight="bold")
    ax.set_xticks(xc)
    ax.set_xticklabels(cond_names, fontsize=8.2, fontweight="bold")
    ax.set_ylim(0, 3.85)
    ax.set_ylabel("Puntos / Ronda (200 turnos)")
    ax.set_title("3. Comparativa Directa 1v1: Mitcha vs. Jacinto", fontsize=10, fontweight="bold")
    ax.legend(loc="upper center", ncol=2, fontsize=8.0)
    ax.grid(axis="y", linestyle=":", alpha=0.5)

    # Panel 4: Trajectory vs Defector and 3-Phase Rival
    ax = axes[1, 1]
    ax.plot(t_arr, duel_results["3 Fases C-D-C"]["Jacinto"]["cum_avg"], color="#1d4ed8", lw=2.2, label=f"Jacinto vs 3 Fases: {duel_results['3 Fases C-D-C']['Jacinto']['mean']:.3f} (F3={duel_results['3 Fases C-D-C']['Jacinto']['f3']:.3f})")
    ax.plot(t_arr, duel_results["3 Fases C-D-C"]["Mitcha"]["cum_avg"], color="#22c55e", lw=2.0, ls="--", label=f"Mitcha vs 3 Fases: {duel_results['3 Fases C-D-C']['Mitcha']['mean']:.3f} (F3={duel_results['3 Fases C-D-C']['Mitcha']['f3']:.3f})")
    ax.plot(t_arr, duel_results["Defector"]["Jacinto"]["cum_avg"], color="#ef4444", lw=2.0, label=f"Jacinto vs Defector: {duel_results['Defector']['Jacinto']['mean']:.3f}")
    ax.plot(t_arr, duel_results["Defector"]["Mitcha"]["cum_avg"], color="#991b1b", lw=1.8, ls=":", label=f"Mitcha vs Defector: {duel_results['Defector']['Mitcha']['mean']:.3f}")
    ax.set_title("4. Adaptación No Estacionaria (3 Fases) y Defensa (Defector)", fontsize=10, fontweight="bold")
    ax.set_xlabel("Turno (t)")
    ax.set_ylabel("Puntos Acumulados / Ronda")
    ax.legend(loc="center right", fontsize=7.8)
    ax.grid(True, linestyle=":", alpha=0.5)

    plt.tight_layout(rect=[0, 0, 1, 0.95])
    plt.savefig("fig_jacinto_taller6.png", dpi=170)
    plt.close(fig)
    print(f"[OK] Completado en {time.time() - t0:.1f}s. Figura fig_jacinto_taller6.png guardada.")


if __name__ == "__main__":
    main()
