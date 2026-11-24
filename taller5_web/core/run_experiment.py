"""End-to-end experiment: Empirical 8-context Frequency Table + Bellman + Forgetting MDP RL."""

from pathlib import Path
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import axelrod as axl

from agents import EmpiricalPolicyAgent, ForgettingTransitionRLAgent
from ipd_mdp import (
    ACTION_C,
    ACTION_D,
    ACTION_LABELS,
    ACTIONS,
    C,
    STATE_MAP,
    STATES,
    BellmanResult,
    FrequencyTableResult,
    build_training_pool,
    collect_frequency_table,
    compute_cumulative_avg_scores,
    solve_bellman,
)


def print_frequency_table(freq: FrequencyTableResult) -> None:
    """Print the 8-context empirical counts and the induced 8x4 MDP transition matrix."""
    print("=" * 78)
    print(f"ETAPA 1: TABLA DE FRECUENCIAS EMPIRICA (N = {freq.total_transitions:,} transiciones)")
    print("=" * 78)
    print(f"{'Contexto (s_{t-1}, A_t)':<24} {'Coop':>10} {'Total':>10} {'P_hat(O_t=C | s, a)':>22}")
    print("-" * 78)
    for s_idx, s_name in enumerate(STATES):
        for a in ACTIONS:
            coop = freq.counts_coop[(s_idx, a)]
            total = freq.counts_total[(s_idx, a)]
            prob = freq.p_coop[(s_idx, a)]
            label = f"({s_name}, A_t={ACTION_LABELS[a]})"
            print(f"{label:<24} {coop:>10,} {total:>10,} {prob:>21.4f}")

    print("\nMATRIZ DE TRANSICION COMPLETA DEL AMBIENTE P(s_t | s_{t-1}, A_t) [8 x 4]:")
    print(f"{'(s_{t-1}, A_t)':<18} {'-> CC':>10} {'-> CD':>10} {'-> DC':>10} {'-> DD':>10}")
    print("-" * 62)
    for s_idx, s_name in enumerate(STATES):
        for a in ACTIONS:
            row = freq.mdp_transitions[(s_idx, a)]
            label = f"({s_name}, {ACTION_LABELS[a]})"
            print(
                f"{label:<18} "
                f"{row[0]:>10.4f} {row[1]:>10.4f} {row[2]:>10.4f} {row[3]:>10.4f}"
            )


def print_bellman_table(
    p_coop: dict[tuple[int, int], float],
    bellman: BellmanResult,
    gamma: float,
) -> None:
    """Print V*(s), Q*(s, C), Q*(s, D), advantage, and initial policy pi_0."""
    print("\n" + "=" * 86)
    print(f"ETAPA 2: SOLUCION DE BELLMAN (gamma = {gamma:.2f}) -> POLITICA INICIAL pi_0")
    print("=" * 86)
    print(
        f"{'Estado':<8} {'P(C|s,C)':>10} {'P(C|s,D)':>10} "
        f"{'V*(s)':>9} {'Q*(s,C)':>9} {'Q*(s,D)':>9} {'Delta Q*':>10} {'pi_0[s]':>9}"
    )
    print("-" * 86)
    for s_idx, s_name in enumerate(STATES):
        p_c = p_coop[(s_idx, ACTION_C)]
        p_d = p_coop[(s_idx, ACTION_D)]
        v_s = bellman.v_values[s_idx]
        q_c = bellman.q_values[(s_idx, ACTION_C)]
        q_d = bellman.q_values[(s_idx, ACTION_D)]
        dq = bellman.delta_q[s_idx]
        pi_s = ACTION_LABELS[bellman.policy[s_idx]]
        print(
            f"{s_name:<8} {p_c:>10.4f} {p_d:>10.4f} "
            f"{v_s:>9.2f} {q_c:>9.2f} {q_d:>9.2f} {dq:>+10.2f} {pi_s:>9}"
        )
    policy_str = "".join(ACTION_LABELS[a] for a in bellman.policy)
    print(f"\nPolitica inicial emergente (CC, CD, DC, DD): {policy_str}")


