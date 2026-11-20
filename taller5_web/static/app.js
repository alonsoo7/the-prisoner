/**
 * app.js — Interactive Game + Axelrod 1980 Voxel Ring + Intelligent Agents Technical Lab
 * Features: Human-vs-AI Voxel Arena, Illuminated Diamond Matrix, Animated Round-Robin Ring,
 * Live KaTeX Math, LaTeX/Modern Typography Switcher, Expectimax & RL Turn-Window Inspectors.
 */

(function () {
  const STATE = {
    catalog: [],
    pythonTemplates: {},
    mdp: null,
    customP: null,
    lambdaSweep: null,
    evolution: null,
    online: null,
    gary: null,
    garyActiveTurn: 1,
    garyPlayTimer: null,
    tournamentsVerified: null,
    axelrodRing: null,
    ringInjectId: "none",
    ringSelectedIdx: 0,
    ringAnimTimer: null,
    ringAnimPairs: [],
    ringAnimStep: 0,
    playSessionId: null,
    playOpponentId: "axl_TitForTat",
    playState: null,
    t10FullGrid: false,
    duel: null,
    duelActiveTurn: 1,
    duelPlayTimer: null,
    h2hSelected: [
      "gen1_rulito", "gen2_cloud", "gen3_gary", "gen4_base", "gen5_rl",
      "axl_TitForTat", "axl_Grudger", "axl_Defector", "axl_Alternator", "rival_switch_50"
    ],
    liveTournSelected: ["gen3_gary", "gen4_base", "gen5_rl"],
    liveTournResult: null,
    codeFiles: null,
    activeCodeIdx: 0,
    activeScriptJobId: null,
    scriptPollTimer: null,
    builderMode: "visual_mem1",
    thm2Events: [],
  };

  const TAB_META = {
    play: [
      "Juega el Dilema del Prisionero Iterado",
      "Experimenta el juego en primera persona frente a estrategas clásicos y agentes de IA",
    ],
    axelrod: [
      "El Primer Torneo de Axelrod (1980)",
      "Quince estrategias compitiendo todos contra todos, el triunfo de las estrategias Nice y su extensión con IA",
    ],
    overview: [
      "Evolución de Agentes Inteligentes",
      "De la miopía frecuentista y la búsqueda Expectimax al aprendizaje por refuerzo con olvido",
    ],
    mdp: [
      "Modelo MDP (8×4) y Planificación de Bellman",
      "Dinámica condicional P(Oₜ | sₜ₋₁, Aₜ), iteración de valores y actualización con factor de olvido",
    ],
    learning: [
      "Aprendizaje Online con Factor de Olvido",
      "Velocidad de adaptación, entornos no estacionarios, tasa variable ηₖ y evolución de Tₜ",
    ],
    gary: [
      "Búsqueda Expectimax con Heurística de Markov",
      "Inspección ronda a ronda de la ventana observada, cálculo en raíz y decisión final",
    ],
    future: [
      "¿Posible Mejora a Futuro? — Jacinto (Taller 6)",
      "Guacamayo Jacinto · Fusión de RL con Olvido (Mitcha) + Exploración Segura UCB en contextos no visitados",
    ],
    arena: [
      "Duelos 1v1, Harper y Torneos en Vivo",
      "Escenario voxel + análisis técnico turno a turno, matrices Head-to-Head y ecosistemas masivos",
    ],
    studio: [
      "Constructor de Estrategias y Código Fuente",
      "Incorpora nuevas estrategias visuales o en Python y valida los invariantes del sistema",
    ],
  };

  const FEATURED_RIVALS = [
    { id: "axl_TitForTat", name: "Tit For Tat", trait: "Copia tu última jugada" },
    { id: "axl_FirstByJoss", name: "Joss", trait: "Sigilosa (10% traición)" },
    { id: "axl_Grudger", name: "Friedman (Grudger)", trait: "Nunca perdona" },
    { id: "axl_FirstByGraaskamp", name: "Graaskamp", trait: "Sondea defensas" },
    { id: "axl_Alternator", name: "Alternator", trait: "Alterna C, D, C, D..." },
    { id: "axl_Defector", name: "Defector", trait: "Siempre traiciona" },
    { id: "axl_Random", name: "Random", trait: "Azar puro 50/50" },
    { id: "gen1_rulito", name: "Rulito (Canario Fiorino)", trait: "Gen 1 · Miope γ=0" },
    { id: "gen2_cloud", name: "Cloud (Periquito Azul)", trait: "Gen 2 · 1-Step γ=0.9" },
    { id: "gen3_gary", name: "Gary (Perro Negro/Blanco)", trait: "Gen 3 · Expectimax H=4" },
    { id: "gen4_base", name: "Base MDP (CDDC)", trait: "Gen 4 · Pavlov emergente" },
    { id: "gen5_rl", name: "Mitcha (Periquito Verde)", trait: "Gen 5 · RL Olvido" },
    { id: "gen6_jacinto", name: "Jacinto (Guacamayo)", trait: "Gen 6 · RL + Safe UCB" },
  ];

  const $ = (id) => document.getElementById(id);

  function renderMath(rootEl) {
    const target = rootEl || document.body;
    if (typeof window.renderMathInElement === "function") {
      try {
        window.renderMathInElement(target, {
          delimiters: [
            { left: "$$", right: "$$", display: true },
            { left: "$", right: "$", display: false },
          ],
          throwOnError: false,
        });
      } catch (_err) {}
    }
  }

  function toast(msg, type = "info") {
    const box = $("toast-container");
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transition = "opacity 0.25s";
      setTimeout(() => el.remove(), 260);
    }, 3200);
  }

  async function apiGet(url) {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function apiPost(url, body = {}) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function apiDelete(url) {
    const res = await fetch(url, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function downloadText(filename, content, mime = "text/plain;charset=utf-8") {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function redrawVisibleCanvases() {
    requestAnimationFrame(() => {
      document.querySelectorAll("canvas").forEach((cv) => {
        if (cv._lastRender && cv.offsetParent !== null) cv._lastRender();
      });
    });
  }

  // =========================================================================
  // TYPOGRAPHY SWITCHER (LaTeX / Moderna)
  // =========================================================================
  function applyTypography(mode) {
    const isLatex = mode !== "modern";
    document.body.classList.toggle("latex-theme", isLatex);
    document.querySelectorAll(".font-toggle button").forEach((b) => {
      b.classList.toggle("active", b.dataset.font === (isLatex ? "latex" : "modern"));
    });
    try { localStorage.setItem("ipd_typography", isLatex ? "latex" : "modern"); } catch (_e) {}
    redrawVisibleCanvases();
  }

  function setupTypographyToggle() {
    let saved = "latex";
    try { saved = localStorage.getItem("ipd_typography") || "latex"; } catch (_e) {}
    applyTypography(saved);
    document.querySelectorAll(".font-toggle button").forEach((b) => {
      b.addEventListener("click", () => applyTypography(b.dataset.font));
    });
  }

  // =========================================================================
  // NAVIGATION & SUBTABS
  // =========================================================================
  function switchTab(tabId) {
    stopGaryPlayback();
    stopDuelPlayback();
    stopRingAnimation();
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tabId));
    document.querySelectorAll(".tab-section").forEach((s) => s.classList.toggle("active", s.id === `tab-${tabId}`));
    if (TAB_META[tabId]) {
      $("topbar-title").textContent = TAB_META[tabId][0];
      $("topbar-subtitle").textContent = TAB_META[tabId][1];
    }
    if (tabId === "studio" && !STATE.codeFiles) loadSourceCodes();
    if (tabId === "arena" && !STATE.duel) runCurrentDuel();
    redrawVisibleCanvases();
  }

  function activateSubtab(sectionEl, subtabId) {
    sectionEl.querySelectorAll(".subtab-btn[data-subtab]").forEach((b) =>
      b.classList.toggle("active", b.dataset.subtab === subtabId)
    );
    sectionEl.querySelectorAll(".subpanel").forEach((p) =>
      p.classList.toggle("active", p.id === `subpanel-${subtabId}`)
    );
    redrawVisibleCanvases();
  }

  function setupNavigation() {
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });
    document.querySelectorAll(".subtab-btn[data-subtab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const parent = btn.closest(".tab-section");
        activateSubtab(parent, btn.dataset.subtab);
        if (btn.dataset.subtab === "studio-code" && !STATE.codeFiles) loadSourceCodes();
      });
    });
    $("duel-inner-tabs").querySelectorAll("[data-duelview]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = btn.dataset.duelview;
        $("duel-inner-tabs").querySelectorAll("[data-duelview]").forEach((b) => b.classList.toggle("active", b === btn));
        document.querySelectorAll(".duelview-panel").forEach((p) => p.classList.toggle("hidden", p.id !== `duelview-${v}`));
        redrawVisibleCanvases();
      });
    });
    $("btn-goto-axelrod").addEventListener("click", () => switchTab("axelrod"));
    $("btn-goto-evolution").addEventListener("click", () => switchTab("overview"));
  }

  // =========================================================================
  // CATALOG POPULATORS
  // =========================================================================
  function populateStrategySelect(selectEl, defaultId) {
    if (!selectEl) return;
    const prevVal = selectEl.value || defaultId;
    const groups = new Map();
    STATE.catalog.forEach((item) => {
      if (!groups.has(item.group)) groups.set(item.group, []);
      groups.get(item.group).push(item);
    });
    selectEl.innerHTML = "";
    groups.forEach((items, gName) => {
      const og = document.createElement("optgroup");
      og.label = gName;
      items.forEach((it) => {
        const opt = document.createElement("option");
        opt.value = it.id;
        opt.textContent = it.name;
        og.appendChild(opt);
      });
      selectEl.appendChild(og);
    });
    if ([...selectEl.options].some((o) => o.value === prevVal)) selectEl.value = prevVal;
    else if (defaultId && [...selectEl.options].some((o) => o.value === defaultId)) selectEl.value = defaultId;
  }

  function renderChipSelector(containerId, selectedArr) {
    const container = $(containerId);
    if (!container) return;
    container.innerHTML = "";
    STATE.catalog.forEach((it) => {
      const isSel = selectedArr.includes(it.id);
      const chip = document.createElement("span");
      chip.className = `strategy-chip ${isSel ? "selected" : ""}`;
      chip.innerHTML = `<span class="dot" style="background:${it.color}"></span>${it.short}`;
      chip.title = `${it.name} (${it.group})`;
      chip.addEventListener("click", () => {
        const idx = selectedArr.indexOf(it.id);
        if (idx >= 0) selectedArr.splice(idx, 1);
        else selectedArr.push(it.id);
        chip.classList.toggle("selected");
      });
      container.appendChild(chip);
    });
  }

  function refreshAllCatalogWidgets() {
    populateStrategySelect($("play-opponent-select"), STATE.playOpponentId);
    populateStrategySelect($("duel-agent-a"), "gen5_rl");
    populateStrategySelect($("duel-agent-b"), "axl_Defector");
    populateStrategySelect($("lrn-matrix-rival"), "axl_Alternator");
    populateStrategySelect($("gary-rival"), "axl_FirstByJoss");
    renderChipSelector("h2h-chip-selector", STATE.h2hSelected);
    renderChipSelector("live-tourn-chips", STATE.liveTournSelected);
    renderPlayCharacterGrid();
    renderCustomStrategiesList();
    const customCount = STATE.catalog.filter((c) => c.id.startsWith("custom_")).length;
    $("nav-custom-count").textContent = String(customCount);
  }

  // =========================================================================
  // SECTION 1: JUEGA EL DILEMA (HUMAN VS AI VOXEL ARENA)
  // =========================================================================
  function renderPlayCharacterGrid() {
    const grid = $("play-char-grid");
    if (!grid) return;
    const customs = STATE.catalog
      .filter((c) => c.id.startsWith("custom_"))
      .map((c) => ({ id: c.id, name: c.short, trait: "Tu estrategia", color: c.color }));
    const cards = [...FEATURED_RIVALS, ...customs];

    grid.innerHTML = cards
      .map(
        (c) => `
      <div class="char-card ${c.id === STATE.playOpponentId ? "active" : ""}" data-play-opp="${c.id}">
        ${T5Voxel.renderVoxelAvatar(c.id, { headOnly: true, size: 46, color: c.color })}
        <div class="c-name">${c.name}</div>
        <div class="c-trait">${c.trait}</div>
      </div>`
      )
      .join("");

    grid.querySelectorAll("[data-play-opp]").forEach((el) => {
      el.addEventListener("click", () => startHumanGame(el.dataset.playOpp));
    });
  }

  async function startHumanGame(opponentId) {
    STATE.playOpponentId = opponentId || STATE.playOpponentId || "axl_TitForTat";
    if ($("play-opponent-select")) $("play-opponent-select").value = STATE.playOpponentId;
    renderPlayCharacterGrid();

    try {
      const res = await apiPost("/api/play/start", {
        opponent_id: STATE.playOpponentId,
        seed: Math.floor(Math.random() * 10000),
      });
      STATE.playSessionId = res.session_id;
      STATE.playState = {
        opponentName: res.opponent_name,
        humanMoves: [],
        oppMoves: [],
        humanScores: [],
        oppScores: [],
        humanTotal: 0,
        oppTotal: 0,
        turn: 0,
      };
      renderPlayStage();
      $("play-insight-box").innerHTML = `
        <h4>Nueva partida contra ${res.opponent_name}</h4>
        <p>Elige <strong>Cooperar ($C$)</strong> o <strong>Traicionar ($D$)</strong> para jugar la ronda 1. Si ambos cooperan ganan $3$ pts cada uno; si traicionas a un cooperador ganas $5$ pts (y él $0$); si ambos traicionan ganan $1$ pt.</p>`;
      renderMath($("play-insight-box"));
    } catch (err) {
      toast(err.message, "error");
    }
  }

  function renderPlayStage() {
    const ps = STATE.playState;
    if (!ps) return;
    const cat = STATE.catalog.find((c) => c.id === STATE.playOpponentId);
    T5Voxel.renderDuelStage($("play-voxel-stage"), {
      idA: "human",
      nameA: "Tú (Humano)",
      idB: STATE.playOpponentId,
      nameB: ps.opponentName,
      colorB: cat?.color,
      movesA: ps.humanMoves,
      movesB: ps.oppMoves,
      scoresA: ps.humanScores,
      scoresB: ps.oppScores,
      activeTurn: ps.turn,
      totalA: ps.humanTotal,
      totalB: ps.oppTotal,
      compact: false,
    });
  }

  async function playHumanMove(move) {
    if (!STATE.playSessionId) await startHumanGame(STATE.playOpponentId);
    try {
      $("btn-human-c").disabled = true;
      $("btn-human-d").disabled = true;
      const res = await apiPost("/api/play/move", {
        session_id: STATE.playSessionId,
        human_move: move,
      });
      STATE.playState = {
        opponentName: STATE.playState.opponentName,
        humanMoves: res.human_moves,
        oppMoves: res.opp_moves,
        humanScores: res.human_scores,
        oppScores: res.opp_scores,
        humanTotal: res.human_total,
        oppTotal: res.opp_total,
        turn: res.turn,
      };
      renderPlayStage();

      const outcomeDesc =
        res.state === "CC"
          ? "Cooperación mutua: ambos ganan $+3$ puntos."
          : res.state === "DC"
          ? "¡Explotaste al rival! Ganas $+5$ puntos y el rival $0$."
          : res.state === "CD"
          ? "¡El rival te traicionó! Recibes $0$ puntos y el rival $+5$."
          : "Castigo mutuo $(D, D)$: ambos quedan atrapados en $+1$ punto.";

      let aiLine = "";
      if (res.ai_thought) {
        const th = res.ai_thought;
        if (th.kind === "mdp_rl") {
          aiLine = `<p style="margin-top:6px"><strong>Mente del agente RL:</strong> política actualizada $\\pi_${res.turn} = \\texttt{${th.policy}}$ · $P_t(C\\mid CC,C)=${th.p_cc_c}$, $P_t(C\\mid DD,C)=${th.p_dd_c}$, $\\Delta Q_t(DD)=${th.delta_q_dd >= 0 ? "+" : ""}${th.delta_q_dd}$.</p>`;
        } else if (th.kind === "gary") {
          aiLine = `<p style="margin-top:6px"><strong>Mente de Expectimax:</strong> evaluó $\\bar{f}_t(C)=${th.f_c}$ vs. $\\bar{f}_t(D)=${th.f_d}$ con vector $E_t=[${th.E.join(", ")}]$.</p>`;
        } else if (th.kind === "rulito" || th.kind === "cloud") {
          aiLine = `<p style="margin-top:6px"><strong>Mente de ${STATE.playState.opponentName}:</strong> fase <code>${th.phase}</code> · $\\hat{Q}(C)=${th.q_c}$ vs. $\\hat{Q}(D)=${th.q_d}$.</p>`;
        }
      }

      $("play-insight-box").innerHTML = `
        <h4>Ronda ${res.turn} · Promedio: Tú ${res.human_avg.toFixed(2)} pts/r vs. ${STATE.playState.opponentName} ${res.opp_avg.toFixed(2)} pts/r</h4>
        <p>Jugaste <strong>${res.human_move}</strong> y tu rival jugó <strong>${res.opp_move}</strong>. ${outcomeDesc}</p>
        ${aiLine}`;
      renderMath($("play-insight-box"));
    } catch (err) {
      toast(err.message, "error");
    } finally {
      $("btn-human-c").disabled = false;
      $("btn-human-d").disabled = false;
    }
  }

  // =========================================================================
  // SECTION 2: AXELROD 1980 — ANIMATED VOXEL RING + NICE VS NASTY LEADERBOARD
  // =========================================================================
  function getActiveRingDataset() {
    const ring = STATE.axelrodRing;
    if (!ring) return null;
    const base15 = ring.players_15.map((p) => ({ ...p, isInjected: false }));
    const inj = STATE.ringInjectId;

    if (inj === "none" || !ring.generations_vs_15[inj]) {
      const players = base15.map((p, i) => ({ ...p, avg_total: p.avg_total_15, avg_round: p.avg_round_15 }));
      return { players, matrix: ring.matrix_15 };
    }

    const gen = ring.generations_vs_15[inj];
    const n15 = base15.length;
    const players = [
      ...base15.map((p, i) => {
        const sum15 = ring.matrix_15[i].reduce((acc, v, j) => (j === i ? acc : acc + v), 0);
        const avgTotal = (sum15 + gen["15_vs"][i]) / n15;
        return { ...p, avg_total: Math.round(avgTotal * 10) / 10, avg_round: avgTotal / ring.turns };
      }),
      {
        id: gen.id,
        name: gen.name,
        short: gen.short,
        nice: gen.nice,
        trait: gen.trait,
        sample_moves: gen.sample_moves,
        sample_opp: gen.sample_opp,
        avg_total: gen.avg_total,
        avg_round: gen.avg_round,
        isInjected: true,
      },
    ];

    const mat16 = ring.matrix_15.map((row, i) => [...row, gen["15_vs"][i]]);
    mat16.push([...gen.vs_15, 600.0]);
    return { players, matrix: mat16 };
  }

  function stopRingAnimation() {
    if (STATE.ringAnimTimer) {
      clearInterval(STATE.ringAnimTimer);
      STATE.ringAnimTimer = null;
      if ($("btn-ring-animate")) $("btn-ring-animate").textContent = "▶ Animar Enfrentamientos";
    }
  }

  function renderAxelrodRingSection(activePair = null) {
    const ds = getActiveRingDataset();
    if (!ds) return;
    const { players, matrix } = ds;
    if (STATE.ringSelectedIdx >= players.length) STATE.ringSelectedIdx = 0;

    T5Voxel.renderAxelrodRingSVG($("axelrod-ring-svg"), players, matrix, {
      selectedIdx: STATE.ringSelectedIdx,
      activePair,
      onSelect: (idx) => {
        stopRingAnimation();
        STATE.ringSelectedIdx = idx;
        renderAxelrodRingSection(null);
      },
    });

    // Selected Character Inspector Card below the ring
    const sel = players[STATE.ringSelectedIdx];
    const sigHtml = (sel.sample_moves || [])
      .map((m) => `<span class="tok-dot ${m === "C" ? "tok-c" : "tok-d"}" style="width:16px;height:16px"></span>`)
      .join("");
    const oppSigHtml = (sel.sample_opp || [])
      .map((m) => `<span class="tok-dot ${m === "C" ? "tok-c" : "tok-d"}" style="width:16px;height:16px"></span>`)
      .join("");

    $("ring-char-detail").innerHTML = `
      <div class="theorem-box" style="margin-bottom:0;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:14px;flex:1;min-width:240px">
          ${T5Voxel.renderVoxelAvatar(sel.id, { side: "left", move: sel.nice ? "C" : "D", mood: sel.nice ? "happy" : "sneaky", size: 70 })}
          <div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <strong>${sel.name}</strong>
              <span class="badge ${sel.isInjected ? "badge-purple" : sel.nice ? "badge-c" : "badge-d"}">${sel.isInjected ? "Agente IA" : sel.nice ? "Nice" : "Nasty"}</span>
              <span class="mono" style="font-size:12.5px"><strong>${Math.round(sel.avg_total)} pts</strong> (${sel.avg_round.toFixed(3)}/r)</span>
            </div>
            <p style="margin:4px 0 6px;font-size:12.8px">${sel.trait}</p>
            <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--ink-muted)">
              <span>Firma ante sonda:</span> ${sigHtml} <span style="margin-left:6px">vs</span> ${oppSigHtml}
            </div>
          </div>
        </div>
        <div class="btn-group">
          <button class="btn btn-primary btn-sm" id="btn-ring-play-vs">🎮 Jugar contra ${sel.short.slice(0, 12)}</button>
        </div>
      </div>`;

    $("btn-ring-play-vs").addEventListener("click", () => {
      switchTab("play");
      startHumanGame(sel.id);
    });

    // Nice vs Nasty Voxel Leaderboard (sorted)
    const ranked = players
      .map((p, origIdx) => ({ ...p, origIdx }))
      .sort((a, b) => b.avg_total - a.avg_total);
    const maxPts = Math.max(550, ...ranked.map((r) => r.avg_total));

    const lb = $("axelrod-voxel-leaderboard");
    lb.innerHTML = ranked
      .map((r, pos) => {
        const rowCls = r.isInjected ? "is-ai" : r.nice ? "is-nice" : "is-nasty";
        const barCol = r.isInjected ? "#7b3fa0" : r.nice ? "#16a34a" : "#dc2626";
        const pct = Math.max(8, Math.round((r.avg_total / maxPts) * 100));
        return `
        <div class="axelrod-lb-row ${rowCls}" data-lbidx="${r.origIdx}">
          <span class="mono" style="font-weight:700;font-size:12px">#${String(pos + 1).padStart(2, "0")}</span>
          ${T5Voxel.renderVoxelAvatar(r.id, { headOnly: true, size: 26 })}
          <span style="font-weight:${r.origIdx === STATE.ringSelectedIdx || r.isInjected ? "700" : "600"};font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.short}</span>
          <span class="mono text-right" style="font-weight:700;font-size:12.5px">${Math.round(r.avg_total)}</span>
          <div class="axelrod-lb-bar-track"><div class="axelrod-lb-bar-fill" style="width:${pct}%;background:${barCol}"></div></div>
        </div>`;
      })
      .join("");

    lb.querySelectorAll("[data-lbidx]").forEach((el) => {
      el.addEventListener("click", () => {
        stopRingAnimation();
        STATE.ringSelectedIdx = parseInt(el.dataset.lbidx, 10);
        renderAxelrodRingSection(null);
      });
    });
  }

  function toggleRingAnimation() {
    if (STATE.ringAnimTimer) {
      stopRingAnimation();
      renderAxelrodRingSection(null);
      return;
    }
    const ds = getActiveRingDataset();
    if (!ds) return;
    const n = ds.players.length;
    const pairs = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) pairs.push([i, j]);
    }
    // Shuffle lightly or start with focused player's pairs first so it's immediately exciting!
    const focus = STATE.ringSelectedIdx;
    pairs.sort((a, b) => (a.includes(focus) ? -1 : 0) - (b.includes(focus) ? -1 : 0));
    STATE.ringAnimPairs = pairs;
    STATE.ringAnimStep = 0;
    $("btn-ring-animate").textContent = "⏸ Detener Animación";

    STATE.ringAnimTimer = setInterval(() => {
      const pair = STATE.ringAnimPairs[STATE.ringAnimStep % STATE.ringAnimPairs.length];
      renderAxelrodRingSection(pair);
      STATE.ringAnimStep++;
    }, 520);
  }

  // =========================================================================
  // HELPER: SLIDING TURN WINDOW STRIP
  // =========================================================================
  function buildTurnWindowHTML(movesA, movesB, scoresA, scoresB, activeTurn1Based) {
    const t = activeTurn1Based;
    const startT = Math.max(1, t - 3);
    const slots = [];
    for (let k = startT; k <= t; k++) {
      const idx = k - 1;
      const ma = movesA[idx], mb = movesB[idx], st = `${ma}${mb}`;
      const isCurr = k === t, isPrev = k === t - 1 || k === t - 2;
      const roleTag = isCurr ? "Turno actual" : k === t - 1 ? "Estado previo" : k === t - 2 ? "Contexto t−2" : "Historial";
      const stBadgeCls = st === "CC" ? "badge-c" : st === "DC" ? "badge-blue" : st === "DD" ? "badge-amber" : "badge-d";
      slots.push(`
        <div class="win-slot ${isCurr ? "is-current" : isPrev ? "is-prev" : ""}">
          <div class="w-turn">t = ${k} · ${roleTag}</div>
          <div class="w-moves">
            <span class="badge ${ma === "C" ? "badge-c" : "badge-d"}">${ma}</span>
            <span style="margin:0 3px;color:var(--ink-muted)">vs</span>
            <span class="badge ${mb === "C" ? "badge-c" : "badge-d"}">${mb}</span>
          </div>
          <div class="w-pts"><span class="badge ${stBadgeCls}">${st}</span> · +${scoresA[idx]} / +${scoresB[idx]}</div>
        </div>`);
      if (k < t) slots.push(`<div class="win-arrow">→</div>`);
    }
    return slots.join("");
  }

  // =========================================================================
  // SECTION 3: EVOLUCIÓN DE AGENTES
  // =========================================================================
  function renderEvolutionCharts() {
    const evo = STATE.evolution;
    if (!evo) return;

    T5Charts.renderVerticalBarChart($("cv-evo-axelrod"), {
      categories: evo.axelrod_bars.map((b) => b.short),
      groups: [{
        label: "Pts / Ronda",
        values: evo.axelrod_bars.map((b) => b.mean),
        stds: evo.axelrod_bars.map((b) => b.std),
        colors: evo.axelrod_bars.map((b) => b.color),
        tags: evo.axelrod_bars.map((b) => `(#${b.rank}/16)`),
      }],
      yMin: 0,
      yMax: 3.18,
      yLabel: "Puntos / Ronda",
      showBarValues: true,
      hideLegend: true,
      hLines: [{ y: evo.tft_reference, color: "#0f253c", label: "Tit For Tat (2.560)" }],
    });

    T5Charts.renderLineChart($("cv-evo-grudger"), {
      series: evo.grudger_series.map((s) => ({ label: `${s.name.split(" (")[0]} (${s.final_total})`, color: s.color, dashed: s.dashed, values: s.values })),
      yMin: 0,
      yMax: 630,
      yDecimals: 0,
      xLabel: "Turno (t)",
      yLabel: "Puntos Acumulados",
      vLines: [{ x: 10, color: "#64748b", label: "Fin exploración (t=10)" }],
    });

    T5Charts.renderLineChart($("cv-evo-defector"), {
      series: evo.defector_series.map((s) => ({ label: `${s.name.split(" (")[0]} (${s.final_avg.toFixed(3)})`, color: s.color, dashed: s.dashed, values: s.values })),
      yMin: 0.2,
      yMax: 1.08,
      xLabel: "Turno (t)",
      yLabel: "Promedio acumulado / ronda",
    });

    const genIds = ["gen1_rulito", "gen2_cloud", "gen3_gary", "gen4_base", "gen5_rl"];
    const genMeta = {
      gen1_rulito: { label: "1. Rulito", color: "#d62728" },
      gen2_cloud: { label: "2. Cloud", color: "#ef6c00" },
      gen3_gary: { label: "3. Expectimax", color: "#7b3fa0" },
      gen4_base: { label: "4. Base CDDC", color: "#1565c0" },
      gen5_rl: { label: "5. Mitcha (RL)", color: "#2e7d32" },
    };
    T5Charts.renderVerticalBarChart($("cv-evo-conditions"), {
      categories: evo.conditions,
      groups: genIds.map((gid) => ({ label: genMeta[gid].label, color: genMeta[gid].color, values: evo.conditions.map((c) => evo.condition_scores[gid][c] ?? 0) })),
      yMin: 0,
      yMax: 3.85,
      yLabel: "Puntos / Ronda",
    });

    const tbody = $("tbody-paper-summary");
    const rowsData = [
      ["Torneo Axelrod 1980", "16 jug. · 10 seeds", "1.921 (#11)", "2.449 (#6)", "2.686 (#1)", "2.539 (#4)", "2.632 (#1)", "tab:axelrod"],
      ["Ecosistema Harper et al.", "41 jug. · 10 seeds", "2.075 (#32)", "2.382 (#25)", "2.808 (#2)", "2.559 (#22)", "2.613 (#17)", "tourn-harper-mega"],
      ["Mega-Torneo General", "175 estrategias", "1.903 (#154)", "2.365 (#119)", "2.847 (#10)", "2.582 (#100)", "2.788 (#23)", "tourn-harper-mega"],
      ["Duelo vs TitForTat", "1v1 · T=200", evo.condition_scores.gen1_rulito["TitForTat"], evo.condition_scores.gen2_cloud["TitForTat"], evo.condition_scores.gen3_gary["TitForTat"], evo.condition_scores.gen4_base["TitForTat"], evo.condition_scores.gen5_rl["TitForTat"], "duel:axl_TitForTat"],
      ["Duelo vs Grudger", "1v1 · T=200", evo.condition_scores.gen1_rulito["Grudger"], evo.condition_scores.gen2_cloud["Grudger"], evo.condition_scores.gen3_gary["Grudger"], evo.condition_scores.gen4_base["Grudger"], evo.condition_scores.gen5_rl["Grudger"], "duel:axl_Grudger"],
      ["Duelo vs Defector", "1v1 · T=200", evo.condition_scores.gen1_rulito["Defector"], evo.condition_scores.gen2_cloud["Defector"], evo.condition_scores.gen3_gary["Defector"], evo.condition_scores.gen4_base["Defector"], evo.condition_scores.gen5_rl["Defector"], "duel:axl_Defector"],
      ["Duelo vs Alternator", "1v1 · T=200", evo.condition_scores.gen1_rulito["Alternator"], evo.condition_scores.gen2_cloud["Alternator"], evo.condition_scores.gen3_gary["Alternator"], evo.condition_scores.gen4_base["Alternator"], evo.condition_scores.gen5_rl["Alternator"], "duel:axl_Alternator"],
      ["Cambio de régimen C → D", "1v1 · T=200", evo.condition_scores.gen1_rulito["Cambio C->D"], evo.condition_scores.gen2_cloud["Cambio C->D"], evo.condition_scores.gen3_gary["Cambio C->D"], evo.condition_scores.gen4_base["Cambio C->D"], evo.condition_scores.gen5_rl["Cambio C->D"], "duel:rival_switch_50"],
      ["Tres fases C − D − C", "1v1 · T=200", evo.condition_scores.gen1_rulito["3 Fases C-D-C"], evo.condition_scores.gen2_cloud["3 Fases C-D-C"], evo.condition_scores.gen3_gary["3 Fases C-D-C"], evo.condition_scores.gen4_base["3 Fases C-D-C"], evo.condition_scores.gen5_rl["3 Fases C-D-C"], "duel:rival_3phase"],
    ];

    tbody.innerHTML = rowsData
      .map((r) => {
        const fmt = (v) => (typeof v === "number" ? v.toFixed(3) : v);
        const btn = r[7].startsWith("duel:")
          ? `<button class="btn btn-secondary btn-sm" data-open-duel="gen5_rl|${r[7].slice(5)}">⚔ Analizar</button>`
          : `<button class="btn btn-secondary btn-sm" data-open-tourn="${r[7]}">🏆 Ver</button>`;
        return `<tr>
          <td><strong>${r[0]}</strong></td><td class="muted">${r[1]}</td>
          <td class="mono text-right">${fmt(r[2])}</td><td class="mono text-right">${fmt(r[3])}</td>
          <td class="mono text-right" style="color:#6d28d9;font-weight:700">${fmt(r[4])}</td>
          <td class="mono text-right" style="color:#1565c0">${fmt(r[5])}</td>
          <td class="mono text-right" style="color:#2e7d32;font-weight:700">${fmt(r[6])}</td>
          <td>${btn}</td>
        </tr>`;
      })
      .join("");

    tbody.querySelectorAll("[data-open-duel]").forEach((b) => {
      b.addEventListener("click", () => {
        const [a, opp] = b.dataset.openDuel.split("|");
        openDuelDirectly(a, opp);
      });
    });
    tbody.querySelectorAll("[data-open-tourn]").forEach((b) => {
      b.addEventListener("click", () => {
        if (b.dataset.openTourn === "tab:axelrod") switchTab("axelrod");
        else { switchTab("arena"); activateSubtab($("tab-arena"), b.dataset.openTourn); }
      });
    });
  }

  // =========================================================================
  // SECTION 4: MODELO MDP Y BELLMAN
  // =========================================================================
  function renderMdpSection() {
    const mdp = STATE.mdp;
    if (!mdp) return;

    $("mdp-policy-badge").textContent = mdp.policy_str;
    $("mdp-pol-summary-pill").textContent = `π₀ = ${mdp.policy_str}`;
    if ($("mdp-lab-pol-pill")) $("mdp-lab-pol-pill").textContent = `π₀ = ${mdp.policy_str}`;
    $("kpi-transitions").textContent = mdp.total_transitions.toLocaleString("en-US");

    const states = ["CC", "CD", "DC", "DD"];
    const pC = states.map((st) => mdp.contexts.find((c) => c.state === st && c.action === "C").p_coop);
    const pD = states.map((st) => mdp.contexts.find((c) => c.state === st && c.action === "D").p_coop);
    T5Charts.renderVerticalBarChart($("cv-mdp-probs"), {
      categories: states,
      groups: [
        { label: "Si juego C (Aₜ = C)", color: "#2e7d32", values: pC },
        { label: "Si juego D (Aₜ = D)", color: "#c62828", values: pD },
      ],
      yMin: 0,
      yMax: 1.08,
      yLabel: "P̂(Oₜ = C | sₜ₋₁, Aₜ)",
    });

    const qC = mdp.bellman.map((b) => b.q_c);
    const qD = mdp.bellman.map((b) => b.q_d);
    const maxQ = Math.max(...qC, ...qD, 1);
    T5Charts.renderVerticalBarChart($("cv-mdp-bellman"), {
      categories: states,
      groups: [
        { label: "Q*(s, C)", color: "#1565c0", values: qC },
        { label: "Q*(s, D)", color: "#ef6c00", values: qD },
      ],
      yMin: 0,
      yMax: maxQ * 1.18,
      yLabel: "Valor Esperado Descontado",
      categoryTags: mdp.bellman.map((b) => `π₀=${b.policy}`),
    });

    const tr = mdp.defector_trace;
    T5Charts.renderLineChart($("cv-mdp-defector"), {
      series: [
        { label: "Pₜ(C | DD, C)", color: "#6a1b9a", values: tr.map((r) => r.p_dd_c), markers: true },
        { label: "Pₜ(C | CD, D)", color: "#00838f", values: tr.map((r) => r.p_cd_d), markers: true },
      ],
      rightSeries: [{ label: "ΔQₜ(DD)", color: "#d84315", dashed: true, values: tr.map((r) => r.delta_q_dd) }],
      yMin: 0,
      yMax: 0.56,
      xLabel: "Turno (t)",
      yLabel: "Probabilidad Estimada Pₜ",
      ryLabel: "Ventaja ΔQₜ(DD)",
      hLines: [{ y: 0, right: true, color: "#0f253c", dash: [2, 3], label: "ΔQ = 0" }],
    });

    renderLambdaSweepChart();

    const tbody = $("tbody-mdp-table1");
    tbody.innerHTML = mdp.contexts
      .map((ctx, idx) => {
        const bRow = mdp.bellman[Math.floor(idx / 2)];
        const showBellman = idx % 2 === 0;
        const polBadge = bRow.policy === "C"
          ? `<span class="badge badge-c">C (${bRow.delta_q >= 0 ? "+" : ""}${bRow.delta_q.toFixed(2)})</span>`
          : `<span class="badge badge-d">D (${bRow.delta_q.toFixed(2)})</span>`;
        const bCells = showBellman
          ? `<td rowspan="2" class="text-center"><strong>${bRow.state}</strong></td>
             <td rowspan="2" class="mono text-right">${bRow.v_star.toFixed(2)}</td>
             <td rowspan="2" class="mono text-right">${bRow.q_c.toFixed(2)}</td>
             <td rowspan="2" class="mono text-right">${bRow.q_d.toFixed(2)}</td>
             <td rowspan="2" class="text-center">${polBadge}</td>`
          : "";
        return `<tr>
          <td class="mono"><strong>${ctx.label}</strong></td>
          <td class="mono text-right">${ctx.coop.toLocaleString("en-US")}</td>
          <td class="mono text-right">${ctx.total.toLocaleString("en-US")}</td>
          <td class="mono text-right"><strong>${ctx.p_coop.toFixed(4)}</strong></td>
          <td class="mono text-right">${ctx.row[0].toFixed(4)}</td>
          <td class="mono text-right">${ctx.row[1].toFixed(4)}</td>
          <td class="mono text-right">${ctx.row[2].toFixed(4)}</td>
          <td class="mono text-right">${ctx.row[3].toFixed(4)}</td>
          ${bCells}
        </tr>`;
      })
      .join("");

    const sliderBox = $("mdp-prob-sliders");
    if (!sliderBox.dataset.built) {
      sliderBox.dataset.built = "1";
      sliderBox.innerHTML = mdp.contexts
        .map((ctx) => `<div class="prob-slider-card"><div class="top"><span class="mono">p₀${ctx.label}</span><span class="mono" id="lbl-p-${ctx.key}">${ctx.p_coop.toFixed(4)}</span></div><input type="range" min="0" max="1" step="0.01" value="${ctx.p_coop}" data-pkey="${ctx.key}" /></div>`)
        .join("");
      let debounce = null;
      sliderBox.querySelectorAll("input[data-pkey]").forEach((inp) => {
        inp.addEventListener("input", () => {
          const k = inp.dataset.pkey, v = parseFloat(inp.value);
          $(`lbl-p-${k}`).textContent = v.toFixed(4);
          if (!STATE.customP) { STATE.customP = {}; STATE.mdp.contexts.forEach((c) => (STATE.customP[c.key] = c.p_coop)); }
          STATE.customP[k] = v;
          clearTimeout(debounce);
          debounce = setTimeout(recalcMdpLive, 120);
        });
      });
    } else if (!STATE.customP) {
      mdp.contexts.forEach((ctx) => {
        const el = sliderBox.querySelector(`input[data-pkey="${ctx.key}"]`);
        if (el) el.value = ctx.p_coop;
        const lbl = $(`lbl-p-${ctx.key}`);
        if (lbl) lbl.textContent = ctx.p_coop.toFixed(4);
      });
    }
  }

  function renderLambdaSweepChart() {
    const sw = STATE.lambdaSweep;
    if (!sw) return;
    T5Charts.renderVerticalBarChart($("cv-mdp-sweep"), {
      categories: sw.bars.map((b) => b.label),
      groups: [{
        label: "Axelrod 1980",
        values: sw.bars.map((b) => b.mean),
        stds: sw.bars.map((b) => b.std),
        colors: sw.bars.map((b) => b.color),
        tags: sw.bars.map((b) => `(#${b.rank})`),
      }],
      yMin: 0,
      yMax: 3.15,
      yLabel: "Puntos / Ronda",
      showBarValues: true,
      hideLegend: true,
      padBottom: 56,
    });
  }

  async function recalcMdpLive() {
    try {
      STATE.mdp = await apiPost("/api/mdp", {
        gamma: parseFloat($("mdp-gamma").value),
        laplace_alpha: parseFloat($("mdp-laplace").value) || 0,
        initial_count: parseFloat($("mdp-n0").value),
        forgetting_factor: parseFloat($("mdp-lam").value),
        custom_p_coop: STATE.customP,
      });
      renderMdpSection();
      renderTheorem2Sim();
    } catch (err) { toast(err.message, "error"); }
  }

  function renderTheorem2Sim() {
    const p0 = 0.953, n0 = parseFloat($("mdp-n0").value) || 2.0, lam = parseFloat($("mdp-lam").value) || 0.9;
    let nF = n0, pF = p0, nNF = n0, pNF = p0;
    const pFSeries = [p0], pNFSeries = [p0];
    const rows = [{ k: 0, ev: "Prior p₀", n: n0, eta: null, pf: p0, pnf: p0 }];

    STATE.thm2Events.forEach((y, idx) => {
      nF = lam * nF + 1.0; const etaF = 1.0 / nF; pF = (1 - etaF) * pF + etaF * y;
      nNF = nNF + 1.0; const etaNF = 1.0 / nNF; pNF = (1 - etaNF) * pNF + etaNF * y;
      pFSeries.push(pF); pNFSeries.push(pNF);
      rows.push({ k: idx + 1, ev: y === 1 ? "SUMAR" : "RESTAR", n: nF, eta: etaF, pf: pF, pnf: pNF });
    });

    T5Charts.renderLineChart($("cv-thm2-sim"), {
      xStart: 0,
      xTooltipPrefix: "Visita k =",
      series: [
        { label: `Con Olvido (λ=${lam.toFixed(2)})`, color: "#1565c0", values: pFSeries, markers: pFSeries.length <= 20 },
        { label: "Sin Olvido (λ=1.00)", color: "#8e24aa", dashed: true, values: pNFSeries, markers: pNFSeries.length <= 20 },
      ],
      yMin: 0,
      yMax: 1.05,
      xLabel: "Visitas al contexto (CC, C)",
      yLabel: "Probabilidad p_k",
    });

    const tail = rows.length > 25 ? [rows[0], ...rows.slice(-24)] : rows;
    $("tbody-thm2-sim").innerHTML = tail
      .map((r) => `<tr><td class="mono">${r.k}</td><td>${r.ev === "SUMAR" ? '<span class="badge badge-c">y=1 SUMAR</span>' : r.ev === "RESTAR" ? '<span class="badge badge-d">y=0 RESTAR</span>' : '<span class="badge badge-gray">Inicial</span>'}</td><td class="mono text-right">${r.n.toFixed(3)}</td><td class="mono text-right">${r.eta == null ? "—" : r.eta.toFixed(4)}</td><td class="mono text-right" style="color:#1565c0;font-weight:700">${r.pf.toFixed(4)}</td><td class="mono text-right" style="color:#8e24aa">${r.pnf.toFixed(4)}</td></tr>`)
      .join("");
  }

  // =========================================================================
  // SECTION 5: APRENDIZAJE ONLINE (RL)
  // =========================================================================
  function renderOnlineLearningSection() {
    const d = STATE.online;
    if (!d) return;

    T5Charts.renderLineChart($("cv-lrn-defector-speed"), {
      series: d.defector_speed.map((s) => ({ label: s.label, color: s.color, values: s.values, starTurn: s.first_d_turn, starVal: s.first_d_val })),
      yMin: 0, yMax: 0.30, xLabel: "Turno (t)", yLabel: "Pₜ(Oₜ = C | DD, C)",
    });

    T5Charts.renderLineChart($("cv-lrn-switch"), {
      series: d.switch_curves,
      yMin: 0.85, yMax: 3.15, xLabel: "Turno (t)", yLabel: "Puntos acumulados / ronda",
      vLines: [{ x: d.params.switch_turn, color: "#0f253c", label: `Cambio C→D (t=${d.params.switch_turn})` }],
    });

    T5Charts.renderLineChart($("cv-lrn-archetypes"), {
      series: d.archetype_curves, yMin: -0.04, yMax: 1.15, xLabel: "Turno (t)", yLabel: "Probabilidad Estimada Pₜ",
    });

    T5Charts.renderHeatmap($("cv-lrn-policy-map"), {
      mode: "binary",
      matrix: d.policy_heatmap.map((r) => r.values),
      rowLabels: d.policy_heatmap.map((r) => r.label),
      colLabels: Array.from({ length: 40 }, (_, i) => String(i + 1)),
      dividers: [4, 8, 12],
      valueLabel: "Decisión πₜ[s]",
      padLeft: 76, padTop: 10, padBottom: 24,
    });

    const hFloors = d.eta_curves.filter((c) => c.floor != null).map((c) => ({ y: c.floor, color: c.color, dash: [2, 3] }));
    T5Charts.renderLineChart($("cv-lrn-eta"), {
      xTooltipPrefix: "Visita k =",
      series: d.eta_curves.map((c) => ({ label: c.label, color: c.color, values: c.values, markers: true, markerRadius: 2.8 })),
      yMin: 0, yMax: 0.48, xLabel: "Visitas al contexto (k)", yLabel: "Tasa variable η_k = 1 / n_k", hLines: hFloors,
    });

    $("lrn-dq-subtitle").textContent = `Frente a ${d.params.matrix_rival_name} (t=1..60) · Positivo = Cooperar (C), Negativo = Traicionar (D)`;
    T5Charts.renderLineChart($("cv-lrn-deltaq"), {
      series: d.delta_q_curves, xLabel: "Turno (t)", yLabel: "Ventaja Qₜ(s, C) − Qₜ(s, D)",
      hLines: [{ y: 0, color: "#0f253c", dash: [5, 4] }],
      annotations: [{ text: "Cooperar (C)", rx: 0.74, ry: 0.14, color: "#2e7d32" }, { text: "Traicionar (D)", rx: 0.74, ry: 0.86, color: "#c62828" }],
    });

    const p1 = d.params.phase1_end, p2 = d.params.phase2_end;
    T5Charts.renderLineChart($("cv-lrn-3phase"), {
      series: d.phase_curves, yMin: 0.2, yMax: 5.55, xLabel: "Turno (t)", yLabel: `Pts/Ronda (ventana ${d.params.rolling_window} t.)`,
      vSpans: [
        { from: 1, to: p1, color: "rgba(46,125,50,0.09)", label: "Fase 1: C", textColor: "#2e7d32" },
        { from: p1, to: p2, color: "rgba(198,40,40,0.09)", label: "Fase 2: D", textColor: "#c62828" },
        { from: p2, to: 200, color: "rgba(21,101,192,0.09)", label: "Fase 3: C", textColor: "#1565c0" },
      ],
      vLines: [{ x: p1, color: "#334155" }, { x: p2, color: "#334155" }],
    });

    $("lbl-mat60-title").textContent = `Matriz T₆₀ vs ${d.params.matrix_rival_name}`;
    T5Charts.renderHeatmap($("cv-lrn-mat0"), { mode: "prob", matrix: d.matrix_before, rowLabels: d.matrix_context_labels, colLabels: ["CC", "CD", "DC", "DD"], showValues: true, valueLabel: "T₀", padLeft: 62, padTop: 22, padBottom: 8 });
    T5Charts.renderHeatmap($("cv-lrn-mat60"), { mode: "prob", matrix: d.matrix_after, rowLabels: d.matrix_context_labels, colLabels: ["CC", "CD", "DC", "DD"], showValues: true, valueLabel: "T₆₀", padLeft: 62, padTop: 22, padBottom: 8 });
  }

  // =========================================================================
  // SECTION 6: BÚSQUEDA EXPECTIMAX (GARY)
  // =========================================================================
  function stopGaryPlayback() {
    if (STATE.garyPlayTimer) {
      clearInterval(STATE.garyPlayTimer);
      STATE.garyPlayTimer = null;
      if ($("btn-gary-play")) $("btn-gary-play").textContent = "▶ Reproducir";
    }
  }

  function toggleGaryPlayback() {
    if (!STATE.gary) return;
    if (STATE.garyPlayTimer) { stopGaryPlayback(); return; }
    if (STATE.garyActiveTurn >= STATE.gary.turns) STATE.garyActiveTurn = 1;
    $("btn-gary-play").textContent = "⏸ Pausar";
    STATE.garyPlayTimer = setInterval(() => {
      if (STATE.garyActiveTurn >= STATE.gary.turns) { stopGaryPlayback(); return; }
      updateGaryStepView(STATE.garyActiveTurn + 1);
    }, 240);
  }

  function updateGaryStepView(turn1Based) {
    const g = STATE.gary;
    if (!g) return;
    const steps = g.e_vector_vs_rival.steps || [];
    const t = Math.max(1, Math.min(g.turns, turn1Based));
    STATE.garyActiveTurn = t;
    const st = steps[t - 1];
    if (!st) return;

    $("gary-turn-slider").value = t;
    $("gary-turn-badge").textContent = `Turno ${t} / ${g.turns}`;
    $("gary-score-chip").textContent = `Media: ${st.cum_avg.toFixed(3)} pts/r`;
    $("gary-turn-summary").textContent = `Contra ${g.rival_name} (H=${g.horizon}, ${g.leaves_count} hojas, γ=${g.gamma.toFixed(2)}) · Jugada: (${st.my_move}, ${st.opp_move}) → +${st.round_score} pts`;

    document.querySelectorAll("#gary-ribbon .ribbon-cell.active-turn").forEach((c) => c.classList.remove("active-turn"));
    const cell = document.querySelector(`#gary-ribbon .ribbon-cell[data-gturn="${t}"]`);
    if (cell) cell.classList.add("active-turn");

    const movesG = steps.map((x) => x.my_move);
    const movesR = steps.map((x) => x.opp_move);
    const scG = steps.map((x) => x.round_score);
    const scR = steps.map((x) => (x.outcome_state === "CC" ? 3 : x.outcome_state === "CD" ? 5 : x.outcome_state === "DC" ? 0 : 1));
    $("gary-window-strip").innerHTML = buildTurnWindowHTML(movesG, movesR, scG, scR, t);

    const sNames = ["CC", "CD", "DC", "DD"];
    const obsLine = st.is_opening
      ? `<p class="muted" style="margin:0">Sin historial previo: abre con cooperación (<strong>regla Nice</strong>).</p>`
      : `<p style="margin:0;font-size:13px">En la ventana previa se observó <strong>${st.updated_state} $\\to O_{t-1} = ${st.opp_observed}$</strong>. Estado actual en raíz: <span class="badge badge-purple">${st.current_state}</span> con $p = E_t[${st.current_state}] = ${st.p_c.toFixed(4)}$.</p>`;

    $("gary-step1-body").innerHTML = obsLine + `
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Estado</th><th class="text-right">Conteo $C / (C+D)$</th><th class="text-right">$E_t[s]$</th></tr></thead>
        <tbody>${sNames.map((sn, i) => {
          const [nc, nd] = st.counts[i];
          return `<tr class="${sn === st.current_state ? "highlight-gary" : ""}"><td class="mono"><strong>${sn}</strong>${sn === st.updated_state ? " ★" : ""}</td><td class="mono text-right">${nc} / ${nc + nd}</td><td class="mono text-right"><strong>${st.E[i].toFixed(4)}</strong></td></tr>`;
        }).join("")}</tbody>
      </table></div>`;
    renderMath($("gary-step1-body"));

    $("gary-step2-body").innerHTML = `
      <p style="margin:0;font-size:12.8px">Se resuelve $(I_4 - \\gamma P_{\\mathrm{TFT}}(E_t))^{-1} P_{\\mathrm{TFT}}(E_t)\\mathbf{R}$ y se descuenta por $\\gamma^${g.horizon} = ${Math.pow(g.gamma, g.horizon).toFixed(4)}$:</p>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Hoja $s_H$</th><th class="text-right">$V_{\\mathrm{Markov}}$</th><th class="text-right">$h = \\gamma^H V$</th></tr></thead>
        <tbody>${sNames.map((sn, i) => `<tr class="${sn === st.current_state ? "highlight-gary" : ""}"><td class="mono"><strong>${sn}</strong></td><td class="mono text-right">${st.v_markov[i].toFixed(2)}</td><td class="mono text-right"><strong>${st.leaf_h[i].toFixed(2)}</strong></td></tr>`).join("")}</tbody>
      </table></div>`;
    renderMath($("gary-step2-body"));

    const chooseC = st.chosen === "C";
    const diff = st.f_c - st.f_d;
    const eqBlock = st.is_opening
      ? `<div class="math-block">$$A_1 = C \\quad (\\text{apertura cooperativa fija})$$</div>`
      : `<div class="math-block">$$\\bar{f}_t(C) = ${st.p_c.toFixed(2)}\\cdot ${st.val_cc.toFixed(3)} + ${st.p_d.toFixed(2)}\\cdot ${st.val_cd.toFixed(3)} = \\mathbf{${st.f_c.toFixed(4)}}$$</div>
         <div class="math-block">$$\\bar{f}_t(D) = ${st.p_c.toFixed(2)}\\cdot ${st.val_dc.toFixed(3)} + ${st.p_d.toFixed(2)}\\cdot ${st.val_dd.toFixed(3)} = \\mathbf{${st.f_d.toFixed(4)}}$$</div>`;

    $("gary-step3-body").innerHTML = `${eqBlock}
      <div class="decision-verdict ${chooseC ? "choose-c" : "choose-d"}">
        ${chooseC ? "f̄(C) ≥ f̄(D) → Elige COOPERAR (C)" : "f̄(D) > f̄(C) → Elige TRAICIONAR (D)"}
        <div class="mono" style="font-size:11.5px;margin-top:2px">Margen Δf̄ = ${diff >= 0 ? "+" : ""}${diff.toFixed(4)} · Rival jugó ${st.opp_move} → ${st.outcome_state} (+${st.round_score} pts)</div>
      </div>`;
    renderMath($("gary-step3-body"));

    T5Charts.renderGaryMarkovSVG($("gary-markov-svg"), { ...st, horizon: g.horizon, gamma: g.gamma });
  }

  function renderGarySection() {
    const g = STATE.gary;
    if (!g) return;
    const steps = g.e_vector_vs_rival.steps || [];

    const ribbon = $("gary-ribbon");
    ribbon.innerHTML = steps.map((st, i) => `<div class="ribbon-cell st-${st.outcome_state}" data-gturn="${i + 1}" title="T${i + 1}: (${st.my_move}, ${st.opp_move}) → +${st.round_score}"></div>`).join("");
    ribbon.querySelectorAll(".ribbon-cell").forEach((c) => c.addEventListener("click", () => { stopGaryPlayback(); updateGaryStepView(parseInt(c.dataset.gturn, 10)); }));

    $("gary-turn-slider").max = g.turns;
    const initTurn = Math.min(g.turns, Math.max(1, steps.findIndex((s) => s.outcome_state === "CD") + 2 || 12));
    updateGaryStepView(initTurn);

    T5Charts.renderLineChart($("cv-gary-horizon"), {
      series: [
        { label: `Peso Futuro w_fut(t) (L_γ=${g.effective_horizon})`, color: "#0f4c81", values: g.horizon_weights.w_fut, fillArea: "rgba(15, 76, 129, 0.12)" },
        { label: "Inercia Histórica w_pas(t)", color: "#475569", dashed: true, values: g.horizon_weights.w_pas },
      ],
      yMin: 0, yMax: 102, yDecimals: 0, xLabel: "Turno (t)", yLabel: "Peso Relativo (%)",
    });

    T5Charts.renderLineChart($("cv-gary-root"), {
      series: [
        { label: `Expectimax H=${g.horizon}: f̄ₜ(C) = ${g.root_vs_tft.mean_f_c.toFixed(2)}`, color: "#2e7d32", values: g.root_vs_tft.f_c },
        { label: `Expectimax H=${g.horizon}: f̄ₜ(D) ≈ ${g.root_vs_tft.mean_f_d.toFixed(2)}`, color: "#1565c0", dashed: true, values: g.root_vs_tft.f_d },
        { label: "Rulito (γ=0): Q̂ₜ(D) → 1.00", color: "#c62828", dashed: true, values: g.root_vs_tft.rulito_qd.map((v, i) => (i < 10 ? 1.0 : Math.min(3.3, v))) },
      ],
      yMin: 0.5, yMax: 3.4, xLabel: "Turno (t)", yLabel: "Retorno Esperado (pts/r)",
    });

    $("gary-e-subtitle").textContent = `Frente a ${g.rival_name} (puntaje final: ${g.rival_final_avg.toFixed(3)} pts/r) · Clic para saltar al turno`;
    T5Charts.renderLineChart($("cv-gary-evec"), {
      series: [
        { label: "p̂_CC", color: "#2e7d32", values: g.e_vector_vs_rival.e_cc },
        { label: "p̂_CD", color: "#c62828", dashed: true, values: g.e_vector_vs_rival.e_cd },
        { label: "p̂_DC", color: "#ef6c00", dashed: true, values: g.e_vector_vs_rival.e_dc },
        { label: "p̂_DD", color: "#334155", values: g.e_vector_vs_rival.e_dd },
      ],
      yMin: -0.04, yMax: 1.08, xLabel: "Turno (t)", yLabel: "Probabilidad en Eₜ",
      onPointClick: (turn) => { activateSubtab($("tab-gary"), "gary-step"); updateGaryStepView(turn); },
    });

    T5Charts.renderVerticalBarChart($("cv-gary-ablation"), {
      categories: g.ablation.benchmarks, groups: g.ablation.series, yMin: 2.2, yMax: 3.05, yLabel: "Puntaje Medio (pts/r)", showBarValues: true,
    });
  }

  // =========================================================================
  // SECTION 7: DUELOS 1v1 (CON ESCENARIO VOXEL + VENTANA), H2H, HARPER, LIVE
  // =========================================================================
  function openDuelDirectly(agentA, agentB) {
    switchTab("arena");
    activateSubtab($("tab-arena"), "duel-1v1");
    $("duel-agent-a").value = agentA;
    $("duel-agent-b").value = agentB;
    updateDuelRlBarVisibility();
    runCurrentDuel();
  }

  function updateDuelRlBarVisibility() {
    const aid = $("duel-agent-a").value;
    $("duel-rl-params-bar").classList.toggle("hidden", aid !== "gen5_rl" && aid !== "gen6_jacinto");
  }

  async function runCurrentDuel() {
    stopDuelPlayback();
    const aid = $("duel-agent-a").value || "gen5_rl";
    const bid = $("duel-agent-b").value || "axl_Defector";
    const paramsA = (aid === "gen5_rl" || aid === "gen6_jacinto")
      ? { initial_count: parseFloat($("duel-n0").value), forgetting_factor: parseFloat($("duel-lam").value), gamma: parseFloat($("duel-gamma").value) }
      : {};
    try {
      $("btn-run-duel").disabled = true;
      STATE.duel = await apiPost("/api/duel", {
        agent_a_id: aid, agent_b_id: bid, params_a: paramsA,
        turns: parseInt($("duel-turns").value, 10) || 200,
        rolling_window: parseInt($("duel-window").value, 10) || 15,
        seed: parseInt($("duel-seed").value, 10) || 42,
      });
      STATE.duelActiveTurn = Math.min(STATE.duel.turns, 7);
      renderDuelView();
    } catch (err) { toast(`Error en duelo: ${err.message}`, "error"); }
    finally { $("btn-run-duel").disabled = false; }
  }

  function renderDuelView() {
    const d = STATE.duel;
    if (!d) return;
    const pa = d.player_a, pb = d.player_b, sc = d.state_counts;

    $("duel-kpi-grid").innerHTML = `
      <div class="kpi-card green"><div class="kpi-label">Jugador A · ${pa.name.slice(0, 22)}</div><div class="kpi-value">${pa.mean_score.toFixed(3)} pts/r</div><div class="kpi-sub">Total: ${pa.total_score} · Últ. 100: ${pa.last100_score.toFixed(3)} · Coop: ${pa.coop_rate}%</div></div>
      <div class="kpi-card blue"><div class="kpi-label">Jugador B · ${pb.name.slice(0, 22)}</div><div class="kpi-value">${pb.mean_score.toFixed(3)} pts/r</div><div class="kpi-sub">Total: ${pb.total_score} · Últ. 100: ${pb.last100_score.toFixed(3)} · Coop: ${pb.coop_rate}%</div></div>
      <div class="kpi-card ${pa.n_sucker === 0 ? "green" : pa.n_sucker <= 15 ? "amber" : "red"}"><div class="kpi-label">Estafas (S=0) y Estabilización</div><div class="kpi-value">${pa.n_sucker} / ${pa.t_est == null ? "—" : "t=" + pa.t_est}</div><div class="kpi-sub">Rondas en CD · Turno defensa estable</div></div>
      <div class="kpi-card purple"><div class="kpi-label">Distribución de Estados</div><div class="kpi-value" style="font-size:15px;margin-top:6px">CC:${sc.CC} · CD:${sc.CD} · DC:${sc.DC} · DD:${sc.DD}</div><div class="kpi-sub">${d.turns} rondas (Seed ${d.seed})</div></div>`;

    const ribbon = $("duel-ribbon");
    ribbon.innerHTML = d.states.map((st, i) => `<div class="ribbon-cell st-${st}" data-turn="${i + 1}" title="T${i + 1}: (${pa.moves[i]}, ${pb.moves[i]}) → +${pa.round_scores[i]}/+${pb.round_scores[i]}"></div>`).join("");
    ribbon.querySelectorAll(".ribbon-cell").forEach((cell) => {
      cell.addEventListener("click", () => { stopDuelPlayback(); setDuelActiveTurn(parseInt(cell.dataset.turn, 10)); });
    });

    $("duel-turn-slider").max = d.turns;
    $("duel-turn-slider").value = STATE.duelActiveTurn;
    setDuelActiveTurn(STATE.duelActiveTurn);
    renderDuelTraceTable();
  }

  function renderDuelLiveDecisionBox(turn1Based) {
    const d = STATE.duel, idx = turn1Based - 1, pa = d.player_a, pb = d.player_b, tr = pa.trace;
    const box = $("duel-live-decision-box"), stIdxMap = { CC: 0, CD: 1, DC: 2, DD: 3 };

    if (tr && tr.kind === "mdp_rl" && tr.turns[idx]) {
      const snap = tr.turns[idx], prevSnap = idx > 0 ? tr.turns[idx - 1] : null;
      let updateHtml = `<p class="muted" style="margin:0">Sin ventana de 2 turnos completa todavía; se usa el prior $T_0$.</p>`;
      if (turn1Based >= 3 && prevSnap) {
        const sPrev2 = d.states[idx - 2], aPrev1 = pa.moves[idx - 1], oPrev1 = pb.moves[idx - 1];
        const ctxKey = `${stIdxMap[sPrev2]}_${aPrev1 === "C" ? 1 : 0}`;
        const pBefore = prevSnap.probs[ctxKey], pAfter = snap.probs[ctxKey];
        const eta = snap.etas ? snap.etas[ctxKey] : null, nEff = snap.effective_counts ? snap.effective_counts[ctxKey] : null;
        updateHtml = `<p style="margin:0;font-size:13px">Ventana observada: $(${sPrev2}, A=${aPrev1}) \\to O=${oPrev1}$ (${oPrev1 === "C" ? "SUMÓ" : "RESTÓ"}). ${nEff != null ? `$n_k = ${nEff.toFixed(2)}$, $\\eta_k = ${eta.toFixed(4)}$, ` : ""}$p: ${pBefore.toFixed(4)} \\to \\mathbf{${pAfter.toFixed(4)}}$.</p>`;
      }
      const currS = idx > 0 ? d.states[idx - 1] : "CC", si = stIdxMap[currS];
      const qc = snap.q_c ? snap.q_c[si] : 0, qd = snap.q_d ? snap.q_d[si] : 0, dq = snap.delta_q[si];
      const decHtml = turn1Based === 1
        ? `Apertura Nice → juega <strong>C</strong> (Política: <span class="mono">${snap.policy_str}</span>)`
        : `En estado <strong>${currS}</strong>: $Q_t(${currS}, C) = ${qc.toFixed(2)}$ vs. $Q_t(${currS}, D) = ${qd.toFixed(2)}$ ($\\Delta Q_t = ${dq >= 0 ? "+" : ""}${dq.toFixed(2)}$) $\\implies$ elige <strong>${pa.moves[idx]}</strong> (Política: <span class="mono">${snap.policy_str}</span>)`;
      box.innerHTML = `<div class="theorem-box" style="margin-bottom:0">${updateHtml}<p style="margin:6px 0 0;font-size:13.5px">${decHtml}</p></div>`;
      renderMath(box);
    } else if (tr && tr.kind === "gary" && tr.turns[idx]) {
      const s = tr.turns[idx];
      const eq = s.is_opening
        ? `Turno 1 (apertura cooperativa fija): elige <strong>C</strong>.`
        : `Estado <strong>${s.current_state}</strong> ($p=${s.p_c.toFixed(2)}$): $\\bar{f}_t(C) = ${s.p_c.toFixed(2)}\\cdot${s.val_cc.toFixed(2)} + ${s.p_d.toFixed(2)}\\cdot${s.val_cd.toFixed(2)} = \\mathbf{${s.f_c.toFixed(3)}}$ vs. $\\bar{f}_t(D) = ${s.p_c.toFixed(2)}\\cdot${s.val_dc.toFixed(2)} + ${s.p_d.toFixed(2)}\\cdot${s.val_dd.toFixed(2)} = \\mathbf{${s.f_d.toFixed(3)}}$ $\\implies$ elige <strong>${s.chosen}</strong>.`;
      box.innerHTML = `<div class="theorem-box" style="margin-bottom:0"><p style="margin:0;font-size:13.5px">${eq}</p></div>`;
      renderMath(box);
    } else if (tr && (tr.kind === "rulito" || tr.kind === "cloud") && tr.turns[idx]) {
      const s = tr.turns[idx];
      box.innerHTML = `<div class="theorem-box" style="margin-bottom:0"><p style="margin:0;font-size:13.5px">Fase: <strong>${s.phase}</strong> · $\\hat{Q}(s, C) = ${s.q_c.toFixed(2)}$ vs. $\\hat{Q}(s, D) = ${s.q_d.toFixed(2)}$ $\\implies$ juega <strong>${pa.moves[idx]}</strong>.</p></div>`;
      renderMath(box);
    } else {
      const prevS = idx > 0 ? d.states[idx - 1] : "Inicio";
      box.innerHTML = `<div class="theorem-box" style="margin-bottom:0"><p style="margin:0;font-size:13.5px">Estado previo: <strong>${prevS}</strong> → <strong>${pa.name}</strong> juega <strong>${pa.moves[idx]}</strong>, <strong>${pb.name}</strong> juega <strong>${pb.moves[idx]}</strong> (+${pa.round_scores[idx]} / +${pb.round_scores[idx]} pts).</p></div>`;
    }
  }

  function setDuelActiveTurn(turn) {
    const d = STATE.duel;
    if (!d) return;
    const t = Math.max(1, Math.min(d.turns, turn));
    STATE.duelActiveTurn = t;
    const idx = t - 1, pa = d.player_a, pb = d.player_b;

    $("duel-turn-slider").value = t;
    $("duel-turn-counter").textContent = `t = ${t} / ${d.turns}`;
    $("duel-turn-detail").textContent = `Turno ${t}: (${pa.moves[idx]}, ${pb.moves[idx]}) → Estado ${d.states[idx]} | Acumulado A=${pa.cum_avg[idx].toFixed(3)}, B=${pb.cum_avg[idx].toFixed(3)}`;

    // Sync compact Voxel Duel Stage!
    const catA = STATE.catalog.find((c) => c.id === pa.id);
    const catB = STATE.catalog.find((c) => c.id === pb.id);
    T5Voxel.renderDuelStage($("duel-voxel-stage"), {
      idA: pa.id, nameA: pa.name, colorA: catA?.color,
      idB: pb.id, nameB: pb.name, colorB: catB?.color,
      movesA: pa.moves, movesB: pb.moves,
      scoresA: pa.round_scores, scoresB: pb.round_scores,
      activeTurn: t,
      totalA: Math.round(pa.cum_total[idx]),
      totalB: Math.round(pb.cum_total[idx]),
      compact: true,
      onTokenClick: (clickedT) => { stopDuelPlayback(); setDuelActiveTurn(clickedT); },
    });

    document.querySelectorAll("#duel-ribbon .ribbon-cell.active-turn").forEach((c) => c.classList.remove("active-turn"));
    const activeCell = document.querySelector(`#duel-ribbon .ribbon-cell[data-turn="${t}"]`);
    if (activeCell) activeCell.classList.add("active-turn");

    $("duel-window-strip").innerHTML = buildTurnWindowHTML(pa.moves, pb.moves, pa.round_scores, pb.round_scores, t);
    renderDuelLiveDecisionBox(t);

    T5Charts.renderLineChart($("cv-duel-scores"), {
      series: [
        { label: `A Acum. (${pa.mean_score.toFixed(3)})`, color: "#2e7d32", values: pa.cum_avg },
        { label: `A Móvil ${d.rolling_window}t`, color: "#2e7d32", dashed: true, values: pa.rolling_avg },
        { label: `B Acum. (${pb.mean_score.toFixed(3)})`, color: "#1565c0", values: pb.cum_avg },
        { label: `B Móvil ${d.rolling_window}t`, color: "#ef6c00", dashed: true, values: pb.rolling_avg },
      ],
      yMin: 0, yMax: 5.15, xLabel: "Turno (t)", yLabel: "Puntos / Ronda", activeTurn: t,
      onPointClick: (ct) => { stopDuelPlayback(); setDuelActiveTurn(ct); },
    });

    const tr = pa.trace;
    if (tr && tr.kind === "mdp_rl") {
      $("duel-internal-title").textContent = "Probabilidades Aprendidas Pₜ(Oₜ=C | s, a)";
      $("duel-internal-note").textContent = "Contextos del MDP 8×4 actualizados en línea";
      T5Charts.renderLineChart($("cv-duel-internal"), {
        series: [
          { label: "P(C | CC, C)", color: "#2e7d32", values: tr.turns.map((x) => x.probs["0_1"]) },
          { label: "P(C | CD, D)", color: "#00838f", values: tr.turns.map((x) => x.probs["1_0"]) },
          { label: "P(C | DC, C)", color: "#1565c0", dashed: true, values: tr.turns.map((x) => x.probs["2_1"]) },
          { label: "P(C | DD, C)", color: "#c62828", values: tr.turns.map((x) => x.probs["3_1"]) },
          { label: "P(C | DD, D)", color: "#ef6c00", dashed: true, values: tr.turns.map((x) => x.probs["3_0"]) },
        ],
        yMin: -0.04, yMax: 1.08, xLabel: "Turno (t)", yLabel: "Probabilidad Pₜ", activeTurn: t,
        onPointClick: (ct) => { stopDuelPlayback(); setDuelActiveTurn(ct); },
      });
      const sCols = ["#2e7d32", "#1565c0", "#ef6c00", "#8e24aa"];
      T5Charts.renderLineChart($("cv-duel-deltaq"), {
        series: ["CC", "CD", "DC", "DD"].map((sn, si) => ({ label: `ΔQₜ(${sn})`, color: sCols[si], values: tr.turns.map((x) => x.delta_q[si]) })),
        hLines: [{ y: 0, color: "#0f253c", dash: [4, 4] }], xLabel: "Turno (t)", yLabel: "Qₜ(s, C) − Qₜ(s, D)", activeTurn: t,
        onPointClick: (ct) => { stopDuelPlayback(); setDuelActiveTurn(ct); },
      });
      const snap = tr.turns[Math.min(idx, tr.turns.length - 1)];
      $("duel-mat-title").textContent = `Matriz de Transición T_${t} (8×4) · Política: ${snap.policy_str}`;
      T5Charts.renderHeatmap($("cv-duel-matrix"), { mode: "prob", matrix: snap.matrix, rowLabels: ["(CC,D)", "(CC,C)", "(CD,D)", "(CD,C)", "(DC,D)", "(DC,C)", "(DD,D)", "(DD,C)"], colLabels: ["CC", "CD", "DC", "DD"], showValues: true, valueLabel: `T_${t}`, padLeft: 64, padTop: 24 });
    } else if (tr && tr.kind === "gary") {
      $("duel-internal-title").textContent = "Vector Frecuentista Eₜ (Expectimax)";
      T5Charts.renderLineChart($("cv-duel-internal"), {
        series: [
          { label: "p̂_CC", color: "#2e7d32", values: tr.turns.map((x) => x.E[0]) },
          { label: "p̂_CD", color: "#c62828", values: tr.turns.map((x) => x.E[1]) },
          { label: "p̂_DC", color: "#ef6c00", values: tr.turns.map((x) => x.E[2]) },
          { label: "p̂_DD", color: "#334155", values: tr.turns.map((x) => x.E[3]) },
        ],
        yMin: -0.04, yMax: 1.08, xLabel: "Turno (t)", yLabel: "Vector Eₜ", activeTurn: t,
      });
      T5Charts.renderLineChart($("cv-duel-deltaq"), {
        series: [{ label: "f̄ₜ(C)", color: "#2e7d32", values: tr.turns.map((x) => x.f_c) }, { label: "f̄ₜ(D)", color: "#c62828", dashed: true, values: tr.turns.map((x) => x.f_d) }],
        xLabel: "Turno (t)", yLabel: "Valor Esperado Raíz", activeTurn: t,
      });
      const snap = tr.turns[Math.min(idx, tr.turns.length - 1)];
      const [pcc, pcd, pdc, pdd] = snap.E;
      $("duel-mat-title").textContent = `Cadena de Markov P_TFT(E_${t})`;
      T5Charts.renderHeatmap($("cv-duel-matrix"), { mode: "prob", matrix: [[pcc, 1 - pcc, 0, 0], [0, 0, pcd, 1 - pcd], [pdc, 1 - pdc, 0, 0], [0, 0, pdd, 1 - pdd]], rowLabels: ["CC", "CD", "DC", "DD"], colLabels: ["CC", "CD", "DC", "DD"], showValues: true, valueLabel: "P_TFT", padLeft: 52, padTop: 26 });
    } else if (tr && (tr.kind === "rulito" || tr.kind === "cloud")) {
      $("duel-internal-title").textContent = "Modelo Frecuentista P(Oₜ=C | sₜ₋₁)";
      T5Charts.renderLineChart($("cv-duel-internal"), {
        series: [
          { label: "p̂(CC)", color: "#2e7d32", values: tr.turns.map((x) => x.p_state[0]) },
          { label: "p̂(CD)", color: "#c62828", values: tr.turns.map((x) => x.p_state[1]) },
          { label: "p̂(DC)", color: "#1565c0", values: tr.turns.map((x) => x.p_state[2]) },
          { label: "p̂(DD)", color: "#ef6c00", values: tr.turns.map((x) => x.p_state[3]) },
        ],
        yMin: -0.04, yMax: 1.08, xLabel: "Turno (t)", yLabel: "p̂_s", activeTurn: t,
      });
      T5Charts.renderLineChart($("cv-duel-deltaq"), {
        series: [{ label: "Q̂(s, C)", color: "#2e7d32", values: tr.turns.map((x) => x.q_c) }, { label: "Q̂(s, D)", color: "#c62828", dashed: true, values: tr.turns.map((x) => x.q_d) }],
        xLabel: "Turno (t)", yLabel: "Valor Q̂", activeTurn: t,
      });
      renderEmpiricalPairTransitions(t);
    } else {
      $("duel-internal-title").textContent = "Tasa Acumulada de Cooperación (%)";
      let ca = 0, cb = 0;
      const coopA = pa.moves.map((m, i) => { if (m === "C") ca++; return (100 * ca) / (i + 1); });
      const coopB = pb.moves.map((m, i) => { if (m === "C") cb++; return (100 * cb) / (i + 1); });
      T5Charts.renderLineChart($("cv-duel-internal"), {
        series: [{ label: `Coop A (${pa.coop_rate}%)`, color: "#2e7d32", values: coopA }, { label: `Coop B (${pb.coop_rate}%)`, color: "#1565c0", values: coopB }],
        yMin: 0, yMax: 104, yDecimals: 0, xLabel: "Turno (t)", yLabel: "% Cooperación", activeTurn: t,
      });
      T5Charts.renderLineChart($("cv-duel-deltaq"), {
        series: [{ label: "Diferencia Acumulada (A − B)", color: "#7b3fa0", values: pa.cum_total.map((v, i) => v - pb.cum_total[i]) }],
        hLines: [{ y: 0, color: "#0f253c", dash: [4, 4] }], xLabel: "Turno (t)", yLabel: "Ventaja Total", activeTurn: t,
      });
      renderEmpiricalPairTransitions(t);
    }
  }

  function renderEmpiricalPairTransitions(upToTurn) {
    const d = STATE.duel, states = ["CC", "CD", "DC", "DD"], idxMap = { CC: 0, CD: 1, DC: 2, DD: 3 };
    const counts = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
    for (let i = 1; i < upToTurn; i++) counts[idxMap[d.states[i - 1]]][idxMap[d.states[i]]]++;
    const mat = counts.map((row) => { const s = row.reduce((a, b) => a + b, 0); return row.map((v) => (s > 0 ? v / s : 0)); });
    $("duel-mat-title").textContent = `Transiciones Empíricas hasta t=${upToTurn}`;
    T5Charts.renderHeatmap($("cv-duel-matrix"), { mode: "prob", matrix: mat, rowLabels: states, colLabels: states, showValues: true, valueLabel: "P(s→s')", padLeft: 52, padTop: 26 });
  }

  function renderDuelTraceTable() {
    const d = STATE.duel;
    if (!d) return;
    const pa = d.player_a, pb = d.player_b, tr = pa.trace, maxShow = Math.min(d.turns, 60);
    const rows = [];
    for (let i = 0; i < maxShow; i++) {
      let polStr = "—", detail = "—";
      if (tr && tr.kind === "mdp_rl" && tr.turns[i]) {
        const s = tr.turns[i];
        polStr = `<span class="badge badge-blue">${s.policy_str}</span>`;
        detail = `P(DD,C)=${s.probs["3_1"].toFixed(4)} · ΔQ(DD)=${s.delta_q[3] >= 0 ? "+" : ""}${s.delta_q[3].toFixed(2)}`;
      } else if (tr && tr.kind === "gary" && tr.turns[i]) {
        const s = tr.turns[i];
        polStr = `<span class="badge badge-purple">${s.chosen}</span>`;
        detail = `f̄(C)=${s.f_c.toFixed(3)} vs f̄(D)=${s.f_d.toFixed(3)}`;
      } else if (tr && (tr.kind === "rulito" || tr.kind === "cloud") && tr.turns[i]) {
        const s = tr.turns[i];
        polStr = `<span class="badge badge-amber">${s.phase}</span>`;
        detail = `Q̂(C)=${s.q_c.toFixed(2)} vs Q̂(D)=${s.q_d.toFixed(2)}`;
      }
      rows.push(`<tr style="cursor:pointer" data-row-turn="${i + 1}"><td class="mono">${i + 1}</td><td class="text-center"><span class="badge ${pa.moves[i] === "C" ? "badge-c" : "badge-d"}">${pa.moves[i]}</span> <span class="badge ${pb.moves[i] === "C" ? "badge-c" : "badge-d"}">${pb.moves[i]}</span></td><td class="mono text-right">+${pa.round_scores[i]} / +${pb.round_scores[i]}</td><td class="mono text-right">${pa.cum_avg[i].toFixed(3)}</td><td class="mono text-right">${pb.cum_avg[i].toFixed(3)}</td><td class="text-center">${polStr}</td><td class="mono" style="font-size:11.8px">${detail}</td></tr>`);
    }
    const tb = $("tbody-duel-trace");
    tb.innerHTML = rows.join("");
    tb.querySelectorAll("tr[data-row-turn]").forEach((r) => r.addEventListener("click", () => { stopDuelPlayback(); setDuelActiveTurn(parseInt(r.dataset.rowTurn, 10)); }));
  }

  function stopDuelPlayback() {
    if (STATE.duelPlayTimer) {
      clearInterval(STATE.duelPlayTimer);
      STATE.duelPlayTimer = null;
      if ($("btn-duel-play")) $("btn-duel-play").textContent = "▶ Reproducir";
    }
  }

  function toggleDuelPlayback() {
    if (!STATE.duel) return;
    if (STATE.duelPlayTimer) { stopDuelPlayback(); return; }
    if (STATE.duelActiveTurn >= STATE.duel.turns) STATE.duelActiveTurn = 1;
    $("btn-duel-play").textContent = "⏸ Pausar";
    STATE.duelPlayTimer = setInterval(() => {
      if (STATE.duelActiveTurn >= STATE.duel.turns) { stopDuelPlayback(); return; }
      setDuelActiveTurn(STATE.duelActiveTurn + 1);
    }, 260);
  }

  async function runH2HMatrix() {
    if (STATE.h2hSelected.length < 2) { toast("Selecciona al menos 2 estrategias", "error"); return; }
    try {
      $("btn-run-h2h").disabled = true;
      const res = await apiPost("/api/h2h", { strategy_ids: STATE.h2hSelected, turns: parseInt($("duel-turns").value, 10) || 200, seed: parseInt($("duel-seed").value, 10) || 42 });
      T5Charts.renderHeatmap($("cv-h2h-heatmap"), {
        mode: "payoff", matrix: res.payoffs,
        rowLabels: res.names.map((nm, i) => `${nm.slice(0, 17)} (${res.row_means[i].toFixed(2)})`),
        colLabels: res.names.map((nm) => nm.slice(0, 15)),
        showValues: true, decimals: 2, minVal: 0.4, maxVal: 3.4, valueLabel: "Pts/Ronda Fila",
        onCellClick: (r, c) => openDuelDirectly(res.strategy_ids[r], res.strategy_ids[c]),
      });
      toast(`Matriz ${res.names.length}×${res.names.length} lista`, "success");
    } catch (err) { toast(err.message, "error"); }
    finally { $("btn-run-h2h").disabled = false; }
  }

  // =========================================================================
  // 10-SEED AXELROD, HARPER 41, MEGA 175 & LIVE TOURNAMENTS
  // =========================================================================
  const AGENT_COLORS_MAP = {
    "1. Rulito (Miope g=0)": "#d62728",
    "2. Cloud (1-Step g=0.90)": "#ef6c00",
    "3. Expectimax H=4 + Markov": "#7b3fa0",
    "4. Base MDP Fija (CDDC)": "#1565c0",
    "5. RL Olvido (n0=2.0, lam=0.90)": "#2e7d32",
  };
  const AGENT_NAMES_ORDERED = Object.keys(AGENT_COLORS_MAP);

  function renderAxelrod10Focus(genIdx) {
    const data = STATE.tournamentsVerified;
    if (!data) return;
    const agName = AGENT_NAMES_ORDERED[genIdx] || AGENT_NAMES_ORDERED[4];
    const ranking = data.individual_axelrod_10seeds[agName];
    if (!ranking) return;
    const our = ranking.find((r) => r.name === agName);
    $("t10-focus-title").textContent = `${agName} — Puesto #${our.overall_rank}/16`;
    $("t10-focus-sub").textContent = `Media: ${our.mean_score.toFixed(3)} ± ${our.std_score.toFixed(3)} pts/ronda · Rank medio: ${our.mean_rank.toFixed(2)} · Victorias #1: ${our.win_rate_pct.toFixed(0)}%`;

    T5Charts.renderHorizontalBarChart($("cv-t10-focus"), {
      xMin: 0, xMax: 3.15, padLeft: 164, showAllValues: true, xLabel: "Puntos / Ronda (10 semillas independientes)",
      items: ranking.map((r) => {
        const isOur = r.name === agName, isTft = r.name === "Tit For Tat";
        return {
          label: `#${String(r.overall_rank).padStart(2, " ")} ${isOur ? agName : r.name.replace("First by ", "")}`,
          fullLabel: `#${r.overall_rank}/16 ${r.name}`, value: r.mean_score, std: r.std_score,
          color: isOur ? AGENT_COLORS_MAP[agName] : isTft ? "#eab308" : "#94a3b8", bold: isOur,
          extra: `Rank medio: ${r.mean_rank.toFixed(2)} | #1: ${r.win_rate_pct.toFixed(0)}%`,
        };
      }),
    });
  }

  function renderVerifiedTournaments() {
    const data = STATE.tournamentsVerified;
    if (!data) return;
    renderAxelrod10Focus(parseInt($("t10-gen-select").value, 10) || 4);

    const boxGroups = AGENT_NAMES_ORDERED.map((nm) => ({
      label: nm.split(" (")[0].replace("Expectimax H=4 + Markov", "3. Expect.\n+Markov").replace("Base MDP Fija", "4. Base\nCDDC").replace("RL Olvido", "5. RL\nOlvido").replace("Rulito", "1. Rulito").replace("Cloud", "2. Cloud"),
      color: AGENT_COLORS_MAP[nm],
      values: data.individual_axelrod_10seeds[nm].find((r) => r.name === nm).seed_scores,
    }));
    const tftRef = data.individual_axelrod_10seeds["5. RL Olvido (n0=2.0, lam=0.90)"].find((r) => r.name === "Tit For Tat");
    if (tftRef) boxGroups.push({ label: "Tit For\nTat", color: "#eab308", values: tftRef.seed_scores });

    T5Charts.renderBoxplotChart($("cv-t10-box"), { groups: boxGroups, yMin: 1.80, yMax: 2.90 });

    AGENT_NAMES_ORDERED.forEach((agName, idx) => {
      const ranking = data.individual_axelrod_10seeds[agName];
      const our = ranking.find((r) => r.name === agName);
      $(`t10-title-${idx}`).textContent = `${agName.split(" (")[0]} — #${our.overall_rank}/16 (${our.mean_score.toFixed(3)})`;
      T5Charts.renderHorizontalBarChart($(`cv-t10-${idx}`), {
        xMin: 0, xMax: 3.15, padLeft: 132, xLabel: "Pts / Ronda",
        items: ranking.map((r) => {
          const isOur = r.name === agName, isTft = r.name === "Tit For Tat";
          return {
            label: `#${String(r.overall_rank).padStart(2, " ")} ${isOur ? agName.split(" (")[0] : r.name.replace("First by ", "")}`,
            fullLabel: `#${r.overall_rank}/16 ${r.name}`, value: r.mean_score, std: r.std_score,
            color: isOur ? AGENT_COLORS_MAP[agName] : isTft ? "#eab308" : "#94a3b8", bold: isOur,
            showValue: isOur || isTft || r.overall_rank <= 2,
          };
        }),
      });
    });
    T5Charts.renderBoxplotChart($("cv-t10-box-grid"), { groups: boxGroups, yMin: 1.80, yMax: 2.90 });

    const ourSet = new Set(AGENT_NAMES_ORDERED);
    const harperSel = data.harper_10seeds.filter((r) => r.overall_rank <= 20 || ourSet.has(r.name));
    T5Charts.renderHorizontalBarChart($("cv-harper-41"), {
      xMin: 1.5, xMax: 3.12, padLeft: 184, showAllValues: true, xLabel: "Puntaje Medio ± DE (10 Semillas)",
      items: harperSel.map((r) => {
        const isOur = ourSet.has(r.name), isTrained = /Evolved|PSO|Winner|DBS|Fool/.test(r.name);
        return { label: `#${String(r.overall_rank).padStart(2, " ")}/41 ${r.name}`, fullLabel: `#${r.overall_rank}/41 ${r.name}`, value: r.mean_score, std: r.std_score, color: isOur ? AGENT_COLORS_MAP[r.name] : isTrained ? "#6A1B9A" : r.name.includes("Tit For Tat") ? "#eab308" : "#7f8c8d", bold: isOur, extra: `Rank medio: ${r.mean_rank.toFixed(2)}` };
      }),
    });

    const classics = new Set(["First by Shubik", "Forgiving Tit For Tat", "Grudger"]);
    const megaSel = data.mega_tournament_175.filter((r) => r.overall_rank <= 18 || ourSet.has(r.name) || classics.has(r.name));
    T5Charts.renderHorizontalBarChart($("cv-mega-175"), {
      xMin: 1.5, xMax: 3.18, padLeft: 184, showAllValues: true, xLabel: "Puntaje Medio (175 Estrategias)",
      items: megaSel.map((r) => {
        const isOur = ourSet.has(r.name), isTrained = /Evolved|PSO|Winner|DBS|Fool/.test(r.name);
        return { label: `#${String(r.overall_rank).padStart(3, " ")}/175 ${r.name}`, fullLabel: `#${r.overall_rank}/175 ${r.name}`, value: r.mean_score, color: isOur ? AGENT_COLORS_MAP[r.name] : isTrained ? "#6A1B9A" : classics.has(r.name) ? "#eab308" : "#7f8c8d", bold: isOur, valueLabel: `${r.mean_score.toFixed(3)} (#${r.overall_rank})` };
      }),
    });

    renderHarperAndMegaTables("", "");
  }

  function renderHarperAndMegaTables(qHarper, qMega) {
    const data = STATE.tournamentsVerified;
    if (!data) return;
    const ourSet = new Set(AGENT_NAMES_ORDERED);
    const fh = qHarper.trim().toLowerCase();
    $("tbody-harper").innerHTML = data.harper_10seeds.filter((r) => !fh || r.name.toLowerCase().includes(fh)).map((r) => {
      const cls = r.name.includes("RL Olvido") ? "highlight-row" : r.name.includes("Expectimax") ? "highlight-gary" : "";
      return `<tr class="${cls}"><td class="mono">#${r.overall_rank}</td><td>${ourSet.has(r.name) ? `<strong>${r.name}</strong>` : r.name}</td><td class="mono text-right">${r.mean_score.toFixed(3)} ± ${r.std_score.toFixed(3)}</td><td class="mono text-right">${r.mean_rank.toFixed(2)}</td></tr>`;
    }).join("");

    const fm = qMega.trim().toLowerCase();
    $("tbody-mega").innerHTML = data.mega_tournament_175.filter((r) => !fm || r.name.toLowerCase().includes(fm)).map((r) => {
      const cls = r.name.includes("RL Olvido") ? "highlight-row" : r.name.includes("Expectimax") ? "highlight-gary" : "";
      return `<tr class="${cls}"><td class="mono">#${r.overall_rank}</td><td>${ourSet.has(r.name) ? `<strong>${r.name}</strong>` : r.name}</td><td class="mono text-right">${r.mean_score.toFixed(3)}</td></tr>`;
    }).join("");
  }

  async function startLiveTournament() {
    const preset = $("live-tourn-preset").value, turns = parseInt($("live-tourn-turns").value, 10) || 200;
    const nSeeds = parseInt($("live-tourn-nseeds").value, 10) || 5, seeds = Array.from({ length: nSeeds }, (_, i) => i);
    if (preset === "custom" && STATE.liveTournSelected.length < 2) { toast("En modo Libre debes marcar al menos 2 estrategias", "error"); return; }

    try {
      $("btn-start-live-tournament").disabled = true;
      $("live-tourn-progress").classList.remove("hidden");
      $("live-tourn-bar").style.width = "5%"; $("live-tourn-pct").textContent = "5%"; $("live-tourn-msg").textContent = "Iniciando torneo...";
      const started = await apiPost("/api/tournament/start", { preset, selected_ids: [...STATE.liveTournSelected], turns, seeds });
      const poll = setInterval(async () => {
        try {
          const st = await apiGet(`/api/tournament/status/${started.job_id}`);
          $("live-tourn-bar").style.width = `${st.progress || 0}%`; $("live-tourn-pct").textContent = `${st.progress || 0}%`; $("live-tourn-msg").textContent = st.message || "Simulando...";
          if (st.status === "done") {
            clearInterval(poll); $("btn-start-live-tournament").disabled = false; STATE.liveTournResult = st.result;
            renderLiveTournamentResult(st.result); toast(`Torneo completado en ${st.result.elapsed_sec}s`, "success");
          } else if (st.status === "error") { clearInterval(poll); $("btn-start-live-tournament").disabled = false; toast(st.error, "error"); }
        } catch (err) { clearInterval(poll); $("btn-start-live-tournament").disabled = false; toast(err.message, "error"); }
      }, 260);
    } catch (err) { $("btn-start-live-tournament").disabled = false; toast(err.message, "error"); }
  }

  function renderLiveTournamentResult(res) {
    $("live-tourn-results").classList.remove("hidden");
    $("live-tourn-summary-note").textContent = `${res.n_players} jugadores · T=${res.turns} · ${res.seeds.length} semillas · ${res.elapsed_sec}s`;
    const catalogMap = new Map(STATE.catalog.map((c) => [c.id, c]));
    const showList = res.standings.length <= 24 ? res.standings : res.standings.filter((r) => r.overall_rank <= 20 || r.is_selected);

    T5Charts.renderHorizontalBarChart($("cv-live-ranking"), {
      xMin: 0, xMax: Math.max(3.2, (res.standings[0]?.mean_score || 3) + 0.3), padLeft: 175, showAllValues: true, xLabel: "Puntaje Medio ± DE",
      items: showList.map((r) => {
        const cat = catalogMap.get(r.id), col = r.is_selected ? (cat?.color || "#2e7d32") : r.name === "Tit For Tat" ? "#eab308" : "#94a3b8";
        return { label: `#${String(r.overall_rank).padStart(2, " ")} ${r.name}`, fullLabel: `#${r.overall_rank}/${res.n_players} ${r.name}`, value: r.mean_score, std: r.std_score, color: col, bold: r.is_selected, extra: `Rank medio: ${r.mean_rank} | %#1: ${r.win_rate_pct}%` };
      }),
    });

    const boxCandidates = [], seen = new Set();
    res.standings.forEach((r) => { if ((r.overall_rank <= 6 || r.is_selected) && !seen.has(r.id) && boxCandidates.length < 10) { seen.add(r.id); boxCandidates.push(r); } });
    T5Charts.renderBoxplotChart($("cv-live-boxplot"), {
      groups: boxCandidates.map((r) => ({ label: (catalogMap.get(r.id)?.short || r.name).slice(0, 12), color: r.is_selected ? (catalogMap.get(r.id)?.color || "#2e7d32") : "#64748b", values: r.seed_scores })),
    });

    if (res.payoff_matrix) {
      $("live-tourn-heatmap-card").classList.remove("hidden");
      const limit = Math.min(res.standings.length, 24), subSt = res.standings.slice(0, limit);
      const subMat = res.payoff_matrix.slice(0, limit).map((row) => row.slice(0, limit));
      T5Charts.renderHeatmap($("cv-live-heatmap"), {
        mode: "payoff", matrix: subMat, rowLabels: subSt.map((s) => `#${s.overall_rank} ${s.name.slice(0, 15)}`), colLabels: subSt.map((s) => s.name.slice(0, 14)),
        showValues: limit <= 16, decimals: 2, valueLabel: "Pts/Ronda Fila",
        onCellClick: (r, c) => openDuelDirectly(subSt[r].id, subSt[c].id),
      });
    } else $("live-tourn-heatmap-card").classList.add("hidden");
  }

  // =========================================================================
  // SECTION 8: STRATEGY BUILDER, CODE EXPLORER & UNIT TESTS
  // =========================================================================
  function getBuilderPayload() {
    const mode = STATE.builderMode;
    const base = { name: $("b-name").value.trim() || "Mi Estrategia", color: $("b-color").value || "#0ea5e9", description: $("b-desc").value.trim(), kind: mode, config: {}, code: "" };
    if (mode === "visual_mem1") base.config = { first_move: $("bm1-first").value, p_cc: parseFloat($("bm1-cc").value), p_cd: parseFloat($("bm1-cd").value), p_dc: parseFloat($("bm1-dc").value), p_dd: parseFloat($("bm1-dd").value) };
    else if (mode === "visual_rl") base.config = { initial_count: parseFloat($("brl-n0").value), forgetting_factor: parseFloat($("brl-lam").value), gamma: parseFloat($("brl-gamma").value), uniform_prior: $("brl-prior").value === "uniform" };
    else if (mode === "visual_gary") base.config = { horizon: parseInt($("bgary-h").value, 10), gamma: parseFloat($("bgary-gamma").value), use_markov_leaves: $("bgary-markov").value === "true" };
    else if (mode === "visual_phase") base.config = { phases: [{ until: parseInt($("bph-t1").value, 10) || 50, mode: $("bph-m1").value }, { until: parseInt($("bph-t2").value, 10) || 120, mode: $("bph-m2").value }, { until: 500, mode: $("bph-m3").value }] };
    else if (mode === "python_code") base.code = $("b-py-code").value;
    return base;
  }

  function renderBuilderDiagnostics(diag) {
    const box = $("builder-test-output");
    box.classList.remove("hidden");
    box.innerHTML = `<div class="theorem-box" style="margin-bottom:0"><h4>✓ "${diag.name}" validada (${diag.stochastic ? "Estocástica" : "Determinista"})</h4><div class="table-wrap mt-sm"><table class="data-table"><thead><tr><th>Rival (100 t.)</th><th class="text-right">Mi Media</th><th class="text-right">Rival</th><th class="text-right">% Coop</th><th>Primeros 10</th></tr></thead><tbody>${diag.diagnostics.map((r) => `<tr><td><strong>${r.rival}</strong></td><td class="mono text-right"><strong>${r.my_avg.toFixed(3)}</strong></td><td class="mono text-right">${r.opp_avg.toFixed(3)}</td><td class="mono text-right">${r.coop_pct}%</td><td class="mono">${r.first_10}</td></tr>`).join("")}</tbody></table></div></div>`;
  }

  function renderCustomStrategiesList() {
    const list = $("custom-strategies-list");
    const customs = STATE.catalog.filter((c) => c.id.startsWith("custom_"));
    if (!customs.length) { list.innerHTML = `<p class="muted">Aún no has guardado estrategias propias.</p>`; return; }
    list.innerHTML = customs.map((c) => {
      const meta = c.custom_meta || {};
      return `<div class="custom-item">
        <div style="display:flex;align-items:center;gap:10px">
          ${T5Voxel.renderVoxelAvatar(c.id, { headOnly: true, size: 34, color: c.color })}
          <div>
            <div style="display:flex;align-items:center;gap:6px"><strong>${c.name}</strong><span class="badge badge-gray">${meta.kind || "custom"}</span></div>
            <div class="muted" style="margin-top:2px">${c.description || "Sin descripción"}</div>
          </div>
        </div>
        <div class="btn-group">
          <button class="btn btn-primary btn-sm" data-cplay="${c.id}">🎮 Jugar</button>
          <button class="btn btn-secondary btn-sm" data-cduel="${c.id}">⚔ vs RL</button>
          <button class="btn btn-secondary btn-sm" data-ctourn="${c.id}">🏆 Torneo</button>
          <button class="btn btn-danger btn-sm" data-cdel="${meta.id}">✕</button>
        </div>
      </div>`;
    }).join("");

    list.querySelectorAll("[data-cplay]").forEach((b) => b.addEventListener("click", () => { switchTab("play"); startHumanGame(b.dataset.cplay); }));
    list.querySelectorAll("[data-cduel]").forEach((b) => b.addEventListener("click", () => openDuelDirectly(b.dataset.cduel, "gen5_rl")));
    list.querySelectorAll("[data-ctourn]").forEach((b) => b.addEventListener("click", () => {
      if (!STATE.liveTournSelected.includes(b.dataset.ctourn)) STATE.liveTournSelected.push(b.dataset.ctourn);
      renderChipSelector("live-tourn-chips", STATE.liveTournSelected);
      switchTab("arena"); activateSubtab($("tab-arena"), "tourn-live");
      toast("Estrategia añadida al Torneo en Vivo", "success");
    }));
    list.querySelectorAll("[data-cdel]").forEach((b) => b.addEventListener("click", async () => {
      try { const res = await apiDelete(`/api/strategies/${b.dataset.cdel}`); STATE.catalog = res.catalog; refreshAllCatalogWidgets(); toast("Estrategia eliminada", "info"); }
      catch (err) { toast(err.message, "error"); }
    }));
  }

  function highlightPython(src) {
    const esc = src.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return esc.replace(/(#[^\n]*)/g, '<span class="cmt">$1</span>').replace(/\b(def|class|return|if|elif|else|for|in|while|import|from|as|try|except|raise|with|assert|True|False|None|and|or|not)\b/g, '<span class="kw">$1</span>').replace(/\b(\d+\.\d+|\d+)\b/g, '<span class="num">$1</span>');
  }

  async function loadSourceCodes() {
    try {
      const res = await apiGet("/api/code");
      STATE.codeFiles = res.files || [];
      const box = $("code-file-tabs");
      box.innerHTML = STATE.codeFiles.map((f, idx) => `<button class="subtab-btn ${idx === STATE.activeCodeIdx ? "active" : ""}" data-code-idx="${idx}">${f.filename}</button>`).join("");
      box.querySelectorAll("[data-code-idx]").forEach((b) => b.addEventListener("click", () => showCodeFile(parseInt(b.dataset.codeIdx, 10))));
      showCodeFile(0);
    } catch (err) { toast(err.message, "error"); }
  }

  function showCodeFile(idx) {
    STATE.activeCodeIdx = idx;
    const f = STATE.codeFiles[idx];
    if (!f) return;
    document.querySelectorAll("#code-file-tabs .subtab-btn").forEach((b, i) => b.classList.toggle("active", i === idx));
    $("code-file-desc").textContent = `${f.filename} — ${f.description} (${f.lines} líneas)`;
    $("code-cli-pill").textContent = `$ ${f.cli}   (${f.est})`;
    $("btn-run-script").disabled = !f.runnable || Boolean(STATE.scriptPollTimer);
    $("btn-run-script").textContent = f.runnable ? `▶ Ejecutar (${f.est})` : "Solo descarga (.ipynb)";
    $("btn-download-code").textContent = f.filename.endsWith(".ipynb") ? "Descargar .ipynb" : "Descargar .py";
    $("code-viewer-pre").innerHTML = highlightPython(f.content);
  }

  function stopScriptPolling() {
    if (STATE.scriptPollTimer) {
      clearInterval(STATE.scriptPollTimer);
      STATE.scriptPollTimer = null;
    }
    $("btn-stop-script").classList.add("hidden");
    const f = STATE.codeFiles && STATE.codeFiles[STATE.activeCodeIdx];
    $("btn-run-script").disabled = !(f && f.runnable);
  }

  async function runActiveScript() {
    const f = STATE.codeFiles && STATE.codeFiles[STATE.activeCodeIdx];
    if (!f || !f.runnable) return;
    stopScriptPolling();

    try {
      $("btn-run-script").disabled = true;
      $("btn-stop-script").classList.remove("hidden");
      $("script-console-wrap").classList.remove("hidden");
      $("script-images-box").classList.add("hidden");
      $("script-images-box").innerHTML = "";
      $("script-status-badge").className = "badge badge-blue";
      $("script-status-badge").textContent = "Ejecutando...";
      $("script-elapsed").textContent = "0.0s";
      $("script-console-pre").textContent = `$ ${f.cli}\nIniciando proceso Python...\n`;

      const started = await apiPost("/api/scripts/run", { script_id: f.id });
      STATE.activeScriptJobId = started.job_id;

      STATE.scriptPollTimer = setInterval(async () => {
        try {
          const st = await apiGet(`/api/scripts/status/${started.job_id}`);
          const pre = $("script-console-pre");
          pre.textContent = st.output || "";
          pre.scrollTop = pre.scrollHeight;
          $("script-elapsed").textContent = `${st.elapsed_sec}s`;

          if (st.status !== "running") {
            stopScriptPolling();
            if (st.status === "done") {
              $("script-status-badge").className = "badge badge-c";
              $("script-status-badge").textContent = "✓ Completado (Exit 0)";
              toast(`${f.filename} ejecutado en ${st.elapsed_sec}s`, "success");
            } else if (st.status === "stopped") {
              $("script-status-badge").className = "badge badge-amber";
              $("script-status-badge").textContent = "■ Detenido";
            } else {
              $("script-status-badge").className = "badge badge-d";
              $("script-status-badge").textContent = `✕ Error (Exit ${st.returncode ?? "?"})`;
              toast(`Error al ejecutar ${f.filename}`, "error");
            }

            if (st.generated_images && st.generated_images.length) {
              const imgBox = $("script-images-box");
              imgBox.classList.remove("hidden");
              imgBox.innerHTML = st.generated_images
                .map(
                  (im) => `
                <div class="card" style="padding:10px;margin-bottom:0">
                  <div class="mono muted mb-sm">Figura generada: <strong>${im.name}</strong></div>
                  <a href="${im.url}" target="_blank"><img src="${im.url}" alt="${im.name}" style="width:100%;border-radius:6px;border:1px solid var(--border)"/></a>
                </div>`
                )
                .join("");
            }
          }
        } catch (err) {
          stopScriptPolling();
          toast(err.message, "error");
        }
      }, 300);
    } catch (err) {
      stopScriptPolling();
      toast(err.message, "error");
    }
  }

  async function runUnitTests() {
    try {
      $("btn-run-unittests").disabled = true;
      $("unittest-results-box").innerHTML = `<p class="muted">Ejecutando pruebas unitarias...</p>`;
      const res = await apiPost("/api/tests/run", {});
      const pill = res.passed ? `<span class="badge badge-c">✓ ${res.tests_run}/${res.tests_run} pruebas superadas en ${res.elapsed_sec}s</span>` : `<span class="badge badge-d">✕ ${res.failures + res.errors} fallos</span>`;
      $("unittest-results-box").innerHTML = `<div class="mb-sm">${pill}</div><div class="table-wrap mb-sm"><table class="data-table"><thead><tr><th>Prueba Unitaria</th><th class="text-center">Resultado</th></tr></thead><tbody>${res.tests.map((t) => `<tr><td class="mono">${t.name}</td><td class="text-center"><span class="badge ${t.status === "ok" ? "badge-c" : "badge-d"}">${t.status.toUpperCase()}</span></td></tr>`).join("")}</tbody></table></div><details><summary class="muted" style="cursor:pointer">Salida completa</summary><pre class="code-viewer-pre mt-sm" style="max-height:220px">${res.raw_output}</pre></details>`;
      toast(`Pruebas completadas: ${res.tests_run} OK`, res.passed ? "success" : "error");
    } catch (err) { toast(err.message, "error"); }
    finally { $("btn-run-unittests").disabled = false; }
  }

  // =========================================================================
  // EVENT BINDINGS
  // =========================================================================
  function bindEvents() {
    // Section 1: Play Human-vs-AI
    $("btn-human-c").addEventListener("click", () => playHumanMove("C"));
    $("btn-human-d").addEventListener("click", () => playHumanMove("D"));
    $("btn-human-reset").addEventListener("click", () => startHumanGame(STATE.playOpponentId));
    $("play-opponent-select").addEventListener("change", () => startHumanGame($("play-opponent-select").value));

    // Section 2: Axelrod Ring
    $("ring-inject-select").addEventListener("change", () => {
      stopRingAnimation();
      STATE.ringInjectId = $("ring-inject-select").value;
      STATE.ringSelectedIdx = STATE.ringInjectId === "none" ? 0 : 15;
      renderAxelrodRingSection(null);
    });
    $("btn-ring-animate").addEventListener("click", toggleRingAnimation);
    $("t10-gen-select").addEventListener("change", () => renderAxelrod10Focus(parseInt($("t10-gen-select").value, 10)));
    $("btn-t10-toggle-grid").addEventListener("click", () => {
      STATE.t10FullGrid = !STATE.t10FullGrid;
      $("t10-focus-view").classList.toggle("hidden", STATE.t10FullGrid);
      $("t10-full-grid").classList.toggle("hidden", !STATE.t10FullGrid);
      $("btn-t10-toggle-grid").textContent = STATE.t10FullGrid ? "Vista enfocada (1 generación)" : "Ver las 5 generaciones juntas";
      redrawVisibleCanvases();
    });

    // Section 3: Evolution
    $("btn-rerun-evolution").addEventListener("click", async () => {
      try {
        $("btn-rerun-evolution").disabled = true;
        toast("Ejecutando simulación en vivo de las 5 generaciones...", "info");
        STATE.evolution = await apiPost("/api/evolution", { turns: 200, repetitions: 5, seed: 42, include_axelrod: true });
        renderEvolutionCharts();
        toast("Simulación actualizada", "success");
      } catch (err) { toast(err.message, "error"); }
      finally { $("btn-rerun-evolution").disabled = false; }
    });

    // Section 4: MDP
    ["mdp-gamma", "mdp-n0", "mdp-lam"].forEach((id) => {
      $(id).addEventListener("input", () => {
        const val = parseFloat($(id).value);
        $(`lbl-${id}`).textContent = id === "mdp-n0" ? val.toFixed(1) : val.toFixed(2);
        renderTheorem2Sim();
      });
    });
    $("btn-mdp-recalc").addEventListener("click", recalcMdpLive);
    $("btn-mdp-reset-emp").addEventListener("click", () => {
      STATE.customP = null;
      $("mdp-gamma").value = 0.90; $("lbl-mdp-gamma").textContent = "0.90";
      $("mdp-n0").value = 2.0; $("lbl-mdp-n0").textContent = "2.0";
      $("mdp-lam").value = 0.90; $("lbl-mdp-lam").textContent = "0.90";
      $("mdp-laplace").value = 0;
      recalcMdpLive();
      toast("Valores empíricos restaurados", "info");
    });
    $("btn-mdp-run-sweep").addEventListener("click", async () => {
      try {
        $("btn-mdp-run-sweep").disabled = true;
        toast("Calculando barrido de λ en Axelrod 1980...", "info");
        STATE.lambdaSweep = await apiPost("/api/lambda-sweep", { initial_count: parseFloat($("mdp-n0").value), gamma: parseFloat($("mdp-gamma").value), repetitions: 5, seed: 42 });
        renderLambdaSweepChart();
        toast("Barrido completado", "success");
      } catch (err) { toast(err.message, "error"); }
      finally { $("btn-mdp-run-sweep").disabled = false; }
    });
    $("btn-sim-add-c").addEventListener("click", () => { STATE.thm2Events.push(1); renderTheorem2Sim(); });
    $("btn-sim-add-d").addEventListener("click", () => { STATE.thm2Events.push(0); renderTheorem2Sim(); });
    $("btn-sim-50c5d").addEventListener("click", () => { STATE.thm2Events = [...Array(50).fill(1), ...Array(5).fill(0)]; renderTheorem2Sim(); toast("Secuencia 50 C + 5 D cargada", "success"); });
    $("btn-sim-reset").addEventListener("click", () => { STATE.thm2Events = [1, 0, 0]; renderTheorem2Sim(); });

    // Section 5: Online RL
    $("btn-run-learning").addEventListener("click", async () => {
      try {
        $("btn-run-learning").disabled = true;
        STATE.online = await apiPost("/api/online-learning", {
          initial_count: parseFloat($("lrn-n0").value) || 2.0, default_lambda: parseFloat($("lrn-lam").value) || 0.90,
          gamma: parseFloat($("lrn-gamma").value) || 0.90, switch_turn: parseInt($("lrn-switch").value, 10) || 50,
          rolling_window: parseInt($("lrn-window").value, 10) || 15, matrix_rival_id: $("lrn-matrix-rival").value || "axl_Alternator",
          seed: parseInt($("lrn-seed").value, 10) || 42,
        });
        renderOnlineLearningSection();
        toast("Curvas actualizadas", "success");
      } catch (err) { toast(err.message, "error"); }
      finally { $("btn-run-learning").disabled = false; }
    });

    // Section 6: Gary Expectimax
    $("gary-h").addEventListener("input", () => ($("lbl-gary-h").textContent = $("gary-h").value));
    $("gary-gamma").addEventListener("input", () => ($("lbl-gary-gamma").textContent = parseFloat($("gary-gamma").value).toFixed(2)));
    $("gary-turn-slider").addEventListener("input", () => { stopGaryPlayback(); updateGaryStepView(parseInt($("gary-turn-slider").value, 10)); });
    $("btn-gary-play").addEventListener("click", toggleGaryPlayback);
    $("btn-gary-prev").addEventListener("click", () => { stopGaryPlayback(); updateGaryStepView(STATE.garyActiveTurn - 1); });
    $("btn-gary-next").addEventListener("click", () => { stopGaryPlayback(); updateGaryStepView(STATE.garyActiveTurn + 1); });
    $("btn-run-gary").addEventListener("click", async () => {
      stopGaryPlayback();
      try {
        $("btn-run-gary").disabled = true;
        STATE.gary = await apiPost("/api/gary-dynamics", { horizon: parseInt($("gary-h").value, 10) || 4, gamma: parseFloat($("gary-gamma").value) || 0.95, rival_id: $("gary-rival").value || "axl_FirstByJoss", seed: parseInt($("gary-seed").value, 10) || 42 });
        renderGarySection();
        toast(`Partida Expectimax (H=${STATE.gary.horizon}, γ=${STATE.gary.gamma}) lista`, "success");
      } catch (err) { toast(err.message, "error"); }
      finally { $("btn-run-gary").disabled = false; }
    });

    // Section 7: Duels & Tournaments
    $("duel-agent-a").addEventListener("change", updateDuelRlBarVisibility);
    ["duel-n0", "duel-lam", "duel-gamma"].forEach((id) => $(id).addEventListener("input", () => ($(`lbl-${id}`).textContent = id === "duel-n0" ? parseFloat($(id).value).toFixed(1) : parseFloat($(id).value).toFixed(2))));
    $("btn-run-duel").addEventListener("click", runCurrentDuel);
    $("btn-swap-duel").addEventListener("click", () => { const a = $("duel-agent-a").value; $("duel-agent-a").value = $("duel-agent-b").value; $("duel-agent-b").value = a; updateDuelRlBarVisibility(); runCurrentDuel(); });
    $("btn-duel-play").addEventListener("click", toggleDuelPlayback);
    $("btn-duel-prev").addEventListener("click", () => { stopDuelPlayback(); setDuelActiveTurn(STATE.duelActiveTurn - 1); });
    $("btn-duel-next").addEventListener("click", () => { stopDuelPlayback(); setDuelActiveTurn(STATE.duelActiveTurn + 1); });
    $("duel-turn-slider").addEventListener("input", () => { stopDuelPlayback(); setDuelActiveTurn(parseInt($("duel-turn-slider").value, 10)); });
    $("btn-duel-export-csv").addEventListener("click", () => {
      const d = STATE.duel; if (!d) return;
      const lines = ["turn,move_a,move_b,state,score_a,score_b,cum_avg_a,cum_avg_b"];
      for (let i = 0; i < d.turns; i++) lines.push(`${i + 1},${d.player_a.moves[i]},${d.player_b.moves[i]},${d.states[i]},${d.player_a.round_scores[i]},${d.player_b.round_scores[i]},${d.player_a.cum_avg[i]},${d.player_b.cum_avg[i]}`);
      downloadText(`duelo_${d.player_a.id}_vs_${d.player_b.id}.csv`, lines.join("\n"), "text/csv;charset=utf-8");
    });
    $("btn-h2h-preset-paper").addEventListener("click", () => {
      STATE.h2hSelected = ["gen1_rulito", "gen2_cloud", "gen3_gary", "gen4_base", "gen5_rl", "axl_TitForTat", "axl_Grudger", "axl_Defector", "axl_Alternator", "rival_switch_50"];
      renderChipSelector("h2h-chip-selector", STATE.h2hSelected);
      runH2HMatrix();
    });
    $("btn-run-h2h").addEventListener("click", runH2HMatrix);
    $("search-harper").addEventListener("input", () => renderHarperAndMegaTables($("search-harper").value, $("search-mega").value));
    $("search-mega").addEventListener("input", () => renderHarperAndMegaTables($("search-harper").value, $("search-mega").value));
    $("btn-start-live-tournament").addEventListener("click", startLiveTournament);
    $("btn-export-tourn-csv").addEventListener("click", () => {
      const r = STATE.liveTournResult; if (!r) return;
      const lines = ["rank,name,mean_score,std_score,mean_rank,win_rate_pct,top3_rate_pct"];
      r.standings.forEach((s) => lines.push(`${s.overall_rank},"${s.name}",${s.mean_score},${s.std_score},${s.mean_rank},${s.win_rate_pct},${s.top3_rate_pct}`));
      downloadText(`torneo_${r.preset}.csv`, lines.join("\n"), "text/csv;charset=utf-8");
    });

    // Section 8: Studio
    $("builder-mode-tabs").querySelectorAll("[data-bmode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        STATE.builderMode = btn.dataset.bmode;
        $("builder-mode-tabs").querySelectorAll("[data-bmode]").forEach((b) => b.classList.toggle("active", b === btn));
        document.querySelectorAll(".bpanel").forEach((p) => p.classList.toggle("hidden", p.id !== `bpanel-${STATE.builderMode}`));
      });
    });
    ["cc", "cd", "dc", "dd"].forEach((s) => $(`bm1-${s}`).addEventListener("input", () => ($(`lbl-bm1-${s}`).textContent = parseFloat($(`bm1-${s}`).value).toFixed(2))));
    document.querySelectorAll("[data-m1preset]").forEach((b) => b.addEventListener("click", () => {
      const [cc, cd, dc, dd] = b.dataset.m1preset.split(",").map(Number);
      [["cc", cc], ["cd", cd], ["dc", dc], ["dd", dd]].forEach(([k, v]) => { $(`bm1-${k}`).value = v; $(`lbl-bm1-${k}`).textContent = v.toFixed(2); });
    }));
    $("brl-n0").addEventListener("input", () => ($("lbl-brl-n0").textContent = parseFloat($("brl-n0").value).toFixed(1)));
    $("brl-lam").addEventListener("input", () => ($("lbl-brl-lam").textContent = parseFloat($("brl-lam").value).toFixed(2)));
    $("brl-gamma").addEventListener("input", () => ($("lbl-brl-gamma").textContent = parseFloat($("brl-gamma").value).toFixed(2)));
    $("bgary-gamma").addEventListener("input", () => ($("lbl-bgary-gamma").textContent = parseFloat($("bgary-gamma").value).toFixed(2)));
    $("b-py-template").addEventListener("change", () => {
      const tpl = STATE.pythonTemplates[$("b-py-template").value];
      if (tpl) { $("b-py-code").value = tpl.code; $("b-name").value = tpl.title; $("b-desc").value = tpl.description; }
    });
    $("btn-test-strategy").addEventListener("click", async () => {
      try { $("btn-test-strategy").disabled = true; const diag = await apiPost("/api/strategies/test", getBuilderPayload()); renderBuilderDiagnostics(diag); toast(`"${diag.name}" validada`, "success"); }
      catch (err) { toast(err.message, "error"); } finally { $("btn-test-strategy").disabled = false; }
    });
    $("btn-save-strategy").addEventListener("click", async () => {
      try { $("btn-save-strategy").disabled = true; const res = await apiPost("/api/strategies", getBuilderPayload()); STATE.catalog = res.catalog; renderBuilderDiagnostics(res.diagnostics); refreshAllCatalogWidgets(); toast(`"${res.saved.name}" incorporada`, "success"); }
      catch (err) { toast(err.message, "error"); } finally { $("btn-save-strategy").disabled = false; }
    });
    $("btn-run-unittests").addEventListener("click", runUnitTests);
    $("btn-run-script").addEventListener("click", runActiveScript);
    $("btn-stop-script").addEventListener("click", async () => {
      if (STATE.activeScriptJobId) {
        try { await apiPost(`/api/scripts/stop/${STATE.activeScriptJobId}`, {}); } catch (_e) {}
      }
      stopScriptPolling();
      $("script-status-badge").className = "badge badge-amber";
      $("script-status-badge").textContent = "■ Detenido";
    });
    $("btn-clear-console").addEventListener("click", () => $("script-console-wrap").classList.add("hidden"));
    $("btn-copy-code").addEventListener("click", () => { const f = STATE.codeFiles && STATE.codeFiles[STATE.activeCodeIdx]; if (f) { navigator.clipboard.writeText(f.content); toast(`${f.filename} copiado`, "success"); } });
    $("btn-download-code").addEventListener("click", () => {
      const f = STATE.codeFiles && STATE.codeFiles[STATE.activeCodeIdx];
      if (!f) return;
      if (f.filename.endsWith(".ipynb")) { window.open("/api/download-notebook", "_blank"); return; }
      downloadText(f.filename, f.content, "text/x-python;charset=utf-8");
    });
  }

  // =========================================================================
  // INIT
  // =========================================================================
  async function init() {
    setupTypographyToggle();
    setupNavigation();
    bindEvents();
    renderMath(document.body);

    try {
      const data = await apiGet("/api/bootstrap");
      STATE.catalog = data.catalog;
      STATE.pythonTemplates = data.python_templates || {};
      STATE.mdp = data.mdp;
      STATE.lambdaSweep = data.lambda_sweep;
      STATE.evolution = data.evolution;
      STATE.online = data.online;
      STATE.gary = data.gary;
      STATE.tournamentsVerified = data.tournaments_verified;
      STATE.axelrodRing = data.axelrod_ring;
      STATE.thm2Events = [1, 0, 0];

      const tplSel = $("b-py-template");
      tplSel.innerHTML = Object.entries(STATE.pythonTemplates).map(([k, v]) => `<option value="${k}">${v.title}</option>`).join("");
      const firstKey = Object.keys(STATE.pythonTemplates)[0];
      if (firstKey) $("b-py-code").value = STATE.pythonTemplates[firstKey].code;

      refreshAllCatalogWidgets();
      updateDuelRlBarVisibility();

      // Render Jacinto avatar & wire Future Proposal (Taller 6) buttons
      if ($("jacinto-hero-avatar")) {
        $("jacinto-hero-avatar").innerHTML = T5Voxel.renderVoxelAvatar("gen6_jacinto", { side: "left", move: "C", mood: "happy", size: 78 });
      }
      if ($("btn-jacinto-vs-alternator")) {
        $("btn-jacinto-vs-alternator").addEventListener("click", () => openDuelDirectly("axl_Alternator", "gen6_jacinto"));
      }
      if ($("btn-play-jacinto")) {
        $("btn-play-jacinto").addEventListener("click", () => { switchTab("play"); startHumanGame("gen6_jacinto"); });
      }

      // Start initial playable Human-vs-AI session & render Axelrod Ring + all technical views
      await startHumanGame("axl_TitForTat");
      renderAxelrodRingSection(null);
      renderEvolutionCharts();
      renderMdpSection();
      renderTheorem2Sim();
      renderOnlineLearningSection();
      renderGarySection();
      renderVerifiedTournaments();
      renderMath(document.body);

      $("global-status-text").textContent = `${data.mdp.total_transitions.toLocaleString("en-US")} transiciones · π₀=${data.mdp.policy_str}`;
    } catch (err) {
      $("global-status-text").textContent = "Error de conexión";
      toast(`Error al inicializar: ${err.message}`, "error");
    }
  }

  window.addEventListener("DOMContentLoaded", init);
})();
