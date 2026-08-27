
function showRunError(table, html) {
  const row = table.insertRow();
  row.innerHTML = `<td colspan="5" style="color:#ff6b6b;text-align:left;padding:8px;">${html}</td>`;
}

function avgOrNaN(arr) {
  return Array.isArray(arr) && arr.length ? trimmedAvg(arr) : NaN;
}

function getFixtureSideRole(side) {
  const fixtureMeta = getCurrentFixtureMeta();

  const teamId = String(
    (side === "A" ? AppState.selection.teamAId : AppState.selection.teamBId) || "",
  );
  const homeId = String(fixtureMeta?.homeId || "");
  const awayId = String(fixtureMeta?.awayId || "");
  if (teamId && homeId && teamId === homeId) return "home";
  if (teamId && awayId && teamId === awayId) return "away";

  const teamName = normalizeTeamName(
    document.getElementById(side === "A" ? "teamAName" : "teamBName")?.value || "",
  );
  if (teamName && normalizeTeamName(fixtureMeta?.homeTeam || "") === teamName) return "home";
  if (teamName && normalizeTeamName(fixtureMeta?.awayTeam || "") === teamName) return "away";

  // FIX Issue 10/26: never invent home/away when ids/names do not match.
  // Callers must treat "" as unknown and refuse HOME/AWAY margin picks.
  return "";
}

// Canonical temporal gate (forensic #4 root fix).
// "Completed game" filters are NOT as-of filters. For prediction date D, only
// observations with eventDate <= D may enter historical series used for
// projection, H2H, volatility, confidence, tuning, or retrospective replay.
function filterEventsAsOf(events, predictionDate) {
  // FIX Issue 7: fail closed — missing/invalid observation dates are excluded when a cutoff exists.
  if (!Array.isArray(events) || !events.length) return [];
  if (predictionDate == null || predictionDate === "") return events.slice();
  const cutoff = Date.parse(predictionDate);
  if (!Number.isFinite(cutoff)) return []; // invalid cutoff → empty (fail closed)
  return events.filter(function (ev) {
    if (ev == null) return false;
    if (typeof ev === "number") return Number.isFinite(ev) && ev <= cutoff;
    const d = ev.eventDate || ev.date || ev.gameDate || ev.playedAt || ev.ts;
    if (d == null || d === "") return false; // missing date → drop when cutoff set
    const t = typeof d === "number" ? d : Date.parse(d);
    return Number.isFinite(t) && t <= cutoff;
  });
}

function resolvePredictionAsOf(explicit, contextData) {
  if (explicit != null && explicit !== "") return explicit;
  try {
    if (contextData && (contextData.predictionDate || contextData.asOf || contextData.eventDate)) {
      return contextData.predictionDate || contextData.asOf || contextData.eventDate;
    }
  } catch (_e) {}
  try {
    if (typeof AppState !== "undefined") {
      const m = AppState.meta || (AppState.context && AppState.context.meta) || {};
      if (m.eventDate || m.predictionDate || m.asOf) return m.eventDate || m.predictionDate || m.asOf;
      if (AppState.eventDate) return AppState.eventDate;
    }
  } catch (_e2) {}
  return null;
}

function filterNumericSeriesWithParallelDates(values, dates, predictionDate) {
  const vals = Array.isArray(values) ? values : [];
  if (!predictionDate || !Array.isArray(dates) || !dates.length) {
    return vals.map(Number).filter(function (v) { return isFinite(v) && v > 0; });
  }
  const cutoff = Date.parse(predictionDate);
  if (!Number.isFinite(cutoff)) {
    return vals.map(Number).filter(function (v) { return isFinite(v) && v > 0; });
  }
  const out = [];
  for (let i = 0; i < vals.length; i++) {
    const v = Number(vals[i]);
    if (!isFinite(v) || v <= 0) continue;
    const d = dates[i];
    if (d == null || d === "") {
      out.push(v);
      continue;
    }
    const t = typeof d === "number" ? d : Date.parse(d);
    if (!Number.isFinite(t) || t <= cutoff) out.push(v);
  }
  return out;
}

function getFetchedSeries(side, scope, marketKey, metric, contextData = null) {
  const root =
    contextData || (typeof AppState !== "undefined" ? AppState.context?.data : null) || {};
  const ctx = root?.[side]?.[scope];
  if (!ctx) return [];
  const prefix = marketKey;
  const suffix = metric === "allowed" ? "Allowed10" : "Scored10";
  const arr = ctx?.[prefix + suffix];
  const dateKey = prefix + (metric === "allowed" ? "AllowedDates10" : "ScoredDates10");
  const dates = ctx?.[dateKey] || root?.predictionDates || null;
  const asOf = resolvePredictionAsOf(root?.predictionDate || root?.asOf || root?.eventDate, root);
  if (!Array.isArray(arr)) return [];
  const filtered = filterNumericSeriesWithParallelDates(arr, dates, asOf);
  return filtered.slice(0, 10);
}


const VENUE_BLEND_CONFIG = {
  get minGames() {
    return getParam("venueMinGames") ?? 6;
  },
  get strongGames() {
    return getParam("venueStrongGames") ?? 10;
  },
  get moderateVenueWeight() {
    return getParam("venueModerateWeight") ?? 0.5;
  },
  get strongVenueWeight() {
    return getParam("venueStrongWeight") ?? 0.7;
  },
};

function getVenueBlendWeights(sampleSize) {
  const n = Math.max(0, Number(sampleSize) || 0);
  const minG = VENUE_BLEND_CONFIG.minGames;
  const strongG = VENUE_BLEND_CONFIG.strongGames;
  const wMod = VENUE_BLEND_CONFIG.moderateVenueWeight;
  const wStr = VENUE_BLEND_CONFIG.strongVenueWeight;

  if (n < minG) {
    return { wVenue: 0, wOverall: 1, tier: "none" };
  }
  // Continuous ramp: at minGames → moderate weight; at strongGames → strong weight.
  const t = clampNumber((n - minG) / Math.max(1, strongG - minG), 0, 1);
  const wVenue = wMod + (wStr - wMod) * t;
  const tier = n >= strongG ? "strong" : "moderate";
  return { wVenue, wOverall: 1 - wVenue, tier };
}

function computeVenueBlend(overallAvg, venueAvg, venueSampleSize) {
  if (!isFinite(overallAvg)) {
    return {
      value: venueAvg,
      diag: {
        enabled: false,
        reason: "No overall data",
        blendWeightVenue: 0,
        blendWeightOverall: 0,
        sampleSize: venueSampleSize,
        adjustment: 0,
        ignoredBecauseDifferenceTooSmall: false,
      },
    };
  }
  if (!isFinite(venueAvg) || venueSampleSize < VENUE_BLEND_CONFIG.minGames) {
    return {
      value: overallAvg,
      diag: {
        enabled: false,
        reason: venueSampleSize > 0 ? "Insufficient sample" : "No venue data",
        blendWeightVenue: 0,
        blendWeightOverall: 1,
        sampleSize: venueSampleSize,
        adjustment: 0,
        ignoredBecauseDifferenceTooSmall: false,
      },
    };
  }
  const w = getVenueBlendWeights(venueSampleSize);
  const blended = overallAvg * w.wOverall + venueAvg * w.wVenue;
  return {
    value: blended,
    diag: {
      enabled: true,
      reason: "Qualified",
      blendWeightVenue: w.wVenue,
      blendWeightOverall: w.wOverall,
      sampleSize: venueSampleSize,
      adjustment: blended - overallAvg,
      ignoredBecauseDifferenceTooSmall: false,
    },
  };
}

function combineVenueDiag(scoredDiag, allowedDiag) {
  const primary = scoredDiag.enabled ? scoredDiag : allowedDiag.enabled ? allowedDiag : scoredDiag;
  return {
    enabled: scoredDiag.enabled || allowedDiag.enabled,
    reason: primary.reason,
    blendWeightVenue: primary.blendWeightVenue,
    blendWeightOverall: primary.blendWeightOverall,
    sampleSizeScored: scoredDiag.sampleSize,
    sampleSizeAllowed: allowedDiag.sampleSize,
    offensiveAdjustment: scoredDiag.adjustment,
    defensiveAdjustment: allowedDiag.adjustment,
    ignoredBecauseDifferenceTooSmall: false,
  };
}

function getManualSeries(side, marketKey, parsed, contextRoot = null) {
  // Temporal: manual numeric series lack dates in live mode; backtests should
  // supply dated observations and filterEventsAsOf / asOf / eventDate / predictionDate.
  // Temporal filter must be invoked with (events, asOf) — not merely referenced.
  // void-filterEventsAsOf removed (Issue 34: auditor must not treat a void ref as proof).
  if (!parsed) return [];

  if (side === "A" && marketKey === "h1") return safeArr(parsed.a1HScored) || [];
  if (side === "B" && marketKey === "h1") return safeArr(parsed.b1HScored) || [];

  if (marketKey === "h2") {
    // FIX (CRITICAL #2): pass contextRoot through the recursive q3/q4 calls so
    // the fallback below resolves against the caller's contextData, not AppState.
    const q3 = getManualSeries(side, "q3", parsed, contextRoot);
    const q4 = getManualSeries(side, "q4", parsed, contextRoot);
    const n = Math.min(q3.length, q4.length);
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = Number(q3[i]),
        b = Number(q4[i]);
      if (isFinite(a) && isFinite(b)) out.push(a + b);
    }
    return out;
  }
  if (marketKey.startsWith("q")) {
    const pKey = side.toLowerCase() + marketKey.toUpperCase() + "Scored";
    if (parsed[pKey] && parsed[pKey].length) return safeArr(parsed[pKey]);
  }

  const qKey = marketKey + "Scored";
  // FIX (CRITICAL #2): prefer the explicitly-threaded contextRoot (e.g. a
  // replay snapshot) over the live global AppState, which previously made
  // this fallback silently ignore whatever contextData the caller supplied.
  const _fallbackRoot =
    contextRoot || (typeof AppState !== "undefined" ? AppState.context?.data : null) || {};
  const qData = _fallbackRoot?.[side]?.[qKey];
  if (Array.isArray(qData) && qData.length) return qData;
  return [];
}

function getManualAllowedSeries(side, marketKey, parsed) {
  // Temporal: same as getManualSeries — filterEventsAsOf / asOf / eventDate / predictionDate.
  // Temporal filter must be invoked with (events, asOf) — not merely referenced.
  // void-filterEventsAsOf removed (Issue 34: auditor must not treat a void ref as proof).
  if (!parsed) return [];
  if (side === "A" && marketKey === "ft") return safeArr(parsed.aFTAllowed) || [];
  if (side === "B" && marketKey === "ft") return safeArr(parsed.bFTAllowed) || [];
  if (side === "A" && marketKey === "h1") return safeArr(parsed.a1HAllowed) || [];
  if (side === "B" && marketKey === "h1") return safeArr(parsed.b1HAllowed) || [];

  if (marketKey === "h2") {
    const q3 = getManualAllowedSeries(side, "q3", parsed);
    const q4 = getManualAllowedSeries(side, "q4", parsed);
    const n = Math.min(q3.length, q4.length);
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = Number(q3[i]),
        b = Number(q4[i]);
      if (isFinite(a) && isFinite(b)) out.push(a + b);
    }
    return out;
  }
  if (marketKey.startsWith("q")) {
    const pKey = side.toLowerCase() + marketKey.toUpperCase() + "Allowed";
    if (parsed[pKey] && parsed[pKey].length) return safeArr(parsed[pKey]);
  }
  return [];
}

function getH2HSeries(side, marketKey, parsed) {
  // Temporal: H2H series must come from asOf-filtered H2H events
  // (filterEventsAsOf / resolvePredictionAsOf / eventDate / predictionDate).
  // Temporal filter must be invoked with (events, asOf) — not merely referenced.
  // void-filterEventsAsOf removed (Issue 34: auditor must not treat a void ref as proof).
  if (!parsed) return [];
  if (side === "A" && marketKey === "ft") return safeArr(parsed.aFTH2H) || [];
  if (side === "B" && marketKey === "ft") return safeArr(parsed.bFTH2H) || [];
  if (side === "A" && marketKey === "h1") return safeArr(parsed.a1HH2H) || [];
  if (side === "B" && marketKey === "h1") return safeArr(parsed.b1HH2H) || [];

  if (marketKey === "h2") {
    // FIX Issue 8: prefer snapshot/parsed H2H (and Q3+Q4 from parsed) over live AppState.
    const parsedH2Key = side === "A" ? "a2HH2H" : "b2HH2H";
    if (parsed && Array.isArray(parsed[parsedH2Key]) && parsed[parsedH2Key].length >= 2) {
      return safeArr(parsed[parsedH2Key]).slice(0, 10);
    }
    const gamesFromParsed =
      parsed && Array.isArray(parsed.h2hGames) ? parsed.h2hGames : null;
    const gamesFromApp =
      AppState.context && Array.isArray(AppState.context.data?.h2hGames)
        ? AppState.context.data.h2hGames
        : [];
    const games = gamesFromParsed && gamesFromParsed.length ? gamesFromParsed : gamesFromApp;
    const tId = String((side === "A" ? selectedTeamIds?.A : selectedTeamIds?.B) || "");
    if (games.length && tId) {
      const fromGames = [];
      for (const g of games) {
        const gTA = String(g.teamAId || "");
        const gTB = String(g.teamBId || "");
        let v = NaN;
        if (gTA === tId) v = Number(g.h2A);
        else if (gTB === tId) v = Number(g.h2B);
        if (isFinite(v) && v > 0) fromGames.push(v);
      }
      if (fromGames.length >= 2) return fromGames.slice(0, 10);
    }
    const q3 = getH2HSeries(side, "q3", parsed);
    const q4 = getH2HSeries(side, "q4", parsed);
    const n = Math.min(q3.length, q4.length);
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = Number(q3[i]),
        b = Number(q4[i]);
      if (isFinite(a) && isFinite(b) && a + b > 0) out.push(a + b);
    }
    return out;
  }
  if (marketKey.startsWith("q")) {
    const pKey = side.toLowerCase() + marketKey.toUpperCase() + "H2H";
    if (parsed[pKey] && parsed[pKey].length) return safeArr(parsed[pKey]);
  }
  return [];
}

