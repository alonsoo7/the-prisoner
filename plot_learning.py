"""Generate detailed online learning curves for the forgetting-factor MDP agent."""

from pathlib import Path
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap
from matplotlib.patches import Patch
import numpy as np
import axelrod as axl

from agents import EmpiricalPolicyAgent, ForgettingTransitionRLAgent
from ipd_mdp import (
    ACTION_C,
    ACTION_D,
    ACTION_LABELS,
    ACTIONS,
    C,
    D,
    PAYOFF,
    STATES,
    build_mdp_transition_matrix,
    build_training_pool,
    collect_frequency_table,
    compute_cumulative_avg_scores,
    solve_bellman,
)


class CooperateThenDefect(axl.Player):
    """Non-stationary test rival: cooperates for switch_turn rounds, then defects."""

    name = "CooperateThenDefect"

    def __init__(self, switch_turn: int = 50):
        super().__init__()
        self.switch_turn = switch_turn

    def strategy(self, opponent: axl.Player) -> axl.Action:
        return C if len(self.history) < self.switch_turn else D


class ThreePhaseRival(axl.Player):
    """Non-stationary rival: cooperates (1..60), defects (61..130), cooperates (131..200)."""

    name = "ThreePhaseRival"

    def strategy(self, opponent: axl.Player) -> axl.Action:
        turn_idx = len(self.history)
        if turn_idx < 60:
            return C
        if turn_idx < 130:
            return D
        return C


def rolling_round_scores(
    my_history: list[axl.Action],
    opp_history: list[axl.Action],
    window: int = 15,
) -> list[float]:
    """Compute rolling mean points per round over the last `window` turns."""
    round_pts = [
        PAYOFF[(ACTION_C if a == C else ACTION_D, ACTION_C if o == C else ACTION_D)]
        for a, o in zip(my_history, opp_history)
    ]
    avgs: list[float] = []
    for idx in range(len(round_pts)):
        start = max(0, idx - window + 1)
        slice_pts = round_pts[start : idx + 1]
        avgs.append(sum(slice_pts) / len(slice_pts))
    return avgs


def play_and_trace(
    prior_p: dict[tuple[int, int], float],
    opponent: axl.Player,
    initial_count: float,
    forgetting_factor: float,
    gamma: float = 0.90,
    turns: int = 200,
    seed: int = 42,
) -> tuple[ForgettingTransitionRLAgent, axl.Player, list[float]]:
    """Run a single traced match and return (agent, opponent, cumulative_avg_scores)."""
    agent = ForgettingTransitionRLAgent(
        prior_p=prior_p,
        gamma=gamma,
        initial_count=initial_count,
        forgetting_factor=forgetting_factor,
        record_trace=True,
    )
    opp = opponent.clone()
    axl.Match((agent, opp), turns=turns, seed=seed).play()
    avg_scores = compute_cumulative_avg_scores(agent.history, opp.history)
    return agent, opp, avg_scores


def print_online_trace(
    agent: ForgettingTransitionRLAgent,
    opponent: axl.Player,
    avg_scores: list[float],
    turns_to_print: int = 10,
) -> None:
    """Print turn-by-turn transition matrix updates and variable learning rate."""
    print(
        f"\n--- Traza (n0={agent.initial_count}, lam={agent.forgetting_factor}) "
        f"contra {opponent.name} (primeros {turns_to_print} turnos) ---"
    )
    print(
        f"{'T':<4} {'Jugada':<9} {'P_t(C|CC,C)':>12} {'P_t(C|DD,C)':>12} "
        f"{'Politica':>10} {'Pts/Ronda':>10}"
    )
    for t in range(1, min(turns_to_print, len(agent.trace_log)) + 1):
        snap = agent.trace_log[t - 1]
        pair = f"({agent.history[t - 1].name}, {opponent.history[t - 1].name})"
        pol = "".join(ACTION_LABELS[a] for a in snap["policy"])
        print(
            f"{t:<4} {pair:<9} "
            f"{snap['probs'][(0, ACTION_C)]:>12.4f} "
            f"{snap['probs'][(3, ACTION_C)]:>12.4f} "
            f"{pol:>10} {avg_scores[t - 1]:>10.3f}"
        )


