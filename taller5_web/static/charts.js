/**
 * charts.js — High-DPI Interactive Scientific Charting Engine for Taller 5
 * Zero external dependencies: Canvas 2D + SVG, crisp Retina scaling, interactive tooltips,
 * dual Y-axis, shaded phases, error bars, jittered boxplots, heatmaps & Markov SVG.
 */

(function () {
  const tooltipEl = () => document.getElementById("chart-tooltip");

  function showTooltip(evt, html) {
    const tt = tooltipEl();
    if (!tt) return;
    tt.innerHTML = html;
    tt.style.display = "block";
    const pad = 14;
    const rect = tt.getBoundingClientRect();
    let x = evt.clientX + pad;
    let y = evt.clientY + pad;
    if (x + rect.width > window.innerWidth - 10) x = evt.clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight - 10) y = evt.clientY - rect.height - pad;
    tt.style.left = Math.max(8, x) + "px";
    tt.style.top = Math.max(8, y) + "px";
  }

  function hideTooltip() {
    const tt = tooltipEl();
    if (tt) tt.style.display = "none";
  }

  function setupCanvas(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = Math.max(240, Math.floor(rect.width || 560));
    const h = Math.max(180, Math.floor(rect.height || 300));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function bindHover(canvas, onMove, onLeave, onClick) {
    if (canvas._t5Handlers) {
      canvas.removeEventListener("mousemove", canvas._t5Handlers.move);
      canvas.removeEventListener("mouseleave", canvas._t5Handlers.leave);
      if (canvas._t5Handlers.click) canvas.removeEventListener("click", canvas._t5Handlers.click);
    }
    const move = (e) => {
      const rect = canvas.getBoundingClientRect();
      onMove(e, e.clientX - rect.left, e.clientY - rect.top);
    };
    const leave = () => {
      hideTooltip();
      if (onLeave) onLeave();
    };
    const click = onClick
      ? (e) => {
          const rect = canvas.getBoundingClientRect();
          onClick(e, e.clientX - rect.left, e.clientY - rect.top);
        }
      : null;
    canvas.addEventListener("mousemove", move);
    canvas.addEventListener("mouseleave", leave);
    if (click) canvas.addEventListener("click", click);
    canvas._t5Handlers = { move, leave, click };
  }

  function niceTicks(minVal, maxVal, count = 5) {
    if (!Number.isFinite(minVal) || !Number.isFinite(maxVal)) return [0, 1];
    if (Math.abs(maxVal - minVal) < 1e-9) {
      return [minVal - 1, minVal, minVal + 1];
    }
    const step = (maxVal - minVal) / count;
    const ticks = [];
    for (let i = 0; i <= count; i++) ticks.push(minVal + step * i);
    return ticks;
  }

  function drawStar(ctx, cx, cy, r, fill, stroke = "#0f253c") {
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = (Math.PI / 5) * i - Math.PI / 2;
      const rad = i % 2 === 0 ? r : r * 0.45;
      const x = cx + Math.cos(ang) * rad;
      const y = cy + Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = stroke;
    ctx.stroke();
    ctx.restore();
  }

  // =========================================================================
  // 1. INTERACTIVE MULTI-LINE CHART (with dual Y-axis, phases, stars, crosshair)
  // =========================================================================
  function renderLineChart(canvas, cfg) {
    if (!canvas) return;
    canvas._lastRender = () => renderLineChart(canvas, cfg);

    const series = cfg.series || [];
    const rightSeries = cfg.rightSeries || [];
    const hasRight = rightSeries.length > 0;
    const nPts = Math.max(
      1,
      ...series.map((s) => (s.values ? s.values.length : 0)),
      ...rightSeries.map((s) => (s.values ? s.values.length : 0))
    );
    const xStart = cfg.xStart ?? 1;

    // Auto Y bounds
    let yMin = cfg.yMin;
    let yMax = cfg.yMax;
    if (yMin == null || yMax == null) {
      const allV = series.flatMap((s) => s.values || []).filter(Number.isFinite);
      const lo = allV.length ? Math.min(...allV) : 0;
      const hi = allV.length ? Math.max(...allV) : 1;
      const pad = Math.max((hi - lo) * 0.1, 0.05);
      if (yMin == null) yMin = lo - pad;
      if (yMax == null) yMax = hi + pad;
    }

    let ryMin = cfg.ryMin;
    let ryMax = cfg.ryMax;
    if (hasRight && (ryMin == null || ryMax == null)) {
      const allR = rightSeries.flatMap((s) => s.values || []).filter(Number.isFinite);
      const lo = allR.length ? Math.min(...allR) : -1;
      const hi = allR.length ? Math.max(...allR) : 1;
      const pad = Math.max((hi - lo) * 0.12, 0.08);
      if (ryMin == null) ryMin = lo - pad;
      if (ryMax == null) ryMax = hi + pad;
    }

    let hoverIdx = null;

    function draw() {
      const { ctx, w, h } = setupCanvas(canvas);
      const legendItems = [...series, ...rightSeries];
      const legendRows = Math.ceil(legendItems.length / Math.max(1, Math.floor((w - 60) / 185)));
      const topPad = 14 + (cfg.hideLegend ? 0 : Math.min(legendRows, 3) * 18 + 6);
      const pad = {
        left: cfg.padLeft ?? 54,
        right: hasRight ? 54 : 18,
        top: topPad,
        bottom: 38,
      };
      const pw = w - pad.left - pad.right;
      const ph = h - pad.top - pad.bottom;

      const xOf = (i) => pad.left + (nPts <= 1 ? pw / 2 : (i / (nPts - 1)) * pw);
      const yOf = (v) => pad.top + ph - ((v - yMin) / Math.max(1e-9, yMax - yMin)) * ph;
      const ryOf = (v) => pad.top + ph - ((v - ryMin) / Math.max(1e-9, ryMax - ryMin)) * ph;

      ctx.clearRect(0, 0, w, h);

      // Shaded vertical spans (e.g., 3 phases)
      if (cfg.vSpans) {
        cfg.vSpans.forEach((sp) => {
          const x1 = xOf(Math.max(0, sp.from - xStart));
          const x2 = xOf(Math.min(nPts - 1, sp.to - xStart));
          ctx.fillStyle = sp.color;
          ctx.fillRect(x1, pad.top, x2 - x1, ph);
          if (sp.label) {
            ctx.fillStyle = sp.textColor || "#334155";
            ctx.font = "700 10.5px Inter, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(sp.label, (x1 + x2) / 2, pad.top + 14);
          }
        });
      }

      // Gridlines & Left Y-axis ticks
      const yTicks = niceTicks(yMin, yMax, cfg.yTicksCount ?? 5);
      ctx.font = "11px JetBrains Mono, monospace";
      yTicks.forEach((tv) => {
        const y = yOf(tv);
        ctx.strokeStyle = "#e8eef5";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + pw, y);
        ctx.stroke();

        ctx.fillStyle = "#5b6f86";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(tv.toFixed(cfg.yDecimals ?? 2), pad.left - 8, y);
      });

      // Right Y-axis ticks
      if (hasRight) {
        const rTicks = niceTicks(ryMin, ryMax, 5);
        rTicks.forEach((tv) => {
          const y = ryOf(tv);
          ctx.fillStyle = "#c2410c";
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(tv.toFixed(2), pad.left + pw + 7, y);
        });
      }

      // X-axis ticks
      const xStep = Math.max(1, Math.round((nPts - 1) / Math.min(8, Math.max(2, Math.floor(pw / 64)))));
      ctx.fillStyle = "#5b6f86";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (let i = 0; i < nPts; i += xStep) {
        const x = xOf(i);
        ctx.strokeStyle = "#eef2f7";
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, pad.top + ph);
        ctx.stroke();
        ctx.fillText(String(xStart + i), x, pad.top + ph + 6);
      }
      // Ensure final x label
      if ((nPts - 1) % xStep > xStep * 0.45) {
        ctx.fillText(String(xStart + nPts - 1), xOf(nPts - 1), pad.top + ph + 6);
      }

      // Axes frame
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 1;
      ctx.strokeRect(pad.left, pad.top, pw, ph);

      // Axis labels
      ctx.fillStyle = "#334155";
      ctx.font = "600 11px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      if (cfg.xLabel) ctx.fillText(cfg.xLabel, pad.left + pw / 2, h - 3);

      if (cfg.yLabel) {
        ctx.save();
        ctx.translate(8, pad.top + ph / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(cfg.yLabel, 0, 0);
        ctx.restore();
      }
      if (hasRight && cfg.ryLabel) {
        ctx.save();
        ctx.translate(w - 6, pad.top + ph / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillStyle = "#c2410c";
        ctx.fillText(cfg.ryLabel, 0, 0);
        ctx.restore();
      }

      // Horizontal reference lines
      (cfg.hLines || []).forEach((hl) => {
        const y = hl.right ? ryOf(hl.y) : yOf(hl.y);
        if (y < pad.top || y > pad.top + ph) return;
        ctx.save();
        ctx.strokeStyle = hl.color || "#334155";
        ctx.lineWidth = hl.width || 1.2;
        ctx.setLineDash(hl.dash || [4, 4]);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + pw, y);
        ctx.stroke();
        if (hl.label) {
          ctx.fillStyle = hl.color || "#334155";
          ctx.font = "600 10.5px Inter, sans-serif";
          ctx.textAlign = "right";
          ctx.textBaseline = "bottom";
          ctx.fillText(hl.label, pad.left + pw - 6, y - 3);
        }
        ctx.restore();
      });

      // Vertical reference lines
      (cfg.vLines || []).forEach((vl) => {
        const idx = vl.x - xStart;
        if (idx < 0 || idx > nPts - 1) return;
        const x = xOf(idx);
        ctx.save();
        ctx.strokeStyle = vl.color || "#475569";
        ctx.lineWidth = 1.25;
        ctx.setLineDash(vl.dash || [3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, pad.top + ph);
        ctx.stroke();
        if (vl.label) {
          ctx.fillStyle = vl.color || "#334155";
          ctx.font = "600 10.5px Inter, sans-serif";
          ctx.textAlign = x > pad.left + pw * 0.7 ? "right" : "left";
          ctx.textBaseline = "top";
          ctx.fillText(vl.label, x + (x > pad.left + pw * 0.7 ? -4 : 4), pad.top + 4);
        }
        ctx.restore();
      });

      // Highlight active turn marker (from duel scrubber)
      if (cfg.activeTurn != null) {
        const idx = cfg.activeTurn - xStart;
        if (idx >= 0 && idx < nPts) {
          const x = xOf(idx);
          ctx.save();
          ctx.strokeStyle = "#0f253c";
          ctx.lineWidth = 1.8;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(x, pad.top);
          ctx.lineTo(x, pad.top + ph);
          ctx.stroke();
          ctx.restore();
        }
      }

      // Draw series helper
      function drawSeriesList(list, mapY) {
        list.forEach((s) => {
          const vals = s.values || [];
          if (!vals.length) return;
          ctx.save();
          ctx.beginPath();
          ctx.rect(pad.left, pad.top, pw, ph);
          ctx.clip();

          // Optional area fill
          if (s.fillArea) {
            ctx.beginPath();
            ctx.moveTo(xOf(0), mapY(vals[0]));
            for (let i = 1; i < vals.length; i++) ctx.lineTo(xOf(i), mapY(vals[i]));
            ctx.lineTo(xOf(vals.length - 1), pad.top + ph);
            ctx.lineTo(xOf(0), pad.top + ph);
            ctx.closePath();
            ctx.fillStyle = s.fillArea;
            ctx.fill();
          }

          ctx.strokeStyle = s.color || "#1565c0";
          ctx.lineWidth = s.width || 2.1;
          if (s.dashed) ctx.setLineDash([6, 4]);
          ctx.beginPath();
          vals.forEach((v, i) => {
            const x = xOf(i);
            const y = mapY(v);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();
          ctx.setLineDash([]);

          if (s.markers || vals.length <= 32) {
            ctx.fillStyle = s.color || "#1565c0";
            for (let i = 0; i < vals.length; i++) {
              ctx.beginPath();
              ctx.arc(xOf(i), mapY(vals[i]), s.markerRadius || 2.5, 0, Math.PI * 2);
              ctx.fill();
            }
          }

          // Optional star point (e.g. first D turn vs Defector)
          if (s.starTurn != null && s.starVal != null) {
            const sx = xOf(s.starTurn - xStart);
            const sy = mapY(s.starVal);
            drawStar(ctx, sx, sy, 6.5, s.color || "#1565c0");
            ctx.fillStyle = s.color || "#0f253c";
            ctx.font = "700 10.5px JetBrains Mono, monospace";
            ctx.textAlign = "left";
            ctx.textBaseline = "bottom";
            ctx.fillText(`t=${s.starTurn}`, sx + 7, sy - 3);
          }
          ctx.restore();
        });
      }

      drawSeriesList(series, yOf);
      if (hasRight) drawSeriesList(rightSeries, ryOf);

      // Optional text annotations inside chart
      (cfg.annotations || []).forEach((an) => {
        ctx.fillStyle = an.color || "#334155";
        ctx.font = "700 11px Inter, sans-serif";
        ctx.textAlign = an.align || "left";
        ctx.textBaseline = "middle";
        ctx.fillText(an.text, pad.left + pw * an.rx, pad.top + ph * an.ry);
      });

      // Top Legend
      if (!cfg.hideLegend && legendItems.length) {
        let lx = pad.left;
        let ly = 12;
        ctx.font = "600 10.8px Inter, sans-serif";
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        legendItems.forEach((s) => {
          const textW = ctx.measureText(s.label).width + 26;
          if (lx + textW > w - 12 && lx > pad.left) {
            lx = pad.left;
            ly += 17;
          }
          ctx.strokeStyle = s.color || "#1565c0";
          ctx.lineWidth = 2.4;
          ctx.save();
          if (s.dashed) ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(lx, ly);
          ctx.lineTo(lx + 15, ly);
          ctx.stroke();
          ctx.restore();
          ctx.fillStyle = "#2c3e50";
          ctx.fillText(s.label, lx + 19, ly);
          lx += textW + 8;
        });
      }

      // Hover crosshair
      if (hoverIdx != null && hoverIdx >= 0 && hoverIdx < nPts) {
        const hx = xOf(hoverIdx);
        ctx.save();
        ctx.strokeStyle = "rgba(15, 37, 60, 0.35)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(hx, pad.top);
        ctx.lineTo(hx, pad.top + ph);
        ctx.stroke();
        ctx.restore();

        series.forEach((s) => {
          if (hoverIdx < (s.values || []).length) {
            const hy = yOf(s.values[hoverIdx]);
            if (hy >= pad.top && hy <= pad.top + ph) {
              ctx.beginPath();
              ctx.arc(hx, hy, 4, 0, Math.PI * 2);
              ctx.fillStyle = s.color;
              ctx.fill();
              ctx.lineWidth = 1.5;
              ctx.strokeStyle = "#ffffff";
              ctx.stroke();
            }
          }
        });
        rightSeries.forEach((s) => {
          if (hoverIdx < (s.values || []).length) {
            const hy = ryOf(s.values[hoverIdx]);
            if (hy >= pad.top && hy <= pad.top + ph) {
              ctx.beginPath();
              ctx.arc(hx, hy, 4, 0, Math.PI * 2);
              ctx.fillStyle = s.color;
              ctx.fill();
              ctx.lineWidth = 1.5;
              ctx.strokeStyle = "#ffffff";
              ctx.stroke();
            }
          }
        });
      }

      canvas._plotMeta = { pad, pw, ph, nPts, xStart };
    }

    draw();

    bindHover(
      canvas,
      (evt, mx, my) => {
        const m = canvas._plotMeta;
        if (!m) return;
        if (mx < m.pad.left || mx > m.pad.left + m.pw || my < m.pad.top || my > m.pad.top + m.ph) {
          if (hoverIdx != null) {
            hoverIdx = null;
            draw();
          }
          hideTooltip();
          return;
        }
        const frac = (mx - m.pad.left) / Math.max(1, m.pw);
        const idx = Math.max(0, Math.min(m.nPts - 1, Math.round(frac * (m.nPts - 1))));
        if (idx !== hoverIdx) {
          hoverIdx = idx;
          draw();
        }
        const xTitle = `${cfg.xTooltipPrefix || "Turno"} ${m.xStart + idx}`;
        const rows = [];
        series.forEach((s) => {
          if (idx < (s.values || []).length) {
            rows.push(
              `<div class="tt-row"><span style="color:${s.color}">● ${s.label}</span><span>${Number(s.values[idx]).toFixed(cfg.tooltipDecimals ?? 3)}</span></div>`
            );
          }
        });
        rightSeries.forEach((s) => {
          if (idx < (s.values || []).length) {
            rows.push(
              `<div class="tt-row"><span style="color:${s.color}">◆ ${s.label}</span><span>${Number(s.values[idx]).toFixed(3)}</span></div>`
            );
          }
        });
        showTooltip(evt, `<div class="tt-title">${xTitle}</div>${rows.join("")}`);
      },
      () => {
        if (hoverIdx != null) {
          hoverIdx = null;
          draw();
        }
      },
      cfg.onPointClick
        ? (evt, mx) => {
            const m = canvas._plotMeta;
            if (!m || mx < m.pad.left || mx > m.pad.left + m.pw) return;
            const frac = (mx - m.pad.left) / Math.max(1, m.pw);
            const idx = Math.max(0, Math.min(m.nPts - 1, Math.round(frac * (m.nPts - 1))));
            cfg.onPointClick(m.xStart + idx);
          }
        : null
    );
  }

  // =========================================================================
  // 2. VERTICAL BAR CHART (Single or Grouped, with error bars & annotations)
  // =========================================================================
  function renderVerticalBarChart(canvas, cfg) {
    if (!canvas) return;
    canvas._lastRender = () => renderVerticalBarChart(canvas, cfg);

    const categories = cfg.categories || [];
    const groups = cfg.groups || []; // [{ label, color, values: [], stds?: [], tags?: [] }]
    const nCat = categories.length;
    const nGrp = groups.length;
    const yMin = cfg.yMin ?? 0;
    const allVals = groups.flatMap((g) => g.values.map((v, i) => v + (g.stds ? g.stds[i] || 0 : 0)));
    const yMax = cfg.yMax ?? Math.max(1, ...allVals) * 1.18;

    let hitRects = [];

    function draw() {
      const { ctx, w, h } = setupCanvas(canvas);
      const showLegend = !cfg.hideLegend && nGrp > 1;
      const pad = { left: 56, right: 16, top: showLegend ? 36 : 18, bottom: cfg.padBottom ?? 52 };
      const pw = w - pad.left - pad.right;
      const ph = h - pad.top - pad.bottom;
      const yOf = (v) => pad.top + ph - ((v - yMin) / Math.max(1e-9, yMax - yMin)) * ph;

      ctx.clearRect(0, 0, w, h);
      hitRects = [];

      // Grid
      const yTicks = niceTicks(yMin, yMax, 5);
      ctx.font = "11px JetBrains Mono, monospace";
      yTicks.forEach((tv) => {
        const y = yOf(tv);
        ctx.strokeStyle = "#e8eef5";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + pw, y);
        ctx.stroke();
        ctx.fillStyle = "#5b6f86";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(tv.toFixed(cfg.yDecimals ?? 1), pad.left - 7, y);
      });

      // Bars
      const slotW = pw / Math.max(1, nCat);
      const innerW = slotW * (nGrp === 1 ? 0.64 : 0.78);
      const barW = innerW / Math.max(1, nGrp);

      for (let c = 0; c < nCat; c++) {
        const slotLeft = pad.left + c * slotW + (slotW - innerW) / 2;
        for (let g = 0; g < nGrp; g++) {
          const grp = groups[g];
          const val = grp.values[c] ?? 0;
          const std = grp.stds ? grp.stds[c] || 0 : 0;
          const bx = slotLeft + g * barW;
          const by = yOf(val);
          const bh = Math.max(1, yOf(yMin) - by);
          const col = Array.isArray(grp.colors) ? grp.colors[c] : grp.color;

          ctx.fillStyle = col || "#1565c0";
          ctx.beginPath();
          ctx.roundRect ? ctx.roundRect(bx + 1, by, Math.max(2, barW - 2), bh, [4, 4, 0, 0]) : ctx.rect(bx + 1, by, Math.max(2, barW - 2), bh);
          ctx.fill();

          if (std > 0) {
            const cx = bx + barW / 2;
            const yTop = yOf(val + std);
            const yBot = yOf(Math.max(yMin, val - std));
            ctx.strokeStyle = "#1e293b";
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(cx, yTop);
            ctx.lineTo(cx, yBot);
            ctx.moveTo(cx - 4, yTop);
            ctx.lineTo(cx + 4, yTop);
            ctx.moveTo(cx - 4, yBot);
            ctx.lineTo(cx + 4, yBot);
            ctx.stroke();
          }

          if (cfg.showBarValues) {
            const cx = bx + barW / 2;
            const topY = yOf(val + std) - 4;
            ctx.fillStyle = "#0f253c";
            ctx.font = "700 10px JetBrains Mono, monospace";
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            const tag = grp.tags && grp.tags[c] ? ` ${grp.tags[c]}` : "";
            ctx.fillText(val.toFixed(cfg.valDecimals ?? 3), cx, topY - (tag ? 11 : 0));
            if (tag) {
              ctx.fillStyle = "#475569";
              ctx.fillText(tag.trim(), cx, topY);
            }
          }

          hitRects.push({
            x: bx,
            y: by - 8,
            w: barW,
            h: bh + 8,
            cat: categories[c].replace(/\n/g, " "),
            group: grp.label || "",
            val,
            std,
            tag: grp.tags ? grp.tags[c] : "",
            color: col,
          });
        }

        // Category label (multiline support)
        const lines = String(categories[c]).split("\n");
        ctx.fillStyle = "#334155";
        ctx.font = "600 10.5px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        lines.forEach((ln, li) => {
          ctx.fillText(ln, pad.left + c * slotW + slotW / 2, pad.top + ph + 6 + li * 13);
        });

        // Optional per-category top badge (e.g. pi_0 = C)
        if (cfg.categoryTags && cfg.categoryTags[c]) {
          const maxInCat = Math.max(...groups.map((g) => g.values[c] || 0));
          ctx.fillStyle = "#0f3a66";
          ctx.font = "700 10.8px JetBrains Mono, monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillText(cfg.categoryTags[c], pad.left + c * slotW + slotW / 2, yOf(maxInCat) - 5);
        }
      }

      // Horizontal reference line (e.g. Tit For Tat 2.560)
      (cfg.hLines || []).forEach((hl) => {
        const y = yOf(hl.y);
        ctx.save();
        ctx.strokeStyle = hl.color || "#0f253c";
        ctx.lineWidth = 1.3;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + pw, y);
        ctx.stroke();
        if (hl.label) {
          ctx.fillStyle = hl.color || "#0f253c";
          ctx.font = "600 10.5px Inter, sans-serif";
          ctx.textAlign = "right";
          ctx.textBaseline = "bottom";
          ctx.fillText(hl.label, pad.left + pw - 4, y - 3);
        }
        ctx.restore();
      });

      ctx.strokeStyle = "#cbd5e1";
      ctx.strokeRect(pad.left, pad.top, pw, ph);

      if (cfg.yLabel) {
        ctx.save();
        ctx.translate(8, pad.top + ph / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = "#334155";
        ctx.font = "600 11px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(cfg.yLabel, 0, 0);
        ctx.restore();
      }

      if (showLegend) {
        let lx = pad.left;
        const ly = 13;
        ctx.font = "600 10.8px Inter, sans-serif";
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        groups.forEach((g) => {
          const tw = ctx.measureText(g.label).width + 24;
          ctx.fillStyle = g.color;
          ctx.fillRect(lx, ly - 5, 11, 10);
          ctx.fillStyle = "#2c3e50";
          ctx.fillText(g.label, lx + 15, ly);
          lx += tw + 8;
        });
      }
    }

    draw();

    bindHover(canvas, (evt, mx, my) => {
      const hit = hitRects.find((r) => mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h);
      if (!hit) {
        hideTooltip();
        return;
      }
      const stdTxt = hit.std > 0 ? ` ± ${hit.std.toFixed(3)}` : "";
      const tagTxt = hit.tag ? `<div class="tt-row"><span>Posición</span><span>${hit.tag}</span></div>` : "";
      showTooltip(
        evt,
        `<div class="tt-title">${hit.cat}</div>
         <div class="tt-row"><span style="color:${hit.color}">■ ${hit.group || "Valor"}</span><span>${hit.val.toFixed(3)}${stdTxt}</span></div>
         ${tagTxt}`
      );
    });
  }

  // =========================================================================
  // 3. HORIZONTAL RANKING BAR CHART (Axelrod 1980, Harper 37, Mega 171)
  // =========================================================================
  function renderHorizontalBarChart(canvas, cfg) {
    if (!canvas) return;
    canvas._lastRender = () => renderHorizontalBarChart(canvas, cfg);

    const items = cfg.items || []; // [{ label, value, std, color, bold, meta }]
    const xMin = cfg.xMin ?? 0;
    const xMax = cfg.xMax ?? 3.2;
    let hitRows = [];

    function draw() {
      const { ctx, w, h } = setupCanvas(canvas);
      const pad = { left: cfg.padLeft ?? 168, right: 56, top: 10, bottom: 30 };
      const pw = Math.max(80, w - pad.left - pad.right);
      const ph = Math.max(80, h - pad.top - pad.bottom);
      const xOf = (v) => pad.left + ((Math.max(xMin, v) - xMin) / Math.max(1e-9, xMax - xMin)) * pw;

      ctx.clearRect(0, 0, w, h);
      hitRows = [];

      // Vertical grid
      const xTicks = niceTicks(xMin, xMax, 5);
      ctx.font = "10.5px JetBrains Mono, monospace";
      xTicks.forEach((tv) => {
        const x = xOf(tv);
        ctx.strokeStyle = "#e8eef5";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, pad.top + ph);
        ctx.stroke();
        ctx.fillStyle = "#5b6f86";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(tv.toFixed(1), x, pad.top + ph + 4);
      });

      const n = items.length;
      const rowH = ph / Math.max(1, n);
      const barH = Math.max(4, rowH * 0.72);

      items.forEach((it, idx) => {
        const cy = pad.top + idx * rowH + rowH / 2;
        const by = cy - barH / 2;
        const bx1 = xOf(it.value);
        const bw = Math.max(2, bx1 - pad.left);

        ctx.fillStyle = it.color || "#94a3b8";
        ctx.fillRect(pad.left, by, bw, barH);
        ctx.strokeStyle = "rgba(15,37,60,0.28)";
        ctx.lineWidth = 0.7;
        ctx.strokeRect(pad.left, by, bw, barH);

        if (it.std && it.std > 0) {
          const ex1 = xOf(it.value - it.std);
          const ex2 = xOf(it.value + it.std);
          ctx.strokeStyle = "#0f253c";
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(ex1, cy);
          ctx.lineTo(ex2, cy);
          ctx.moveTo(ex1, cy - 3);
          ctx.lineTo(ex1, cy + 3);
          ctx.moveTo(ex2, cy - 3);
          ctx.lineTo(ex2, cy + 3);
          ctx.stroke();
        }

        // Left label
        ctx.fillStyle = it.bold ? it.color : "#334155";
        ctx.font = `${it.bold ? "700" : "500"} ${n > 20 ? 10 : 10.8}px Inter, sans-serif`;
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        const trunc = it.label.length > 29 ? it.label.slice(0, 28) + "…" : it.label;
        ctx.fillText(trunc, pad.left - 7, cy);

        // Right value label
        if (cfg.showAllValues || it.bold || idx < 2 || idx === n - 1 || it.showValue) {
          const vx = xOf(it.value + (it.std || 0)) + 4;
          ctx.fillStyle = it.bold ? "#0f253c" : "#475569";
          ctx.font = `${it.bold ? "700" : "500"} 10px JetBrains Mono, monospace`;
          ctx.textAlign = "left";
          ctx.fillText(it.valueLabel || it.value.toFixed(3), vx, cy);
        }

        hitRows.push({ y: pad.top + idx * rowH, h: rowH, item: it });
      });

      ctx.strokeStyle = "#cbd5e1";
      ctx.strokeRect(pad.left, pad.top, pw, ph);

      if (cfg.xLabel) {
        ctx.fillStyle = "#334155";
        ctx.font = "600 10.8px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(cfg.xLabel, pad.left + pw / 2, h - 1);
      }
    }

    draw();

    bindHover(canvas, (evt, mx, my) => {
      const hit = hitRows.find((r) => my >= r.y && my <= r.y + r.h);
      if (!hit) {
        hideTooltip();
        return;
      }
      const it = hit.item;
      const stdStr = it.std ? ` ± ${it.std.toFixed(3)}` : "";
      const extra = it.extra ? `<div class="tt-row"><span>Detalle</span><span>${it.extra}</span></div>` : "";
      showTooltip(
        evt,
        `<div class="tt-title">${it.fullLabel || it.label}</div>
         <div class="tt-row"><span style="color:${it.color}">● Puntaje</span><span>${it.value.toFixed(3)}${stdStr} pts/r</span></div>
         ${extra}`
      );
    });
  }

  // =========================================================================
  // 4. BOXPLOT WITH JITTERED SEED DOTS (fig_torneos_10seeds_5agentes panel 6)
  // =========================================================================
  function renderBoxplotChart(canvas, cfg) {
    if (!canvas) return;
    canvas._lastRender = () => renderBoxplotChart(canvas, cfg);

    const groups = cfg.groups || []; // [{ label, color, values: [] }]
    const allV = groups.flatMap((g) => g.values || []);
    const yMin = cfg.yMin ?? Math.min(...allV) - 0.1;
    const yMax = cfg.yMax ?? Math.max(...allV) + 0.12;
    let hitBoxes = [];

    function quantile(sorted, q) {
      const pos = (sorted.length - 1) * q;
      const base = Math.floor(pos);
      const rest = pos - base;
      return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
    }

    function draw() {
      const { ctx, w, h } = setupCanvas(canvas);
      const pad = { left: 50, right: 16, top: 22, bottom: 48 };
      const pw = w - pad.left - pad.right;
      const ph = h - pad.top - pad.bottom;
      const yOf = (v) => pad.top + ph - ((v - yMin) / Math.max(1e-9, yMax - yMin)) * ph;

      ctx.clearRect(0, 0, w, h);
      hitBoxes = [];

      const yTicks = niceTicks(yMin, yMax, 5);
      ctx.font = "10.5px JetBrains Mono, monospace";
      yTicks.forEach((tv) => {
        const y = yOf(tv);
        ctx.strokeStyle = "#e8eef5";
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + pw, y);
        ctx.stroke();
        ctx.fillStyle = "#5b6f86";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(tv.toFixed(2), pad.left - 7, y);
      });

      const slotW = pw / Math.max(1, groups.length);
      const boxW = Math.min(44, slotW * 0.5);

      groups.forEach((g, idx) => {
        const vals = [...(g.values || [])].sort((a, b) => a - b);
        if (!vals.length) return;
        const cx = pad.left + idx * slotW + slotW / 2;
        const minV = vals[0];
        const maxV = vals[vals.length - 1];
        const q1 = quantile(vals, 0.25);
        const med = quantile(vals, 0.5);
        const q3 = quantile(vals, 0.75);
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);

        // Whiskers
        ctx.strokeStyle = "#334155";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(cx, yOf(minV));
        ctx.lineTo(cx, yOf(maxV));
        ctx.moveTo(cx - boxW * 0.32, yOf(minV));
        ctx.lineTo(cx + boxW * 0.32, yOf(minV));
        ctx.moveTo(cx - boxW * 0.32, yOf(maxV));
        ctx.lineTo(cx + boxW * 0.32, yOf(maxV));
        ctx.stroke();

        // Box Q1-Q3
        const yQ3 = yOf(q3);
        const yQ1 = yOf(q1);
        ctx.fillStyle = g.color;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(cx - boxW / 2, yQ3, boxW, Math.max(2, yQ1 - yQ3));
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#0f253c";
        ctx.lineWidth = 1.2;
        ctx.strokeRect(cx - boxW / 2, yQ3, boxW, Math.max(2, yQ1 - yQ3));

        // Median
        ctx.strokeStyle = "#0f253c";
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(cx - boxW / 2, yOf(med));
        ctx.lineTo(cx + boxW / 2, yOf(med));
        ctx.stroke();

        // Individual jittered seed dots
        g.values.forEach((v, sIdx) => {
          const offset = g.values.length > 1 ? ((sIdx / (g.values.length - 1)) - 0.5) * boxW * 0.65 : 0;
          ctx.beginPath();
          ctx.arc(cx + offset, yOf(v), 2.7, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(15, 37, 60, 0.72)";
          ctx.fill();
        });

        // White diamond mean marker
        const my = yOf(mean);
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#0f253c";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(cx, my - 4.5);
        ctx.lineTo(cx + 4.5, my);
        ctx.lineTo(cx, my + 4.5);
        ctx.lineTo(cx - 4.5, my);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Top mean ± std annotation
        ctx.fillStyle = "#0f253c";
        ctx.font = "700 9.8px JetBrains Mono, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        const annY = Math.max(pad.top + 18, yOf(maxV) - 5);
        ctx.fillText(mean.toFixed(3), cx, annY - 10);
        ctx.fillStyle = "#475569";
        ctx.fillText(`±${std.toFixed(3)}`, cx, annY);

        // X label
        const lines = String(g.label).split("\n");
        ctx.fillStyle = "#1e293b";
        ctx.font = "700 10px Inter, sans-serif";
        ctx.textBaseline = "top";
        lines.forEach((ln, li) => ctx.fillText(ln, cx, pad.top + ph + 6 + li * 12));

        hitBoxes.push({ x: cx - slotW / 2, w: slotW, g, mean, std, minV, maxV, med });
      });

      ctx.strokeStyle = "#cbd5e1";
      ctx.strokeRect(pad.left, pad.top, pw, ph);
    }

    draw();

    bindHover(canvas, (evt, mx) => {
      const hit = hitBoxes.find((b) => mx >= b.x && mx <= b.x + b.w);
      if (!hit) {
        hideTooltip();
        return;
      }
      const seedsHtml = hit.g.values
        .map((v, i) => `s${i}:${v.toFixed(3)}`)
        .join(" · ");
      showTooltip(
        evt,
        `<div class="tt-title">${hit.g.label.replace(/\n/g, " ")}</div>
         <div class="tt-row"><span>Media ± DE</span><span>${hit.mean.toFixed(3)} ± ${hit.std.toFixed(3)}</span></div>
         <div class="tt-row"><span>Min / Med / Max</span><span>${hit.minV.toFixed(3)} / ${hit.med.toFixed(3)} / ${hit.maxV.toFixed(3)}</span></div>
         <div style="margin-top:4px;font-size:10.5px;color:#cbd5e1;font-family:var(--font-mono)">${seedsHtml}</div>`
      );
    });
  }

  // =========================================================================
  // 5. INTERACTIVE HEATMAP (8x4 Matrices, Policy Mutation, Clickable H2H)
  // =========================================================================
  function colorYlGnBu(t) {
    const v = Math.max(0, Math.min(1, t));
    const stops = [
      [255, 255, 217],
      [199, 233, 180],
      [65, 182, 196],
      [34, 94, 168],
      [12, 44, 132],
    ];
    const scaled = v * (stops.length - 1);
    const idx = Math.min(stops.length - 2, Math.floor(scaled));
    const f = scaled - idx;
    const c0 = stops[idx];
    const c1 = stops[idx + 1];
    const r = Math.round(c0[0] + (c1[0] - c0[0]) * f);
    const g = Math.round(c0[1] + (c1[1] - c0[1]) * f);
    const b = Math.round(c0[2] + (c1[2] - c0[2]) * f);
    return `rgb(${r},${g},${b})`;
  }

  function colorPayoff(val, minV = 0.5, maxV = 3.5) {
    const t = Math.max(0, Math.min(1, (val - minV) / Math.max(1e-6, maxV - minV)));
    const stops = [
      [214, 48, 49],
      [245, 158, 11],
      [254, 249, 195],
      [74, 222, 128],
      [21, 128, 61],
    ];
    const scaled = t * (stops.length - 1);
    const idx = Math.min(stops.length - 2, Math.floor(scaled));
    const f = scaled - idx;
    const c0 = stops[idx];
    const c1 = stops[idx + 1];
    return `rgb(${Math.round(c0[0] + (c1[0] - c0[0]) * f)},${Math.round(c0[1] + (c1[1] - c0[1]) * f)},${Math.round(c0[2] + (c1[2] - c0[2]) * f)})`;
  }

  function renderHeatmap(canvas, cfg) {
    if (!canvas) return;
    canvas._lastRender = () => renderHeatmap(canvas, cfg);

    const matrix = cfg.matrix || [];
    const rowLabels = cfg.rowLabels || [];
    const colLabels = cfg.colLabels || [];
    const nRows = matrix.length;
    const nCols = nRows ? matrix[0].length : 0;
    const mode = cfg.mode || "prob"; // "prob" | "binary" | "payoff"

    let gridMeta = null;

    function draw() {
      const { ctx, w, h } = setupCanvas(canvas);
      const pad = {
        left: cfg.padLeft ?? (mode === "payoff" ? 132 : 76),
        right: 12,
        top: cfg.padTop ?? (mode === "payoff" ? 86 : 24),
        bottom: cfg.padBottom ?? 22,
      };
      const pw = Math.max(60, w - pad.left - pad.right);
      const ph = Math.max(60, h - pad.top - pad.bottom);
      const cw = pw / Math.max(1, nCols);
      const ch = ph / Math.max(1, nRows);
      gridMeta = { pad, cw, ch, nRows, nCols };

      ctx.clearRect(0, 0, w, h);

      for (let r = 0; r < nRows; r++) {
        for (let c = 0; c < nCols; c++) {
          const val = matrix[r][c];
          if (mode === "binary") {
            ctx.fillStyle = val === 1 ? "#2e7d32" : "#d32f2f";
          } else if (mode === "payoff") {
            ctx.fillStyle = colorPayoff(val, cfg.minVal ?? 0.5, cfg.maxVal ?? 3.3);
          } else {
            ctx.fillStyle = colorYlGnBu(val);
          }
          const x = pad.left + c * cw;
          const y = pad.top + r * ch;
          ctx.fillRect(x, y, cw + 0.4, ch + 0.4);

          if (cfg.showValues && cw >= 24 && ch >= 14) {
            const darkBg =
              mode === "binary" ||
              (mode === "prob" && val > 0.55) ||
              (mode === "payoff" && (val < 1.05 || val > 2.95));
            ctx.fillStyle = darkBg ? "#ffffff" : "#0f253c";
            ctx.font = `700 ${cw < 36 ? 9.5 : 10.8}px JetBrains Mono, monospace`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(val.toFixed(cfg.decimals ?? 2), x + cw / 2, y + ch / 2);
          }
        }
      }

      // Optional white divider lines (e.g., policy mutation rivals)
      (cfg.dividers || []).forEach((rowIdx) => {
        const y = pad.top + rowIdx * ch;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + pw, y);
        ctx.stroke();
      });

      // Row labels
      ctx.fillStyle = "#1e293b";
      ctx.font = `${nRows > 14 ? 9.5 : 10.5}px JetBrains Mono, monospace`;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      rowLabels.forEach((lbl, r) => {
        const txt = lbl.length > 21 ? lbl.slice(0, 20) + "…" : lbl;
        ctx.fillText(txt, pad.left - 6, pad.top + r * ch + ch / 2);
      });

      // Column labels
      if (mode === "payoff") {
        ctx.fillStyle = "#1e293b";
        ctx.font = "600 10px Inter, sans-serif";
        colLabels.forEach((lbl, c) => {
          ctx.save();
          ctx.translate(pad.left + c * cw + cw / 2, pad.top - 6);
          ctx.rotate(-Math.PI / 3.2);
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          const txt = lbl.length > 16 ? lbl.slice(0, 15) + "…" : lbl;
          ctx.fillText(txt, 0, 0);
          ctx.restore();
        });
      } else {
        ctx.fillStyle = "#334155";
        ctx.font = "700 10.5px JetBrains Mono, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = mode === "binary" ? "top" : "bottom";
        const step = nCols > 12 ? 5 : 1;
        for (let c = 0; c < nCols; c += step) {
          const yPos = mode === "binary" ? pad.top + ph + 5 : pad.top - 5;
          ctx.fillText(colLabels[c] ?? String(c + 1), pad.left + c * cw + cw / 2, yPos);
        }
      }

      ctx.strokeStyle = "#94a3b8";
      ctx.lineWidth = 1;
      ctx.strokeRect(pad.left, pad.top, pw, ph);
    }

    draw();

    bindHover(
      canvas,
      (evt, mx, my) => {
        if (!gridMeta) return;
        const { pad, cw, ch, nRows, nCols } = gridMeta;
        const c = Math.floor((mx - pad.left) / cw);
        const r = Math.floor((my - pad.top) / ch);
        if (r < 0 || r >= nRows || c < 0 || c >= nCols) {
          hideTooltip();
          return;
        }
        const val = matrix[r][c];
        const rName = rowLabels[r] || `Fila ${r}`;
        const cName = colLabels[c] || `Col ${c + 1}`;
        let valText = val.toFixed(3);
        if (mode === "binary") valText = val === 1 ? "Cooperar (C)" : "Traicionar (D)";
        const clickHint = cfg.onCellClick
          ? `<div style="margin-top:4px;font-size:10.5px;color:#7cc4fa">Clic para analizar este duelo 1v1 →</div>`
          : "";
        showTooltip(
          evt,
          `<div class="tt-title">${rName} × ${cName}</div>
           <div class="tt-row"><span>${cfg.valueLabel || "Valor"}</span><span>${valText}</span></div>
           ${clickHint}`
        );
      },
      null,
      cfg.onCellClick
        ? (evt, mx, my) => {
            if (!gridMeta) return;
            const { pad, cw, ch, nRows, nCols } = gridMeta;
            const c = Math.floor((mx - pad.left) / cw);
            const r = Math.floor((my - pad.top) / ch);
            if (r >= 0 && r < nRows && c >= 0 && c < nCols) {
              cfg.onCellClick(r, c);
            }
          }
        : null
    );
  }

  // =========================================================================
  // 6. INTERACTIVE SVG: GARY EXPECTIMAX TREE WITH LIVE NODE VALUES + MARKOV CHAIN
  // =========================================================================
  function renderGaryMarkovSVG(container, stateData) {
    if (!container) return;
    const E = stateData.E || [0.9, 0.85, 0.0, 0.0];
    const V = stateData.v_markov || [50, 30, 30, 20];
    const LH = stateData.leaf_h || [0, 0, 0, 0];
    const fc = stateData.f_c ?? 3.0;
    const fd = stateData.f_d ?? 1.2;
    const pCurrC = stateData.p_c ?? 0.5;
    const pCurrD = stateData.p_d ?? (1 - pCurrC);
    const valCC = stateData.val_cc ?? 3.0;
    const valCD = stateData.val_cd ?? 0.0;
    const valDC = stateData.val_dc ?? 5.0;
    const valDD = stateData.val_dd ?? 1.0;
    const currSt = stateData.current_state || "Apertura";
    const isOpening = Boolean(stateData.is_opening);
    const horizon = stateData.horizon ?? 4;
    const gamma = stateData.gamma ?? 0.95;
    const pcc = E[0].toFixed(2), qcc = (1 - E[0]).toFixed(2);
    const pcd = E[1].toFixed(2), qcd = (1 - E[1]).toFixed(2);
    const pdc = E[2].toFixed(2), qdc = (1 - E[2]).toFixed(2);
    const pdd = E[3].toFixed(2), qdd = (1 - E[3]).toFixed(2);
    const chooseC = fc >= fd;

    const Lgamma = 1 / Math.max(1e-6, 1 - gamma);
    const Lstr = Math.abs(Lgamma - Math.round(Lgamma)) < 0.05 ? String(Math.round(Lgamma)) : Lgamma.toFixed(1);
    const gammaH = Math.pow(gamma, horizon);

    container.innerHTML = `
      <svg viewBox="0 0 960 340" width="100%" style="max-height:345px;display:block;font-family:Inter,sans-serif">
        <defs>
          <marker id="arr-g" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#2e7d32"/>
          </marker>
          <marker id="arr-r" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#c62828"/>
          </marker>
        </defs>

        <!-- LEFT: PLAIN-LANGUAGE EXPLANATION OF h AND ÷ L_gamma -->
        <rect x="8" y="8" width="446" height="324" rx="12" fill="#f9fbfd" stroke="#d8e3ef"/>
        <text x="231" y="31" text-anchor="middle" font-size="12.5" font-weight="700" fill="#0f253c">
          ¿De dónde sale h y por qué dividimos por ${Lstr}?
        </text>

        <rect x="22" y="45" width="418" height="74" rx="9" fill="#ffffff" stroke="#e2e8f0"/>
        <text x="34" y="64" font-size="11" font-weight="700" fill="#5b21b6">1. Cola infinita desde el turno +${horizon + 1} (V_Markov)</text>
        <text x="34" y="82" font-size="10.2" fill="#334155">Después de la hoja s_${horizon}, suponemos que seguimos con reciprocidad (TFT)</text>
        <text x="34" y="97" font-size="10.2" fill="#334155">sobre la cadena P(Eₜ) de la derecha. Eso da la suma futura descontada:</text>
        <text x="34" y="112" font-size="10" font-family="JetBrains Mono,monospace" font-weight="700" fill="#0f253c">V = [CC:${V[0].toFixed(1)}, CD:${V[1].toFixed(1)}, DC:${V[2].toFixed(1)}, DD:${V[3].toFixed(1)}] pts</text>

        <rect x="22" y="129" width="418" height="72" rx="9" fill="#f5f3ff" stroke="#ddd6fe"/>
        <text x="34" y="148" font-size="11" font-weight="700" fill="#5b21b6">2. Traer esa cola al presente: h = γ^${horizon} · V_Markov</text>
        <text x="34" y="166" font-size="10.2" fill="#334155">Como la cola empieza ${horizon} turnos después, se multiplica por γ^${horizon} = ${gammaH.toFixed(2)}:</text>
        <text x="34" y="184" font-size="10" font-family="JetBrains Mono,monospace" font-weight="700" fill="#4c1d95">h = [CC:${LH[0].toFixed(1)}, CD:${LH[1].toFixed(1)}, DC:${LH[2].toFixed(1)}, DD:${LH[3].toFixed(1)}] pts</text>
        <text x="34" y="196" font-size="9.4" fill="#64748b">Se suma a los ${horizon} pasos explícitos: Total descontado = g + h.</text>

        <rect x="22" y="211" width="418" height="108" rx="9" fill="#ecfdf5" stroke="#86efac"/>
        <text x="34" y="230" font-size="11" font-weight="700" fill="#14532d">3. ¿Por qué (g + h) ÷ ${Lstr} = puntos por ronda (f̄)?</text>
        <text x="34" y="248" font-size="10.2" fill="#1e293b">Si ganaras 1 pt cada turno para siempre con descuento γ = ${gamma.toFixed(2)}:</text>
        <text x="34" y="266" font-size="10.2" font-family="JetBrains Mono,monospace" font-weight="700" fill="#166534">1 + ${gamma.toFixed(2)} + ${(gamma*gamma).toFixed(2)} + ... = 1 / (1 − ${gamma.toFixed(2)}) = ${Lstr} pts</text>
        <text x="34" y="285" font-size="10.2" fill="#1e293b">Por eso 3 pts/ronda para siempre suman ${(3*Lgamma).toFixed(1)} pts (g+h).</text>
        <text x="34" y="303" font-size="10.3" font-weight="700" fill="#14532d">Dividir por ${Lstr} (equiv. ×${(1-gamma).toFixed(2)}) devuelve el puntaje por ronda (0..5).</text>

        <!-- RIGHT: 4-STATE MARKOV CHAIN (P_TFT(E_t)) -->
        <rect x="468" y="8" width="484" height="324" rx="12" fill="#f9fbfd" stroke="#d8e3ef"/>
        <text x="710" y="30" text-anchor="middle" font-size="12.5" font-weight="700" fill="#0f253c">
          Cadena de Markov en Hojas: P_TFT(Eₜ)
        </text>

        <!-- Edges of P_TFT -->
        <path d="M 568 92 C 524 46, 620 46, 602 88" fill="none" stroke="#2e7d32" stroke-width="2" marker-end="url(#arr-g)"/>
        <rect x="537" y="42" width="74" height="17" rx="5" fill="#ffffff" stroke="#bbf7d0" stroke-width="1"/>
        <text x="574" y="54" text-anchor="middle" font-size="10" font-family="JetBrains Mono,monospace" font-weight="700" fill="#1b5e20">p_CC=${pcc}</text>

        <path d="M 622 114 L 774 114" fill="none" stroke="#c62828" stroke-width="1.8" marker-end="url(#arr-r)"/>
        <rect x="658" y="96" width="80" height="16" rx="5" fill="#ffffff" stroke="#fecaca" stroke-width="0.9"/>
        <text x="698" y="108" text-anchor="middle" font-size="9.8" font-family="JetBrains Mono,monospace" fill="#b71c1c">1−p_CC=${qcc}</text>

        <path d="M 784 142 L 622 224" fill="none" stroke="#2e7d32" stroke-width="1.8" marker-end="url(#arr-g)"/>
        <rect x="704" y="180" width="66" height="16" rx="5" fill="#ffffff" stroke="#bbf7d0" stroke-width="0.9"/>
        <text x="737" y="191" text-anchor="middle" font-size="9.8" font-family="JetBrains Mono,monospace" fill="#1b5e20">p_CD=${pcd}</text>

        <path d="M 818 148 L 818 212" fill="none" stroke="#c62828" stroke-width="1.8" marker-end="url(#arr-r)"/>
        <rect x="826" y="172" width="82" height="16" rx="5" fill="#ffffff" stroke="#fecaca" stroke-width="0.9"/>
        <text x="867" y="184" text-anchor="middle" font-size="9.8" font-family="JetBrains Mono,monospace" fill="#b71c1c">1−p_CD=${qcd}</text>

        <path d="M 586 212 L 586 148" fill="none" stroke="#2e7d32" stroke-width="1.8" marker-end="url(#arr-g)"/>
        <rect x="498" y="172" width="76" height="16" rx="5" fill="#ffffff" stroke="#bbf7d0" stroke-width="0.9"/>
        <text x="536" y="184" text-anchor="middle" font-size="9.8" font-family="JetBrains Mono,monospace" fill="#1b5e20">p_DC=${pdc}</text>

        <path d="M 620 214 L 780 134" fill="none" stroke="#c62828" stroke-width="1.4" stroke-dasharray="4,3" marker-end="url(#arr-r)"/>
        <rect x="624" y="152" width="80" height="16" rx="5" fill="#ffffff" stroke="#fecaca" stroke-width="0.9"/>
        <text x="664" y="164" text-anchor="middle" font-size="9.5" font-family="JetBrains Mono,monospace" fill="#991b1b">1−p_DC=${qdc}</text>

        <path d="M 774 248 L 622 248" fill="none" stroke="#2e7d32" stroke-width="1.8" marker-end="url(#arr-g)"/>
        <rect x="662" y="253" width="72" height="16" rx="5" fill="#ffffff" stroke="#bbf7d0" stroke-width="0.9"/>
        <text x="698" y="264" text-anchor="middle" font-size="9.8" font-family="JetBrains Mono,monospace" fill="#1b5e20">p_DD=${pdd}</text>

        <path d="M 848 264 C 902 308, 912 222, 858 236" fill="none" stroke="#c62828" stroke-width="2" marker-end="url(#arr-r)"/>
        <rect x="854" y="274" width="84" height="17" rx="5" fill="#ffffff" stroke="#fecaca" stroke-width="0.9"/>
        <text x="896" y="286" text-anchor="middle" font-size="9.8" font-family="JetBrains Mono,monospace" font-weight="700" fill="#b71c1c">1−p_DD=${qdd}</text>

        <!-- 4 State Nodes with V_Markov and leaf_h -->
        <g transform="translate(586,116)">
          <circle r="34" fill="#dcfce7" stroke="${currSt === "CC" ? "#0f253c" : "#2e7d32"}" stroke-width="${currSt === "CC" ? 3.5 : 2}"/>
          <text y="-9" text-anchor="middle" font-size="11.5" font-weight="700" fill="#14532d">CC</text>
          <text y="6" text-anchor="middle" font-size="9.5" font-family="JetBrains Mono,monospace" fill="#166534">V=${V[0].toFixed(1)}</text>
          <text y="19" text-anchor="middle" font-size="9" font-family="JetBrains Mono,monospace" fill="#334155">h=${LH[0].toFixed(1)}</text>
        </g>

        <g transform="translate(818,116)">
          <circle r="34" fill="#fee2e2" stroke="${currSt === "CD" ? "#0f253c" : "#c62828"}" stroke-width="${currSt === "CD" ? 3.5 : 2}"/>
          <text y="-9" text-anchor="middle" font-size="11.5" font-weight="700" fill="#7f1d1d">CD</text>
          <text y="6" text-anchor="middle" font-size="9.5" font-family="JetBrains Mono,monospace" fill="#991b1b">V=${V[1].toFixed(1)}</text>
          <text y="19" text-anchor="middle" font-size="9" font-family="JetBrains Mono,monospace" fill="#334155">h=${LH[1].toFixed(1)}</text>
        </g>

        <g transform="translate(586,246)">
          <circle r="34" fill="#dbeafe" stroke="${currSt === "DC" ? "#0f253c" : "#1565c0"}" stroke-width="${currSt === "DC" ? 3.5 : 2}"/>
          <text y="-9" text-anchor="middle" font-size="11.5" font-weight="700" fill="#1e3a8a">DC</text>
          <text y="6" text-anchor="middle" font-size="9.5" font-family="JetBrains Mono,monospace" fill="#1d4ed8">V=${V[2].toFixed(1)}</text>
          <text y="19" text-anchor="middle" font-size="9" font-family="JetBrains Mono,monospace" fill="#334155">h=${LH[2].toFixed(1)}</text>
        </g>

        <g transform="translate(818,246)">
          <circle r="34" fill="#ffedd5" stroke="${currSt === "DD" ? "#0f253c" : "#ef6c00"}" stroke-width="${currSt === "DD" ? 3.5 : 2}"/>
          <text y="-9" text-anchor="middle" font-size="11.5" font-weight="700" fill="#7c2d12">DD</text>
          <text y="6" text-anchor="middle" font-size="9.5" font-family="JetBrains Mono,monospace" fill="#c2410c">V=${V[3].toFixed(1)}</text>
          <text y="19" text-anchor="middle" font-size="9" font-family="JetBrains Mono,monospace" fill="#334155">h=${LH[3].toFixed(1)}</text>
        </g>

        <text x="710" y="318" text-anchor="middle" font-size="10.2" fill="#475569">
          V = (I − γP)⁻¹PR  ·  h = γ^${horizon} · V  ·  Borde negro = estado actual (${currSt})
        </text>
      </svg>
    `;
  }

  function renderGaryFullTreeH2SVG(container, stepData, gamma, opts) {
    if (!container) return;
    const g = gamma != null ? gamma : 0.90;
    const turn = stepData && stepData.turn ? stepData.turn : 1;
    const focus = (opts && opts.focusStep) || "all";
    const selectedLeafIdx = opts && opts.selectedLeafIdx != null ? opts.selectedLeafIdx : null;
    const onSelectLeaf = opts && typeof opts.onSelectLeaf === "function" ? opts.onSelectLeaf : null;

    if (!stepData || stepData.is_opening) {
      container.innerHTML = `
        <div style="padding:14px 16px;font-size:13px;color:#475569;text-align:center">
          <strong>Turno 1 (Apertura Nice):</strong> Sin historial previo, Gary abre directamente con <strong>Cooperar ($C$)</strong>. Avanza al <strong>Turno 2</strong> o posterior para ver el árbol Expectimax completo de 16 hojas ($H=2$).
        </div>`;
      return;
    }

    const tree = stepData.tree_h2;
    if (!tree || !tree.level1 || tree.level1.length !== 4) {
      const h = stepData.horizon || 4;
      container.innerHTML = `
        <div style="padding:14px 16px;font-size:13px;color:#475569;text-align:center">
          Con <strong>H = ${h}</strong> el árbol tiene <strong>${Math.pow(4, h)} hojas</strong>. Selecciona <strong>H = 2</strong> arriba para desplegar el árbol Expectimax completo de <strong>16 hojas</strong> en pantalla.
        </div>`;
      return;
    }

    const fc = stepData.f_c != null ? stepData.f_c : 0;
    const fd = stepData.f_d != null ? stepData.f_d : 0;
    const chooseC = fc >= fd;
    const p0 = tree.p_c != null ? tree.p_c : 0;
    const q0 = 1 - p0;
    const Lgamma = 1 / Math.max(1e-6, 1 - g);
    const Lstr = Math.abs(Lgamma - Math.round(Lgamma)) < 0.05 ? String(Math.round(Lgamma)) : Lgamma.toFixed(1);

    // Stage opacity helpers for interactive 4-step walkthrough
    const opProbs  = focus === "all" || focus === "probs" || focus === "up" ? 1 : 0.28;
    const opDown   = focus === "all" || focus === "down"  || focus === "up" ? 1 : 0.30;
    const opLeaves = focus === "all" || focus === "leaves" || focus === "down" ? 1 : 0.34;
    const opUp     = focus === "all" || focus === "up" ? 1 : 0.36;

    const palette = {
      CC: { fill: "#dcfce7", stroke: "#2e7d32", text: "#14532d" },
      CD: { fill: "#fee2e2", stroke: "#dc2626", text: "#7f1d1d" },
      DC: { fill: "#dbeafe", stroke: "#1d4ed8", text: "#1e3a8a" },
      DD: { fill: "#ffedd5", stroke: "#ea580c", text: "#7c2d12" },
    };

    // Shift entire tree +82px right to leave a clean LEFT RAIL for stage labels (viewBox 0 0 1082 486)
    const OX = 82;
    const l1Centers = [136 + OX, 376 + OX, 624 + OX, 864 + OX];
    const leafCenters = [
      46, 106, 166, 226,
      286, 346, 406, 466,
      534, 594, 654, 714,
      774, 834, 894, 954,
    ].map((x) => x + OX);

    let edgesSvg = "";
    let probBadgesSvg = "";
    let nodesSvg = "";

    // Root -> Root CHANCE (C / D)
    edgesSvg += `<line x1="${450 + OX}" y1="74" x2="${256 + OX}" y2="106" stroke="${chooseC ? "#2e7d32" : "#cbd5e1"}" stroke-width="${chooseC ? 3.2 : 1.5}" opacity="${opUp}"/>`;
    edgesSvg += `<line x1="${550 + OX}" y1="74" x2="${744 + OX}" y2="106" stroke="${!chooseC ? "#c62828" : "#cbd5e1"}" stroke-width="${!chooseC ? 3.2 : 1.5}" opacity="${opUp}"/>`;

    const rootChanceX = [256 + OX, 256 + OX, 744 + OX, 744 + OX];
    const rootBranchChosen = [chooseC, chooseC, !chooseC, !chooseC];
    const rootEdgeProb = [p0, q0, p0, q0];
    const rootEdgeColor = ["#16a34a", "#dc2626", "#16a34a", "#dc2626"];

    tree.level1.forEach((n1, i) => {
      const cx1 = l1Centers[i];
      const rx = rootChanceX[i];
      const onBestRoot = rootBranchChosen[i];
      const pEdge = rootEdgeProb[i];
      const stPal = palette[n1.s1] || palette.CC;
      const isReachable = pEdge > 0.0001;

      // Edge from Root CHANCE to L1 MAX
      edgesSvg += `<line x1="${rx}" y1="146" x2="${cx1}" y2="188" stroke="${onBestRoot ? rootEdgeColor[i] : "#cbd5e1"}" stroke-width="${onBestRoot ? 2.4 : 1.2}" stroke-dasharray="${isReachable ? "none" : "4,3"}" opacity="${Math.max(opProbs, opDown)}"/>`;

      // Crisp white pill badge for Rival C / Rival D probability (ZERO overlap with edge!)
      const mx = (rx + cx1) / 2;
      const my = 166;
      const pillBorder = focus === "probs" ? "#7b3fa0" : onBestRoot ? rootEdgeColor[i] : "#cbd5e1";
      probBadgesSvg += `
        <g opacity="${opProbs}">
          <rect x="${mx - 31}" y="${my - 13}" width="62" height="25" rx="6" fill="#ffffff" stroke="${pillBorder}" stroke-width="${focus === "probs" ? 1.8 : 1}"/>
          <text x="${mx}" y="${my - 2}" text-anchor="middle" font-size="8.2" font-weight="700" fill="${i % 2 === 0 ? "#166534" : "#991b1b"}">${i % 2 === 0 ? "Rival C" : "Rival D"}</text>
          <text x="${mx}" y="${my + 8.5}" text-anchor="middle" font-size="8.4" font-family="JetBrains Mono,monospace" font-weight="700" fill="#0f253c">×${pEdge.toFixed(2)}</text>
        </g>`;

      // L1 MAX Node Box
      nodesSvg += `
        <g opacity="${Math.max(opDown, opUp)}">
          <rect x="${cx1 - 60}" y="188" width="120" height="48" rx="8" fill="${stPal.fill}" stroke="${onBestRoot ? stPal.stroke : "#cbd5e1"}" stroke-width="${onBestRoot ? 2.2 : 1.1}"/>
          <text x="${cx1}" y="203" text-anchor="middle" font-size="10" font-weight="700" fill="${stPal.text}">MAX · ${n1.s1} (r₁=+${n1.r1})</text>
          <text x="${cx1}" y="217" text-anchor="middle" font-size="9.4" font-family="JetBrains Mono,monospace" font-weight="700" fill="#0f253c">mejor ${n1.chosen}: ${n1.val.toFixed(2)}</text>
          <text x="${cx1}" y="230" text-anchor="middle" font-size="8.5" font-family="JetBrains Mono,monospace" fill="${focus === "probs" ? "#5b21b6" : "#475569"}" font-weight="${focus === "probs" ? "700" : "400"}">p(C|${n1.s1})=${n1.p_c.toFixed(2)}</text>
        </g>`;

      // Two L1 CHANCE children: C and D
      const chCxC = (leafCenters[i * 4] + leafCenters[i * 4 + 1]) / 2;
      const chCxD = (leafCenters[i * 4 + 2] + leafCenters[i * 4 + 3]) / 2;
      const chooseL1C = n1.chosen === "C";
      const actCActive = onBestRoot && chooseL1C;
      const actDActive = onBestRoot && !chooseL1C;

      edgesSvg += `<line x1="${cx1 - 24}" y1="236" x2="${chCxC}" y2="270" stroke="${actCActive ? "#2e7d32" : chooseL1C ? "#86efac" : "#e2e8f0"}" stroke-width="${actCActive ? 2.4 : 1.2}" opacity="${Math.max(opDown, opUp)}"/>`;
      edgesSvg += `<line x1="${cx1 + 24}" y1="236" x2="${chCxD}" y2="270" stroke="${actDActive ? "#c62828" : !chooseL1C ? "#fca5a5" : "#e2e8f0"}" stroke-width="${actDActive ? 2.4 : 1.2}" opacity="${Math.max(opDown, opUp)}"/>`;

      nodesSvg += `
        <g opacity="${opUp}">
          <rect x="${chCxC - 45}" y="270" width="90" height="32" rx="14" fill="${actCActive ? "#e8f5e9" : "#f8fafc"}" stroke="${actCActive ? "#2e7d32" : chooseL1C ? "#86efac" : "#cbd5e1"}" stroke-width="${actCActive ? 2 : 1}"/>
          <text x="${chCxC}" y="283" text-anchor="middle" font-size="9" font-weight="700" fill="${chooseL1C ? "#166534" : "#64748b"}">${chooseL1C ? "✓ " : ""}A₂=C</text>
          <text x="${chCxC}" y="296" text-anchor="middle" font-size="9.2" font-family="JetBrains Mono,monospace" font-weight="700" fill="#0f253c">${n1.exp_c.toFixed(2)} pts/r</text>
        </g>
        <g opacity="${opUp}">
          <rect x="${chCxD - 45}" y="270" width="90" height="32" rx="14" fill="${actDActive ? "#ffebee" : "#f8fafc"}" stroke="${actDActive ? "#c62828" : !chooseL1C ? "#fca5a5" : "#cbd5e1"}" stroke-width="${actDActive ? 2 : 1}"/>
          <text x="${chCxD}" y="283" text-anchor="middle" font-size="9" font-weight="700" fill="${!chooseL1C ? "#991b1b" : "#64748b"}">${!chooseL1C ? "✓ " : ""}A₂=D</text>
          <text x="${chCxD}" y="296" text-anchor="middle" font-size="9.2" font-family="JetBrains Mono,monospace" font-weight="700" fill="#0f253c">${n1.exp_d.toFixed(2)} pts/r</text>
        </g>`;

      // 4 Terminal Leaves under this L1 MAX node (explicit g, +h, =Total, ÷L_gamma, f̄!)
      const p1 = n1.p_c;
      const q1 = 1 - p1;
      n1.leaves.forEach((lf, j) => {
        const lIdx = i * 4 + j;
        const lx = leafCenters[lIdx];
        const parentX = j < 2 ? chCxC : chCxD;
        const leafProb = j % 2 === 0 ? p1 : q1;
        const isActiveLeaf = (j < 2 && actCActive) || (j >= 2 && actDActive);
        const isSelected = selectedLeafIdx === lIdx;
        const lPal = palette[lf.s2] || palette.CC;
        const tot = lf.g + lf.h;

        edgesSvg += `<line x1="${parentX}" y1="302" x2="${lx}" y2="338" stroke="${isActiveLeaf ? (j % 2 === 0 ? "#16a34a" : "#dc2626") : "#e2e8f0"}" stroke-width="${isActiveLeaf ? 1.8 : 1}" stroke-dasharray="${leafProb > 0.0001 ? "none" : "3,3"}" opacity="${Math.max(opProbs, opDown)}"/>`;

        const pmx = (parentX + lx) / 2;
        probBadgesSvg += `
          <g opacity="${opProbs}">
            <rect x="${pmx - 15}" y="312" width="30" height="13" rx="4" fill="#ffffff" stroke="${focus === "probs" ? "#7b3fa0" : "#e2e8f0"}" stroke-width="${focus === "probs" ? 1.2 : 0.7}"/>
            <text x="${pmx}" y="321.5" text-anchor="middle" font-size="7.8" font-family="JetBrains Mono,monospace" font-weight="${isActiveLeaf || focus === "probs" ? "700" : "400"}" fill="${isActiveLeaf ? "#0f253c" : "#64748b"}">${leafProb.toFixed(2)}</text>
          </g>`;

        nodesSvg += `
          <g class="gary-leaf-node" data-leaf-idx="${lIdx}" style="cursor:pointer" opacity="${isSelected ? 1 : opLeaves}">
            <rect x="${lx - 27}" y="338" width="54" height="106" rx="7" fill="${isSelected || isActiveLeaf ? lPal.fill : "#f8fafc"}" stroke="${isSelected ? "#0f253c" : isActiveLeaf ? lPal.stroke : "#cbd5e1"}" stroke-width="${isSelected ? 2.6 : isActiveLeaf ? 1.8 : 1}"/>
            <text x="${lx}" y="352" text-anchor="middle" font-size="9.5" font-weight="700" fill="${isSelected || isActiveLeaf ? lPal.text : "#475569"}">${lf.s2}</text>
            <text x="${lx}" y="367" text-anchor="middle" font-size="8.0" font-family="JetBrains Mono,monospace" font-weight="${focus === "down" ? "700" : "400"}" fill="${focus === "down" ? "#0f3a66" : "#334155"}">g=${lf.g.toFixed(1)}</text>
            <text x="${lx}" y="380" text-anchor="middle" font-size="8.0" font-family="JetBrains Mono,monospace" font-weight="${focus === "leaves" ? "700" : "400"}" fill="#6b21a8">+h=${lf.h.toFixed(1)}</text>
            <line x1="${lx - 21}" y1="387" x2="${lx + 21}" y2="387" stroke="#94a3b8" stroke-width="0.8"/>
            <text x="${lx}" y="399" text-anchor="middle" font-size="8.2" font-family="JetBrains Mono,monospace" font-weight="700" fill="#334155">=${tot.toFixed(1)}</text>
            <text x="${lx}" y="413" text-anchor="middle" font-size="7.4" font-family="JetBrains Mono,monospace" fill="#64748b">÷${Lstr} ↓</text>
            <text x="${lx}" y="431" text-anchor="middle" font-size="9.8" font-family="JetBrains Mono,monospace" font-weight="700" fill="${isSelected || isActiveLeaf ? "#0f253c" : "#475569"}">${lf.f.toFixed(2)}</text>
          </g>`;
      });
    });

    // LEFT RAIL stage guide boxes
    const railSvg = `
      <g>
        <rect x="10" y="34" width="76" height="40" rx="7" fill="#eff6ff" stroke="#0f3a66" stroke-width="1.2"/>
        <text x="48" y="49" text-anchor="middle" font-size="8.4" font-weight="700" fill="#0f3a66">HOY (MAX)</text>
        <text x="48" y="63" text-anchor="middle" font-size="7.5" fill="#475569">Elijo A₁</text>

        <rect x="10" y="106" width="76" height="40" rx="7" fill="#f8fafc" stroke="#64748b" stroke-width="1.1"/>
        <text x="48" y="121" text-anchor="middle" font-size="8.3" font-weight="700" fill="#334155">AZAR 1</text>
        <text x="48" y="135" text-anchor="middle" font-size="7.3" fill="#64748b">Promedia ×p</text>

        <rect x="10" y="188" width="76" height="48" rx="7" fill="#eff6ff" stroke="#1d4ed8" stroke-width="1.1"/>
        <text x="48" y="203" text-anchor="middle" font-size="8.3" font-weight="700" fill="#1e40af">TURNO +1</text>
        <text x="48" y="216" text-anchor="middle" font-size="7.3" fill="#475569">Sumo +r₁</text>
        <text x="48" y="228" text-anchor="middle" font-size="7.3" fill="#475569">y elijo A₂</text>

        <rect x="10" y="270" width="76" height="32" rx="7" fill="#f8fafc" stroke="#64748b" stroke-width="1.1"/>
        <text x="48" y="284" text-anchor="middle" font-size="8.3" font-weight="700" fill="#334155">AZAR 2</text>
        <text x="48" y="296" text-anchor="middle" font-size="7.2" fill="#64748b">Promedia ×p</text>

        <rect x="10" y="338" width="76" height="106" rx="7" fill="#f5f3ff" stroke="#6b21a8" stroke-width="1.3"/>
        <text x="48" y="354" text-anchor="middle" font-size="8.4" font-weight="700" fill="#5b21b6">HOJAS (+2)</text>
        <text x="48" y="370" text-anchor="middle" font-size="7.4" fill="#334155">g = r₁+γr₂</text>
        <text x="48" y="384" text-anchor="middle" font-size="7.4" fill="#6b21a8">+ h (Markov)</text>
        <text x="48" y="399" text-anchor="middle" font-size="7.6" font-weight="700" fill="#334155">= Total pts</text>
        <text x="48" y="414" text-anchor="middle" font-size="7.3" fill="#64748b">÷ ${Lstr} (×${(1-g).toFixed(2)})</text>
        <text x="48" y="431" text-anchor="middle" font-size="8.0" font-weight="700" fill="#0f253c">= pts/ronda</text>
      </g>`;

    const rootCLine = `f̄(C) = ${p0.toFixed(2)}×${tree.level1[0].val.toFixed(2)} + ${q0.toFixed(2)}×${tree.level1[1].val.toFixed(2)} = ${fc.toFixed(3)}`;
    const rootDLine = `f̄(D) = ${p0.toFixed(2)}×${tree.level1[2].val.toFixed(2)} + ${q0.toFixed(2)}×${tree.level1[3].val.toFixed(2)} = ${fd.toFixed(3)}`;

    container.innerHTML = `
      <svg viewBox="0 0 1082 476" width="100%" style="display:block;font-family:Inter,sans-serif">
        <rect x="3" y="3" width="1076" height="470" rx="12" fill="#fcfdff" stroke="#d8e3ef"/>
        <text x="541" y="23" text-anchor="middle" font-size="12.5" font-weight="700" fill="#0f253c">
          Árbol Expectimax Completo (H = 2 · 16 Hojas · γ = ${g.toFixed(2)} · divisor 1/(1−γ) = ${Lstr}) — Turno ${turn}
        </text>

        ${railSvg}
        ${edgesSvg}

        <!-- Root MAX -->
        <g opacity="${opUp}">
          <rect x="${380 + OX}" y="34" width="240" height="40" rx="9" fill="#0f3a66"/>
          <text x="${500 + OX}" y="50" text-anchor="middle" font-size="11" font-weight="700" fill="#ffffff">
            RAÍZ MAX · Estado hoy: ${tree.root_state} → Elige ${chooseC ? "C" : "D"}
          </text>
          <text x="${500 + OX}" y="65" text-anchor="middle" font-size="9.6" font-family="JetBrains Mono,monospace" fill="#93c5fd">
            p(C|${tree.root_state})=${p0.toFixed(2)}  |  p(D)=${q0.toFixed(2)}
          </text>
        </g>

        <!-- Root CHANCE C -->
        <g opacity="${opUp}">
          <rect x="${146 + OX}" y="106" width="220" height="40" rx="16" fill="${chooseC ? "#e8f5e9" : "#f1f5f9"}" stroke="${chooseC ? "#2e7d32" : "#94a3b8"}" stroke-width="${chooseC ? 2.4 : 1.1}"/>
          <text x="${256 + OX}" y="121" text-anchor="middle" font-size="10.2" font-weight="700" fill="${chooseC ? "#1b5e20" : "#475569"}">${chooseC ? "✓ " : ""}A₁ = Cooperar (C)</text>
          <text x="${256 + OX}" y="137" text-anchor="middle" font-size="9.2" font-family="JetBrains Mono,monospace" font-weight="700" fill="#0f253c">${rootCLine}</text>
        </g>

        <!-- Root CHANCE D -->
        <g opacity="${opUp}">
          <rect x="${634 + OX}" y="106" width="220" height="40" rx="16" fill="${!chooseC ? "#ffebee" : "#f1f5f9"}" stroke="${!chooseC ? "#c62828" : "#94a3b8"}" stroke-width="${!chooseC ? 2.4 : 1.1}"/>
          <text x="${744 + OX}" y="121" text-anchor="middle" font-size="10.2" font-weight="700" fill="${!chooseC ? "#b71c1c" : "#475569"}">${!chooseC ? "✓ " : ""}A₁ = Traicionar (D)</text>
          <text x="${744 + OX}" y="137" text-anchor="middle" font-size="9.2" font-family="JetBrains Mono,monospace" font-weight="700" fill="#0f253c">${rootDLine}</text>
        </g>

        ${nodesSvg}
        ${probBadgesSvg}

        <text x="541" y="463" text-anchor="middle" font-size="10" fill="#475569">
          Haz clic en cualquiera de las 16 hojas para ver su cuenta exacta paso a paso aquí abajo (bajar g → sumar cola h → dividir por ${Lstr} = pts/ronda).
        </text>
      </svg>`;

    if (onSelectLeaf) {
      container.querySelectorAll(".gary-leaf-node").forEach((el) => {
        el.addEventListener("click", () => {
          onSelectLeaf(parseInt(el.dataset.leafIdx, 10));
        });
      });
    }
  }

  // Responsive redraw on window resize
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      document.querySelectorAll("canvas").forEach((cv) => {
        if (cv._lastRender && cv.offsetParent !== null) cv._lastRender();
      });
    }, 140);
  });

  window.T5Charts = {
    renderLineChart,
    renderVerticalBarChart,
    renderHorizontalBarChart,
    renderBoxplotChart,
    renderHeatmap,
    renderGaryMarkovSVG,
    renderGaryFullTreeH2SVG,
  };
})();