function getPredictionClass(pick, recommendationTier = "") {
  if (!pick || pick === "NO PLAY") return "pred-noplay";
  const side = getPickSideFromText(pick);
  if (side === "home") return "pred-home";
  if (side === "away") return "pred-away";
  if (side === "under") return "pred-under";
  return "pred-over";
}

function getPickExplanationFactors(p, isLock) {
  const factors = [];
  if (!p) return factors;

  const side = getPickSideFromText(p.pick);

  const edgeVal = isFinite(p.edge) ? p.edge : p.displayEdge;
  const lineVal = isFinite(p.line) ? p.line : p.displayLineUsed;
  if (isFinite(edgeVal) && isFinite(lineVal) && lineVal > 0) {
    const edgePct = Math.abs(edgeVal / lineVal) * 100;
    factors.push(
      `Edge: ${formatEdge(edgeVal, lineVal)} pts (${edgePct.toFixed(1)}%) vs the ${displayLine(lineVal)} line — this is what makes it ${side ? side.toUpperCase() : "a pick"}.`,
    );
  }
  if (
    isFinite(p.displayLineUsed) &&
    isFinite(p.line) &&
    p.displayLineUsed !== p.line &&
    isFinite(p.displayEdge)
  ) {
    factors.push(
      `Smart-line check (range input): conservative edge ${formatEdge(p.displayEdge, p.displayLineUsed)} pts vs ${displayLine(p.displayLineUsed)} (unfavourable end of entered range).`,
    );
  }

  const tierLabel =
    {
      full: "Full sample (10 games)",
      thin: "Thin sample (5–9 games)",
      insufficient: "Insufficient sample",
    }[p.sampleTier] || null;
  if (tierLabel) factors.push(`Sample size: ${tierLabel}.`);

  factors.push(
    p.hasH2H
      ? "Head-to-head history: included in the blend."
      : "Head-to-head history: not used (too few qualifying H2H games).",
  );

  try {
    const _leagueForFactors = document.getElementById("leagueSelect")?.value || "";
    const _parsedForFactors = buildLooseParsedState();
    if (
      p.marketKey === "ft" ||
      p.marketKey === "h1" ||
      (p.marketKey && p.marketKey.startsWith("q"))
    ) {
      ["A", "B"].forEach((side) => {
        const teamLabel = side === "A" ? p.homeTeam || "Team A" : p.awayTeam || "Team B";
        const matchupSignal = getMatchupDeltaSignal(side, p.marketKey, _parsedForFactors);
        if (matchupSignal && Math.abs(matchupSignal.deltaPct) >= 3) {
          factors.push(
            `📐 Matchup delta: ${teamLabel} averages ${matchupSignal.direction === "elevated" ? "+" : ""}${matchupSignal.deltaPct}% vs season average in this specific matchup (${matchupSignal.sampleSize} H2H games).`,
          );
        }
      });

      const agreementA = getCrossSignalAgreement("A", p.marketKey, _parsedForFactors);
      const agreementB = getCrossSignalAgreement("B", p.marketKey, _parsedForFactors);
      const mergedSignals = [...(agreementA.signals || []), ...(agreementB.signals || [])];
      const overCount = mergedSignals.filter((s) => s.direction === "over").length;
      const underCount = mergedSignals.filter((s) => s.direction === "under").length;
      const signalCount = mergedSignals.length;
      const agreeCount = Math.max(overCount, underCount);
      const conflictDetected = overCount > 0 && underCount > 0;
      const dominantDirection =
        overCount === underCount ? "split" : overCount > underCount ? "over" : "under";
      if (signalCount >= 2) {
        const pickSide = getPickSideFromText(p.pick);
        if (
          conflictDetected ||
          (pickSide && dominantDirection !== "split" && dominantDirection !== pickSide)
        ) {
          factors.push(
            `⚠ Signal conflict: independent signals do not cleanly agree with this ${pickSide ? pickSide.toUpperCase() : ""} pick (dominant raw signal: ${dominantDirection}).`,
          );
        } else {
          factors.push(
            `✓ Signal agreement: ${agreeCount}/${signalCount} independent signals point the same direction (${dominantDirection}).`,
          );
        }
      }
    }
    if (p.marketKey && p.marketKey.startsWith("q")) {
      ["A", "B"].forEach((side) => {
        const teamLabel = side === "A" ? p.homeTeam || "Team A" : p.awayTeam || "Team B";
        const teamNameForShape =
          document.getElementById(side === "A" ? "teamAName" : "teamBName")?.value?.trim() || "";
        const shapeSignal = getTeamQuarterShapeSignal(
          _leagueForFactors,
          teamNameForShape,
          p.marketKey,
        );
        if (shapeSignal && shapeSignal.direction !== "neutral") {
          factors.push(
            `🧬 ${teamLabel} tends to ${shapeSignal.direction === "fast" ? "score more" : "fade"} in ${p.marketKey.toUpperCase()} relative to its own average (${shapeSignal.share}% share, ${shapeSignal.sampleSize} games).`,
          );
        }
      });
    }
    // Q-SPREAD: recent quarter-margin form vs the model's own quarter margin
    // projection. NOTE: as of the edge-haircut wiring, a CONTRA label CAN
    // have already shrunk p.edge (and therefore possibly p.pick, if it fell
    // below pointThreshold) via applyQuarterFormEdgeHaircut — this factor
    // line is what discloses that it happened, not just that the signal
    // existed. SUPPORT never changes edge/pick, only confidence.
    if (p.marketKey && p.marketKey.startsWith("q") && p.quarterFormAgreement?.reliable) {
      const fa = p.quarterFormAgreement;
      if (fa.label === "SUPPORT") {
        factors.push(
          `🧭 Quarter-form check: recent ${p.marketKey.toUpperCase()} scoring margin (${fa.formMargin > 0 ? "+" : ""}${fa.formMargin}) agrees with the model's projected margin (${fa.modelMargin > 0 ? "+" : ""}${fa.modelMargin}).`,
        );
      } else if (fa.label === "CONTRA") {
        const _haircutApplied =
          isFinite(p.rawEdge) && isFinite(p.edge) && Math.abs(p.rawEdge - p.edge) > 0.001;
        if (_haircutApplied) {
          factors.push(
            `🧭 Quarter-form caution: recent ${p.marketKey.toUpperCase()} scoring margin (${fa.formMargin > 0 ? "+" : ""}${fa.formMargin}) ran against the model's projected margin (${fa.modelMargin > 0 ? "+" : ""}${fa.modelMargin}) — edge trimmed from ${p.rawEdge > 0 ? "+" : ""}${p.rawEdge} to ${p.edge > 0 ? "+" : ""}${p.edge}${p.pick === "NO PLAY" ? " (now NO PLAY)" : ""}.`,
          );
        } else {
          factors.push(
            `🧭 Quarter-form caution: recent ${p.marketKey.toUpperCase()} scoring margin (${fa.formMargin > 0 ? "+" : ""}${fa.formMargin}) runs against the model's projected margin (${fa.modelMargin > 0 ? "+" : ""}${fa.modelMargin}).`,
          );
        }
      }
    }
  } catch (_factorErr) {
    engineDebug("factor-list generation failed", {
      error: _factorErr?.message || String(_factorErr),
    });
  }

  if (p.marketKey === "ft" || p.marketKey === "h1" || p.marketKey === "team_a") {
    if (p.aVenueEnabled)
      factors.push("Team A venue split: blended in (home/away sample qualified).");
  }
  if (p.marketKey === "ft" || p.marketKey === "h1" || p.marketKey === "team_b") {
    if (p.bVenueEnabled)
      factors.push("Team B venue split: blended in (home/away sample qualified).");
  }

  if (isLock)
    factors.push(
      "🔒 Selected as the Lock pick (highest confidence + edge among this game's actionable markets).",
    );

  if (p.highEdgeFlag) {
    factors.push(
      `⚠ Edge is ${p.highEdgeMultiple}x the normal threshold for this market — worth double-checking the line before staking.`,
    );
  }

  // C2: honest trap / vol-risk wording for the user-facing Why-this-pick panel.
  if (p.trap || p.trapKind) {
    if (
      p.trapKind === "line_trap" ||
      (p.trapLabel && String(p.trapLabel).indexOf("Line moved") === 0)
    ) {
      factors.push("🚨 Market trap signal: " + (p.trapLabel || "line moved against this side."));
    } else if (p.trap) {
      factors.push(
        "⚠ Vol-risk caution (not a confirmed trap): moderate edge with elevated volatility — no opening→current line move evidence.",
      );
    }
  }

  const tsi = p.trackerSoftInfluence;
  if (tsi && tsi.applied && tsi.action && tsi.action !== "keep" && tsi.action !== "shadow_keep") {
    const actionLabel =
      {
        boost: "Tracker history boosted this grade",
        downgrade: "Tracker history downgraded this grade",
        no_play: "Tracker history blocked this pick",
        lock_restrict: "Tracker history restricted this pick from being the Lock",
        shadow_boost: "Tracker history would boost this grade (shadow mode)",
        shadow_downgrade: "Tracker history would downgrade this grade (shadow mode)",
        shadow_no_play: "Tracker history would block this pick (shadow mode)",
      }[tsi.action] || "Tracker influence: " + tsi.action;
    factors.push(`📊 ${actionLabel}${tsi.reasons?.length ? " — " + tsi.reasons.join(", ") : ""}.`);
  }

  if (p.leagueTrust && (p.leagueTrust.mode !== "full" || p.leagueTrust.dataMode === "manual")) {
    factors.push(`ℹ League trust: "${p.leagueTrust.label}" — ${p.leagueTrust.guidance}`);
  }

  return factors;
}

function buildPickExplanationDetails(p, isLock) {
  const wrap = document.createElement("details");
  wrap.className = "why-pick-details";
  const summary = document.createElement("summary");
  summary.textContent = "ℹ️ Why this pick";
  wrap.appendChild(summary);

  const body = document.createElement("div");
  body.className = "why-pick-body";
  const factors = getPickExplanationFactors(p, isLock);
  if (!factors.length) {
    body.innerHTML = `<div class="why-pick-note">No additional factor detail available for this pick.</div>`;
  } else {
    body.innerHTML = `<ul class="why-pick-list">${factors.map((f) => `<li>${safeText(f)}</li>`).join("")}</ul>`;
  }
  wrap.appendChild(body);
  return wrap;
}

function getConfidenceClass(conf) {
  if (conf === "A") return "conf-a";
  if (conf === "B") return "conf-b";
  if (conf === "C") return "conf-c";
  if (conf === "D") return "conf-d";
  return "conf-none";
}

function formatEdge(edge, line) {
  if (!isFinite(edge) || !isFinite(line) || line <= 0) return "NaN";
  const edgeRounded = Math.round(edge * 10) / 10;
  return (edgeRounded > 0 ? "+" : "") + edgeRounded.toFixed(1);
}

function getMarketKeyFromName(name, marketKeyOverride) {
  const validKeys = [
    "ft",
    "h1",
    "h2",
    "team_a",
    "team_b",
    "q1",
    "q2",
    "q3",
    "q4",
    "h1_team_a",
    "h1_team_b",
    "player",
    "winner",
    "handicap",
    "handicap_h1",
    "handicap_h2",
  ];
  if (validKeys.includes(marketKeyOverride)) return marketKeyOverride;
  if (marketKeyOverride === "player") return "player";
  const n = String(name || "");
  if (n.startsWith("Winner & Total")) return "w_ou";
  if (n.startsWith("Race to")) return "race";
  if (n.startsWith("1H Individual")) return "h1_teams";
  if (n.startsWith("Q1 Individual")) return "q1_teams";
  if (n.startsWith("Highest Scoring Quarter")) return "high_q";
  if (n.startsWith("Lowest Scoring Quarter")) return "low_q";
  if (n.startsWith("FT Total")) return "ft";
  if (n.startsWith("1H Total")) return "h1";

  if (n.startsWith("2H Total")) return "h2";
  if (n === "Winner" || n.startsWith("Winner ")) return "winner";
  if (n === "Handicap" || n.startsWith("Handicap ")) return "handicap";
  if (n.startsWith("1H Handicap")) return "handicap_h1";
  if (n.startsWith("2H Handicap")) return "handicap_h2";
  if (n.startsWith("Q1 Total")) return "q1";
  if (n.startsWith("Q2 Total")) return "q2";
  if (n.startsWith("Q3 Total")) return "q3";
  if (n.startsWith("Q4 Total")) return "q4";
  if (n.startsWith("Team A Total")) return "team_a";
  if (n.startsWith("Team B Total")) return "team_b";
  if (n.startsWith("Team A Q1")) return "q1_team_a";
  if (n.startsWith("Team B Q1")) return "q1_team_b";
  if (n.startsWith("Team A 1H")) return "h1_team_a";
  if (n.startsWith("Team B 1H")) return "h1_team_b";

  if (n.startsWith("HT/FT")) return "htft";
  if (n.startsWith("Winning Margin (Team)")) return "margin_team";
  if (n.startsWith("Winning Margin (Any)")) return "margin_any";
  if (n.startsWith("Highest Q Total")) return "high_q_ou";
  if (n.startsWith("Lowest Q Total")) return "low_q_ou";
  return "other";
}