def main() -> None:
    """Build frequency table, trace forgetting-factor learning curves, and save figure."""
    gamma = 0.90
    initial_count = 2.0
    default_lambda = 0.90
    freq = collect_frequency_table(build_training_pool(), turns=200, repetitions=1, seed=42)
    bellman0 = solve_bellman(freq.p_coop, gamma=gamma)

    # 1. Compare forgetting_factor values vs Defector and vs regime-switching opponent
    lambda_compare = [0.70, 0.85, 0.90, 1.0]
    defector_runs: dict[float, tuple[ForgettingTransitionRLAgent, list[float]]] = {}
    switch_runs: dict[float, tuple[ForgettingTransitionRLAgent, list[float]]] = {}
    for lam in lambda_compare:
        agent_def, _, scores_def = play_and_trace(
            freq.p_coop,
            axl.Defector(),
            initial_count=initial_count,
            forgetting_factor=lam,
            gamma=gamma,
            turns=200,
        )
        defector_runs[lam] = (agent_def, scores_def)

        agent_sw, _, scores_sw = play_and_trace(
            freq.p_coop,
            CooperateThenDefect(switch_turn=50),
            initial_count=initial_count,
            forgetting_factor=lam,
            gamma=gamma,
            turns=200,
        )
        switch_runs[lam] = (agent_sw, scores_sw)

    fixed_agent = EmpiricalPolicyAgent(policy=bellman0.policy)
    fixed_opp = CooperateThenDefect(switch_turn=50)
    axl.Match((fixed_agent, fixed_opp), turns=200, seed=42).play()
    fixed_switch_scores = compute_cumulative_avg_scores(fixed_agent.history, fixed_opp.history)

    # 2. Trace default config against 4 distinct rival archetypes over 60 turns
    rivals = [
        ("Cooperator", axl.Cooperator()),
        ("Alternator", axl.Alternator()),
        ("Random", axl.Random()),
        ("Defector", axl.Defector()),
    ]
    rival_runs: dict[str, tuple[ForgettingTransitionRLAgent, axl.Player, list[float]]] = {}
    for label, opp in rivals:
        agent, played_opp, scores = play_and_trace(
            freq.p_coop,
            opp,
            initial_count=initial_count,
            forgetting_factor=default_lambda,
            gamma=gamma,
            turns=60,
            seed=42,
        )
        rival_runs[label] = (agent, played_opp, scores)

    print_online_trace(rival_runs["Defector"][0], rival_runs["Defector"][1], rival_runs["Defector"][2])
    print_online_trace(
        rival_runs["Alternator"][0], rival_runs["Alternator"][1], rival_runs["Alternator"][2]
    )

    # Build compact 1x4 horizontal learning visualization
    fig, axes = plt.subplots(1, 4, figsize=(16.2, 3.85))
    fig.suptitle(
        f"Aprendizaje Online de Mitcha con Contador Efectivo y Factor de Olvido (n0={initial_count}, reset_model() por enfrentamiento)",
        fontsize=11.3,
        fontweight="bold",
        y=1.02,
    )

    lam_colors = {0.70: "#00897b", 0.85: "#2e7d32", 0.90: "#1565c0", 1.0: "#8e24aa"}

    # Panel 1: P_t(C | DD, C) vs Defector for different forgetting factors
    ax = axes[0]
    t35 = np.arange(1, 36)
    ann_offsets = {0.70: (-20, -14), 0.85: (-24, 5), 0.90: (8, -6), 1.0: (7, 6)}
    for lam in lambda_compare:
        agent, _ = defector_runs[lam]
        p_dd_c = [snap["probs"][(3, ACTION_C)] for snap in agent.trace_log[:35]]
        pol_dd = [snap["policy"][3] for snap in agent.trace_log[:35]]
        color = lam_colors[lam]
        lbl = f"lam={lam:.2f}" + (" (sin olvido)" if lam == 1.0 else f" (eta_inf={1-lam:.2f})")
        ax.plot(t35, p_dd_c, label=lbl, color=color, linewidth=1.8)
        first_d = next((idx for idx, act in enumerate(pol_dd) if act == ACTION_D), None)
        if first_d is not None:
            ax.scatter(
                t35[first_d],
                p_dd_c[first_d],
                color=color,
                marker="*",
                s=105,
                zorder=5,
                edgecolor="black",
            )
            ax.annotate(
                f"t={t35[first_d]}",
                (t35[first_d], p_dd_c[first_d]),
                textcoords="offset points",
                xytext=ann_offsets[lam],
                fontsize=7.3,
                color=color,
                fontweight="bold",
            )
    ax.set_xlabel("Turno (t)", fontsize=8.5)
    ax.set_ylabel("P_t(O_t = C | DD, C)", fontsize=8.5)
    ax.set_title("1. Ajuste vs Defector (* = 1er cambio a D)", fontsize=9.2, fontweight="bold")
    ax.set_ylim(0.0, 0.30)
    ax.legend(fontsize=6.9, loc="upper right")
    ax.grid(alpha=0.3)

    # Panel 2: Adaptation to a mid-match regime switch (Cooperate 50 -> Defect 150)
    ax = axes[1]
    t200 = np.arange(1, 201)
    ax.plot(
        t200,
        fixed_switch_scores,
        label=f"Base CDDC ({fixed_switch_scores[-1]:.3f})",
        color="#d32f2f",
        linestyle="--",
        linewidth=1.7,
    )
    for lam in lambda_compare:
        _, scores = switch_runs[lam]
        lbl = f"lam={lam:.2f} ({scores[-1]:.3f})"
        ax.plot(t200, scores, label=lbl, color=lam_colors[lam], linewidth=1.8)
    ax.axvline(50, color="black", linestyle=":", linewidth=1.1, label="Cambio C->D (t=50)")
    ax.set_xlabel("Turno (t)", fontsize=8.5)
    ax.set_ylabel("Pts acumulados / ronda", fontsize=8.5)
    ax.set_title("2. Cambio de estrategia C -> D (t=50)", fontsize=9.2, fontweight="bold")
    ax.set_ylim(0.8, 3.15)
    ax.legend(fontsize=6.8, loc="lower left", ncol=2)
    ax.grid(alpha=0.3)

    # Panel 3: What (n0=2.0, lambda=0.90) learns across 4 archetypes
    ax = axes[2]
    t60 = np.arange(1, 61)
    curves = [
        ("Coop: P(C|CC,C)", "Cooperator", (0, ACTION_C), "#2e7d32", "-"),
        ("Alt: P(C|CD,D)", "Alternator", (1, ACTION_D), "#0277bd", "-"),
        ("Alt: P(C|DC,C)", "Alternator", (2, ACTION_C), "#0277bd", "--"),
        ("Rand: P(C|CC,C)", "Random", (0, ACTION_C), "#ef6c00", "-"),
        ("Def: P(C|DD,C)", "Defector", (3, ACTION_C), "#c62828", "-"),
    ]
    for label, rival_key, ctx, color, ls in curves:
        agent = rival_runs[rival_key][0]
        series = [snap["probs"][ctx] for snap in agent.trace_log[:60]]
        ax.plot(t60, series, label=label, color=color, linestyle=ls, linewidth=1.8)
    ax.set_xlabel("Turno (t)", fontsize=8.5)
    ax.set_ylabel("Probabilidad Estimada P_t", fontsize=8.5)
    ax.set_title(f"3. Probabilidades aprendidas (lam={default_lambda})", fontsize=9.2, fontweight="bold")
    ax.set_ylim(-0.04, 1.25)
    ax.legend(fontsize=6.6, loc="upper center", ncol=2, framealpha=0.92)
    ax.grid(alpha=0.3)

    # Panel 4: Policy mutation timeline [CC, CD, DC, DD] over turns 1..40
    ax = axes[3]
    turns_map = 40
    grid_rows: list[list[int]] = []
    y_labels: list[str] = []
    for rival_name, _ in rivals:
        agent = rival_runs[rival_name][0]
        for s_idx, s_name in enumerate(STATES):
            row = [agent.trace_log[t]["policy"][s_idx] for t in range(turns_map)]
            grid_rows.append(row)
            y_labels.append(f"{rival_name[:4]}:{s_name}")

    cmap = ListedColormap(["#d32f2f", "#2e7d32"])
    ax.imshow(np.array(grid_rows), aspect="auto", cmap=cmap, vmin=0, vmax=1, interpolation="nearest")
    for sep in (3.5, 7.5, 11.5):
        ax.axhline(sep, color="white", linewidth=1.8)
    ax.set_yticks(range(len(y_labels)))
    ax.set_yticklabels(y_labels, fontsize=6.4)
    ax.set_xticks(np.arange(0, turns_map, 5))
    ax.set_xticklabels(np.arange(1, turns_map + 1, 5), fontsize=7.5)
    ax.set_xlabel("Turno (t)", fontsize=8.5)
    ax.set_title("4. Mutacion de politica pi_t[s] en vivo", fontsize=9.2, fontweight="bold")
    ax.legend(
        handles=[Patch(facecolor="#2e7d32", label="C"), Patch(facecolor="#d32f2f", label="D")],
        loc="upper right",
        fontsize=6.9,
        framealpha=0.92,
    )

    plt.tight_layout()
    out_path = Path(__file__).resolve().parent / "aprendizaje_olvido.png"
    fig.savefig(out_path, dpi=160, bbox_inches="tight")
    plt.close(fig)
    print(f"\nGrafico de aprendizaje guardado en: {out_path}")

    save_detailed_rl_figure(
        prior_p=freq.p_coop,
        base_policy=bellman0.policy,
        alternator_agent=rival_runs["Alternator"][0],
        initial_count=initial_count,
        default_lambda=default_lambda,
        gamma=gamma,
    )