def trace_vs_defector(
    prior_p: dict[tuple[int, int], float],
    gamma: float = 0.90,
    initial_count: float = 2.0,
    forgetting_factor: float = 0.90,
    turns: int = 30,
) -> dict[str, list[float]]:
    """Simulate a match against Defector and record online adaptation metrics."""
    agent = ForgettingTransitionRLAgent(
        prior_p=prior_p,
        gamma=gamma,
        initial_count=initial_count,
        forgetting_factor=forgetting_factor,
        record_trace=True,
    )
    opponent = axl.Defector()
    axl.Match((agent, opponent), turns=turns, seed=42).play()

    cum_avg_score = compute_cumulative_avg_scores(agent.history, opponent.history)
    p_dd_c_hist = [snap["probs"][(3, ACTION_C)] for snap in agent.trace_log]
    p_cd_d_hist = [snap["probs"][(1, ACTION_D)] for snap in agent.trace_log]
    delta_q_dd_hist = [snap["delta_q"][3] for snap in agent.trace_log]

    print("\n" + "=" * 88)
    print(
        "TRAZA ONLINE CONTRA DEFECTOR - CONTADOR EFECTIVO CON OLVIDO "
        f"(n0={initial_count}, lambda={forgetting_factor})"
    )
    print("=" * 88)
    print(
        f"{'Turno':<6} {'Jugada':<10} {'eta_t':>8} {'P_t(C|DD,C)':>13} "
        f"{'DeltaQ_t(DD)':>14} {'pi_t[DD]':>10} {'Pts/Ronda':>11}"
    )
    print("-" * 88)
    for t in range(1, min(turns, 12) + 1):
        snap = agent.trace_log[t - 1]
        pair_str = f"({agent.history[t - 1].name}, {opponent.history[t - 1].name})"
        if t >= 3:
            ctx = (
                STATE_MAP[(agent.history[t - 3], opponent.history[t - 3])],
                ACTION_C if agent.history[t - 2] == C else ACTION_D,
            )
            eta_str = f"{snap['etas'][ctx]:>8.4f}"
        else:
            eta_str = f"{'---':>8}"
        pi_dd = ACTION_LABELS[snap["policy"][3]]
        print(
            f"{t:<6} {pair_str:<10} {eta_str} {p_dd_c_hist[t - 1]:>13.4f} "
            f"{delta_q_dd_hist[t - 1]:>+14.2f} {pi_dd:>10} {cum_avg_score[t - 1]:>11.3f}"
        )

    return {
        "p_dd_c": p_dd_c_hist,
        "p_cd_d": p_cd_d_hist,
        "delta_q_dd": delta_q_dd_hist,
        "cum_avg_score": cum_avg_score,
    }


def evaluate_in_axelrod_1980(
    agent: axl.Player,
    turns: int = 200,
    repetitions: int = 5,
    seed: int = 42,
) -> list[dict[str, float | str | int]]:
    """Run the 16-player Axelrod 1980 tournament and return sorted standings."""
    players = [cls() for cls in axl.axelrod_first_strategies] + [agent.clone()]
    tournament = axl.Tournament(
        players=players,
        turns=turns,
        repetitions=repetitions,
        seed=seed,
    )
    results = tournament.play(progress_bar=False)

    standings = []
    for idx, player in enumerate(players):
        norm_scores = results.normalised_scores[idx]
        raw_scores = results.scores[idx]
        standings.append(
            {
                "name": player.name,
                "mean_norm": float(np.mean(norm_scores)),
                "std_norm": float(np.std(norm_scores)),
                "mean_total": float(np.mean(raw_scores)),
            }
        )

    standings.sort(key=lambda row: row["mean_norm"], reverse=True)
    for rank, row in enumerate(standings, start=1):
        row["rank"] = rank
    return standings