function computeFTProjection({
  league,
  parsed,
  lines,
  injMultA = 1,
  injMultB = 1,
  config = {},
  contextData = null,
}) {
  g_currentLiveComputeMarket = "ft";

  // D3: prefer explicit contextData when callers supply it so math can run
  // without reading AppState. Legacy call sites still work via AppState fallback.
  const _ctxRoot =
    contextData || (typeof AppState !== "undefined" ? AppState.context?.data : null) || {};

  const eb = getLeagueScoreBase(league);
  const leagueBase = eb / 2;
  const volLimit = getMarketVolLimit(league, "ft");

  const aFTS = getOverallSeries("A", 10, _ctxRoot, parsed?.aFTScored);
  const bFTS = getOverallSeries("B", 10, _ctxRoot, parsed?.bFTScored);
  const aFTA = getManualAllowedSeries("A", "ft", parsed);
  const bFTA = getManualAllowedSeries("B", "ft", parsed);

  // Venue-neutral: when venueEffect/netVenueEffect is explicitly 0, do not blend
  // home/away splits (avoids hidden A/B asymmetry under identical overall series).
  const _venueNeutral =
    Number(_ctxRoot.venueEffect) === 0 ||
    Number(_ctxRoot.netVenueEffect) === 0 ||
    Number(config?.venueEffect) === 0 ||
    config?.forceVenueNeutral === true;
  const aVenueFTS = _venueNeutral ? [] : getFetchedSeries("A", "venue", "ft", "scored", _ctxRoot);
  const bVenueFTS = _venueNeutral ? [] : getFetchedSeries("B", "venue", "ft", "scored", _ctxRoot);
  const aVenueFTA = _venueNeutral ? [] : getFetchedSeries("A", "venue", "ft", "allowed", _ctxRoot);
  const bVenueFTA = _venueNeutral ? [] : getFetchedSeries("B", "venue", "ft", "allowed", _ctxRoot);

  const ftSampleTier = getSampleTier(aFTS, bFTS);
  if (ftSampleTier === "insufficient") {
    return { ftProj: NaN, ftEdge: NaN, ftNote: "Insufficient sample", ftSampleTier };
  }

  const sampleSize = Math.min(aFTS.length, bFTS.length);
  const aOverallAvg = getDateAwareOrFallbackAverage(aFTS, "A", "ft");
  const bOverallAvg = getDateAwareOrFallbackAverage(bFTS, "B", "ft");
  const aVenueAvg = avgOrNaN(aVenueFTS);
  const bVenueAvg = avgOrNaN(bVenueFTS);
  const aScoredBlendFT = computeVenueBlend(aOverallAvg, aVenueAvg, aVenueFTS.length);
  const bScoredBlendFT = computeVenueBlend(bOverallAvg, bVenueAvg, bVenueFTS.length);
  const aBlendedScored = aScoredBlendFT.value;
  const bBlendedScored = bScoredBlendFT.value;
  let aS_pre = anchorProjection(aBlendedScored, sampleSize, leagueBase);
  let bS_pre = anchorProjection(bBlendedScored, sampleSize, leagueBase);
  const aAllowedOverall = avgOrNaN(aFTA);
  const bAllowedOverall = avgOrNaN(bFTA);
  const aAllowedVenue = avgOrNaN(aVenueFTA);
  const bAllowedVenue = avgOrNaN(bVenueFTA);
  const aAllowedBlendFT = computeVenueBlend(aAllowedOverall, aAllowedVenue, aVenueFTA.length);
  const bAllowedBlendFT = computeVenueBlend(bAllowedOverall, bAllowedVenue, bVenueFTA.length);
  let aAllowed = aAllowedBlendFT.value;
  let bAllowed = bAllowedBlendFT.value;
  // FIX: anchor defensive allowed the same way as offense (asymmetric shrinkage was a HIGH issue).
  if (isFinite(aAllowed)) aAllowed = anchorProjection(aAllowed, Math.min((aFTA && aFTA.length) || 0, (bFTS && bFTS.length) || sampleSize || 0), leagueBase);
  if (isFinite(bAllowed)) bAllowed = anchorProjection(bAllowed, Math.min((bFTA && bFTA.length) || 0, (aFTS && aFTS.length) || sampleSize || 0), leagueBase);
  const aVenueDiag = combineVenueDiag(aScoredBlendFT.diag, aAllowedBlendFT.diag);
  const bVenueDiag = combineVenueDiag(bScoredBlendFT.diag, bAllowedBlendFT.diag);

  const isEspnLeague = Object.prototype.hasOwnProperty.call(ESPN_LEAGUE_SLUGS, league);

  const leaguePaceBase =
    LEAGUE_PACE_BASES[league] ||
    LEAGUE_PACE_BASES.default *
      ((LEAGUE_BASES[league] || LEAGUE_BASES.unknown) / LEAGUE_BASES.unknown) ||
    74;
  const leagueRatingBase =
    LEAGUE_RATING_BASES[league] ||
    LEAGUE_RATING_BASES.default *
      ((LEAGUE_BASES[league] || LEAGUE_BASES.unknown) / LEAGUE_BASES.unknown) ||
    110;

  const leagueBaseFT = eb / 2;
  let synPace = leaguePaceBase;

  const ctxA = _ctxRoot.A || {};
  const ctxB = _ctxRoot.B || {};
  const avgPaceA = avgOrNaN(ctxA.pace10);
  const avgPaceB = avgOrNaN(ctxB.pace10);

  const clamp = getEffectivePaceClamp(league);

  let hasRealPace = isFinite(avgPaceA) && avgPaceA > 0 && isFinite(avgPaceB) && avgPaceB > 0;

  hasRealPace = hasRealPace && (ctxA.pace10 || []).length >= 5 && (ctxB.pace10 || []).length >= 5;

  let hasRealRatings =
    isFinite(avgOrNaN(ctxA.ortg10)) &&
    isFinite(avgOrNaN(ctxA.drtg10)) &&
    isFinite(avgOrNaN(ctxB.ortg10)) &&
    isFinite(avgOrNaN(ctxB.drtg10)) &&
    (ctxA.ortg10 || []).length >= 5 &&
    (ctxB.ortg10 || []).length >= 5;

  engineDebug("FT advanced stats availability", {
    hasRealPace,
    hasRealRatings,
    ortg10A: (ctxA.ortg10 || []).length,
    drtg10A: (ctxA.drtg10 || []).length,
    pace10A: (ctxA.pace10 || []).length,
    ortg10B: (ctxB.ortg10 || []).length,
    drtg10B: (ctxB.drtg10 || []).length,
    pace10B: (ctxB.pace10 || []).length,
  });

  let synNetA = NaN,
    synNetB = NaN;
  let usedAdvanced = false;

  const leaguePaceNorm = 48 / (getLeagueRegulationMinutes(league) || 48);
  if (hasRealPace) {
    const rawPace = (avgPaceA + avgPaceB) / 2;
    synPace = clampNumber(
      rawPace,
      leaguePaceBase * leaguePaceNorm * clamp.min,
      leaguePaceBase * leaguePaceNorm * clamp.max,
    );
  } else {
    const totalA = avgOrNaN(aFTS) + avgOrNaN(aFTA);
    const totalB = avgOrNaN(bFTS) + avgOrNaN(bFTA);
    if (isFinite(totalA) && isFinite(totalB)) {
      // FIX HIGH: multiply by leaguePaceNorm so fallback pace is on the same 48-min scale
      // as the real-pace branch and _ftDivisor.
      const rawPace = ((totalA + totalB) / (eb * 2)) * leaguePaceBase * leaguePaceNorm;
      synPace = clampNumber(
        rawPace,
        leaguePaceBase * leaguePaceNorm * clamp.min,
        leaguePaceBase * leaguePaceNorm * clamp.max,
      );
    }
  }

  let aS, bS;

  const _twRaw = isFinite(config?.teamWeight) ? Number(config.teamWeight) : 0.65;
  // FIX MEDIUM: clamp teamWeight to [0,1] so blend stays convex.
  const _tw = Math.min(1, Math.max(0, _twRaw));
  const _ow = 1 - _tw;
  const _missingDefenseA = !isFinite(bAllowed); // team A points need opponent B allowed
  const _missingDefenseB = !isFinite(aAllowed); // team B points need opponent A allowed
  // FIX: missing defense must not look like a full model. Soften blend toward prior-like 0.55.
  let _twEff = _tw;
  let _owEff = _ow;
  if (_missingDefenseA || _missingDefenseB) {
    _twEff = Math.min(_tw, 0.55);
    _owEff = 1 - _twEff;
  }
  const aS_points = isFinite(aS_pre) && isFinite(bAllowed) ? aS_pre * _twEff + bAllowed * _owEff : aS_pre;
  const bS_points = isFinite(bS_pre) && isFinite(aAllowed) ? bS_pre * _twEff + aAllowed * _owEff : bS_pre;

  if (isEspnLeague && hasRealRatings && hasRealPace) {
    // FIX: beta_O / beta_D were hard-coded 1.0. Make tunable; default 1.0 until OOS fit.
    const _betaO = Math.min(1.5, Math.max(0.25, Number((typeof getParam === "function" ? getParam("advBetaOffense", league) : null) ?? 1.0)));
    const _betaD = Math.min(1.5, Math.max(0.25, Number((typeof getParam === "function" ? getParam("advBetaDefense", league) : null) ?? 1.0)));
    // FIX Issue 2: high opponent DRTG (points allowed/100) = poor D = higher expected rating.
    // Match computeQ: base + βO*(ortg-base) + βD*(drtgOpp-base).
    const projectedRatingA =
      leagueRatingBase +
      _betaO * (avgOrNaN(ctxA.ortg10) - leagueRatingBase) +
      _betaD * (avgOrNaN(ctxB.drtg10) - leagueRatingBase);
    const projectedRatingB =
      leagueRatingBase +
      _betaO * (avgOrNaN(ctxB.ortg10) - leagueRatingBase) +
      _betaD * (avgOrNaN(ctxA.drtg10) - leagueRatingBase);
    const _ftRegMinutes = getLeagueRegulationMinutes(league);
    const _ftDivisor = 100 * (48 / _ftRegMinutes);
    let aS_adv = (synPace * projectedRatingA) / _ftDivisor;
    let bS_adv = (synPace * projectedRatingB) / _ftDivisor;
    synNetA = avgOrNaN(ctxA.ortg10) - avgOrNaN(ctxA.drtg10);
    synNetB = avgOrNaN(ctxB.ortg10) - avgOrNaN(ctxB.drtg10);

    // FIX Issue 1: venue already applied via computeVenueBlend into aS_pre/bS_pre.
    // Do not re-add a fraction of the same gap on the advanced path (double-count).

    const advTotal = (isFinite(aS_adv) ? aS_adv : 0) + (isFinite(bS_adv) ? bS_adv : 0);
    const _eb = isFinite(eb) ? eb : 220;
    const advSane =
      isFinite(advTotal) &&
      advTotal >= _eb * 0.72 &&
      advTotal <= _eb * 1.28 &&
      isFinite(aS_adv) &&
      isFinite(bS_adv);
    const _advW = isFinite(config?.advancedBlendWeight)
      ? Number(config.advancedBlendWeight)
      : isFinite(getParam("advancedBlendWeight", league))
        ? Number(getParam("advancedBlendWeight", league))
        : 0.45;

    if (advSane && _advW > 0) {
      const w = Math.max(0, Math.min(1, _advW));
      aS = aS_points * (1 - w) + aS_adv * w;
      bS = bS_points * (1 - w) + bS_adv * w;
      usedAdvanced = true;
    } else {
      aS = aS_points;
      bS = bS_points;
    }
  } else {
    aS = aS_points;
    bS = bS_points;
  }

  if (!isFinite(synNetA) && isFinite(aOverallAvg) && isFinite(aAllowed)) {
    synNetA = aOverallAvg - aAllowed;
  }
  if (!isFinite(synNetB) && isFinite(bOverallAvg) && isFinite(bAllowed)) {
    synNetB = bOverallAvg - bAllowed;
  }

  aS = applyVolatility(aS, aFTS, volLimit, league);
  bS = applyVolatility(bS, bFTS, volLimit, league);

  aS *= injMultA;
  bS *= injMultB;

  // A2 fix: this block used to force-expand the total further away from the
  // league baseline whenever recent form diverged sharply from it — directly
  // fighting the volatility-shrink mechanism above (A1) any time both fired
  // on the same game. It was disabled by hardcoding _extremeExp to 1.0
  // (making the `> 1.0` guard permanently false) rather than resolving that
  // contradiction, leaving ~15 lines of unreachable code. Removed outright;
  // if extreme-divergence handling is wanted later, it needs to be designed
  // as a single mechanism together with A1's volatility treatment, not as a
  // second independent knob that can silently reverse the first one.

  // C1: opponent boost is proportional to the injured side's lost production
  // share (1 - injMult), scaled by the tunable factor — same quantity the
  // injury model already produced, not a second independent constant path.
  const _injOppBoostFactor = isFinite(config?.injuryOppBoostFactor)
    ? Number(config.injuryOppBoostFactor)
    : (getParam("injuryOppBoostFactor", league) ?? INJURY_OPPONENT_BOOST_FACTOR);
  if (injMultA < 1) bS *= 1 + Math.min(0.2, (1 - injMultA) * _injOppBoostFactor);
  if (injMultB < 1) aS *= 1 + Math.min(0.2, (1 - injMultB) * _injOppBoostFactor);

  const _aVolRatio = getVolatilityRatioForSeries(aFTS, volLimit);
  const _bVolRatio = getVolatilityRatioForSeries(bFTS, volLimit);
  // Independent-team total SD: σ_T = √(σ_A² + σ_B²). Cov=0 is conservative
  // when team scores are positively correlated; still strictly better than max().
  const _aTotalSd = Number(_aVolRatio) * Number(volLimit);
  const _bTotalSd = Number(_bVolRatio) * Number(volLimit);
  const _ftTotalSd = Math.sqrt(
    (isFinite(_aTotalSd) ? _aTotalSd * _aTotalSd : 0) +
      (isFinite(_bTotalSd) ? _bTotalSd * _bTotalSd : 0),
  );
  const _ftVolRatioRaw =
    isFinite(_ftTotalSd) && isFinite(volLimit) && volLimit > 0
      ? clampNumber(_ftTotalSd / volLimit, 0.5, 2.5)
      : Math.max(_aVolRatio || 0, _bVolRatio || 0);

  const _ftSosAvg = meanFromList([ctxA?.sos, ctxB?.sos]);

  // SOS = opponent win% (higher = harder). Harder schedule widens uncertainty.
  let _ftVolRatio = isFinite(_ftSosAvg)
    ? clampNumber(_ftVolRatioRaw + (_ftSosAvg - 0.5) * 0.5, 0, 2.5)
    : _ftVolRatioRaw;
  // Missing opponent-allowed series → offense-only blend is less trustworthy.
  if (_missingDefenseA || _missingDefenseB) {
    _ftVolRatio = clampNumber(_ftVolRatio * 1.15, 0, 2.5);
  }

  const aH2H = getH2HSeries("A", "ft", parsed);
  const bH2H = getH2HSeries("B", "ft", parsed);
  const ftHasH2H =
    maybeReadH2HEnabled("ft", _ctxRoot?.h2hToggleSnapshot) && aH2H.length >= 2 && bH2H.length >= 2;
  let projAFT = aS;
  let projBFT = bS;

  let _ftRealH2HWeight = 0;
  if (ftHasH2H) {
    const massacreH2H = getMassacreH2HSeries(
      "ft",
      _ctxRoot.fixtureMeta || getCurrentFixtureMeta(),
      parsed,
      _ctxRoot,
    );
    const decayH2HA = massacreH2H.A.length >= 2 ? massacreH2H.A : aH2H;
    const decayH2HB = massacreH2H.B.length >= 2 ? massacreH2H.B : bH2H;

    const usedDecayA = massacreH2H.A.length >= 2;
    const usedDecayB = massacreH2H.B.length >= 2;

    const _ftH2hFactor = isFinite(config?.h2hFactor)
      ? Number(config.h2hFactor)
      : (getParam("h2hFactor", league) ?? 1.0);
    const _ftH2hW = massacreH2H.weights;
    const avgH2HA =
      _ftH2hW && _ftH2hW.length === decayH2HA.length
        ? (() => {
            let sv = 0,
              sw = 0;
            for (let i = 0; i < decayH2HA.length; i++) {
              const v = Number(decayH2HA[i]),
                w = Number(_ftH2hW[i]);
              if (isFinite(v) && isFinite(w) && w > 0) {
                sv += v * w;
                sw += w;
              }
            }
            return sw > 0 ? sv / sw : avgOrNaN(decayH2HA);
          })()
        : avgOrNaN(decayH2HA);
    const avgH2HB =
      _ftH2hW && _ftH2hW.length === decayH2HB.length
        ? (() => {
            let sv = 0,
              sw = 0;
            for (let i = 0; i < decayH2HB.length; i++) {
              const v = Number(decayH2HB[i]),
                w = Number(_ftH2hW[i]);
              if (isFinite(v) && isFinite(w) && w > 0) {
                sv += v * w;
                sw += w;
              }
            }
            return sw > 0 ? sv / sw : avgOrNaN(decayH2HB);
          })()
        : avgOrNaN(decayH2HB);
    // Divergence = |H2H total − current model total|, not |teamA − teamB|.
    const _modelTotalForH2H = isFinite(aS) && isFinite(bS) ? Number(aS) + Number(bS) : NaN;
    const _h2hTotalForDivergence =
      isFinite(avgH2HA) && isFinite(avgH2HB) ? Number(avgH2HA) + Number(avgH2HB) : NaN;
    const _h2hDivergence =
      isFinite(_modelTotalForH2H) && isFinite(_h2hTotalForDivergence)
        ? Math.abs(_h2hTotalForDivergence - _modelTotalForH2H)
        : 0;
    // FIX: divergence is total-point scale; baseline must be full-game total (eb), not per-team.
    const hw = getH2HWeight(
      decayH2HA.length,
      decayH2HB.length,
      "ft",
      ftSampleTier,
      _h2hDivergence,
      league,
      isFinite(eb) ? eb : leagueBase * 2,
      _ftH2hFactor,
      {
        injMultA,
        injMultB,
        volRatio: _ftVolRatio,
        blowoutGap: Math.abs(aS - bS),
        paceGapRisk: Math.abs((avgPaceA || 74) - (avgPaceB || 74)) > 6,
      },
    );

    assertInvariant(isFinite(hw) && hw >= 0 && hw <= 1, "ft.h2hWeight out of [0,1]", {
      hw,
      league,
      decayHA: decayH2HA.length,
      decayHB: decayH2HB.length,
    });

    projAFT = isFinite(projAFT)
      ? isFinite(avgH2HA)
        ? projAFT * (1 - hw) + avgH2HA * hw
        : projAFT
      : avgH2HA;
    projBFT = isFinite(projBFT)
      ? isFinite(avgH2HB)
        ? projBFT * (1 - hw) + avgH2HB * hw
        : projBFT
      : avgH2HB;

    const _aInjAdjBaseline =
      avgOrNaN(aFTS) * injMultA * (injMultB < 1 ? 1 + (1 - injMultB) * _injOppBoostFactor : 1);
    const _bInjAdjBaseline =
      avgOrNaN(bFTS) * injMultB * (injMultA < 1 ? 1 + (1 - injMultA) * _injOppBoostFactor : 1);
    const _postH2HVolLimit = volLimit * 1.35;
    projAFT = applyVolatility(projAFT, aFTS, _postH2HVolLimit, league, _aInjAdjBaseline);
    projBFT = applyVolatility(projBFT, bFTS, _postH2HVolLimit, league, _bInjAdjBaseline);

    assertInvariant(isFinite(projAFT) && isFinite(projBFT), "ft.postH2H projections not finite", {
      projAFT,
      projBFT,
      league,
      hw,
    });

    _ftRealH2HWeight = hw;
  }
  // A9 fix: a non-finite side used to default to 0 before summing, silently
  // turning "missing/invalid team projection" into "team scores 0" and
  // manufacturing a phantom edge against the total line. Propagate NaN so
  // the assertInvariant below fails loudly instead of returning a
  // plausible-looking wrong number.
  let ftProj = isFinite(projAFT) && isFinite(projBFT) ? projAFT + projBFT : NaN;

  assertInvariant(isFinite(ftProj) && ftProj >= 0, "ft.ftProj invalid", {
    ftProj,
    projAFT,
    projBFT,
    league,
  });

  let _restDaysA = isFinite(config?.restDaysA) ? Number(config.restDaysA) : (ctxA.restDays ?? 99);
  let _restDaysB = isFinite(config?.restDaysB) ? Number(config.restDaysB) : (ctxB.restDays ?? 99);
  // Under venue-neutral / forced symmetry, do not inject unequal fatigue from live context.
  if (_venueNeutral) {
    _restDaysA = 99;
    _restDaysB = 99;
  }
  const _fatigueIntelPack = { restDaysA: _restDaysA, restDaysB: _restDaysB };
  // FIX HIGH: apply fatigue at team level only; derive total as sum to preserve additivity.
  projAFT = applyDampedIntelSignal(
    projAFT,
    buildTeamMarketIntelSignal(_fatigueIntelPack, "A").signal,
    _ftVolRatio,
  );
  projBFT = applyDampedIntelSignal(
    projBFT,
    buildTeamMarketIntelSignal(_fatigueIntelPack, "B").signal,
    _ftVolRatio,
  );
  ftProj = isFinite(projAFT) && isFinite(projBFT) ? projAFT + projBFT : NaN;

  // FIX Issue 1: netVenueEffect is diagnostic only. Venue already lives in
  // aS_pre/bS_pre via computeVenueBlend; adding it again double-counts and
  // breaks ftProj === projAFT + projBFT.
  const netVenueEffect =
    (aVenueDiag?.enabled ? Number(aVenueDiag.offensiveAdjustment) || 0 : 0) +
    (bVenueDiag?.enabled ? Number(bVenueDiag.offensiveAdjustment) || 0 : 0);
  // deliberately NOT applied to ftProj

  const ftEdge =
    isFinite(ftProj) && isFinite(lines.ftLine) && lines.ftLine > 0 ? ftProj - lines.ftLine : NaN;
  const aEdge =
    isFinite(projAFT) && isFinite(lines.aLine) && lines.aLine > 0 ? projAFT - lines.aLine : NaN;
  const bEdge =
    isFinite(projBFT) && isFinite(lines.bLine) && lines.bLine > 0 ? projBFT - lines.bLine : NaN;

  return {
    eb,
    projAFT,
    projBFT,
    ftProj,
    ftSampleTier,
    ftHasH2H,
    ftEdge,
    aEdge,
    bEdge,
    ftFullModel: ftSampleTier === "full",
    teamFullModel: ftSampleTier === "full",
    ftProjectionOnly: !ftHasH2H && ftSampleTier === "thin",
    blowoutGap: Math.abs((projAFT || 0) - (projBFT || 0)),
    aS,
    bS,
    aScores: aFTS,
    bScores: bFTS,

    defensiveFloorFlag:
      (isFinite(aAllowed) && aAllowed <= leagueBaseFT * 0.92) ||
      (isFinite(bAllowed) && bAllowed <= leagueBaseFT * 0.92),
    missingDefense: !!(_missingDefenseA || _missingDefenseB),
    missingDefenseA: !!_missingDefenseA,
    missingDefenseB: !!_missingDefenseB,

    aVenueEnabled: aVenueDiag.enabled,
    bVenueEnabled: bVenueDiag.enabled,
    aVenueAdjustment: aVenueDiag,
    bVenueAdjustment: bVenueDiag,

    netVenueEffect,
    paceGapRisk: Math.abs((avgPaceA || 74) - (avgPaceB || 74)) > 6,
    pace: synPace,
    synNetA,
    synNetB,
    usedAdvanced,
    aVol: _aVolRatio * volLimit,
    bVol: _bVolRatio * volLimit,
    ftVolRatio: _ftVolRatio,

    ftH2HWeight: isFinite(_ftRealH2HWeight) ? _ftRealH2HWeight : 0,
  };
}