def save_detailed_rl_figure(
    prior_p: dict[tuple[int, int], float],
    base_policy: list[int],
    alternator_agent: ForgettingTransitionRLAgent,
    initial_count: float = 2.0,
    default_lambda: float = 0.90,
    gamma: float = 0.90,
) -> None:
    """Plot internal RL learning mechanics: eta_t, Bellman DeltaQ, 3-phase rolling score, and T0->T60."""
    fig = plt.figure(figsize=(15, 10.5))
    gs = fig.add_gridspec(2, 2, hspace=0.32, wspace=0.26)
    fig.suptitle(
        f"Mecanismo Interno de Aprendizaje RL (n0={initial_count}, lam={default_lambda})",
        fontsize=13.5,
        fontweight="bold",
    )

    # Panel 1: Variable learning rate eta_k = 1 / n_k across context visits k=1..25
    ax1 = fig.add_subplot(gs[0, 0])
    visits = np.arange(1, 26)
    lam_specs = [
        (0.70, "#00897b", "lam=0.70 (piso eta=0.30)"),
        (0.85, "#2e7d32", "lam=0.85 (piso eta=0.15)"),
        (0.90, "#1565c0", "lam=0.90 (piso eta=0.10)"),
        (1.00, "#8e24aa", "lam=1.00 (eta -> 0, sin olvido)"),
    ]
    for lam, color, label in lam_specs:
        n_val = initial_count
        etas = []
        for _ in visits:
            n_val = lam * n_val + 1.0
            etas.append(1.0 / n_val)
        ax1.plot(visits, etas, marker="o", ms=3.5, color=color, linewidth=2, label=label)
        if lam < 1.0:
            ax1.axhline(1.0 - lam, color=color, linestyle=":", linewidth=1.1, alpha=0.8)
    ax1.set_xlabel("Visitas al contexto (k)")
    ax1.set_ylabel("Tasa variable de aprendizaje eta_k = 1 / n_k")
    ax1.set_title("1. Evolucion de eta_k: agilidad inicial y piso de plasticidad")
    ax1.set_ylim(-0.02, 0.46)
    ax1.legend(fontsize=8, loc="upper right")
    ax1.grid(alpha=0.3)

    # Panel 2: Bellman advantage DeltaQ_t(s) = Q_t(s, C) - Q_t(s, D) vs Alternator
    ax2 = fig.add_subplot(gs[0, 1])
    t60 = np.arange(1, 61)
    state_colors = ["#2e7d32", "#1565c0", "#ef6c00", "#8e24aa"]
    for s_idx, s_name in enumerate(STATES):
        dq_series = [snap["delta_q"][s_idx] for snap in alternator_agent.trace_log[:60]]
        ax2.plot(t60, dq_series, label=f"Delta Q_t({s_name})", color=state_colors[s_idx], linewidth=2)
    ax2.axhline(0.0, color="black", linestyle="--", linewidth=1.2)
    ax2.text(43, 0.45, "Zona Cooperar (C)", fontsize=8, color="#2e7d32", fontweight="bold")
    ax2.text(43, -0.25, "Zona Traicionar (D)", fontsize=8, color="#c62828", fontweight="bold")
    ax2.set_xlabel("Turno (t)")
    ax2.set_ylabel("Ventaja Q_t(s, C) - Q_t(s, D)")
    ax2.set_title("2. Evolucion de la ventaja de Bellman Delta Q_t vs Alternator")
    ax2.legend(fontsize=8, loc="lower left")
    ax2.grid(alpha=0.3)

    # Panel 3: 15-turn rolling score against 3-phase non-stationary opponent (C -> D -> C)
    ax3 = fig.add_subplot(gs[1, 0])
    t200 = np.arange(1, 201)
    phase_runs: list[tuple[str, str, str, axl.Player]] = [
        ("Fija CDDC", "#d32f2f", "--", EmpiricalPolicyAgent(policy=base_policy)),
        (
            "lam=1.00 (sin olvido)",
            "#8e24aa",
            "-",
            ForgettingTransitionRLAgent(
                prior_p=prior_p, gamma=gamma, initial_count=initial_count, forgetting_factor=1.0
            ),
        ),
        (
            "lam=0.90",
            "#1565c0",
            "-",
            ForgettingTransitionRLAgent(
                prior_p=prior_p, gamma=gamma, initial_count=initial_count, forgetting_factor=0.90
            ),
        ),
        (
            "lam=0.80",
            "#00897b",
            "-",
            ForgettingTransitionRLAgent(
                prior_p=prior_p, gamma=gamma, initial_count=initial_count, forgetting_factor=0.80
            ),
        ),
    ]
    for label, color, ls, ag in phase_runs:
        opp = ThreePhaseRival()
        axl.Match((ag, opp), turns=200, seed=42).play()
        roll = rolling_round_scores(ag.history, opp.history, window=15)
        total_mean = compute_cumulative_avg_scores(ag.history, opp.history)[-1]
        ax3.plot(
            t200,
            roll,
            label=f"{label} ({total_mean:.3f})",
            color=color,
            linestyle=ls,
            linewidth=2,
        )
    ax3.axvspan(1, 60, color="#e8f5e9", alpha=0.45)
    ax3.axvspan(60, 130, color="#ffebee", alpha=0.45)
    ax3.axvspan(130, 200, color="#e3f2fd", alpha=0.45)
    ax3.axvline(60, color="black", linestyle=":", linewidth=1.1)
    ax3.axvline(130, color="black", linestyle=":", linewidth=1.1)
    ax3.text(30, 5.22, "Fase 1: C", ha="center", fontsize=8, fontweight="bold", color="#2e7d32")
    ax3.text(95, 5.22, "Fase 2: D", ha="center", fontsize=8, fontweight="bold", color="#c62828")
    ax3.text(165, 5.22, "Fase 3: C", ha="center", fontsize=8, fontweight="bold", color="#1565c0")
    ax3.set_xlabel("Turno (t)")
    ax3.set_ylabel("Pts/Ronda (ventana movil 15 turnos)")
    ax3.set_title("3. Adaptacion online en 3 fases (Coopera -> Traiciona -> Coopera)")
    ax3.set_ylim(0.2, 5.55)
    ax3.legend(fontsize=7.3, loc="lower right", framealpha=0.95)
    ax3.grid(alpha=0.3)

    # Panel 4: Transition matrix 8x4 before (T_0) vs after 60 turns vs Alternator (T_60)
    sub_gs = gs[1, 1].subgridspec(1, 2, wspace=0.14)
    base_matrix = build_mdp_transition_matrix(prior_p)
    learned_matrix = alternator_agent.mdp_transitions
    ctx_keys = [(s, a) for s in range(4) for a in ACTIONS]
    ctx_labels = [f"({STATES[s]},{ACTION_LABELS[a]})" for s, a in ctx_keys]

    mat_before = np.array([[base_matrix[k][s_next] for s_next in range(4)] for k in ctx_keys])
    mat_after = np.array([[learned_matrix[k][s_next] for s_next in range(4)] for k in ctx_keys])

    for col_idx, (mat, subtitle) in enumerate(
        [(mat_before, "4a. Matriz Inicial T_0"), (mat_after, "4b. Matriz T_60 vs Alternator")]
    ):
        ax_m = fig.add_subplot(sub_gs[0, col_idx])
        ax_m.imshow(mat, cmap="YlGnBu", vmin=0.0, vmax=1.0, aspect="auto")
        ax_m.set_xticks(range(4))
        ax_m.set_xticklabels(STATES, fontsize=8)
        ax_m.set_yticks(range(len(ctx_labels)))
        if col_idx == 0:
            ax_m.set_yticklabels(ctx_labels, fontsize=7.5)
        else:
            ax_m.set_yticklabels([])
        ax_m.set_title(subtitle, fontsize=10, fontweight="bold")
        for r in range(mat.shape[0]):
            for c in range(mat.shape[1]):
                val = mat[r, c]
                txt_color = "white" if val > 0.55 else "black"
                ax_m.text(c, r, f"{val:.2f}", ha="center", va="center", fontsize=7.2, color=txt_color)

    out_path = Path(__file__).resolve().parent / "aprendizaje_detalle_rl.png"
    fig.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"Grafico detallado RL guardado en: {out_path}")


if __name__ == "__main__":
    main()
