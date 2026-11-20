/**
 * voxel.js — Original Blocky Voxel (Minecraft-inspired) Character Renderer,
 * Illuminated Diamond Payoff Stage, Token History Track & Axelrod Round-Robin Ring.
 */

(function () {
  // Unique blocky skins & headgear per strategy
  const VOXEL_SKINS = {
    human: { tunic: "#0ea5e9", pants: "#1e3a8a", skin: "#f5d0b5", hair: "#4a321f", hat: "headband", hatCol: "#eab308", accent: "#38bdf8", badge: "Jugador Humano" },
    axl_TitForTat: { tunic: "#2563eb", pants: "#1e293b", skin: "#f6d7bf", hair: "#3b2f2f", hat: "beanie", hatCol: "#38bdf8", accent: "#60a5fa", badge: "Nice · Recíproca" },
    axl_FirstByTidemanAndChieruzzi: { tunic: "#d97706", pants: "#334155", skin: "#f4d1b4", hair: "#475569", hat: "hardhat", hatCol: "#facc15", accent: "#fbbf24", badge: "Nice · Reconciliadora" },
    axl_FirstByNydegger: { tunic: "#475569", pants: "#1e293b", skin: "#f3cfb3", hair: "#94a3b8", hat: "beard", hatCol: "#cbd5e1", accent: "#94a3b8", badge: "Nice · Memoria-3" },
    axl_FirstByGrofman: { tunic: "#7c3aed", pants: "#312e81", skin: "#f7d9c2", hair: "#27272a", hat: "beret", hatCol: "#9333ea", accent: "#c084fc", badge: "Nice · Tolerante" },
    axl_FirstByShubik: { tunic: "#059669", pants: "#064e3b", skin: "#f5d2b8", hair: "#1f2937", hat: "party", hatCol: "#10b981", accent: "#34d399", badge: "Nice · Escalonada" },
    axl_FirstBySteinAndRapoport: { tunic: "#334155", pants: "#0f172a", skin: "#f5d0b5", hair: "#1e293b", hat: "bowler", hatCol: "#1e293b", accent: "#64748b", badge: "Nice · Estadística" },
    axl_Grudger: { tunic: "#1f2937", pants: "#111827", skin: "#f2cbb0", hair: "#111827", hat: "hood", hatCol: "#374151", accent: "#ef4444", badge: "Nice · Rencorosa" },
    axl_FirstByDavis: { tunic: "#4d7c0f", pants: "#365314", skin: "#f3ceb2", hair: "#5c3d28", hat: "cowboy", hatCol: "#92400e", accent: "#a16207", badge: "Nice · Paciente" },
    axl_FirstByGraaskamp: { tunic: "#b45309", pants: "#451a03", skin: "#f5d2b8", hair: "#78350f", hat: "detective", hatCol: "#a16207", accent: "#d97706", badge: "Nasty · Sondeadora" },
    axl_FirstByDowning: { tunic: "#3f3f46", pants: "#18181b", skin: "#f2ccb2", hair: "#27272a", hat: "fedora", hatCol: "#27272a", accent: "#71717a", badge: "Nasty · Pesimista" },
    axl_FirstByFeld: { tunic: "#dc2626", pants: "#1e293b", skin: "#f6d7bf", hair: "#3f2c1e", hat: "cap", hatCol: "#ef4444", accent: "#fca5a5", badge: "Nasty · Decreciente" },
    axl_FirstByJoss: { tunic: "#ca8a04", pants: "#422006", skin: "#f5d3ba", hair: "#52525b", hat: "glasses", hatCol: "#38bdf8", accent: "#facc15", badge: "Nasty · Sigilosa 10%" },
    axl_FirstByTullock: { tunic: "#1d4ed8", pants: "#172554", skin: "#f3cfb4", hair: "#1e3a8a", hat: "tallhat", hatCol: "#1e3a8a", accent: "#60a5fa", badge: "Nasty · Recortadora" },
    axl_FirstByAnonymous: { tunic: "#9a3412", pants: "#431407", skin: "#f5d0b5", hair: "#292524", hat: "straw", hatCol: "#eab308", accent: "#fb923c", badge: "Nasty · Variable" },
    axl_Random: { tunic: "#db2777", pants: "#4c1d95", skin: "#f7d9c2", hair: "#f59e0b", hat: "jester", hatCol: "#ec4899", accent: "#facc15", badge: "Nasty · Aleatoria" },
    axl_Defector: { tunic: "#991b1b", pants: "#450a0a", skin: "#efc7ab", hair: "#18181b", hat: "crown_red", hatCol: "#dc2626", accent: "#f87171", badge: "Nasty · Siempre D" },
    axl_Cooperator: { tunic: "#16a34a", pants: "#14532d", skin: "#f7dac4", hair: "#713f12", hat: "wreath", hatCol: "#4ade80", accent: "#86efac", badge: "Nice · Siempre C" },
    axl_Alternator: { tunic: "#0284c7", pants: "#991b1b", skin: "#f5d1b6", hair: "#334155", hat: "split", hatCol: "#22c55e", accent: "#ef4444", badge: "Cíclica · C-D-C-D" },
    rival_switch_50: { tunic: "#b91c1c", pants: "#166534", skin: "#f5d1b6", hair: "#1e293b", hat: "split", hatCol: "#16a34a", accent: "#dc2626", badge: "No Estacionaria C→D" },
    rival_3phase: { tunic: "#7e22ce", pants: "#1e293b", skin: "#f5d1b6", hair: "#4c1d95", hat: "crown_purple", hatCol: "#a855f7", accent: "#38bdf8", badge: "3 Fases C−D−C" },
    gen1_rulito: { species: "fiorino_canary", tunic: "#facc15", pants: "#ca8a04", skin: "#fde047", hair: "#a16207", hat: "fiorino", hatCol: "#fef08a", accent: "#fb923c", badge: "Gen 1 · Canario Fiorino" },
    gen2_cloud: { species: "budgie_blue", tunic: "#38bdf8", pants: "#0284c7", skin: "#ffffff", hair: "#e2e8f0", hat: "budgie_b", hatCol: "#38bdf8", accent: "#0ea5e9", badge: "Gen 2 · Periquito Blanco/Azul" },
    gen3_gary: { species: "black_dog", tunic: "#1e293b", pants: "#0f172a", skin: "#1e293b", hair: "#0f172a", hat: "dog_ears", hatCol: "#0f172a", accent: "#ffffff", badge: "Gen 3 · Perro Negro/Blanco" },
    gen4_base: { tunic: "#1565c0", pants: "#0f253c", skin: "#f5d2b8", hair: "#1e3a8a", hat: "blueprint", hatCol: "#38bdf8", accent: "#93c5fd", badge: "Gen 4 · Base CDDC" },
    gen5_rl: { species: "budgie_green", tunic: "#22c55e", pants: "#15803d", skin: "#fde047", hair: "#16a34a", hat: "budgie_g", hatCol: "#22c55e", accent: "#facc15", badge: "Gen 5 · Mitcha (Periquito Verde)" },
    gen6_jacinto: { species: "hyacinth_macaw", tunic: "#1d4ed8", pants: "#1e3a8a", skin: "#1d4ed8", hair: "#1e40af", hat: "macaw", hatCol: "#facc15", accent: "#facc15", badge: "Gen 6 · Jacinto (Guacamayo)" },
  };

  function getSkin(id, fallbackColor) {
    if (VOXEL_SKINS[id]) return VOXEL_SKINS[id];
    const col = fallbackColor || "#0284c7";
    return {
      tunic: col,
      pants: "#1e293b",
      skin: "#f5d2b8",
      hair: "#334155",
      hat: id && id.startsWith("custom_") ? "star_helm" : "beanie",
      hatCol: col,
      accent: "#38bdf8",
      badge: "Estrategia",
    };
  }

  function renderHatSVG(hat, hatCol, accent) {
    switch (hat) {
      case "headband":
        return `<rect x="26" y="18" width="28" height="6" fill="#4a321f"/><rect x="26" y="23" width="28" height="4" fill="${hatCol}"/><rect x="37" y="22" width="6" height="6" fill="#fef08a"/>`;
      case "beanie":
        return `<rect x="25" y="14" width="30" height="10" fill="${hatCol}"/><rect x="27" y="10" width="26" height="5" fill="${hatCol}"/><rect x="36" y="6" width="8" height="5" fill="${accent}"/>`;
      case "hardhat":
        return `<rect x="24" y="14" width="32" height="9" fill="${hatCol}"/><rect x="22" y="21" width="36" height="4" fill="#eab308"/><rect x="36" y="11" width="8" height="6" fill="#fef08a"/>`;
      case "beard":
        return `<rect x="26" y="18" width="28" height="4" fill="#cbd5e1"/><rect x="28" y="38" width="24" height="10" fill="${hatCol}"/><rect x="32" y="48" width="16" height="6" fill="${hatCol}"/><rect x="36" y="54" width="8" height="4" fill="#94a3b8"/>`;
      case "beret":
        return `<rect x="24" y="15" width="32" height="7" fill="${hatCol}"/><rect x="29" y="11" width="22" height="5" fill="${hatCol}"/><rect x="38" y="8" width="4" height="4" fill="${accent}"/>`;
      case "party":
        return `<polygon points="40,4 27,22 53,22" fill="${hatCol}" stroke="#0f172a" stroke-width="1.5"/><rect x="31" y="15" width="18" height="3" fill="#fef08a"/><rect x="37" y="2" width="6" height="5" fill="${accent}"/>`;
      case "bowler":
        return `<rect x="22" y="19" width="36" height="4" fill="${hatCol}"/><rect x="27" y="10" width="26" height="10" fill="${hatCol}"/><rect x="27" y="17" width="26" height="2" fill="#94a3b8"/>`;
      case "hood":
        return `<rect x="23" y="14" width="34" height="10" fill="${hatCol}"/><rect x="23" y="22" width="5" height="22" fill="${hatCol}"/><rect x="52" y="22" width="5" height="22" fill="${hatCol}"/>`;
      case "cowboy":
        return `<rect x="19" y="19" width="42" height="4" fill="${hatCol}"/><rect x="27" y="11" width="26" height="9" fill="${hatCol}"/><rect x="27" y="17" width="26" height="2" fill="#facc15"/>`;
      case "detective":
        return `<rect x="22" y="18" width="36" height="4" fill="${hatCol}"/><rect x="26" y="12" width="28" height="7" fill="${hatCol}"/><rect x="32" y="38" width="16" height="4" fill="#78350f"/>`;
      case "fedora":
        return `<rect x="21" y="18" width="38" height="4" fill="${hatCol}"/><rect x="27" y="11" width="26" height="8" fill="${hatCol}"/><rect x="27" y="16" width="26" height="2" fill="#dc2626"/>`;
      case "cap":
        return `<rect x="26" y="14" width="28" height="8" fill="${hatCol}"/><rect x="26" y="20" width="36" height="4" fill="#ffffff"/>`;
      case "glasses":
        return `<rect x="26" y="18" width="28" height="4" fill="#52525b"/><rect x="26" y="28" width="12" height="7" fill="#0f172a" stroke="#e2e8f0" stroke-width="1.5"/><rect x="42" y="28" width="12" height="7" fill="#0f172a" stroke="#e2e8f0" stroke-width="1.5"/><rect x="38" y="30" width="4" height="2" fill="#e2e8f0"/><rect x="28" y="29" width="4" height="2" fill="${hatCol}"/><rect x="44" y="29" width="4" height="2" fill="${hatCol}"/>`;
      case "tallhat":
        return `<rect x="24" y="18" width="32" height="4" fill="${hatCol}"/><rect x="27" y="5" width="26" height="14" fill="${hatCol}"/><rect x="27" y="15" width="26" height="3" fill="${accent}"/>`;
      case "straw":
        return `<polygon points="40,9 18,22 62,22" fill="${hatCol}" stroke="#92400e" stroke-width="1.5"/>`;
      case "jester":
        return `<rect x="26" y="16" width="28" height="6" fill="${hatCol}"/><rect x="18" y="10" width="10" height="8" fill="#2563eb"/><rect x="52" y="10" width="10" height="8" fill="#16a34a"/><rect x="35" y="7" width="10" height="9" fill="#eab308"/><rect x="16" y="15" width="4" height="4" fill="#facc15"/><rect x="60" y="15" width="4" height="4" fill="#facc15"/>`;
      case "crown_red":
      case "crown_purple":
        return `<rect x="26" y="15" width="28" height="7" fill="${hatCol}"/><rect x="26" y="9" width="6" height="6" fill="${hatCol}"/><rect x="37" y="7" width="6" height="8" fill="${hatCol}"/><rect x="48" y="9" width="6" height="6" fill="${hatCol}"/><rect x="38" y="17" width="4" height="4" fill="#fef08a"/>`;
      case "wreath":
        return `<rect x="25" y="17" width="30" height="6" fill="${hatCol}"/><rect x="29" y="16" width="4" height="4" fill="#fef08a"/><rect x="46" y="16" width="4" height="4" fill="#f472b6"/>`;
      case "split":
        return `<rect x="26" y="14" width="14" height="9" fill="${hatCol}"/><rect x="40" y="14" width="14" height="9" fill="${accent}"/>`;
      case "visor_red":
        return `<rect x="25" y="16" width="30" height="6" fill="${hatCol}"/><rect x="25" y="27" width="30" height="8" fill="#991b1b" opacity="0.88"/><rect x="28" y="29" width="24" height="3" fill="#fca5a5"/>`;
      case "cloud":
        return `<rect x="22" y="12" width="36" height="10" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.2"/><rect x="28" y="7" width="24" height="8" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.2"/>`;
      case "blueprint":
        return `<rect x="25" y="13" width="30" height="10" fill="#1e40af"/><rect x="27" y="16" width="26" height="4" fill="${hatCol}"/><rect x="36" y="11" width="8" height="4" fill="#93c5fd"/>`;
      case "diamond_rl":
        return `<rect x="24" y="13" width="32" height="10" fill="#065f46"/><rect x="26" y="15" width="28" height="6" fill="#10b981"/><polygon points="40,6 46,14 40,21 34,14" fill="${hatCol}" stroke="#0f172a" stroke-width="1.2"/>`;
      case "star_helm":
        return `<rect x="25" y="14" width="30" height="9" fill="${hatCol}"/><polygon points="40,6 43,13 50,13 44,17 46,23 40,19 34,23 36,17 30,13 37,13" fill="#facc15"/>`;
      default:
        return `<rect x="26" y="17" width="28" height="5" fill="${hatCol}"/>`;
    }
  }

  let _diamondFilterSeq = 0;

  /**
   * Render custom blocky voxel animal characters (Fiorino Canary, Blue/White Budgie,
   * Black & White Short-Haired Dog, Green Budgie, Hyacinth Macaw) in crisp pixel/voxel blocks.
   */
  function renderAnimalVoxelAvatar(sk, opts) {
    const side = opts.side || "left";
    const move = opts.move || null;
    const mood = opts.mood || "neutral";
    const size = opts.size || 96;
    const sp = sk.species;

    // Head-only rendering (for Picker Grid, Axelrod Ring, Token Board)
    if (opts.headOnly) {
      let inner = "";
      if (sp === "fiorino_canary") {
        // Yellow Fiorino canary with fluffy crest (moño) and small orange beak
        inner = `
          <rect x="25" y="19" width="30" height="25" fill="#fde047" stroke="#0f172a" stroke-width="2"/>
          <rect x="23" y="13" width="34" height="8" fill="#fef08a" stroke="#0f172a" stroke-width="1.8"/>
          <rect x="27" y="9" width="26" height="6" fill="#ca8a04" stroke="#0f172a" stroke-width="1.5"/>
          <rect x="30" y="11" width="20" height="4" fill="#fde047"/>
          <rect x="29" y="27" width="4" height="4" fill="#0f172a"/>
          <rect x="47" y="27" width="4" height="4" fill="#0f172a"/>
          <rect x="36" y="31" width="8" height="6" fill="#fb923c" stroke="#0f172a" stroke-width="1.5"/>
          <rect x="22" y="36" width="6" height="8" fill="#fef08a" stroke="#0f172a" stroke-width="1.5"/>
          <rect x="52" y="36" width="6" height="8" fill="#fef08a" stroke="#0f172a" stroke-width="1.5"/>`;
      } else if (sp === "budgie_blue") {
        // White & sky-blue budgerigar
        inner = `
          <rect x="26" y="18" width="28" height="26" fill="#ffffff" stroke="#0f172a" stroke-width="2"/>
          <rect x="26" y="14" width="28" height="6" fill="#f8fafc" stroke="#0f172a" stroke-width="1.8"/>
          <rect x="28" y="38" width="24" height="6" fill="#38bdf8"/>
          <rect x="30" y="27" width="4" height="4" fill="#0f172a"/>
          <rect x="46" y="27" width="4" height="4" fill="#0f172a"/>
          <rect x="37" y="29" width="6" height="3" fill="#60a5fa"/>
          <rect x="37" y="32" width="6" height="5" fill="#eab308" stroke="#0f172a" stroke-width="1.3"/>
          <rect x="29" y="36" width="3" height="3" fill="#1e293b"/>
          <rect x="48" y="36" width="3" height="3" fill="#1e293b"/>`;
      } else if (sp === "black_dog") {
        // Short-haired black dog with white chest & floppy/perky ears
        inner = `
          <rect x="26" y="17" width="28" height="27" fill="#1e293b" stroke="#0f172a" stroke-width="2"/>
          <rect x="20" y="19" width="6" height="16" fill="#0f172a" stroke="#0f172a" stroke-width="1.5"/>
          <rect x="54" y="19" width="6" height="16" fill="#0f172a" stroke="#0f172a" stroke-width="1.5"/>
          <rect x="31" y="26" width="4" height="4" fill="#ffffff"/>
          <rect x="32" y="27" width="2" height="2" fill="#0f172a"/>
          <rect x="45" y="26" width="4" height="4" fill="#ffffff"/>
          <rect x="46" y="27" width="2" height="2" fill="#0f172a"/>
          <rect x="33" y="32" width="14" height="10" fill="#334155" stroke="#0f172a" stroke-width="1.5"/>
          <rect x="37" y="33" width="6" height="4" fill="#0f172a"/>
          <rect x="35" y="42" width="10" height="4" fill="#ffffff"/>`;
      } else if (sp === "budgie_green") {
        // Green & yellow budgerigar (Mitcha)
        inner = `
          <rect x="26" y="18" width="28" height="26" fill="#fde047" stroke="#0f172a" stroke-width="2"/>
          <rect x="26" y="14" width="28" height="6" fill="#fef08a" stroke="#0f172a" stroke-width="1.8"/>
          <rect x="26" y="37" width="28" height="7" fill="#22c55e"/>
          <rect x="30" y="26" width="4" height="4" fill="#0f172a"/>
          <rect x="46" y="26" width="4" height="4" fill="#0f172a"/>
          <rect x="37" y="29" width="6" height="3" fill="#38bdf8"/>
          <rect x="37" y="32" width="6" height="5" fill="#fb923c" stroke="#0f172a" stroke-width="1.3"/>
          <rect x="29" y="35" width="3" height="3" fill="#0f172a"/>
          <rect x="48" y="35" width="3" height="3" fill="#0f172a"/>`;
      } else if (sp === "hyacinth_macaw") {
        // Hyacinth macaw (Jacinto): cobalt blue + yellow eye rings + yellow base of large black beak
        inner = `
          <rect x="25" y="17" width="30" height="27" fill="#1d4ed8" stroke="#0f172a" stroke-width="2"/>
          <rect x="28" y="11" width="24" height="6" fill="#2563eb" stroke="#0f172a" stroke-width="1.5"/>
          <rect x="28" y="24" width="8" height="7" fill="#facc15"/>
          <rect x="44" y="24" width="8" height="7" fill="#facc15"/>
          <rect x="30" y="26" width="4" height="3" fill="#0f172a"/>
          <rect x="46" y="26" width="4" height="3" fill="#0f172a"/>
          <rect x="34" y="35" width="12" height="5" fill="#facc15"/>
          <rect x="35" y="31" width="10" height="9" fill="#0f172a"/>`;
      }
      return `<svg viewBox="18 6 44 42" width="${size}" height="${size}" class="voxel-head-svg" shape-rendering="crispEdges">${inner}</svg>`;
    }

    // Full-body voxel animal + C/D sign paddle
    const isLeft = side === "left";
    const signColor = move === "C" ? "#16a34a" : "#dc2626";
    const signBg = move === "C" ? "#dcfce7" : "#fee2e2";
    const signLetter = move || "?";
    const wingCol = sp === "fiorino_canary" ? "#fef08a" : sp === "budgie_blue" ? "#bae6fd" : sp === "black_dog" ? "#1e293b" : sp === "budgie_green" ? "#fde047" : "#1e40af";
    const pawCol = sp === "black_dog" ? "#ffffff" : "#fb923c";

    let armsAndSign = "";
    if (!move) {
      armsAndSign = `
        <rect x="17" y="45" width="9" height="24" fill="${wingCol}" stroke="#0f172a" stroke-width="2"/>
        <rect x="54" y="45" width="9" height="24" fill="${wingCol}" stroke="#0f172a" stroke-width="2"/>`;
    } else if (isLeft) {
      armsAndSign = `
        <rect x="17" y="45" width="9" height="24" fill="${wingCol}" stroke="#0f172a" stroke-width="2"/>
        <g class="voxel-arm-pop">
          <rect x="54" y="45" width="24" height="9" fill="${wingCol}" stroke="#0f172a" stroke-width="2"/>
          <rect x="72" y="45" width="6" height="9" fill="${pawCol}" stroke="#0f172a" stroke-width="1.5"/>
          <rect x="74" y="26" width="3" height="22" fill="#475569"/>
          <rect x="64" y="10" width="22" height="22" rx="4" fill="${signBg}" stroke="${signColor}" stroke-width="3"/>
          <text x="75" y="26" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="14" font-weight="800" fill="${signColor}">${signLetter}</text>
        </g>`;
    } else {
      armsAndSign = `
        <rect x="54" y="45" width="9" height="24" fill="${wingCol}" stroke="#0f172a" stroke-width="2"/>
        <g class="voxel-arm-pop">
          <rect x="2" y="45" width="24" height="9" fill="${wingCol}" stroke="#0f172a" stroke-width="2"/>
          <rect x="2" y="45" width="6" height="9" fill="${pawCol}" stroke="#0f172a" stroke-width="1.5"/>
          <rect x="3" y="26" width="3" height="22" fill="#475569"/>
          <rect x="-6" y="10" width="22" height="22" rx="4" fill="${signBg}" stroke="${signColor}" stroke-width="3"/>
          <text x="5" y="26" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="14" font-weight="800" fill="${signColor}">${signLetter}</text>
        </g>`;
    }

    let bodyAndHead = "";
    if (sp === "fiorino_canary") {
      // Yellow Fiorino Canary with frilled chest, fluffy wings, crest & leg rings
      bodyAndHead = `
        <rect x="29" y="73" width="5" height="20" fill="#fb923c" stroke="#0f172a" stroke-width="1.5"/>
        <rect x="46" y="73" width="5" height="20" fill="#fb923c" stroke="#0f172a" stroke-width="1.5"/>
        <rect x="28" y="83" width="7" height="4" fill="#facc15" stroke="#0f172a" stroke-width="1"/>
        <rect x="45" y="83" width="7" height="4" fill="#0f172a"/>
        <rect x="24" y="92" width="13" height="4" fill="#fb923c" stroke="#0f172a" stroke-width="1.4"/>
        <rect x="43" y="92" width="13" height="4" fill="#fb923c" stroke="#0f172a" stroke-width="1.4"/>
        <rect x="25" y="44" width="30" height="30" fill="#fde047" stroke="#0f172a" stroke-width="2"/>
        <rect x="21" y="48" width="6" height="20" fill="#fef08a" stroke="#0f172a" stroke-width="1.5"/>
        <rect x="53" y="48" width="6" height="20" fill="#fef08a" stroke="#0f172a" stroke-width="1.5"/>
        <rect x="31" y="48" width="18" height="20" fill="#fef08a"/>
        ${armsAndSign}
        <rect x="26" y="18" width="28" height="26" fill="#fde047" stroke="#0f172a" stroke-width="2"/>
        <rect x="23" y="13" width="34" height="7" fill="#fef08a" stroke="#0f172a" stroke-width="1.8"/>
        <rect x="27" y="9" width="26" height="5" fill="#ca8a04" stroke="#0f172a" stroke-width="1.4"/>
        <rect x="30" y="27" width="4" height="4" fill="#0f172a"/>
        <rect x="46" y="27" width="4" height="4" fill="#0f172a"/>
        ${mood === "mad" ? '<rect x="29" y="24" width="6" height="2" fill="#991b1b"/><rect x="45" y="24" width="6" height="2" fill="#991b1b"/>' : ""}
        <rect x="36" y="31" width="8" height="6" fill="#fb923c" stroke="#0f172a" stroke-width="1.4"/>`;
    } else if (sp === "budgie_blue") {
      // White & Sky-Blue Budgerigar
      bodyAndHead = `
        <rect x="30" y="73" width="5" height="20" fill="#94a3b8" stroke="#0f172a" stroke-width="1.5"/>
        <rect x="45" y="73" width="5" height="20" fill="#94a3b8" stroke="#0f172a" stroke-width="1.5"/>
        <rect x="26" y="92" width="12" height="4" fill="#94a3b8" stroke="#0f172a" stroke-width="1.4"/>
        <rect x="42" y="92" width="12" height="4" fill="#94a3b8" stroke="#0f172a" stroke-width="1.4"/>
        <rect x="26" y="44" width="28" height="30" fill="#38bdf8" stroke="#0f172a" stroke-width="2"/>
        <rect x="28" y="45" width="24" height="11" fill="#ffffff"/>
        <rect x="27" y="48" width="4" height="3" fill="#1e293b"/>
        <rect x="49" y="48" width="4" height="3" fill="#1e293b"/>
        ${armsAndSign}
        <rect x="26" y="18" width="28" height="26" fill="#ffffff" stroke="#0f172a" stroke-width="2"/>
        <rect x="26" y="14" width="28" height="6" fill="#f8fafc" stroke="#0f172a" stroke-width="1.6"/>
        <rect x="30" y="27" width="4" height="4" fill="#0f172a"/>
        <rect x="46" y="27" width="4" height="4" fill="#0f172a"/>
        ${mood === "mad" ? '<rect x="29" y="24" width="6" height="2" fill="#991b1b"/><rect x="45" y="24" width="6" height="2" fill="#991b1b"/>' : ""}
        <rect x="37" y="29" width="6" height="3" fill="#60a5fa"/>
        <rect x="37" y="32" width="6" height="5" fill="#eab308" stroke="#0f172a" stroke-width="1.3"/>`;
    } else if (sp === "black_dog") {
      // Short-haired Black Dog with White Chest
      bodyAndHead = `
        <rect x="17" y="64" width="10" height="6" fill="#0f172a" stroke="#0f172a" stroke-width="1.4"/>
        <rect x="27" y="72" width="12" height="24" fill="#0f172a" stroke="#0f172a" stroke-width="2"/>
        <rect x="41" y="72" width="12" height="24" fill="#0f172a" stroke="#0f172a" stroke-width="2"/>
        <rect x="27" y="90" width="12" height="6" fill="#ffffff" stroke="#0f172a" stroke-width="1.4"/>
        <rect x="41" y="90" width="12" height="6" fill="#ffffff" stroke="#0f172a" stroke-width="1.4"/>
        <rect x="26" y="44" width="28" height="29" fill="#1e293b" stroke="#0f172a" stroke-width="2"/>
        <rect x="32" y="46" width="16" height="22" fill="#ffffff"/>
        <rect x="35" y="62" width="10" height="6" fill="#e2e8f0"/>
        ${armsAndSign}
        <rect x="26" y="17" width="28" height="27" fill="#1e293b" stroke="#0f172a" stroke-width="2"/>
        <rect x="20" y="19" width="6" height="16" fill="#0f172a" stroke="#0f172a" stroke-width="1.5"/>
        <rect x="54" y="19" width="6" height="16" fill="#0f172a" stroke="#0f172a" stroke-width="1.5"/>
        <rect x="31" y="25" width="4" height="4" fill="#ffffff"/>
        <rect x="32" y="26" width="2" height="2" fill="#0f172a"/>
        <rect x="45" y="25" width="4" height="4" fill="#ffffff"/>
        <rect x="46" y="26" width="2" height="2" fill="#0f172a"/>
        ${mood === "mad" ? '<rect x="30" y="22" width="6" height="2" fill="#ef4444"/><rect x="44" y="22" width="6" height="2" fill="#ef4444"/>' : ""}
        <rect x="33" y="32" width="14" height="10" fill="#334155" stroke="#0f172a" stroke-width="1.4"/>
        <rect x="37" y="33" width="6" height="4" fill="#0f172a"/>
        ${mood === "happy" ? '<rect x="38" y="41" width="4" height="4" fill="#fb7185"/>' : ""}`;
    } else if (sp === "budgie_green") {
      // Green & Yellow Budgerigar (Mitcha)
      bodyAndHead = `
        <rect x="30" y="73" width="5" height="20" fill="#fb923c" stroke="#0f172a" stroke-width="1.5"/>
        <rect x="45" y="73" width="5" height="20" fill="#fb923c" stroke="#0f172a" stroke-width="1.5"/>
        <rect x="26" y="92" width="12" height="4" fill="#fb923c" stroke="#0f172a" stroke-width="1.4"/>
        <rect x="42" y="92" width="12" height="4" fill="#fb923c" stroke="#0f172a" stroke-width="1.4"/>
        <rect x="26" y="44" width="28" height="30" fill="#22c55e" stroke="#0f172a" stroke-width="2"/>
        <rect x="28" y="45" width="24" height="7" fill="#4ade80"/>
        <rect x="27" y="48" width="4" height="3" fill="#0f172a"/>
        <rect x="49" y="48" width="4" height="3" fill="#0f172a"/>
        ${armsAndSign}
        <rect x="26" y="18" width="28" height="26" fill="#fde047" stroke="#0f172a" stroke-width="2"/>
        <rect x="26" y="14" width="28" height="6" fill="#fef08a" stroke="#0f172a" stroke-width="1.6"/>
        <rect x="30" y="26" width="4" height="4" fill="#0f172a"/>
        <rect x="46" y="26" width="4" height="4" fill="#0f172a"/>
        ${mood === "mad" ? '<rect x="29" y="23" width="6" height="2" fill="#991b1b"/><rect x="45" y="23" width="6" height="2" fill="#991b1b"/>' : ""}
        <rect x="37" y="29" width="6" height="3" fill="#38bdf8"/>
        <rect x="37" y="32" width="6" height="5" fill="#fb923c" stroke="#0f172a" stroke-width="1.3"/>`;
    } else if (sp === "hyacinth_macaw") {
      // Hyacinth Macaw (Jacinto)
      bodyAndHead = `
        <rect x="34" y="73" width="12" height="20" fill="#1e3a8a" stroke="#0f172a" stroke-width="1.5"/>
        <rect x="29" y="73" width="5" height="19" fill="#475569" stroke="#0f172a" stroke-width="1.4"/>
        <rect x="46" y="73" width="5" height="19" fill="#475569" stroke="#0f172a" stroke-width="1.4"/>
        <rect x="25" y="91" width="12" height="5" fill="#334155" stroke="#0f172a" stroke-width="1.4"/>
        <rect x="43" y="91" width="12" height="5" fill="#334155" stroke="#0f172a" stroke-width="1.4"/>
        <rect x="25" y="44" width="30" height="30" fill="#1d4ed8" stroke="#0f172a" stroke-width="2"/>
        <rect x="31" y="47" width="18" height="22" fill="#2563eb"/>
        ${armsAndSign}
        <rect x="25" y="17" width="30" height="27" fill="#1d4ed8" stroke="#0f172a" stroke-width="2"/>
        <rect x="28" y="11" width="24" height="6" fill="#2563eb" stroke="#0f172a" stroke-width="1.5"/>
        <rect x="28" y="24" width="8" height="7" fill="#facc15"/>
        <rect x="44" y="24" width="8" height="7" fill="#facc15"/>
        <rect x="30" y="26" width="4" height="3" fill="#0f172a"/>
        <rect x="46" y="26" width="4" height="3" fill="#0f172a"/>
        ${mood === "mad" ? '<rect x="29" y="21" width="6" height="2" fill="#ef4444"/><rect x="45" y="21" width="6" height="2" fill="#ef4444"/>' : ""}
        <rect x="34" y="35" width="12" height="5" fill="#facc15"/>
        <rect x="35" y="31" width="10" height="9" fill="#0f172a"/>`;
    }

    const vb = isLeft ? "4 0 92 104" : "-16 0 92 104";
    return `
      <svg viewBox="${vb}" width="${size}" height="${Math.round(size * 1.12)}" class="voxel-char-svg" shape-rendering="crispEdges">
        <ellipse cx="40" cy="99" rx="22" ry="4" fill="rgba(15,37,60,0.14)"/>
        ${bodyAndHead}
      </svg>`;
  }

  /**
   * Render a crisp Minecraft-style blocky voxel character SVG.
   * @param {string} strategyId
   * @param {object} opts { side: 'left'|'right', move: 'C'|'D'|null, mood: 'neutral'|'happy'|'mad'|'sneaky', size: number, color?: string, headOnly?: boolean }
   */
  function renderVoxelAvatar(strategyId, opts = {}) {
    const sk = getSkin(strategyId, opts.color);
    if (sk.species) {
      return renderAnimalVoxelAvatar(sk, opts);
    }
    const side = opts.side || "left";
    const move = opts.move || null;
    const mood = opts.mood || "neutral";
    const size = opts.size || 96;

    if (opts.headOnly) {
      return `
        <svg viewBox="20 4 40 44" width="${size}" height="${size}" class="voxel-head-svg" shape-rendering="crispEdges">
          <rect x="26" y="18" width="28" height="26" fill="${sk.skin}" stroke="#0f172a" stroke-width="2"/>
          <rect x="49" y="19" width="4" height="24" fill="rgba(0,0,0,0.08)"/>
          <rect x="32" y="30" width="4" height="4" fill="#0f172a"/>
          <rect x="44" y="30" width="4" height="4" fill="#0f172a"/>
          <rect x="36" y="38" width="8" height="2" fill="#64748b"/>
          ${renderHatSVG(sk.hat, sk.hatCol, sk.accent)}
        </svg>`;
    }

    // Face expression
    let face = `
      <rect x="32" y="30" width="4" height="4" fill="#0f172a"/>
      <rect x="44" y="30" width="4" height="4" fill="#0f172a"/>
      <rect x="36" y="38" width="8" height="2" fill="#64748b"/>`;
    if (mood === "happy") {
      face = `
        <rect x="31" y="30" width="5" height="3" fill="#0f172a"/>
        <rect x="44" y="30" width="5" height="3" fill="#0f172a"/>
        <rect x="35" y="37" width="10" height="3" fill="#166534"/>
        <rect x="33" y="35" width="2" height="2" fill="#166534"/>
        <rect x="45" y="35" width="2" height="2" fill="#166534"/>`;
    } else if (mood === "mad") {
      face = `
        <rect x="31" y="27" width="6" height="2" fill="#991b1b"/>
        <rect x="43" y="27" width="6" height="2" fill="#991b1b"/>
        <rect x="32" y="30" width="4" height="4" fill="#0f172a"/>
        <rect x="44" y="30" width="4" height="4" fill="#0f172a"/>
        <rect x="35" y="38" width="10" height="3" fill="#991b1b"/>`;
    } else if (mood === "sneaky") {
      face = `
        <rect x="32" y="30" width="4" height="3" fill="#0f172a"/>
        <rect x="44" y="30" width="4" height="3" fill="#0f172a"/>
        <rect x="36" y="38" width="9" height="2" fill="#0f172a"/>
        <rect x="45" y="36" width="2" height="2" fill="#0f172a"/>`;
    }

    // Arm raising C or D sign on inner side
    const isLeft = side === "left";
    const signColor = move === "C" ? "#16a34a" : "#dc2626";
    const signBg = move === "C" ? "#dcfce7" : "#fee2e2";
    const signLetter = move || "?";

    let armsAndSign = "";
    if (!move) {
      armsAndSign = `
        <rect x="17" y="45" width="9" height="26" fill="${sk.tunic}" stroke="#0f172a" stroke-width="2"/>
        <rect x="17" y="65" width="9" height="6" fill="${sk.skin}" stroke="#0f172a" stroke-width="1.5"/>
        <rect x="54" y="45" width="9" height="26" fill="${sk.tunic}" stroke="#0f172a" stroke-width="2"/>
        <rect x="54" y="65" width="9" height="6" fill="${sk.skin}" stroke="#0f172a" stroke-width="1.5"/>`;
    } else if (isLeft) {
      // Left character raises RIGHT arm (towards center) holding paddle
      armsAndSign = `
        <rect x="17" y="45" width="9" height="26" fill="${sk.tunic}" stroke="#0f172a" stroke-width="2"/>
        <rect x="17" y="65" width="9" height="6" fill="${sk.skin}" stroke="#0f172a" stroke-width="1.5"/>
        <g class="voxel-arm-pop">
          <rect x="54" y="45" width="24" height="9" fill="${sk.tunic}" stroke="#0f172a" stroke-width="2"/>
          <rect x="72" y="45" width="6" height="9" fill="${sk.skin}" stroke="#0f172a" stroke-width="1.5"/>
          <rect x="74" y="26" width="3" height="22" fill="#475569"/>
          <rect x="64" y="10" width="22" height="22" rx="4" fill="${signBg}" stroke="${signColor}" stroke-width="3"/>
          <text x="75" y="26" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="14" font-weight="800" fill="${signColor}">${signLetter}</text>
        </g>`;
    } else {
      // Right character raises LEFT arm (towards center) holding paddle
      armsAndSign = `
        <rect x="54" y="45" width="9" height="26" fill="${sk.tunic}" stroke="#0f172a" stroke-width="2"/>
        <rect x="54" y="65" width="9" height="6" fill="${sk.skin}" stroke="#0f172a" stroke-width="1.5"/>
        <g class="voxel-arm-pop">
          <rect x="2" y="45" width="24" height="9" fill="${sk.tunic}" stroke="#0f172a" stroke-width="2"/>
          <rect x="2" y="45" width="6" height="9" fill="${sk.skin}" stroke="#0f172a" stroke-width="1.5"/>
          <rect x="3" y="26" width="3" height="22" fill="#475569"/>
          <rect x="-6" y="10" width="22" height="22" rx="4" fill="${signBg}" stroke="${signColor}" stroke-width="3"/>
          <text x="5" y="26" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="14" font-weight="800" fill="${signColor}">${signLetter}</text>
        </g>`;
    }

    const vb = isLeft ? "4 0 92 104" : "-16 0 92 104";
    return `
      <svg viewBox="${vb}" width="${size}" height="${Math.round(size * 1.12)}" class="voxel-char-svg" shape-rendering="crispEdges">
        <!-- Ground shadow -->
        <ellipse cx="40" cy="99" rx="22" ry="4" fill="rgba(15,37,60,0.14)"/>
        <!-- Legs -->
        <rect x="27" y="72" width="12" height="24" fill="${sk.pants}" stroke="#0f172a" stroke-width="2"/>
        <rect x="41" y="72" width="12" height="24" fill="${sk.pants}" stroke="#0f172a" stroke-width="2"/>
        <rect x="27" y="90" width="12" height="6" fill="#0f172a"/>
        <rect x="41" y="90" width="12" height="6" fill="#0f172a"/>
        <!-- Torso -->
        <rect x="26" y="44" width="28" height="29" fill="${sk.tunic}" stroke="#0f172a" stroke-width="2"/>
        <rect x="48" y="45" width="5" height="27" fill="rgba(0,0,0,0.12)"/>
        <rect x="36" y="47" width="8" height="6" fill="${sk.accent}" opacity="0.8"/>
        <!-- Arms + Sign -->
        ${armsAndSign}
        <!-- Blocky Head -->
        <rect x="26" y="18" width="28" height="26" fill="${sk.skin}" stroke="#0f172a" stroke-width="2"/>
        <rect x="49" y="19" width="4" height="24" fill="rgba(0,0,0,0.08)"/>
        ${face}
        ${renderHatSVG(sk.hat, sk.hatCol, sk.accent)}
      </svg>`;
  }

  /**
   * Illuminated Diamond Payoff Matrix SVG (top=CC 3|3, left=DC 5|0, right=CD 0|5, bottom=DD 1|1)
   */
  function renderDiamondMatrixSVG(activeState) {
    const fid = `diamond-glow-${++_diamondFilterSeq}`;
    const glow = (st) => (activeState === st ? `stroke="#f59e0b" stroke-width="4" filter="url(#${fid})"` : 'stroke="#0f253c" stroke-width="1.6"');
    const op = (st) => (!activeState || activeState === st ? "1" : "0.46");
    return `
      <svg viewBox="0 0 210 218" width="192" height="198" class="diamond-matrix-svg">
        <defs>
          <filter id="${fid}" x="-25%" y="-25%" width="150%" height="150%">
            <feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="#f59e0b" flood-opacity="0.85"/>
          </filter>
        </defs>
        <rect x="8" y="6" width="194" height="206" rx="14" fill="#fef3c7" stroke="#d97706" stroke-width="2.2"/>
        <!-- LED indicators: Left C/D, Right C/D -->
        <circle cx="62" cy="24" r="6" fill="${activeState && activeState[0] === "C" ? "#22c55e" : "#86efac"}" stroke="#14532d" stroke-width="1.5"/>
        <circle cx="38" cy="48" r="6" fill="${activeState && activeState[0] === "D" ? "#ef4444" : "#fca5a5"}" stroke="#7f1d1d" stroke-width="1.5"/>
        <circle cx="148" cy="24" r="6" fill="${activeState && activeState[1] === "C" ? "#22c55e" : "#86efac"}" stroke="#14532d" stroke-width="1.5"/>
        <circle cx="172" cy="48" r="6" fill="${activeState && activeState[1] === "D" ? "#ef4444" : "#fca5a5"}" stroke="#7f1d1d" stroke-width="1.5"/>

        <!-- TOP QUADRANT: CC (3 | 3) -->
        <g opacity="${op("CC")}">
          <polygon points="105,28 105,108 65,68" fill="#0284c7" ${glow("CC")}/>
          <polygon points="105,28 145,68 105,108" fill="#be185d" ${glow("CC")}/>
          <text x="90" y="74" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="18" font-weight="800" fill="#ffffff">3</text>
          <text x="120" y="74" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="18" font-weight="800" fill="#ffffff">3</text>
        </g>

        <!-- LEFT QUADRANT: DC (5 | 0) -->
        <g opacity="${op("DC")}">
          <polygon points="65,68 65,148 25,108" fill="#0284c7" ${glow("DC")}/>
          <polygon points="65,68 105,108 65,148" fill="#be185d" ${glow("DC")}/>
          <text x="49" y="114" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="18" font-weight="800" fill="#ffffff">5</text>
          <text x="80" y="114" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="18" font-weight="800" fill="#ffffff">0</text>
        </g>

        <!-- RIGHT QUADRANT: CD (0 | 5) -->
        <g opacity="${op("CD")}">
          <polygon points="145,68 145,148 105,108" fill="#0284c7" ${glow("CD")}/>
          <polygon points="145,68 185,108 145,148" fill="#be185d" ${glow("CD")}/>
          <text x="130" y="114" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="18" font-weight="800" fill="#ffffff">0</text>
          <text x="160" y="114" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="18" font-weight="800" fill="#ffffff">5</text>
        </g>

        <!-- BOTTOM QUADRANT: DD (1 | 1) -->
        <g opacity="${op("DD")}">
          <polygon points="105,108 105,188 65,148" fill="#0284c7" ${glow("DD")}/>
          <polygon points="105,108 145,148 105,188" fill="#be185d" ${glow("DD")}/>
          <text x="90" y="154" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="18" font-weight="800" fill="#ffffff">1</text>
          <text x="120" y="154" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="18" font-weight="800" fill="#ffffff">1</text>
        </g>

        <text x="105" y="204" text-anchor="middle" font-family="Inter,sans-serif" font-size="10.5" font-weight="700" fill="#92400e">
          ${activeState === "CC" ? "Cooperación Mutua (+3 / +3)" : activeState === "DC" ? "Tentación Jugador A (+5 / 0)" : activeState === "CD" ? "Tentación Jugador B (0 / +5)" : activeState === "DD" ? "Castigo Mutuo (+1 / +1)" : "Matriz de Pagos del Dilema"}
        </text>
      </svg>`;
  }

  /**
   * Render a complete Voxel Duel Stage (Characters + Illuminated Diamond + Token Track)
   */
  function renderDuelStage(container, opts) {
    if (!container) return;
    const {
      idA, nameA, colorA,
      idB, nameB, colorB,
      movesA = [], movesB = [],
      scoresA = [], scoresB = [],
      activeTurn = 0, // 1-based; 0 = before first round
      totalA = 0, totalB = 0,
      compact = false,
      onTokenClick = null,
    } = opts;

    const idx = activeTurn > 0 ? activeTurn - 1 : -1;
    const moveA = idx >= 0 && movesA[idx] ? movesA[idx] : null;
    const moveB = idx >= 0 && movesB[idx] ? movesB[idx] : null;
    const activeState = moveA && moveB ? `${moveA}${moveB}` : null;
    const ptsA = idx >= 0 && scoresA[idx] != null ? scoresA[idx] : null;
    const ptsB = idx >= 0 && scoresB[idx] != null ? scoresB[idx] : null;

    const moodA = !activeState ? "neutral" : activeState === "CC" ? "happy" : activeState === "CD" ? "mad" : activeState === "DC" ? "sneaky" : "mad";
    const moodB = !activeState ? "neutral" : activeState === "CC" ? "happy" : activeState === "DC" ? "mad" : activeState === "CD" ? "sneaky" : "mad";
    const skinA = getSkin(idA, colorA);
    const skinB = getSkin(idB, colorB);

    // Render ALL rounds from left (turn 1) growing to the right (newest turn),
    // with the full older history preserved and scrollable on the left!
    const totalRounds = movesA.length;
    const colsHtml = [];
    for (let i = 0; i < totalRounds; i++) {
      const isCur = i === idx;
      const mA = movesA[i];
      const mB = movesB[i];
      const showNum = isCur || i === 0 || (i + 1) % 5 === 0 || totalRounds <= 20;
      colsHtml.push(`
        <div class="tok-col ${isCur ? "tok-active" : ""}" data-tokturn="${i + 1}" title="Turno ${i + 1}: ${nameA}=${mA} (+${scoresA[i] ?? ""}), ${nameB}=${mB} (+${scoresB[i] ?? ""})">
          <div class="tok-col-head">${isCur ? `<span class="tok-caret">▼</span>` : ""}<span class="tok-num">${showNum ? i + 1 : ""}</span></div>
          <div class="tok-cell"><span class="tok-dot ${mA === "C" ? "tok-c" : "tok-d"}"></span></div>
          <div class="tok-cell-sep"></div>
          <div class="tok-cell"><span class="tok-dot ${mB === "C" ? "tok-c" : "tok-d"}"></span></div>
        </div>`);
    }
    if (totalRounds === 0) {
      for (let k = 0; k < 8; k++) {
        colsHtml.push(`
          <div class="tok-col">
            <div class="tok-col-head"><span class="tok-num">${k + 1}</span></div>
            <div class="tok-cell"><span class="tok-dot tok-empty"></span></div>
            <div class="tok-cell-sep"></div>
            <div class="tok-cell"><span class="tok-dot tok-empty"></span></div>
          </div>`);
      }
    }

    container.innerHTML = `
      <div class="voxel-stage ${compact ? "is-compact" : ""}">
        <div class="voxel-arena-row">
          <!-- LEFT PLAYER -->
          <div class="voxel-side voxel-side-left">
            <div class="voxel-name-tag">${nameA}</div>
            <div class="voxel-trait-tag">${skinA.badge}</div>
            <div class="voxel-sprite-wrap">
              ${ptsA != null ? `<span class="score-pop pop-left">+${ptsA}</span>` : ""}
              ${renderVoxelAvatar(idA, { side: "left", move: moveA, mood: moodA, size: compact ? 88 : 112, color: colorA })}
            </div>
          </div>

          <!-- CENTER DIAMOND PAYOFF MATRIX -->
          <div class="voxel-center-diamond">
            ${renderDiamondMatrixSVG(activeState)}
          </div>

          <!-- RIGHT PLAYER -->
          <div class="voxel-side voxel-side-right">
            <div class="voxel-name-tag">${nameB}</div>
            <div class="voxel-trait-tag">${skinB.badge}</div>
            <div class="voxel-sprite-wrap">
              ${ptsB != null ? `<span class="score-pop pop-right">+${ptsB}</span>` : ""}
              ${renderVoxelAvatar(idB, { side: "right", move: moveB, mood: moodB, size: compact ? 88 : 112, color: colorB })}
            </div>
          </div>
        </div>

        <!-- GLOWING FULL-HISTORY TOKEN BOARD (grows left -> right, history scrolls left) -->
        <div class="token-board">
          <div class="token-board-grid">
            <div class="tok-avatars-col">
              <div class="tok-head-spacer"></div>
              <div class="tok-avatar">${renderVoxelAvatar(idA, { headOnly: true, size: 26, color: colorA })}</div>
              <div class="tok-cell-sep"></div>
              <div class="tok-avatar">${renderVoxelAvatar(idB, { headOnly: true, size: 26, color: colorB })}</div>
            </div>
            <div class="tok-scroll-track">${colsHtml.join("")}</div>
            <div class="tok-scores-col">
              <div class="tok-head-spacer"><span class="tok-num">PTS</span></div>
              <div class="tok-score mono">${totalA}</div>
              <div class="tok-cell-sep"></div>
              <div class="tok-score mono">${totalB}</div>
            </div>
          </div>
        </div>
      </div>`;

    // Keep newest turn visible on the right (or active turn centered when scrubbing)
    const track = container.querySelector(".tok-scroll-track");
    if (track && totalRounds > 0) {
      if (activeTurn >= totalRounds || activeTurn <= 0) {
        track.scrollLeft = track.scrollWidth;
      } else {
        const activeCol = track.querySelector(".tok-col.tok-active");
        if (activeCol) {
          const targetScroll = activeCol.offsetLeft - track.clientWidth / 2 + activeCol.offsetWidth / 2;
          track.scrollLeft = Math.max(0, targetScroll);
        }
      }
    }

    if (onTokenClick) {
      container.querySelectorAll("[data-tokturn]").forEach((el) => {
        el.style.cursor = "pointer";
        el.addEventListener("click", () => onTokenClick(parseInt(el.dataset.tokturn, 10)));
      });
    }
  }

  /**
   * Interactive Axelrod 1980 Round-Robin Voxel Ring SVG
   */
  function renderAxelrodRingSVG(container, players, matrix, opts = {}) {
    if (!container || !players.length) return;
    const n = players.length;
    const cx = 340, cy = 278, R = 205;
    const selectedIdx = opts.selectedIdx ?? 0;
    const activePair = opts.activePair || null; // [i, j] during animation

    const coords = players.map((_, i) => {
      const ang = (Math.PI * 2 * i) / n - Math.PI / 2;
      return {
        x: cx + R * Math.cos(ang),
        y: cy + R * Math.sin(ang),
        lx: cx + (R + 46) * Math.cos(ang),
        ly: cy + (R + 46) * Math.sin(ang),
      };
    });

    // Background mesh chords
    const bgLines = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        bgLines.push(`<line x1="${coords[i].x.toFixed(1)}" y1="${coords[i].y.toFixed(1)}" x2="${coords[j].x.toFixed(1)}" y2="${coords[j].y.toFixed(1)}" stroke="rgba(15,58,102,0.12)" stroke-width="1"/>`);
      }
    }

    // Highlighted chords for selected player OR animated pair
    const hiLines = [];
    if (activePair) {
      const [a, b] = activePair;
      const scA = matrix[a][b];
      const scB = matrix[b][a];
      const meanPair = (scA + scB) / 2;
      const col = meanPair >= 520 ? "#16a34a" : meanPair >= 340 ? "#d97706" : "#dc2626";
      hiLines.push(`<line x1="${coords[a].x}" y1="${coords[a].y}" x2="${coords[b].x}" y2="${coords[b].y}" stroke="${col}" stroke-width="4" stroke-linecap="round"/>`);
    } else if (selectedIdx >= 0 && selectedIdx < n) {
      for (let j = 0; j < n; j++) {
        if (j === selectedIdx) continue;
        const sc = matrix[selectedIdx][j];
        const col = sc >= 520 ? "#16a34a" : sc >= 340 ? "#eab308" : "#dc2626";
        hiLines.push(`<line x1="${coords[selectedIdx].x.toFixed(1)}" y1="${coords[selectedIdx].y.toFixed(1)}" x2="${coords[j].x.toFixed(1)}" y2="${coords[j].y.toFixed(1)}" stroke="${col}" stroke-width="2.1" opacity="0.82"/>`);
      }
    }

    // Center matchup callout if animating
    let centerBadge = `
      <circle cx="${cx}" cy="${cy}" r="58" fill="rgba(255,255,255,0.88)" stroke="#cbd5e1" stroke-width="1.5"/>
      <text x="${cx}" y="${cy - 8}" text-anchor="middle" font-size="11.5" font-weight="700" fill="#0f253c">${n} Estrategias</text>
      <text x="${cx}" y="${cy + 9}" text-anchor="middle" font-size="10.5" fill="#475569">${(n * (n - 1)) / 2} duelos</text>
      <text x="${cx}" y="${cy + 24}" text-anchor="middle" font-size="9.5" fill="#64748b">Clic en personaje</text>`;

    if (activePair) {
      const [a, b] = activePair;
      centerBadge = `
        <rect x="${cx - 98}" y="${cy - 34}" width="196" height="68" rx="10" fill="rgba(15,37,60,0.94)" stroke="#facc15" stroke-width="2"/>
        <text x="${cx}" y="${cy - 12}" text-anchor="middle" font-size="11" font-weight="700" fill="#7cc4fa">${players[a].short.slice(0, 14)} vs ${players[b].short.slice(0, 14)}</text>
        <text x="${cx}" y="${cy + 10}" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="14" font-weight="800" fill="#ffffff">${Math.round(matrix[a][b])} — ${Math.round(matrix[b][a])}</text>
        <text x="${cx}" y="${cy + 25}" text-anchor="middle" font-size="9.5" fill="#cbd5e1">Puntos en 200 rondas</text>`;
    }

    // Voxel nodes around circle
    const nodes = players.map((pl, i) => {
      const isSel = i === selectedIdx || (activePair && (activePair[0] === i || activePair[1] === i));
      const ringCol = pl.isInjected ? "#7b3fa0" : pl.nice ? "#16a34a" : "#dc2626";
      const bgFill = isSel ? "#fef9c3" : "#ffffff";
      const headInner = renderVoxelAvatar(pl.id, { headOnly: true, size: 32 });
      // Embed head SVG via nested <svg>
      const nestedSvg = headInner.replace("<svg ", `<svg x="${(coords[i].x - 16).toFixed(1)}" y="${(coords[i].y - 16).toFixed(1)}" `);
      const lbl = pl.short.length > 13 ? pl.short.slice(0, 12) + "…" : pl.short;
      return `
        <g class="ring-node" data-ridx="${i}" style="cursor:pointer">
          <circle cx="${coords[i].x.toFixed(1)}" cy="${coords[i].y.toFixed(1)}" r="${isSel ? 24 : 21}" fill="${bgFill}" stroke="${ringCol}" stroke-width="${isSel ? 3.4 : 2.2}"/>
          ${nestedSvg}
          <text x="${coords[i].lx.toFixed(1)}" y="${coords[i].ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="10.2" font-weight="${isSel ? "800" : "600"}" fill="${isSel ? "#0f253c" : "#334155"}">${lbl}</text>
        </g>`;
    });

    container.innerHTML = `
      <svg viewBox="0 0 680 556" width="100%" style="max-height:520px;display:block;font-family:Inter,sans-serif">
        ${bgLines.join("")}
        ${hiLines.join("")}
        ${centerBadge}
        ${nodes.join("")}
      </svg>`;

    if (opts.onSelect) {
      container.querySelectorAll(".ring-node").forEach((g) => {
        g.addEventListener("click", () => opts.onSelect(parseInt(g.dataset.ridx, 10)));
      });
    }
  }

  window.T5Voxel = {
    getSkin,
    renderVoxelAvatar,
    renderDiamondMatrixSVG,
    renderDuelStage,
    renderAxelrodRingSVG,
  };
})();