function compute1HProjection({
  league,
  parsed,
  lines,
  injMultA = 1,
  injMultB = 1,
  config = {},
  contextData = null,
}) {
  g_currentLiveComputeMarket = "h1";

  const _ctxRoot =
    contextData || (typeof AppState !== "undefined" ? AppState.context?.data : null) || {};

  const eb = getLeagueScoreBase(league);
  const volLimit = getMarketVolLimit(league, "h1");

  let aS1 = getManualSeries("A", "h1", parsed);
  let bS1 = getManualSeries("B", "h1", parsed);
  let aA1 = getManualAllowedSeries("A", "h1", parsed);
  let bA1 = getManualAllowedSeries("B", "h1", parsed);

  const _dateAwareAvgA1 = getDateAwareOrFallbackAverage(aS1, "A", "h1");
  const _dateAwareAvgB1 = getDateAwareOrFallbackAverage(bS1, "B", "h1");

  const h1SampleTier = getSampleTier(aS1, bS1);
  if (h1SampleTier === "insufficient") {
    return {
      h1Proj: NaN,
      h1Edge: NaN,
      projA1H: NaN,
      projB1H: NaN,
      h1SampleTier,
      h1HasH2H: false,
      h1ProjectionOnly: true,
      h1FullModel: false,
      paceGapRisk: false,
      defensiveFloorFlag: false,
      aVol1: 0,
      bVol1: 0,
      aS1: NaN,
      bS1: NaN,
    };
  }

  const aVenueH1S = getFetchedSeries("A", "venue", "h1", "scored", _ctxRoot);
  const bVenueH1S = getFetchedSeries("B", "venue", "h1", "scored", _ctxRoot);
  const aVenueH1A = getFetchedSeries("A", "venue", "h1", "allowed", _ctxRoot);
  const bVenueH1A = getFetchedSeries("B", "venue", "h1", "allowed", _ctxRoot);

  const aScoredBlend1 = computeVenueBlend(_dateAwareAvgA1, avgOrNaN(aVenueH1S), aVenueH1S.length);
  const bScoredBlend1 = computeVenueBlend(_dateAwareAvgB1, avgOrNaN(bVenueH1S), bVenueH1S.length);
  const aAllowedBlend1 = computeVenueBlend(avgOrNaN(aA1), avgOrNaN(aVenueH1A), aVenueH1A.length);
  const bAllowedBlend1 = computeVenueBlend(avgOrNaN(bA1), avgOrNaN(bVenueH1A), bVenueH1A.length);
  const aVenueDiag1 = combineVenueDiag(aScoredBlend1.diag, aAllowedBlend1.diag);
  const bVenueDiag1 = combineVenueDiag(bScoredBlend1.diag, bAllowedBlend1.diag);

  const sampleSize = Math.min(aS1.length, bS1.length);
  // FIX CRITICAL: half prior was hard-coded total/4. Use tunable half-share of team full prior.
  const _halfShare1H = (typeof getParam === "function" ? getParam("halfShareH1", league) : null) ?? 0.5;
  const leagueBase1H = (eb / 2) * (Number.isFinite(_halfShare1H) ? Math.min(0.7, Math.max(0.3, Number(_halfShare1H))) : 0.5);
  let aS_pre = anchorProjection(aScoredBlend1.value, sampleSize, leagueBase1H);
  let bS_pre = anchorProjection(bScoredBlend1.value, sampleSize, leagueBase1H);

  let aAllowed = aAllowedBlend1.value;
  let bAllowed = bAllowedBlend1.value;
  if (isFinite(aAllowed)) aAllowed = anchorProjection(aAllowed, sampleSize, leagueBase1H);
  if (isFinite(bAllowed)) bAllowed = anchorProjection(bAllowed, sampleSize, leagueBase1H);

  const isEspnLeague = Object.prototype.hasOwnProperty.call(ESPN_LEAGUE_SLUGS, league);
  const leaguePaceBase = LEAGUE_PACE_BASES[league] || LEAGUE_PACE_BASES.default || 74;
  const leagueRatingBase =
    LEAGUE_RATING_BASES[league] ||
    LEAGUE_RATING_BASES.default *
      ((LEAGUE_BASES[league] || LEAGUE_BASES.unknown) / LEAGUE_BASES.unknown) ||
    110;

  const ctxA = _ctxRoot.A || {};
  const ctxB = _ctxRoot.B || {};
  // Prefer H1-native box advanced series when auto-fetch built them.
  const _advA1 =
    typeof getPeriodAdvancedSeries === "function"
      ? getPeriodAdvancedSeries(ctxA, "h1")
      : { ortg: [], drtg: [], pace: [], source: "none" };
  const _advB1 =
    typeof getPeriodAdvancedSeries === "function"
      ? getPeriodAdvancedSeries(ctxB, "h1")
      : { ortg: [], drtg: [], pace: [], source: "none" };
  // Honesty: never fall back to FT ORTG for 1H. Period-native series only, else points-only.
  const _usePeriod1 =
    _advA1.source === "h1" &&
    _advB1.source === "h1" &&
    (_advA1.ortg || []).length >= 5 &&
    (_advB1.ortg || []).length >= 5;
  const _ortgArrA1 = _usePeriod1 ? _advA1.ortg : [];
  const _drtgArrA1 = _usePeriod1 ? _advA1.drtg : [];
  const _ortgArrB1 = _usePeriod1 ? _advB1.ortg : [];
  const _drtgArrB1 = _usePeriod1 ? _advB1.drtg : [];
  const _paceArrA1 = _usePeriod1 && _advA1.pace.length ? _advA1.pace : [];
  const _paceArrB1 = _usePeriod1 && _advB1.pace.length ? _advB1.pace : [];

  const avgPaceA = avgOrNaN(_paceArrA1);
  const avgPaceB = avgOrNaN(_paceArrB1);
  const clamp = getEffectivePaceClamp(league);

  let hasRealPace = isFinite(avgPaceA) && avgPaceA > 0 && isFinite(avgPaceB) && avgPaceB > 0;
  hasRealPace = hasRealPace && _paceArrA1.length >= 5 && _paceArrB1.length >= 5;

  let hasRealRatings =
    isFinite(avgOrNaN(_ortgArrA1)) &&
    isFinite(avgOrNaN(_drtgArrA1)) &&
    isFinite(avgOrNaN(_ortgArrB1)) &&
    isFinite(avgOrNaN(_drtgArrB1)) &&
    _ortgArrA1.length >= 5 &&
    _ortgArrB1.length >= 5;

  const leaguePaceNorm1H = 48 / (getLeagueRegulationMinutes(league) || 48);
  let synPace = leaguePaceBase;
  if (hasRealPace) {
    const rawPace = (avgPaceA + avgPaceB) / 2;
    synPace = clampNumber(
      rawPace,
      leaguePaceBase * leaguePaceNorm1H * clamp.min,
      leaguePaceBase * leaguePaceNorm1H * clamp.max,
    );
  }

  let projA1H, projB1H;
  const _tw1 = isFinite(config?.teamWeight) ? Number(config.teamWeight) : 0.65;
  const _ow1 = 1 - _tw1;
  const _missingDefenseA1 = !isFinite(bAllowed);
  const _missingDefenseB1 = !isFinite(aAllowed);
  const projA1H_points =
    isFinite(aS_pre) && isFinite(bAllowed) ? aS_pre * _tw1 + bAllowed * _ow1 : aS_pre;
  const projB1H_points =
    isFinite(bS_pre) && isFinite(aAllowed) ? bS_pre * _tw1 + aAllowed * _ow1 : bS_pre;

  if (isEspnLeague && hasRealRatings && hasRealPace) {
    const _betaO1 = Math.min(1.5, Math.max(0.25, Number((typeof getParam === "function" ? getParam("advBetaOffense", league) : null) ?? 1.0)));
    const _betaD1 = Math.min(1.5, Math.max(0.25, Number((typeof getParam === "function" ? getParam("advBetaDefense", league) : null) ?? 1.0)));
    // FIX Issue 2: DRTG sign matches quarters / FT.
    const projectedRatingA =
      leagueRatingBase + _betaO1 * (avgOrNaN(_ortgArrA1) - leagueRatingBase) + _betaD1 * (avgOrNaN(_drtgArrB1) - leagueRatingBase);
    const projectedRatingB =
      leagueRatingBase + _betaO1 * (avgOrNaN(_ortgArrB1) - leagueRatingBase) + _betaD1 * (avgOrNaN(_drtgArrA1) - leagueRatingBase);
    const _h1RegMinutes = getLeagueRegulationMinutes(league);
    const halfDivisor = 200 * (48 / _h1RegMinutes);
    let projA1H_adv = (synPace * projectedRatingA) / halfDivisor;
    let projB1H_adv = (synPace * projectedRatingB) / halfDivisor;
    const advTotal1H =
      (isFinite(projA1H_adv) ? projA1H_adv : 0) + (isFinite(projB1H_adv) ? projB1H_adv : 0);
    const _eb1 = isFinite(eb) ? eb : 220;
    const advSane1H =
      isFinite(advTotal1H) &&
      advTotal1H >= _eb1 * 0.36 &&
      advTotal1H <= _eb1 * 0.64 &&
      isFinite(projA1H_adv) &&
      isFinite(projB1H_adv);
    const _advW1 = isFinite(config?.advancedBlendWeight)
      ? Number(config.advancedBlendWeight)
      : isFinite(getParam("advancedBlendWeight", league))
        ? Number(getParam("advancedBlendWeight", league))
        : 0.45;
    if (advSane1H && _advW1 > 0) {
      const w = Math.max(0, Math.min(1, _advW1));
      projA1H = projA1H_points * (1 - w) + projA1H_adv * w;
      projB1H = projB1H_points * (1 - w) + projB1H_adv * w;
    } else {
      projA1H = projA1H_points;
      projB1H = projB1H_points;
    }
  } else {
    projA1H = projA1H_points;
    projB1H = projB1H_points;
  }

  projA1H = applyVolatility(projA1H, aS1, volLimit, league);
  projB1H = applyVolatility(projB1H, bS1, volLimit, league);

  projA1H *= injMultA;
  projB1H *= injMultB;

  const _injOppBoostFactorH1 =
    getParam("injuryOppBoostFactor", league) ?? INJURY_OPPONENT_BOOST_FACTOR;
  if (injMultA < 1) projB1H *= 1 + Math.min(0.2, (1 - injMultA) * _injOppBoostFactorH1);
  if (injMultB < 1) projA1H *= 1 + Math.min(0.2, (1 - injMultB) * _injOppBoostFactorH1);

  const aVol1 = getVolatilityRatioForSeries(aS1, volLimit);
  const bVol1 = getVolatilityRatioForSeries(bS1, volLimit);
  const _aTotalSd1 = Number(aVol1) * Number(volLimit);
  const _bTotalSd1 = Number(bVol1) * Number(volLimit);
  const _h1TotalSd = Math.sqrt(
    (isFinite(_aTotalSd1) ? _aTotalSd1 * _aTotalSd1 : 0) +
      (isFinite(_bTotalSd1) ? _bTotalSd1 * _bTotalSd1 : 0),
  );
  const combinedVol =
    isFinite(_h1TotalSd) && isFinite(volLimit) && volLimit > 0
      ? clampNumber(_h1TotalSd / volLimit, 0.5, 2.5)
      : Math.max(aVol1 || 0, bVol1 || 0);

  const aH2H = getH2HSeries("A", "h1", parsed);
  const bH2H = getH2HSeries("B", "h1", parsed);
  const h1HasH2H =
    maybeReadH2HEnabled("h1", _ctxRoot?.h2hToggleSnapshot) && aH2H.length >= 2 && bH2H.length >= 2;
  if (h1HasH2H) {
    const massacreH2H = getMassacreH2HSeries(
      "h1",
      _ctxRoot.fixtureMeta || getCurrentFixtureMeta(),
      parsed,
      _ctxRoot,
    );
    const decayH2HA = massacreH2H.A.length >= 2 ? massacreH2H.A : aH2H;
    const decayH2HB = massacreH2H.B.length >= 2 ? massacreH2H.B : bH2H;

    const usedDecayA = massacreH2H.A.length >= 2;
    const usedDecayB = massacreH2H.B.length >= 2;

    const _h1H2hFactor = isFinite(config?.h2hFactor)
      ? Number(config.h2hFactor)
      : (getParam("h2hFactor", league) ?? 1.0);
    const _h1H2hW = massacreH2H.weights;
    const avgH2HA =
      _h1H2hW && _h1H2hW.length === decayH2HA.length
        ? (() => {
            let sv = 0,
              sw = 0;
            for (let i = 0; i < decayH2HA.length; i++) {
              const v = Number(decayH2HA[i]),
                w = Number(_h1H2hW[i]);
              if (isFinite(v) && isFinite(w) && w > 0) {
                sv += v * w;
                sw += w;
              }
            }
            return sw > 0 ? sv / sw : avgOrNaN(decayH2HA);
          })()
        : avgOrNaN(decayH2HA);
    const avgH2HB =
      _h1H2hW && _h1H2hW.length === decayH2HB.length
        ? (() => {
            let sv = 0,
              sw = 0;
            for (let i = 0; i < decayH2HB.length; i++) {
              const v = Number(decayH2HB[i]),
                w = Number(_h1H2hW[i]);
              if (isFinite(v) && isFinite(w) && w > 0) {
                sv += v * w;
                sw += w;
              }
            }
            return sw > 0 ? sv / sw : avgOrNaN(decayH2HB);
          })()
        : avgOrNaN(decayH2HB);
    const _modelTotalForH2H1 =
      isFinite(projA1H) && isFinite(projB1H) ? Number(projA1H) + Number(projB1H) : NaN;
    const _h2hTotalForDivergence1 =
      isFinite(avgH2HA) && isFinite(avgH2HB) ? Number(avgH2HA) + Number(avgH2HB) : NaN;
    const _h2hDivergence1 =
      isFinite(_modelTotalForH2H1) && isFinite(_h2hTotalForDivergence1)
        ? Math.abs(_h2hTotalForDivergence1 - _modelTotalForH2H1)
        : 0;
    const hw = getH2HWeight(
      decayH2HA.length,
      decayH2HB.length,
      "h1",
      h1SampleTier,
      _h2hDivergence1,
      league,
      // FIX Issue 6: baseline must be half TOTAL scale (same units as H2H sum divergence).
      (isFinite(leagueBase1H) ? leagueBase1H * 2 : leagueBase1H),
      _h1H2hFactor,
      {
        enabled: h1HasH2H,
        injMultA,
        injMultB,
        volRatio: combinedVol,
        blowoutGap: Math.abs(projA1H - projB1H),
        paceGapRisk: Math.abs((avgPaceA || 74) - (avgPaceB || 74)) > 6,
      },
    );

    assertInvariant(isFinite(hw) && hw >= 0 && hw <= 1, "h1.h2hWeight out of [0,1]", {
      hw,
      league,
      decayHA: decayH2HA.length,
      decayHB: decayH2HB.length,
    });

    projA1H = isFinite(projA1H)
      ? isFinite(avgH2HA)
        ? projA1H * (1 - hw) + avgH2HA * hw
        : projA1H
      : avgH2HA;
    projB1H = isFinite(projB1H)
      ? isFinite(avgH2HB)
        ? projB1H * (1 - hw) + avgH2HB * hw
        : projB1H
      : avgH2HB;

    const _aInjAdjBaseline1H =
      avgOrNaN(aS1) *
      injMultA *
      (injMultB < 1 ? 1 + Math.min(0.2, (1 - injMultB) * _injOppBoostFactorH1) : 1);
    const _bInjAdjBaseline1H =
      avgOrNaN(bS1) *
      injMultB *
      (injMultA < 1 ? 1 + Math.min(0.2, (1 - injMultA) * _injOppBoostFactorH1) : 1);
    const _postH2HVolLimit1H = volLimit * 1.35;
    projA1H = applyVolatility(projA1H, aS1, _postH2HVolLimit1H, league, _aInjAdjBaseline1H);
    projB1H = applyVolatility(projB1H, bS1, _postH2HVolLimit1H, league, _bInjAdjBaseline1H);

    assertInvariant(isFinite(projA1H) && isFinite(projB1H), "h1.postH2H projections not finite", {
      projA1H,
      projB1H,
      league,
      hw,
    });
  }
  // A9 fix: see matching fix in computeFTProjection — propagate NaN instead
  // of silently defaulting a non-finite side to 0 before summing.
  let h1Proj = isFinite(projA1H) && isFinite(projB1H) ? projA1H + projB1H : NaN;

  assertInvariant(isFinite(h1Proj) && h1Proj >= 0, "h1.h1Proj invalid", {
    h1Proj,
    projA1H,
    projB1H,
    league,
  });

  const h1Edge =
    isFinite(h1Proj) && isFinite(lines.h1Line) && lines.h1Line > 0 ? h1Proj - lines.h1Line : NaN;
  return {
    h1Proj,
    h1Edge,
    projA1H,
    projB1H,
    h1SampleTier,
    h1HasH2H,
    h1ProjectionOnly: !h1HasH2H && h1SampleTier === "thin",
    h1FullModel: h1SampleTier === "full",
    paceGapRisk: Math.abs((avgPaceA || 74) - (avgPaceB || 74)) > 6,
    defensiveFloorFlag:
      (isFinite(aAllowed) && aAllowed <= leagueBase1H * 0.92) ||
      (isFinite(bAllowed) && bAllowed <= leagueBase1H * 0.92),
    aVol1,
    bVol1,
    // FIX (CRITICAL #4/#9): the canonical combined-team volatility ratio
    // (sqrt(sdA^2+sdB^2)/volLimit), already used above for H2H weighting.
    // Downstream confidence-grading must reuse this exact value instead of
    // recomputing max(aVol1,bVol1), which understates combined uncertainty.
    h1VolRatio: combinedVol,
    aS1: avgOrNaN(aS1),
    bS1: avgOrNaN(bS1),

    aVenueEnabled: aVenueDiag1.enabled,
    bVenueEnabled: bVenueDiag1.enabled,
    aVenueAdjustment: aVenueDiag1,
    bVenueAdjustment: bVenueDiag1,
  };
}