def save_summary_plot(
    freq: FrequencyTableResult,
    bellman: BellmanResult,
    defector_trace: dict[str, list[float]],
    comparison_scores: dict[str, tuple[float, float, int]],
    output_path: Path,
) -> None:
    """Create a compact 1x4 horizontal summary visualization of the frequency table, Bellman, and RL results."""
    fig, axes = plt.subplots(1, 4, figsize=(16.2, 3.85))
    fig.suptitle(
        "Dilema del Prisionero Iterado: Tabla de Frecuencias (8 Contextos) + Bellman (CDDC) + Aprendizaje Online con Olvido (Mitcha)",
        fontsize=11.3,
        fontweight="bold",
        y=1.02,
    )

    # Panel 1: 8-context empirical probabilities P(O_t=C | s_{t-1}, A_t)
    ax = axes[0]
    x = np.arange(len(STATES))
    width = 0.36
    probs_c = [freq.p_coop[(s, ACTION_C)] for s in range(4)]
    probs_d = [freq.p_coop[(s, ACTION_D)] for s in range(4)]
    ax.bar(x - width / 2, probs_c, width, label="Si juego C (A_t=C)", color="#2e7d32")
    ax.bar(x + width / 2, probs_d, width, label="Si juego D (A_t=D)", color="#c62828")
    ax.set_xticks(x)
    ax.set_xticklabels(STATES, fontsize=8.5)
    ax.set_ylim(0.0, 1.12)
    ax.set_ylabel("P_hat(O_t = C | s_{t-1}, A_t)", fontsize=8.5)
    ax.set_title("1. Tabla de Frecuencias (8 Contextos)", fontsize=9.3, fontweight="bold")
    ax.legend(fontsize=7.3, loc="upper right")
    ax.grid(axis="y", linestyle="--", alpha=0.4)

    # Panel 2: Bellman Q*(s, C) vs Q*(s, D)
    ax = axes[1]
    q_c = [bellman.q_values[(s, ACTION_C)] for s in range(4)]
    q_d = [bellman.q_values[(s, ACTION_D)] for s in range(4)]
    ax.bar(x - width / 2, q_c, width, label="Q*(s, C)", color="#1565c0")
    ax.bar(x + width / 2, q_d, width, label="Q*(s, D)", color="#ef6c00")
    for s in range(4):
        top = max(q_c[s], q_d[s])
        ax.text(
            s,
            top + 0.45,
            f"pi_0={ACTION_LABELS[bellman.policy[s]]}",
            ha="center",
            fontsize=7.8,
            fontweight="bold",
        )
    ax.set_xticks(x)
    ax.set_xticklabels(STATES, fontsize=8.5)
    ax.set_ylim(18.0, max(q_c + q_d) * 1.11)
    ax.set_ylabel("Valor Descontado Q*(s, a)", fontsize=8.5)
    ax.set_title("2. Bellman (gamma=0.90) -> pi_0=CDDC", fontsize=9.3, fontweight="bold")
    ax.legend(fontsize=7.3, loc="upper right")
    ax.grid(axis="y", linestyle="--", alpha=0.4)

    # Panel 3: Online incremental transition update vs Defector
    ax = axes[2]
    turns = np.arange(1, len(defector_trace["p_dd_c"]) + 1)
    ax.plot(turns, defector_trace["p_dd_c"], label="P_t(C | DD, C)", color="#6a1b9a", marker="o", ms=2.6)
    ax.plot(turns, defector_trace["p_cd_d"], label="P_t(C | CD, D)", color="#00838f", marker="s", ms=2.6)
    ax2 = ax.twinx()
    ax2.plot(turns, defector_trace["delta_q_dd"], label="Delta Q_t(DD)", color="#d84315", linestyle="--")
    ax2.axhline(0.0, color="black", linestyle=":", linewidth=1)
    ax.axvline(7, color="#d84315", linestyle=":", linewidth=1.0, alpha=0.8)
    ax.set_xlabel("Turno (t)", fontsize=8.5)
    ax.set_ylabel("Probabilidad Estimada P_t", fontsize=8.5)
    ax2.set_ylabel("Ventaja Delta Q_t(DD)", fontsize=8.2)
    ax.set_title("3. Adaptacion Online vs Defector (t=7)", fontsize=9.3, fontweight="bold")
    lines1, labels1 = ax.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax.legend(lines1 + lines2, labels1 + labels2, fontsize=6.9, loc="upper right")
    ax.grid(alpha=0.3)

    # Panel 4: Axelrod 1980 tournament comparison
    ax = axes[3]
    labels = list(comparison_scores.keys())
    means = [comparison_scores[k][0] for k in labels]
    stds = [comparison_scores[k][1] for k in labels]
    ranks = [comparison_scores[k][2] for k in labels]
    colors = [
        "#78909c",
        "#42a5f5",
        "#00897b",
        "#2e7d32",
        "#1565c0",
        "#6a1b9a",
        "#8d6e63",
        "#ef6c00",
        "#fbc02d",
    ]
    bars = ax.bar(range(len(labels)), means, yerr=stds, capsize=2.5, color=colors[: len(labels)])
    ax.set_xticks(range(len(labels)))
    short_labels = [
        lbl.replace("Sin Prior\n(0.50)", "SinPrior").replace("\n(sin olvido)", "*").replace("\n", " ")
        for lbl in labels
    ]
    ax.set_xticklabels(short_labels, fontsize=6.8, rotation=25, ha="right")
    ax.set_ylim(1.90, max(means) * 1.11)
    ax.set_ylabel("Pts / Ronda (Axelrod 80)", fontsize=8.5)
    ax.set_title("4. Sensibilidad a lambda en Axelrod 1980", fontsize=9.3, fontweight="bold")
    for bar, mean, rank in zip(bars, means, ranks):
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            mean + 0.035,
            f"{mean:.2f}\n(#{rank})",
            ha="center",
            va="bottom",
            fontsize=6.2,
        )
    ax.grid(axis="y", linestyle="--", alpha=0.4)

    plt.tight_layout()
    fig.savefig(output_path, dpi=160, bbox_inches="tight")
    plt.close(fig)