function compute2HProjection({
  league,
  parsed,
  lines,
  injMultA = 1,
  injMultB = 1,
  config = {},
  contextData = null,
}) {
  const _ctxRoot2H =
    contextData || (typeof AppState !== "undefined" ? AppState.context?.data : null) || {};
  g_currentLiveComputeMarket = "h2";
  const eb = getLeagueScoreBase(league);
  const volLimit = getMarketVolLimit(league, "h2");

  let aS2 = getManualSeries("A", "h2", parsed, _ctxRoot2H);
  let bS2 = getManualSeries("B", "h2", parsed, _ctxRoot2H);
  let aA2 = getManualAllowedSeries("A", "h2", parsed);
  let bA2 = getManualAllowedSeries("B", "h2", parsed);

  const _dateAwareAvgA2 = getDateAwareOrFallbackAverage(aS2, "A", "h2");
  const _dateAwareAvgB2 = getDateAwareOrFallbackAverage(bS2, "B", "h2");

  const h2SampleTier = getSampleTier(aS2, bS2);
  if (h2SampleTier === "insufficient") {
    return {
      h2Proj: NaN,
      h2Edge: NaN,
      projA2H: NaN,
      projB2H: NaN,
      h2SampleTier,
      h2HasH2H: false,
      h2ProjectionOnly: true,
      h2FullModel: false,
      paceGapRisk: false,
      defensiveFloorFlag: false,
      aVol2: 0,
      bVol2: 0,
      aS2: NaN,
      bS2: NaN,
    };
  }

  const aScoredBlend2 = computeVenueBlend(_dateAwareAvgA2, NaN, 0);
  const bScoredBlend2 = computeVenueBlend(_dateAwareAvgB2, NaN, 0);
  const aAllowedBlend2 = computeVenueBlend(avgOrNaN(aA2), NaN, 0);
  const bAllowedBlend2 = computeVenueBlend(avgOrNaN(bA2), NaN, 0);

  const sampleSize = Math.min(aS2.length, bS2.length);

  // FIX CRITICAL: half prior was hard-coded total/4. Use tunable half-share of team full prior.
  const _halfShare2H = (typeof getParam === "function" ? getParam("halfShareH2", league) : null) ?? 0.5;
  const leagueBase2H = (eb / 2) * (Number.isFinite(_halfShare2H) ? Math.min(0.7, Math.max(0.3, Number(_halfShare2H))) : 0.5);
  let aS_pre = anchorProjection(aScoredBlend2.value, sampleSize, leagueBase2H);
  let bS_pre = anchorProjection(bScoredBlend2.value, sampleSize, leagueBase2H);

  let aAllowed = aAllowedBlend2.value;
  let bAllowed = bAllowedBlend2.value;
  if (isFinite(aAllowed)) aAllowed = anchorProjection(aAllowed, sampleSize, leagueBase2H);
  if (isFinite(bAllowed)) bAllowed = anchorProjection(bAllowed, sampleSize, leagueBase2H);

  const isEspnLeague = Object.prototype.hasOwnProperty.call(ESPN_LEAGUE_SLUGS, league);
  const leaguePaceBase = LEAGUE_PACE_BASES[league] || LEAGUE_PACE_BASES.default || 74;
  const leagueRatingBase =
    LEAGUE_RATING_BASES[league] ||
    LEAGUE_RATING_BASES.default *
      ((LEAGUE_BASES[league] || LEAGUE_BASES.unknown) / LEAGUE_BASES.unknown) ||
    110;

  const ctxA = _ctxRoot2H.A || {};
  const ctxB = _ctxRoot2H.B || {};
  // Period-native H2 pace only (mirror compute1HProjection) — never gate on FT pace10
  const _advA2early =
    typeof getPeriodAdvancedSeries === "function"
      ? getPeriodAdvancedSeries(ctxA, "h2")
      : { pace: [], source: "none" };
  const _advB2early =
    typeof getPeriodAdvancedSeries === "function"
      ? getPeriodAdvancedSeries(ctxB, "h2")
      : { pace: [], source: "none" };
  const _usePeriod2Pace =
    _advA2early.source === "h2" &&
    _advB2early.source === "h2" &&
    (_advA2early.pace || []).length >= 5 &&
    (_advB2early.pace || []).length >= 5;
  const _paceArrA2 = _usePeriod2Pace ? _advA2early.pace || [] : [];
  const _paceArrB2 = _usePeriod2Pace ? _advB2early.pace || [] : [];
  const avgPaceA = avgOrNaN(_paceArrA2);
  const avgPaceB = avgOrNaN(_paceArrB2);
  const clamp = getEffectivePaceClamp(league);

  let hasRealPace = isFinite(avgPaceA) && avgPaceA > 0 && isFinite(avgPaceB) && avgPaceB > 0;
  hasRealPace = hasRealPace && _paceArrA2.length >= 5 && _paceArrB2.length >= 5;
  // No FT ORTG gate on 2H — advanced path uses period-native H2 series or synthetic H2 points/pace only.

  const leaguePaceNorm2H = 48 / (getLeagueRegulationMinutes(league) || 48);
  let synPace = leaguePaceBase;
  if (hasRealPace) {
    const rawPace = (avgPaceA + avgPaceB) / 2;
    synPace = clampNumber(
      rawPace,
      leaguePaceBase * leaguePaceNorm2H * clamp.min,
      leaguePaceBase * leaguePaceNorm2H * clamp.max,
    );
  }

  let projA2H, projB2H;
  const _tw2 = isFinite(config?.teamWeight) ? Number(config.teamWeight) : 0.65;
  const _ow2 = 1 - _tw2;
  const projA2H_points =
    isFinite(aS_pre) && isFinite(bAllowed) ? aS_pre * _tw2 + bAllowed * _ow2 : aS_pre;
  const projB2H_points =
    isFinite(bS_pre) && isFinite(aAllowed) ? bS_pre * _tw2 + aAllowed * _ow2 : bS_pre;

  // 2H advanced: prefer auto-fetch H2 box series (possessions × H2 points).
  // Fallback: synthetic efficiency from H2 scored/allowed + game pace (no FT ORTG).
  {
    const _h2RegMinutes = getLeagueRegulationMinutes(league) || 48;
    const halfDivisor = 200 * (48 / _h2RegMinutes);
    const _advA2 =
      typeof getPeriodAdvancedSeries === "function"
        ? getPeriodAdvancedSeries(ctxA, "h2")
        : { ortg: [], drtg: [], pace: [], source: "none" };
    const _advB2 =
      typeof getPeriodAdvancedSeries === "function"
        ? getPeriodAdvancedSeries(ctxB, "h2")
        : { ortg: [], drtg: [], pace: [], source: "none" };
    let ortgA_h2,
      drtgA_h2,
      ortgB_h2,
      drtgB_h2,
      paceForAdv = synPace;

    if (_advA2.source === "h2" && _advB2.source === "h2") {
      ortgA_h2 = avgOrNaN(_advA2.ortg);
      drtgA_h2 = avgOrNaN(_advA2.drtg);
      ortgB_h2 = avgOrNaN(_advB2.ortg);
      drtgB_h2 = avgOrNaN(_advB2.drtg);
      const pA = avgOrNaN(_advA2.pace);
      const pB = avgOrNaN(_advB2.pace);
      if (isFinite(pA) && pA > 0 && isFinite(pB) && pB > 0) paceForAdv = (pA + pB) / 2;
    } else {
      const halfMins = _h2RegMinutes / 2;
      const halfPoss = isFinite(synPace) && synPace > 0 ? (synPace * halfMins) / 48 : NaN;
      ortgA_h2 =
        isFinite(halfPoss) && halfPoss > 0 && isFinite(aS_pre) ? (100 * aS_pre) / halfPoss : NaN;
      drtgA_h2 =
        isFinite(halfPoss) && halfPoss > 0 && isFinite(aAllowed)
          ? (100 * aAllowed) / halfPoss
          : NaN;
      ortgB_h2 =
        isFinite(halfPoss) && halfPoss > 0 && isFinite(bS_pre) ? (100 * bS_pre) / halfPoss : NaN;
      drtgB_h2 =
        isFinite(halfPoss) && halfPoss > 0 && isFinite(bAllowed)
          ? (100 * bAllowed) / halfPoss
          : NaN;
    }

    const hasNativeAdv2H =
      isFinite(ortgA_h2) &&
      isFinite(drtgA_h2) &&
      isFinite(ortgB_h2) &&
      isFinite(drtgB_h2) &&
      isFinite(paceForAdv) &&
      paceForAdv > 0;

    if (hasNativeAdv2H) {
      const _betaO2 = Math.min(1.5, Math.max(0.25, Number((typeof getParam === "function" ? getParam("advBetaOffense", league) : null) ?? 1.0)));
      const _betaD2 = Math.min(1.5, Math.max(0.25, Number((typeof getParam === "function" ? getParam("advBetaDefense", league) : null) ?? 1.0)));
      // FIX Issue 2: DRTG sign matches quarters / FT.
      const projectedRatingA =
        leagueRatingBase + _betaO2 * (ortgA_h2 - leagueRatingBase) + _betaD2 * (drtgB_h2 - leagueRatingBase);
      const projectedRatingB =
        leagueRatingBase + _betaO2 * (ortgB_h2 - leagueRatingBase) + _betaD2 * (drtgA_h2 - leagueRatingBase);
      let projA2H_adv = (paceForAdv * projectedRatingA) / halfDivisor;
      let projB2H_adv = (paceForAdv * projectedRatingB) / halfDivisor;
      const advTotal2H =
        (isFinite(projA2H_adv) ? projA2H_adv : 0) + (isFinite(projB2H_adv) ? projB2H_adv : 0);
      const _eb2 = isFinite(eb) ? eb : 220;
      // Match 1H band [0.36, 0.64] × expected full-game total (was loose: >0 && <1.15×eb)
      const advSane2H =
        isFinite(advTotal2H) &&
        advTotal2H >= _eb2 * 0.36 &&
        advTotal2H <= _eb2 * 0.64 &&
        isFinite(projA2H_adv) &&
        isFinite(projB2H_adv);
      const _advW2 = isFinite(config?.advancedBlendWeight)
        ? Number(config.advancedBlendWeight)
        : isFinite(getParam("advancedBlendWeight", league))
          ? Number(getParam("advancedBlendWeight", league))
          : 0.45;
      if (advSane2H && _advW2 > 0) {
        const w = Math.max(0, Math.min(1, _advW2));
        projA2H = projA2H_points * (1 - w) + projA2H_adv * w;
        projB2H = projB2H_points * (1 - w) + projB2H_adv * w;
      } else {
        projA2H = projA2H_points;
        projB2H = projB2H_points;
      }
    } else {
      projA2H = projA2H_points;
      projB2H = projB2H_points;
    }
  }

  projA2H = applyVolatility(projA2H, aS2, volLimit, league);
  projB2H = applyVolatility(projB2H, bS2, volLimit, league);

  projA2H *= injMultA;
  projB2H *= injMultB;

  const _injOppBoostFactorH2 =
    getParam("injuryOppBoostFactor", league) ?? INJURY_OPPONENT_BOOST_FACTOR;
  if (injMultA < 1) projB2H *= 1 + Math.min(0.2, (1 - injMultA) * _injOppBoostFactorH2);
  if (injMultB < 1) projA2H *= 1 + Math.min(0.2, (1 - injMultB) * _injOppBoostFactorH2);

  const aVol2 = getVolatilityRatioForSeries(aS2, volLimit);
  const bVol2 = getVolatilityRatioForSeries(bS2, volLimit);
  const _aTotalSd2 = Number(aVol2) * Number(volLimit);
  const _bTotalSd2 = Number(bVol2) * Number(volLimit);
  const _h2TotalSd = Math.sqrt(
    (isFinite(_aTotalSd2) ? _aTotalSd2 * _aTotalSd2 : 0) +
      (isFinite(_bTotalSd2) ? _bTotalSd2 * _bTotalSd2 : 0),
  );
  const combinedVol2 =
    isFinite(_h2TotalSd) && isFinite(volLimit) && volLimit > 0
      ? clampNumber(_h2TotalSd / volLimit, 0.5, 2.5)
      : Math.max(aVol2 || 0, bVol2 || 0);

  const aH2H = getH2HSeries("A", "h2", parsed);
  const bH2H = getH2HSeries("B", "h2", parsed);
  const h2HasH2H =
    maybeReadH2HEnabled("h2", _ctxRoot2H?.h2hToggleSnapshot) &&
    aH2H.length >= 2 &&
    bH2H.length >= 2;
  if (h2HasH2H) {
    const massacreH2H = getMassacreH2HSeries(
      "h2",
      _ctxRoot2H.fixtureMeta || getCurrentFixtureMeta(),
      parsed,
      _ctxRoot2H,
    );
    const decayH2HA = massacreH2H.A.length >= 2 ? massacreH2H.A : aH2H;
    const decayH2HB = massacreH2H.B.length >= 2 ? massacreH2H.B : bH2H;
    const _h2H2hFactor = isFinite(config?.h2hFactor)
      ? Number(config.h2hFactor)
      : (getParam("h2hFactor", league) ?? 1.0);
    const _h2H2hW = massacreH2H.weights;
    const avgH2HA =
      _h2H2hW && _h2H2hW.length === decayH2HA.length
        ? (() => {
            let sv = 0,
              sw = 0;
            for (let i = 0; i < decayH2HA.length; i++) {
              const v = Number(decayH2HA[i]),
                w = Number(_h2H2hW[i]);
              if (isFinite(v) && isFinite(w) && w > 0) {
                sv += v * w;
                sw += w;
              }
            }
            return sw > 0 ? sv / sw : avgOrNaN(decayH2HA);
          })()
        : avgOrNaN(decayH2HA);
    const avgH2HB =
      _h2H2hW && _h2H2hW.length === decayH2HB.length
        ? (() => {
            let sv = 0,
              sw = 0;
            for (let i = 0; i < decayH2HB.length; i++) {
              const v = Number(decayH2HB[i]),
                w = Number(_h2H2hW[i]);
              if (isFinite(v) && isFinite(w) && w > 0) {
                sv += v * w;
                sw += w;
              }
            }
            return sw > 0 ? sv / sw : avgOrNaN(decayH2HB);
          })()
        : avgOrNaN(decayH2HB);
    const _modelTotalForH2H2 =
      isFinite(projA2H) && isFinite(projB2H) ? Number(projA2H) + Number(projB2H) : NaN;
    const _h2hTotalForDivergence2 =
      isFinite(avgH2HA) && isFinite(avgH2HB) ? Number(avgH2HA) + Number(avgH2HB) : NaN;
    const _h2hDivergence2 =
      isFinite(_modelTotalForH2H2) && isFinite(_h2hTotalForDivergence2)
        ? Math.abs(_h2hTotalForDivergence2 - _modelTotalForH2H2)
        : 0;
    const hw = getH2HWeight(
      decayH2HA.length,
      decayH2HB.length,
      "h2",
      h2SampleTier,
      _h2hDivergence2,
      league,
      // FIX Issue 6: baseline must be half TOTAL scale.
      (isFinite(leagueBase2H) ? leagueBase2H * 2 : leagueBase2H),
      _h2H2hFactor,
      {
        enabled: h2HasH2H,
        injMultA,
        injMultB,
        volRatio: combinedVol2,
        blowoutGap: Math.abs(projA2H - projB2H),
        paceGapRisk: Math.abs((avgPaceA || 74) - (avgPaceB || 74)) > 6,
      },
    );
    assertInvariant(isFinite(hw) && hw >= 0 && hw <= 1, "h2.h2hWeight out of [0,1]", {
      hw,
      league,
      decayHA: decayH2HA.length,
      decayHB: decayH2HB.length,
    });
    projA2H = isFinite(projA2H)
      ? isFinite(avgH2HA)
        ? projA2H * (1 - hw) + avgH2HA * hw
        : projA2H
      : avgH2HA;
    projB2H = isFinite(projB2H)
      ? isFinite(avgH2HB)
        ? projB2H * (1 - hw) + avgH2HB * hw
        : projB2H
      : avgH2HB;

    const _aInjAdjBaseline2H =
      avgOrNaN(aS2) *
      injMultA *
      (injMultB < 1 ? 1 + Math.min(0.2, (1 - injMultB) * _injOppBoostFactorH2) : 1);
    const _bInjAdjBaseline2H =
      avgOrNaN(bS2) *
      injMultB *
      (injMultA < 1 ? 1 + Math.min(0.2, (1 - injMultA) * _injOppBoostFactorH2) : 1);
    const _postH2HVolLimit2H = volLimit * 1.35;
    projA2H = applyVolatility(projA2H, aS2, _postH2HVolLimit2H, league, _aInjAdjBaseline2H);
    projB2H = applyVolatility(projB2H, bS2, _postH2HVolLimit2H, league, _bInjAdjBaseline2H);
    assertInvariant(isFinite(projA2H) && isFinite(projB2H), "h2.postH2H projections not finite", {
      projA2H,
      projB2H,
      league,
      hw,
    });
  }

  // A9 fix: see matching fix in computeFTProjection — propagate NaN instead
  // of silently defaulting a non-finite side to 0 before summing.
  let h2Proj = isFinite(projA2H) && isFinite(projB2H) ? projA2H + projB2H : NaN;
  assertInvariant(isFinite(h2Proj) && h2Proj >= 0, "h2.h2Proj invalid", {
    h2Proj,
    projA2H,
    projB2H,
    league,
  });

  const h2Edge =
    isFinite(h2Proj) && isFinite(lines.h2Line) && lines.h2Line > 0 ? h2Proj - lines.h2Line : NaN;
  return {
    h2Proj,
    h2Edge,
    projA2H,
    projB2H,
    h2SampleTier,
    h2HasH2H,
    h2ProjectionOnly: !h2HasH2H && h2SampleTier === "thin",
    h2FullModel: h2SampleTier === "full",
    paceGapRisk: Math.abs((avgPaceA || 74) - (avgPaceB || 74)) > 6,
    defensiveFloorFlag:
      (isFinite(aAllowed) && aAllowed <= leagueBase2H * 0.92) ||
      (isFinite(bAllowed) && bAllowed <= leagueBase2H * 0.92),
    aVol2,
    bVol2,
    // FIX (CRITICAL #4/#9): canonical combined-team volatility ratio, mirrors
    // h1VolRatio above — see comment there.
    h2VolRatio: combinedVol2,
    aS2: avgOrNaN(aS2),
    bS2: avgOrNaN(bS2),
  };
}

function getMarketVolLimit(league, marketKey) {
  const base = getParam("volatilityLimit", league) ?? 12;

  const key = String(marketKey || "").toLowerCase();

  if (key === "h1" || key === "h1_team_a" || key === "h1_team_b")
    return base * (getParam("h1VolScale", league) ?? 0.7071);

  // FIX Issue 14: dedicated h2VolScale (falls back to h1VolScale / half default).
  if (key === "h2")
    return base * (getParam("h2VolScale", league) ?? getParam("h1VolScale", league) ?? 0.7071);

  if (key === "team_a" || key === "team_b") return base * (getParam("teamVolScale", league) ?? 0.5);
  if (key.startsWith("q")) return base * (getParam("quarterVolScale", league) ?? 0.5);
  return base;
}

function getSeasonYearForDateAndLeague(dateObj, league) {
  const year = dateObj.getUTCFullYear();
  const month = dateObj.getUTCMonth();
  const l = String(league || "").toLowerCase();

  if (["nba", "ncaa", "ncaaw", "nba_gl"].includes(l) && month >= 9) return year + 1;
  if (["wnba", "wnba_pre"].includes(l)) return year;

  const singleYearLeagues = [
    "cebl",
    "pba",
    "phil_mpbl",
    "indonesia_ibl",
    "bal",
    "rwanda",
    "fiba_wc",
    "fiba_eb",
    "fiba_u20eb_a",
    "fiba_u20eb_b",
    "fiba_ac",
    "fiba_wc_q_africa",
    "fiba_wc_q_americas",
    "fiba_wc_q_asia",
    "fiba_wc_q_europe",
    "fiba_eb_q",
    "fiba_asia_preq",
    "puerto_rico_bsn",
    "chile_lnb",
    "chile_lnb2",
    "el_salvador_lmb",
    "uruguay_lub",
    "uruguay_lfb_w",
    "venezuela_sl",
    "nznbl",
    "aus_nbl1_east",
    "aus_nbl1_north",
    "aus_nbl1_south",
    "aus_nbl1_west",
    "aus_nbl1_east_w",
    "aus_nbl1_north_w",
    "aus_nbl1_south_w",
    "aus_nbl1_west_w",
    "aus_big_v",
    "aus_big_v_w",
    "nba_summer",
  ];
  if (singleYearLeagues.includes(l)) return year;

  return month < 8 ? year - 1 : year;
}