def main() -> None:
    """Run full Frequency Table + Bellman + Forgetting Transition RL experiment."""
    gamma = 0.90
    initial_count = 2.0
    default_lambda = 0.90

    # 1. Build 8-context frequency table from 30 diverse Axelrod strategies (no ML/gradients).
    pool = build_training_pool()
    freq = collect_frequency_table(pool, turns=200, repetitions=1, seed=42)
    print_frequency_table(freq)

    # 2. Solve Bellman Value Iteration to derive initial policy pi_0.
    bellman = solve_bellman(freq.p_coop, gamma=gamma)
    print_bellman_table(freq.p_coop, bellman, gamma=gamma)

    # 3. Trace live adaptation against Defector.
    defector_trace = trace_vs_defector(
        freq.p_coop,
        gamma=gamma,
        initial_count=initial_count,
        forgetting_factor=default_lambda,
        turns=30,
    )

    # 4. Evaluate forgetting factors lambda, plus fixed Stage-1 and uniform baseline.
    def find_row(standings: list[dict[str, float | str | int]], name: str) -> dict:
        return next(r for r in standings if r["name"] == name)

    lambda_values = [0.70, 0.80, 0.85, 0.90, 0.95, 1.0]
    lambda_rows: dict[float, dict] = {}
    standings_default = None
    for lam in lambda_values:
        agent = ForgettingTransitionRLAgent(
            prior_p=freq.p_coop,
            gamma=gamma,
            initial_count=initial_count,
            forgetting_factor=lam,
            player_name=f"Matriz Incremental (n0={initial_count}, lam={lam})",
        )
        standings = evaluate_in_axelrod_1980(agent, turns=200, repetitions=5, seed=42)
        lambda_rows[lam] = find_row(standings, agent.name)
        if lam == default_lambda:
            standings_default = standings

    assert standings_default is not None
    agent_stage1 = EmpiricalPolicyAgent(policy=bellman.policy)
    agent_no_prior = ForgettingTransitionRLAgent(
        prior_p=None,
        gamma=gamma,
        initial_count=initial_count,
        forgetting_factor=default_lambda,
        player_name="Sin Prior (0.50 uniforme)",
    )
    standings_stage1 = evaluate_in_axelrod_1980(agent_stage1, turns=200, repetitions=5, seed=42)
    standings_no_prior = evaluate_in_axelrod_1980(agent_no_prior, turns=200, repetitions=5, seed=42)

    print("\n" + "=" * 78)
    print(f"TORNEO DE AXELROD (1980) - CONTADOR EFECTIVO (n0={initial_count}, lam={default_lambda})")
    print("=" * 78)
    print(f"{'Pos':<5} {'Estrategia':<44} {'Total Medio':>11} {'Pts/Ronda (± DE)':>18}")
    print("-" * 78)
    for row in standings_default:
        print(
            f"#{row['rank']:<4} {str(row['name']):<44} "
            f"{row['mean_total']:>11.1f} {row['mean_norm']:>8.3f} ± {row['std_norm']:.3f}"
        )

    row_no_prior = find_row(standings_no_prior, agent_no_prior.name)
    row_stage1 = find_row(standings_stage1, agent_stage1.name)
    row_tft = find_row(standings_default, "Tit For Tat")

    print("\n" + "=" * 78)
    print(f"IMPACTO DEL FACTOR DE OLVIDO lambda (n0={initial_count}) EN AXELROD 1980")
    print("=" * 78)
    summary_entries = [
        (f"Sin Prior (0.50, n0={initial_count}, lam={default_lambda})", row_no_prior),
        *[
            (
                f"lam={lam:.2f} (eta_inf={1.0 - lam:.2f})"
                + (" [sin olvido]" if lam == 1.0 else ""),
                lambda_rows[lam],
            )
            for lam in lambda_values
        ],
        ("Etapa 1 Fija (eta = 0)", row_stage1),
        ("Tit For Tat (referencia)", row_tft),
    ]
    for label, row in summary_entries:
        print(
            f"{label:<46} Pos #{row['rank']:<2}/16 | "
            f"{row['mean_norm']:.3f} ± {row['std_norm']:.3f} pts/ronda"
        )

    comparison = {
        "Sin Prior\n(0.50)": (row_no_prior["mean_norm"], row_no_prior["std_norm"], row_no_prior["rank"]),
        **{
            (f"lam={lam:.2f}" if lam < 1.0 else "lam=1.0\n(sin olvido)"): (
                lambda_rows[lam]["mean_norm"],
                lambda_rows[lam]["std_norm"],
                lambda_rows[lam]["rank"],
            )
            for lam in lambda_values
        },
        "Fija\n(eta=0)": (row_stage1["mean_norm"], row_stage1["std_norm"], row_stage1["rank"]),
        "Tit For\nTat": (row_tft["mean_norm"], row_tft["std_norm"], row_tft["rank"]),
    }
    out_plot = Path(__file__).resolve().parent / "resultados_experimento.png"
    save_summary_plot(freq, bellman, defector_trace, comparison, out_plot)
    print(f"\nGrafico guardado en: {out_plot}")


if __name__ == "__main__":
    main()