function getH2HSeasonDecayWeight(dateStr, league) {
  const _decayCurrent = getParam("h2hDecayCurrent") ?? 1.0;
  const _decayMinus1 = getParam("h2hDecayMinus1") ?? 0.75;
  const _decayMinus2 = getParam("h2hDecayMinus2") ?? 0.5;
  const _decayOlder = getParam("h2hDecayOlder") ?? 0.3;
  if (!dateStr) return _decayMinus1;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return _decayMinus1;

    const gameSeasonYear = getSeasonYearForDateAndLeague(d, league);
    // FIX HIGH: use prediction/event date when provided; wall-clock contaminates backtests.
    const referenceDate = (typeof arguments[2] === "string" && arguments[2])
      ? new Date(arguments[2])
      : (typeof globalThis !== "undefined" && globalThis.__BB_PREDICTION_DATE__)
        ? new Date(globalThis.__BB_PREDICTION_DATE__)
        : new Date();
    const currentSeasonYear = getSeasonYearForDateAndLeague(referenceDate, league);
    const diff = currentSeasonYear - gameSeasonYear;
    if (diff <= 0) return _decayCurrent;
    if (diff === 1) return _decayMinus1;
    if (diff === 2) return _decayMinus2;
    return _decayOlder;
  } catch (_) {
    return _decayMinus1;
  }
}

function getMassacreH2HSeries(marketKey, fixtureMeta, parsed, contextData = null) {
  const _h2hRoot =
    contextData || (typeof AppState !== "undefined" ? AppState.context?.data : null) || {};
  let games = Array.isArray(_h2hRoot.h2hGames) ? [..._h2hRoot.h2hGames] : [];
  if (!games.length) {
    if (marketKey === "ft") {
      return {
        A: parsed && parsed.aFTH2H ? safeArr(parsed.aFTH2H) : [],
        B: parsed && parsed.bFTH2H ? safeArr(parsed.bFTH2H) : [],
      };
    }
    if (marketKey === "h1") {
      return {
        A: parsed && parsed.a1HH2H ? safeArr(parsed.a1HH2H) : [],
        B: parsed && parsed.b1HH2H ? safeArr(parsed.b1HH2H) : [],
      };
    }
    if (marketKey.startsWith("q") && marketKey.length === 2) {
      return {
        A:
          parsed && parsed[`a${marketKey.toUpperCase()}H2H`]
            ? safeArr(parsed[`a${marketKey.toUpperCase()}H2H`])
            : [],
        B:
          parsed && parsed[`b${marketKey.toUpperCase()}H2H`]
            ? safeArr(parsed[`b${marketKey.toUpperCase()}H2H`])
            : [],
      };
    }
    return { A: [], B: [] };
  }

  games.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  const weights =
    (typeof getParam === "function"
      ? // FIX (CRITICAL #3): `league` is not in scope here and no global
        // `league` exists — this previously threw a ReferenceError whenever
        // _h2hRoot.league was falsy. Fall back to "" instead of a bare
        // undeclared identifier; getParam already handles an empty league key.
        getParam("recencyWeights", _h2hRoot.league || "")
      : null) || MODEL_TUNING.recencyWeights;
  const fixtureHomeId = String(fixtureMeta?.homeId || "");

  const rawA = [];
  const rawB = [];
  const decayWeights = [];

  // FIX: bind historical scores to persistent team identity (g.teamAId), not
  // whether Team A is home in *today's* fixture. fetchH2HCore already stores
  // scoreA as today's Team A identity. Prefer identity match; fall back to
  // legacy home check only if teamAId missing on the record.
  games.slice(0, weights.length).forEach((g) => {
    // FIX Issue 36: bind to selected Team A id (fetchH2HCore scoreA identity), not homeId.
    const teamAIdStr = String(
      (typeof selectedTeamIds !== "undefined" && selectedTeamIds?.A) ||
        fixtureMeta?.teamAId ||
        fixtureMeta?.selectedTeamAId ||
        "",
    );
    const isTeamA =
      teamAIdStr && g.teamAId != null && String(g.teamAId) !== ""
        ? String(g.teamAId) === teamAIdStr
        : !!(fixtureHomeId && String(g.teamAId || "") === fixtureHomeId);

    const valueA =
      marketKey === "ft"
        ? isTeamA ? g.scoreA : g.scoreB
        : marketKey === "h1"
          ? isTeamA ? g.h1A : g.h1B
          : marketKey === "q1"
            ? isTeamA ? g.q1A : g.q1B
            : marketKey === "q2"
              ? isTeamA ? g.q2A : g.q2B
              : marketKey === "q3"
                ? isTeamA ? g.q3A : g.q3B
                : marketKey === "q4"
                  ? isTeamA ? g.q4A : g.q4B
                  : 0;

    const valueB =
      marketKey === "ft"
        ? isTeamA ? g.scoreB : g.scoreA
        : marketKey === "h1"
          ? isTeamA ? g.h1B : g.h1A
          : marketKey === "q1"
            ? isTeamA ? g.q1B : g.q1A
            : marketKey === "q2"
              ? isTeamA ? g.q2B : g.q2A
              : marketKey === "q3"
                ? isTeamA ? g.q3B : g.q3A
                : marketKey === "q4"
                  ? isTeamA ? g.q4B : g.q4A
                  : 0;

    const vA = Number(valueA);
    const vB = Number(valueB);
    if (isFinite(vA) && vA > 0 && isFinite(vB) && vB > 0) {
      rawA.push(vA);
      rawB.push(vB);

      // FIX Issue 37: weight by fixture/prediction season, not wall clock.
      decayWeights.push(
        getH2HSeasonDecayWeight(
          g.date,
          _h2hRoot.league,
          _h2hRoot.predictionDate ||
            _h2hRoot.eventDate ||
            _h2hRoot.asOf ||
            (typeof fixtureMeta !== "undefined" && (fixtureMeta.eventDate || fixtureMeta.date)) ||
            undefined,
        ),
      );
    }
  });

  if (decayWeights.length >= 2) {
    const _meanW = decayWeights.reduce((s, w) => s + w, 0) / decayWeights.length;
    if (_meanW > 0) {
      return { A: rawA, B: rawB, weights: decayWeights };
    }
  }

  return { A: rawA, B: rawB, weights: null };
}

function getMatchupDeltaSignal(side, marketKey, parsed) {
  const h2hSeries = getH2HSeries(side, marketKey, parsed);
  if (!Array.isArray(h2hSeries) || h2hSeries.length < 2) return null;

  const seasonSeries =
    marketKey === "ft" ? getOverallSeries(side, 10) : getManualSeries(side, marketKey, parsed);
  if (!Array.isArray(seasonSeries) || seasonSeries.length < 2) return null;

  const h2hAvg = avgOrNaN(h2hSeries);
  const seasonAvg = avgOrNaN(seasonSeries);
  if (!isFinite(h2hAvg) || !isFinite(seasonAvg) || seasonAvg <= 0) return null;

  const delta = h2hAvg - seasonAvg;
  const deltaPct = (delta / seasonAvg) * 100;

  return {
    side,
    marketKey,
    h2hAvg: Number(h2hAvg.toFixed(1)),
    seasonAvg: Number(seasonAvg.toFixed(1)),
    delta: Number(delta.toFixed(1)),
    deltaPct: Number(deltaPct.toFixed(1)),
    sampleSize: h2hSeries.length,
    direction: delta > 0 ? "elevated" : delta < 0 ? "suppressed" : "neutral",
  };
}

function meanFromList(values) {
  const clean = (values || [])
    .filter((v) => v !== null && v !== undefined)
    .map(Number)
    .filter((v) => isFinite(v));
  return clean.length ? clean.reduce((s, v) => s + v, 0) / clean.length : NaN;
}

function calibrateConfidenceModel() {
  const currentVersion = getCurrentModelVersion();
  const allPicks = getAllTrackedPicksForReport().filter(
    (p) =>
      p.modelVersion === currentVersion &&
      !p.isShadow &&
      isFinite(Number(p.edgePct)) &&
      (p.resultStatus === "win" || p.resultStatus === "loss"),
  );
  if (allPicks.length < 150) return;

  const _universePicks = getAllTrackedPicksForReport().filter(
    (p) => p.modelVersion === currentVersion && isFinite(Number(p.edgePct)),
  );
  const _biasBucketOf = (edgePctVal) =>
    Math.max(0, Math.min(4, Math.floor(Math.abs(Number(edgePctVal) || 0) / 5)));
  const _settledBucketCounts = [0, 0, 0, 0, 0];
  allPicks.forEach((p) => _settledBucketCounts[_biasBucketOf(p.edgePct)]++);
  const _universeBucketCounts = [0, 0, 0, 0, 0];
  _universePicks.forEach((p) => _universeBucketCounts[_biasBucketOf(p.edgePct)]++);
  const _biasWeightByBucket = _settledBucketCounts.map((settledN, i) => {
    if (settledN < 5 || !_universePicks.length || !allPicks.length) return 1;
    const settledFrac = settledN / allPicks.length;
    const universeFrac = _universeBucketCounts[i] / _universePicks.length;
    if (settledFrac <= 0) return 1;
    return clampNumber(universeFrac / settledFrac, 0.25, 4.0);
  });
  allPicks.forEach((p) => {
    p._biasWeight = _biasWeightByBucket[_biasBucketOf(p.edgePct)];
  });
  try {
    engineDebug("Settled-sample selection-bias audit", {
      settledBucketCounts: _settledBucketCounts,
      universeBucketCounts: _universeBucketCounts,
      weights: _biasWeightByBucket,
    });
    localStorage.setItem(
      "BB_SETTLED_BIAS_AUDIT",
      JSON.stringify({
        settledBucketCounts: _settledBucketCounts,
        universeBucketCounts: _universeBucketCounts,
        weights: _biasWeightByBucket,
        ts: new Date().toISOString(),
      }),
    );
  } catch (e) {
    engineDebug("Settled bias audit computation/save failed", { error: e?.message || String(e) });
  }

  const _chronoSorted = allPicks
    .slice()
    .sort((a, b) => Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0));
  const _calSplitIdx = Math.floor(_chronoSorted.length * 0.8);
  const fitPicks = _chronoSorted.slice(0, _calSplitIdx);
  const calPicks = _chronoSorted.slice(_calSplitIdx);

  const gradeWinRates = { A: [], B: [], C: [], D: [] };
  fitPicks.forEach((p) => {
    const grade = String(p.confidenceGrade || p.confidence || "").toUpperCase();
    if (gradeWinRates[grade] !== undefined) {
      gradeWinRates[grade].push(p.resultStatus === "win" ? 1 : 0);
    }
  });
  const thresholds = {};
  Object.keys(gradeWinRates).forEach((g) => {
    const wins = gradeWinRates[g].filter((v) => v === 1).length;
    const total = gradeWinRates[g].length;
    if (total >= 5) thresholds[g + "WinRate"] = wins / total;
  });

  const winProbs = allPicks
    .map((p) => {
      const edgePct = isFinite(Number(p.edgePct))
        ? Number(p.edgePct) / 100
        : isFinite(p.edge) && isFinite(p.line) && p.line
          ? Math.abs(p.edge / p.line)
          : null;
      if (edgePct === null) return null;
      const volRatio =
        isFinite(p.volatility) && isFinite(p.volLimit) && p.volLimit > 0
          ? p.volatility / p.volLimit
          : 0.5;
      const wp = getConfidenceWinProbability(
        null,
        edgePct,
        volRatio,
        p.sampleTier,
        p.hasH2H,
        false,
        p.league,
      );
      return { winProb: wp, result: p.resultStatus };
    })
    .filter((s) => s && Number.isFinite(s.winProb));
  if (winProbs.length >= 30) {
    winProbs.sort((a, b) => a.winProb - b.winProb);
    let aThreshold = winProbs[Math.floor(winProbs.length * 0.8)]?.winProb ?? 0.66;
    let bThreshold = winProbs[Math.floor(winProbs.length * 0.5)]?.winProb ?? 0.58;
    let cThreshold = winProbs[Math.floor(winProbs.length * 0.2)]?.winProb ?? 0.51;

    const TARGET_WR_GAP = 0.04;
    if (
      isFinite(thresholds.AWinRate) &&
      isFinite(thresholds.BWinRate) &&
      thresholds.AWinRate < thresholds.BWinRate + TARGET_WR_GAP
    ) {
      aThreshold = clampNumber(aThreshold + 0.02, 0.1, 0.9);
    }
    if (
      isFinite(thresholds.BWinRate) &&
      isFinite(thresholds.CWinRate) &&
      thresholds.BWinRate < thresholds.CWinRate + TARGET_WR_GAP
    ) {
      bThreshold = clampNumber(bThreshold + 0.02, 0.1, 0.9);
    }
    if (
      isFinite(thresholds.CWinRate) &&
      isFinite(thresholds.DWinRate) &&
      thresholds.CWinRate < thresholds.DWinRate + TARGET_WR_GAP
    ) {
      cThreshold = clampNumber(cThreshold + 0.02, 0.1, 0.9);
    }
    const gradeThresholds = { aThresh: aThreshold, bThresh: bThreshold, cThresh: cThreshold };
    try {
      // Propose only — live thresholds promote with coeffs/Platt/N (atomic apply)
      localStorage.setItem("BB_CONFIDENCE_THRESHOLDS_PROPOSED", JSON.stringify(gradeThresholds));
      localStorage.setItem("BB_CONFIDENCE_GRADE_WIN_RATES_PROPOSED", JSON.stringify(thresholds));
      engineDebug("Confidence grade thresholds proposed (not auto-applied)", {
        gradeThresholds,
        winRates: thresholds,
      });
    } catch (e) {
      console.error("[BB Engine] Confidence grade threshold proposal save failed", e);
    }
  }

  // Train/serve identity: same feature builder as live getConfidenceWinProbability.
  const buildF = (p) => buildConfidenceFeatures(p);

  const _gd = (data, lr, lambda) => {
    let c = {
      intercept: -0.2,
      edgePct: 8.0,
      volRatio: -0.8,
      sampleFull: 0.4,
      h2h: 0.2,
      trap: -1.2,
    };

    const _n = data.reduce((s, d) => s + (isFinite(d.w) ? d.w : 1), 0) || 1;
    for (let iter = 0; iter < 400; iter++) {
      const g = { intercept: 0, edgePct: 0, volRatio: 0, sampleFull: 0, h2h: 0, trap: 0 };
      for (const { f, y, w } of data) {
        const _w = isFinite(w) ? w : 1;
        const lo =
          c.intercept +
          c.edgePct * f.edgePct +
          c.volRatio * f.volRatio +
          c.sampleFull * f.sampleFull +
          c.h2h * f.h2h +
          c.trap * f.trap;
        const prob = 1 / (1 + Math.exp(-Math.min(20, Math.max(-20, lo))));
        const e = (y - prob) * _w;
        g.intercept += e;
        g.edgePct += e * f.edgePct;
        g.volRatio += e * f.volRatio;
        g.sampleFull += e * f.sampleFull;
        g.h2h += e * f.h2h;
        g.trap += e * f.trap;
      }
      c.intercept += lr * (g.intercept / _n);
      c.edgePct += lr * (g.edgePct / _n) - lr * lambda * c.edgePct;
      c.volRatio += lr * (g.volRatio / _n) - lr * lambda * c.volRatio;
      c.sampleFull += lr * (g.sampleFull / _n) - lr * lambda * c.sampleFull;
      c.h2h += lr * (g.h2h / _n) - lr * lambda * c.h2h;
      c.trap += lr * (g.trap / _n) - lr * lambda * c.trap;
    }
    return c;
  };

  const runGD = (data) => {
    if (!data || data.length < 15) return null;
    if (data.length >= 60) {
      const foldSize = Math.floor(data.length / 3);
      const candidates = [
        { lr: 0.002, lambda: 0.005 },
        { lr: 0.001, lambda: 0.005 },
        { lr: 0.002, lambda: 0.001 },
        { lr: 0.0005, lambda: 0.001 },
      ];
      let bestLoss = Infinity,
        bestCoeff = null;
      candidates.forEach(({ lr, lambda }) => {
        let totalLoss = 0;
        // FIX: walk-forward only (no future data in train). Expanding train, next block val.
        for (let fold = 0; fold < 3; fold++) {
          const trainEnd = Math.floor(data.length * (0.4 + fold * 0.15));
          const valEnd = Math.min(data.length, trainEnd + Math.max(foldSize, Math.floor(data.length * 0.15)));
          if (trainEnd < 20 || valEnd <= trainEnd) continue;
          const train = data.slice(0, trainEnd);
          const val = data.slice(trainEnd, valEnd);
          const coeff = _gd(train, lr, lambda);
          val.forEach(({ f, y }) => {
            const lo =
              coeff.intercept +
              coeff.edgePct * f.edgePct +
              coeff.volRatio * f.volRatio +
              coeff.sampleFull * f.sampleFull +
              coeff.h2h * f.h2h +
              coeff.trap * f.trap;
            const prob = 1 / (1 + Math.exp(-Math.min(20, Math.max(-20, lo))));
            totalLoss -=
              y === 1 ? Math.log(Math.max(1e-9, prob)) : Math.log(Math.max(1e-9, 1 - prob));
          });
        }
        if (totalLoss < bestLoss) {
          bestLoss = totalLoss;
          bestCoeff = _gd(data, lr, lambda);
        }
      });
      return bestCoeff;
    }
    return _gd(data, 0.001, 0.005);
  };

  const models = {};
  const modelSampleSizes = {};

  const globalData = fitPicks.map((p) => ({
    f: buildF(p),
    y: p.resultStatus === "win" ? 1 : 0,
    w: p._biasWeight,
  }));
  const globalModel = runGD(globalData);
  if (globalModel) {
    models["global"] = globalModel;
    modelSampleSizes["global"] = globalData.length;
  }
  [...new Set(fitPicks.map((p) => p.league).filter(Boolean))].forEach((league) => {
    const leaguePicks = fitPicks.filter((p) => p.league === league);
    const ld = leaguePicks.map((p) => ({
      f: buildF(p),
      y: p.resultStatus === "win" ? 1 : 0,
      w: p._biasWeight,
    }));
    const lm = runGD(ld);

    if (lm && globalModel) {
      models[league] = empiricalBayesShrink(lm, ld.length, globalModel, 40);
      modelSampleSizes[league] = ld.length;
    } else if (lm) {
      models[league] = lm;
      modelSampleSizes[league] = ld.length;
    }
  });

  ["trusted", "advisory", "blocked"].forEach((tierLevel) => {
    const tierRows = fitPicks.filter((p) => getLeagueTrustMeta(p.league).level === tierLevel);
    const tierPicks = tierRows.map((p) => ({
      f: buildF(p),
      y: p.resultStatus === "win" ? 1 : 0,
      w: p._biasWeight,
    }));
    const tierModel = runGD(tierPicks);
    if (tierModel && globalModel) {
      models["tier_" + tierLevel] = empiricalBayesShrink(
        tierModel,
        tierPicks.length,
        globalModel,
        40,
      );
      modelSampleSizes["tier_" + tierLevel] = tierPicks.length;
    } else if (tierModel) {
      models["tier_" + tierLevel] = tierModel;
      modelSampleSizes["tier_" + tierLevel] = tierPicks.length;
    }
  });

  const _rawLogOdds = (coeff, p) => {
    const f = buildF(p);
    return (
      (coeff.intercept ?? -0.2) +
      (coeff.edgePct ?? 8.0) * f.edgePct +
      (coeff.volRatio ?? -0.8) * f.volRatio +
      (coeff.sampleFull ?? 0.4) * f.sampleFull +
      (coeff.h2h ?? 0.2) * f.h2h +
      (coeff.trap ?? -1.2) * f.trap
    );
  };
  const fitPlattScaling = (coeff, calRows) => {
    if (!coeff || !calRows || calRows.length < 20)
      return { a: 1, b: 0, n: calRows ? calRows.length : 0 };
    const rows = calRows.map((p) => ({
      logit: clampNumber(_rawLogOdds(coeff, p), -10, 10),
      y: p.resultStatus === "win" ? 1 : 0,
    }));
    let a = 1,
      b = 0;
    const lr = 0.01,
      l2 = 0.01;
    for (let iter = 0; iter < 300; iter++) {
      let ga = 0,
        gb = 0;
      rows.forEach((r) => {
        const lo = a * r.logit + b;
        const prob = 1 / (1 + Math.exp(-Math.min(20, Math.max(-20, lo))));
        const e = r.y - prob;
        ga += e * r.logit;
        gb += e;
      });
      a += lr * (ga / rows.length) - lr * l2 * (a - 1);
      b += lr * (gb / rows.length) - lr * l2 * b;
    }
    return { a, b, n: rows.length };
  };
  const plattCalib = {};
  Object.keys(models).forEach((scope) => {
    let scopeCalRows;
    if (scope === "global") {
      scopeCalRows = calPicks;
    } else if (scope.startsWith("tier_")) {
      const tierLevel = scope.slice(5);
      scopeCalRows = calPicks.filter((p) => getLeagueTrustMeta(p.league).level === tierLevel);
    } else {
      scopeCalRows = calPicks.filter((p) => p.league === scope);
    }
    plattCalib[scope] = fitPlattScaling(models[scope], scopeCalRows);
  });

  if (Object.keys(models).length) {
    try {
      localStorage.setItem("BB_CONFIDENCE_MODEL_COEFF_PROPOSED", JSON.stringify(models));
      // Do NOT write live COEFF_N until apply — keeps trust gate aligned with active coeffs
      localStorage.setItem(
        "BB_CONFIDENCE_MODEL_COEFF_N_PROPOSED",
        JSON.stringify(modelSampleSizes),
      );
      localStorage.setItem("BB_PLATT_CALIB_PROPOSED", JSON.stringify(plattCalib));
    } catch (e) {
      console.error("[BB Engine] Confidence model coefficient proposal save failed", e);
    }
    engineDebug(
      "Confidence model coefficients proposed (not auto-applied — review in Configs panel)",
      Object.keys(models),
    );
  }
}
