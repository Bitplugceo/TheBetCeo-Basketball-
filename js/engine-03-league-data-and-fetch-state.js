
const LEAGUE_PACE_BASES = {
  nba: 99.0,
  nba_gl: 101.5,
  nba_summer: 100.0,
  ncaa: 70.0,
  ncaaw: 72.0,
  wnba: 81.0,
  wnba_pre: 81.0,
  euroleague: 71.0,
  eurocup: 72.0,
  champions_league: 71.5,
  acb: 72.5,
  lba: 71.5,
  bbl: 73.0,
  turkey_bsl: 73.5,
  ausnbl: 78.0,
  nznbl: 78.0,
  bleague: 75.5,
  korea_kbl: 74.5,
  cba: 91.0,
  proa: 73.0,
  cebl: 76.0,
  aba: 71.0,

  united_league: 72.5,
  isl: 77.5,
  default: 74.0,
};

const LEAGUE_RATING_BASES = {
  nba: 115.0,
  nba_gl: 112.5,
  nba_summer: 107.0,
  ncaa: 105.0,
  ncaaw: 96.0,
  wnba: 103.0,
  wnba_pre: 101.0,
  euroleague: 114.0,
  eurocup: 111.0,
  champions_league: 111.5,
  acb: 110.5,
  lba: 110.0,
  bbl: 110.5,
  turkey_bsl: 111.0,
  ausnbl: 111.5,
  nznbl: 111.0,
  bleague: 108.5,
  korea_kbl: 107.5,
  cba: 114.5,
  proa: 109.5,
  cebl: 109.0,
  aba: 108.5,

  united_league: 111.0,
  isl: 110.5,
  default: 110.0,
};

const LEAGUE_REGULATION_MINUTES = {
  nba: 48,
  nba_gl: 48,
  nba_summer: 48,
  wnba: 40,
  wnba_pre: 40,
  ncaa: 40,
  ncaaw: 40,
  default: 40,
};
function getLeagueRegulationMinutes(league) {
  return (
    LEAGUE_REGULATION_MINUTES[String(league || "").toLowerCase()] ||
    LEAGUE_REGULATION_MINUTES.default
  );
}

function getLeagueRecencyDefaults(league) {
  const learned = getLearnedRecencyWeights(league, "ft");
  const configured = getParam("recencyWeights", league);
  const activeRecencyWeights =
    Array.isArray(learned) && learned.length ? learned : configured || MODEL_TUNING.recencyWeights;
  const isFlat = activeRecencyWeights.every((w) => w === 1);
  if (isFlat) return [1.35, 1.2, 1.0, 0.85, 0.7, 0.56, 0.44, 0.33, 0.24, 0.16];
  return activeRecencyWeights;
}

const LEAGUE_VOL_LIMITS = {
  nba: 12,
  ncaa: 15,
  ncaaw: 15,
  wnba: 13,
  wnba_pre: 14,
  nba_gl: 13,
  nba_summer: 15,
  euroleague: 10,
  eurocup: 11,
  champions_league: 11,
  acb: 11,
  lba: 11,
  bbl: 12,
  turkey_bsl: 12,
  ausnbl: 12,
  bleague: 11,
  united_league: 12,
  proa: 11,
  default: 12,
};

const ESPN_LEAGUE_SLUGS = {
  nba: "nba",
  wnba: "wnba",
  wnba_pre: "wnba",
  ncaa: "mens-college-basketball",
  ncaaw: "womens-college-basketball",
  nba_gl: "nba-g-league",
  nba_summer: "nba-summer-las-vegas",
  euroleague: "euroleague",
  eurocup: "eurocup",
  champions_league: "basketball-champions-league",
  turkey_bsl: "turkish-bsl",
  acb: "spanish-liga-acb",
  bbl: "german-bbl",
  ausnbl: "australian-nbl",
  lba: "italian-lba",
  bleague: "japan-b-league",
  united_league: "vtb-united-league",
  proa: "french-pro-a",
  bcl: "greek-basket-league",
  aba: "adriatic-basketball-association",
  isl: "israel-super-league",
  cebl: "cebl",
};
function getEspnLeagueSlug(league) {
  return ESPN_LEAGUE_SLUGS[String(league || "").toLowerCase()] || null;
}

const VOL_CACHE_KEY = "engineVolCache_v1";
const VOL_CACHE_MIN_SAMPLES = 25;
const VOL_CACHE_MAX_SAMPLES = 2000;
const VOL_CACHE_MIN_LIMIT = 6;
const VOL_CACHE_MAX_LIMIT = 30;

function getLeagueVolLimit(league) {
  const lk = String(league || "").toLowerCase();
  if (isFinite(LEAGUE_VOL_LIMITS[lk])) return LEAGUE_VOL_LIMITS[lk];

  const learned = getLearnedLeagueStats(lk);
  if (learned && isFinite(learned.stdev)) {
    // FIX Issue 44: vol cache may hold team-score SD. Convert to game-total scale (~√2)
    // when the learned mean looks like a per-team average (less than ~half of expected total).
    let sd = Number(learned.stdev);
    const mean = Number(learned.mean);
    const eb = LEAGUE_BASES[lk] || LEAGUE_BASES.unknown;
    if (isFinite(mean) && mean > 0 && mean < eb * 0.75) {
      sd = sd * Math.SQRT2; // team SD → approximate total SD
    }
    return clampNumber(sd, VOL_CACHE_MIN_LIMIT, VOL_CACHE_MAX_LIMIT);
  }
  const eb = LEAGUE_BASES[lk] || LEAGUE_BASES.unknown;
  const scaled = LEAGUE_VOL_LIMITS.default * (eb / LEAGUE_BASES.unknown);
  return clampNumber(scaled, VOL_CACHE_MIN_LIMIT, VOL_CACHE_MAX_LIMIT);
}

function safeLocalStorageJSON(key, fallback) {
  const fb = fallback === undefined ? null : fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw == null || raw === "" || raw === "undefined" || raw === "null") return fb;
    const parsed = JSON.parse(raw);
    if (parsed === undefined) return fb;
    return parsed;
  } catch (e) {
    try {
      localStorage.removeItem(key);
    } catch (_rm) {}
    return fb;
  }
}

function loadVolCache() {
  try {
    const parsed = safeLocalStorageJSON(VOL_CACHE_KEY, {});
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    engineDebug("loadVolCache failed: " + (e?.message || String(e)), {
      error: e && (e.message || String(e)),
    });
    return {};
  }
}

function saveVolCache(cache) {
  try {
    if (!cache || typeof cache !== "object") return;
    localStorage.setItem(VOL_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    engineDebug("saveVolCache failed", { error: e && (e.message || String(e)) });
  }
}

function updateLeagueVolCache(league, values) {
  const key = String(league || "").toLowerCase();
  if (!key) return;
  const clean = Array.isArray(values) ? values.map(Number).filter((v) => isFinite(v) && v > 0) : [];
  if (!clean.length) return;

  const cache = loadVolCache();
  const entry = cache[key] || { n: 0, mean: 0, m2: 0 };

  clean.forEach((v) => {
    if (entry.n >= VOL_CACHE_MAX_SAMPLES) return;
    entry.n += 1;
    const delta = v - entry.mean;
    entry.mean += delta / entry.n;
    const delta2 = v - entry.mean;
    entry.m2 += delta * delta2;
  });

  entry.updatedAt = new Date().toISOString();
  cache[key] = entry;
  saveVolCache(cache);
}

function getLearnedLeagueStats(league) {
  const lk = String(league || "").toLowerCase();
  const cache = loadVolCache();
  const entry = cache[lk];
  if (!entry || !(entry.n >= VOL_CACHE_MIN_SAMPLES)) return null;
  const variance = entry.n > 1 ? entry.m2 / (entry.n - 1) : 0;
  return { n: entry.n, mean: entry.mean, stdev: Math.sqrt(Math.max(0, variance)) };
}

function getLeagueScoreBase(league) {
  const lk = String(league || "").toLowerCase();
  if (isFinite(LEAGUE_BASES[lk])) return LEAGUE_BASES[lk];
  const learned = getLearnedLeagueStats(lk);
  if (learned) return learned.mean * 2;
  return LEAGUE_BASES.unknown;
}

const QSHAPE_STORAGE_KEY = "BB_TEAM_QSHAPE_V1";
const QSHAPE_MIN_GAMES = 6;

function getTeamQuarterShapeKey(league, teamName) {
  return String(league || "unknown").toLowerCase() + "|" + normalizeTeamName(teamName || "");
}

function loadQuarterShapeStore() {
  try {
    const parsed = safeLocalStorageJSON(QSHAPE_STORAGE_KEY, {});
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch (e) {
    engineDebug("loadQuarterShapeStore failed: " + (e?.message || String(e)), {
      error: e && (e.message || String(e)),
    });
    return {};
  }
}

function saveQuarterShapeStore(store) {
  try {
    localStorage.setItem(QSHAPE_STORAGE_KEY, JSON.stringify(store));
  } catch (e) {
    engineDebug("saveQuarterShapeStore failed to persist", { error: e });
  }
}

function updateTeamQuarterShapeProfile(league, teamName, q1s, q2s, q3s, q4s) {
  const key = getTeamQuarterShapeKey(league, teamName);
  if (!key) return;
  const n = Math.min(
    Array.isArray(q1s) ? q1s.length : 0,
    Array.isArray(q2s) ? q2s.length : 0,
    Array.isArray(q3s) ? q3s.length : 0,
    Array.isArray(q4s) ? q4s.length : 0,
  );
  if (n < 2) return;

  const store = loadQuarterShapeStore();
  const entry = store[key] || { n: 0, meanShare: [0.25, 0.25, 0.25, 0.25], m2: [0, 0, 0, 0] };

  for (let i = 0; i < n; i++) {
    const q1 = Number(q1s[i]),
      q2 = Number(q2s[i]),
      q3 = Number(q3s[i]),
      q4 = Number(q4s[i]);
    const total = q1 + q2 + q3 + q4;
    if (!isFinite(total) || total <= 0) continue;
    const shares = [q1 / total, q2 / total, q3 / total, q4 / total];
    entry.n += 1;
    for (let qi = 0; qi < 4; qi++) {
      const delta = shares[qi] - entry.meanShare[qi];
      entry.meanShare[qi] += delta / entry.n;
      const delta2 = shares[qi] - entry.meanShare[qi];
      entry.m2[qi] += delta * delta2;
    }
  }

  entry.updatedAt = new Date().toISOString();
  store[key] = entry;
  saveQuarterShapeStore(store);
}

function getTeamQuarterShapeSignal(league, teamName, qKey) {
  const key = getTeamQuarterShapeKey(league, teamName);
  const store = loadQuarterShapeStore();
  const entry = store[key];
  if (!entry || entry.n < QSHAPE_MIN_GAMES) return null;

  const qIdx = { q1: 0, q2: 1, q3: 2, q4: 3 }[String(qKey || "").toLowerCase()];
  if (qIdx === undefined) return null;

  const share = entry.meanShare[qIdx];
  const variance = entry.n > 1 ? entry.m2[qIdx] / (entry.n - 1) : 0;
  const stdErr = Math.sqrt(Math.max(variance, 0.0001) / entry.n);
  if (!isFinite(stdErr) || stdErr <= 0) return null;

  const z = (share - 0.25) / stdErr;
  return {
    z: Number(z.toFixed(2)),
    share: Number((share * 100).toFixed(1)),
    sampleSize: entry.n,
    direction: z >= 1.0 ? "fast" : z <= -1.0 ? "fade" : "neutral",
  };
}

// ============================================================================
// Q-SPREAD: quarter net scoring margin (team quarter points - opponent
// quarter points), averaged over recent games. This is a distinct signal
// from the shape store above: shape says WHEN a team scores (tempo), spread
// says how much BETTER they are than opponents in that window (dominance).
//
// Pure functions only below — no DOM, no localStorage, safe to unit-test.
// ============================================================================

// computeQuarterSpread: pairs scored[i]-allowed[i] game by game and averages
// the diffs. Mathematically identical to avg(scored) - avg(allowed) for two
// same-length, index-aligned arrays, but written as a paired diff so it stays
// correct even if a caller ever passes arrays that aren't perfectly aligned
// in length (it just diffs over the shared prefix).
//
// opts.minSample: below this many paired games, reliable=false. Callers
// should not let an unreliable spread influence a pick — treat it as
// "insufficient data", not "zero".
// opts.blowoutGap: single-quarter |scored-allowed| above this is treated as
// a likely garbage-time/blowout outlier and excluded from the average, so a
// single rout doesn't dominate a short (5-10 game) window. This is a
// per-quarter-scale threshold, deliberately separate from
// h2hBlowoutGapThreshold (which is calibrated for full-game gaps).
function computeQuarterSpread(scoredArr, allowedArr, opts = {}) {
  const scored = Array.isArray(scoredArr) ? scoredArr : [];
  const allowed = Array.isArray(allowedArr) ? allowedArr : [];
  const n = Math.min(scored.length, allowed.length);
  const minSample = isFinite(opts.minSample) ? opts.minSample : 5;
  const blowoutGap = isFinite(opts.blowoutGap) ? opts.blowoutGap : Infinity;

  const diffs = [];
  let excluded = 0;
  for (let i = 0; i < n; i++) {
    const s = Number(scored[i]);
    const a = Number(allowed[i]);
    if (!isFinite(s) || !isFinite(a) || (s <= 0 && a <= 0)) continue;
    const d = s - a;
    if (Math.abs(d) > blowoutGap) {
      excluded++;
      continue;
    }
    diffs.push(d);
  }

  if (!diffs.length) {
    return { avg: null, n: 0, excluded, reliable: false };
  }

  return {
    avg: Number(avg(diffs).toFixed(2)),
    n: diffs.length,
    excluded,
    reliable: diffs.length >= minSample,
  };
}

// buildQuarterSpreadProfile: takes any stats-like object exposing
// qNScored/qNAllowed (or qNScored10/qNAllowed10) arrays — this covers both
// the ESPN fetchScheduleCore return shape and the SofaScore
// ssProcessTeamEvents list shape once mapped to the same field names — and
// returns { q1, q2, q3, q4 } spread summaries.
function buildQuarterSpreadProfile(statsLike, opts = {}) {
  if (!statsLike) return null;
  const profile = {};
  ["q1", "q2", "q3", "q4"].forEach((qKey) => {
    const scored = statsLike[qKey + "Scored"] || statsLike[qKey + "Scored10"] || [];
    const allowed = statsLike[qKey + "Allowed"] || statsLike[qKey + "Allowed10"] || [];
    profile[qKey] = computeQuarterSpread(scored, allowed, opts);
  });
  return profile;
}

// buildQuarterSpreadDual: convenience wrapper for the common case of having
// an overall stats object and an optional venue-filtered stats object (the
// shape both the ESPN and SofaScore call sites produce) and wanting the
// { q1: {overall, venue}, q2: {...}, ... } shape in one call.
function buildQuarterSpreadDual(statsOverall, statsVenue, league) {
  const optsOverall = {
    minSample: getParam("quarterSpreadMinSampleOverall", league) ?? 5,
    blowoutGap: getParam("quarterSpreadBlowoutGapThreshold", league) ?? 18,
  };
  const optsVenue = {
    minSample: getParam("quarterSpreadMinSampleSplit", league) ?? 3,
    blowoutGap: optsOverall.blowoutGap,
  };
  const overallProfile = buildQuarterSpreadProfile(statsOverall, optsOverall);
  const venueProfile = statsVenue ? buildQuarterSpreadProfile(statsVenue, optsVenue) : null;
  const out = {};
  ["q1", "q2", "q3", "q4"].forEach((qKey) => {
    out[qKey] = {
      overall: overallProfile?.[qKey] || null,
      venue: venueProfile?.[qKey] || null,
    };
  });
  return out;
}

// getQuarterFormAgreement: compares recent quarter-spread FORM against the
// model's own quarter margin PROJECTION for this matchup, and reports
// whether they point the same direction. This is a read-only diagnostic —
// it does not touch qEdge/qPick/qConf and is not itself a pick.
//
// Combines both sides of the matchup (matches the pattern the engine
// already uses for ORTG/DRTG): team A's own scoring dominance in this
// quarter, averaged with the mirror of team B's own spread (if B typically
// gets outscored in this quarter, that supports A regardless of how good A
// looks in isolation).
//
// Venue-aware: prefers each team's venue-specific split (home for the home
// team, away for the away team) when that split has enough games; falls
// back to the team's overall split otherwise. Returns null (no opinion) if
// neither side has a reliable sample — an unreliable/thin sample must never
// silently masquerade as signal.
function getQuarterFormAgreement(quarterSpreadsA, quarterSpreadsB, qKey, modelMargin, league) {
  const entryA = quarterSpreadsA?.[qKey];
  const entryB = quarterSpreadsB?.[qKey];
  if (!entryA && !entryB) return null;

  const pick = (entry) => {
    if (!entry) return null;
    if (entry.venue && entry.venue.reliable) return entry.venue;
    if (entry.overall && entry.overall.reliable) return entry.overall;
    return null;
  };

  const a = pick(entryA);
  const b = pick(entryB);
  if (!a && !b) return { reliable: false };

  // A's own margin, and the mirror of B's own margin (negated: if B nets
  // negative in this quarter, that supports A having the edge here).
  const parts = [];
  if (a && isFinite(a.avg)) parts.push(a.avg);
  if (b && isFinite(b.avg)) parts.push(-b.avg);
  if (!parts.length) return { reliable: false };

  const formMargin = Number((parts.reduce((s, v) => s + v, 0) / parts.length).toFixed(2));
  if (!isFinite(modelMargin)) return { reliable: false, formMargin };

  const materiality = getParam("quarterSpreadMaterialityPts", league) ?? 2.0;
  const sameDirection =
    Math.sign(formMargin) === Math.sign(modelMargin) || Math.abs(formMargin) < materiality;
  const bothMaterial = Math.abs(formMargin) >= materiality && Math.abs(modelMargin) >= materiality;

  let label = "NEUTRAL";
  if (bothMaterial) {
    label = sameDirection ? "SUPPORT" : "CONTRA";
  }

  return {
    reliable: true,
    label,
    formMargin,
    modelMargin: Number(modelMargin.toFixed(2)),
    gap: Number((formMargin - modelMargin).toFixed(2)),
    nA: a?.n ?? null,
    nB: b?.n ?? null,
  };
}

// applyQuarterFormEdgeHaircut: the actual prediction-level lever (as opposed
// to getQuarterFormAgreement's confidence-level annotation). Deliberately
// one-directional and bounded:
//   - Only ever fires on CONTRA (recent quarter-margin form disagrees with
//     the model's own quarter margin). SUPPORT never boosts edge — there is
//     no validated basis yet for saying "form agrees, so the edge is bigger
//     than the model thinks." Manufacturing edge from an unbacktested signal
//     is a materially different (and much riskier) claim than trimming edge
//     the model already computed.
//   - Capped at min(maxFrac * |edge|, capPts) — a fraction of the existing
//     edge, hard-limited in points, so a single quarter's noisy form can't
//     erase a large, well-supported edge.
//   - Sign-preserving: the result can shrink toward zero but is clamped so
//     it can never cross zero. That would be equivalent to silently
//     flipping OVER<->UNDER off a signal with no track record yet — getPick
//     already turns a small enough edge into NO PLAY on its own once it's
//     below pointThreshold, which is the correct place for that to happen.
function applyQuarterFormEdgeHaircut(edge, formAgreement, league) {
  if (!isFinite(edge) || !formAgreement || !formAgreement.reliable) return edge;
  if (formAgreement.label !== "CONTRA") return edge;

  const maxFrac = getParam("quarterSpreadEdgeHaircutMaxFrac", league) ?? 0.3;
  const capPts = getParam("quarterSpreadEdgeHaircutCapPts", league) ?? 1.0;
  const haircut = Math.min(Math.abs(edge) * maxFrac, capPts);

  let adjusted = edge - Math.sign(edge) * haircut;
  if (Math.sign(adjusted) !== Math.sign(edge)) adjusted = 0;
  return Number(adjusted.toFixed(2));
}

const LEAGUE_CONFIG_MAP = {
  NBA: { volLimit: 12, sanityMin: 160, sanityMax: 250 },
  NCAA: { volLimit: 15, sanityMin: 120, sanityMax: 200 },
  NCAAW: { volLimit: 15, sanityMin: 100, sanityMax: 175 },
  WNBA: { volLimit: 13, sanityMin: 130, sanityMax: 200 },
  WNBA_PRE: { volLimit: 14, sanityMin: 125, sanityMax: 200 },
  NBA_GL: { volLimit: 13, sanityMin: 155, sanityMax: 245 },
  NBA_SUMMER: { volLimit: 15, sanityMin: 130, sanityMax: 210 },
  EUROLEAGUE: { volLimit: 10, sanityMin: 130, sanityMax: 200 },
  EUROCUP: { volLimit: 11, sanityMin: 125, sanityMax: 195 },
  CHAMPIONS_LEAGUE: { volLimit: 11, sanityMin: 120, sanityMax: 195 },
  ACB: { volLimit: 11, sanityMin: 130, sanityMax: 200 },
  LBA: { volLimit: 11, sanityMin: 125, sanityMax: 195 },
  BBL: { volLimit: 12, sanityMin: 130, sanityMax: 205 },
  TURKEY_BSL: { volLimit: 12, sanityMin: 130, sanityMax: 205 },
  AUSNBL: { volLimit: 12, sanityMin: 130, sanityMax: 210 },
};

initLeagueOverridesFromDefaults();
pruneUnverifiedLeagueOverrideDrift();

function backfillMissingLeagueVolLimits() {
  let changed = false;
  Object.keys(LEAGUE_BASES).forEach((lk) => {
    if (lk === "unknown") return;
    if (!g_tunableParamLeagueOverrides[lk]) g_tunableParamLeagueOverrides[lk] = {};
    if (!("volatilityLimit" in g_tunableParamLeagueOverrides[lk])) {
      g_tunableParamLeagueOverrides[lk]["volatilityLimit"] = {
        value: getLeagueVolLimit(lk),
        lastVerifiedAt: null,
      };
      changed = true;
    }
  });
  if (changed) saveTunableParamLeagueOverrides();
}
backfillMissingLeagueVolLimits();

const LEAGUE_TRUST_PROFILES = {
  trusted: [
    "nba",
    "ncaa",
    "nba_gl",
    "ncaaw",
    "wnba",
    "euroleague",
    "eurocup",
    "champions_league",
    "acb",
    "lba",
    "bbl",
    "bcl",
    "turkey_bsl",
    "isl",
    "cba",
    "pba",
    "ausnbl",
    "proa",
    "united_league",
    "bleague",
    "korea_kbl",
    "aus_nbl1_east",
    "aus_nbl1_north",
    "aus_nbl1_south",
    "aus_nbl1_west",
    "aus_nbl1_central",
    "aus_big_v",
    "nznbl",
  ],
  advisory: [
    "nba_summer",
    "wnba_pre",
    "aba",
    "lkl",
    "plk",
    "prob",
    "germany_proa",
    "serbia_kls",
    "croatia_premier",
    "romania_ln",
    "hungary_nb1",
    "nbl_cz",
    "denmark_bliga",
    "england_slb",
    "england_slb_w",
    "finland_koris",
    "italy_a2",
    "italy_serb",
    "italy_a1_w",
    "poland_1liga",
    "portugal_lpb",
    "portugal_proliga",
    "spain_primera",
    "spain_segunda",
    "sweden_sbl",
    "swiss_sbl",
    "turkey_tbl",
    "turkey_tb2l",
    "china_nbl",
    "taipei_tpbl",
    "austria_superliga",
    "belgium_top",
    "bih_1st",
    "bulgaria_nbl",
    "georgia_super",
    "argentina_lnb",
    "brazil_nbb",
    "chile_lnb",
    "mexico_lnbp",
    "mexico_cibacopa",
    "puerto_rico_bsn",
    "uruguay_lub",
    "cebl",
    "aus_nbl1_east_w",
    "aus_nbl1_north_w",
    "aus_nbl1_south_w",
    "aus_nbl1_west_w",
    "aus_nbl1_central_w",
    "aus_big_v_w",
    "bnxt",
    "cyprus_div_a",
    "estonia_kml",
    "iceland_urvalsdeild",
    "latvia_lbl",
    "lebanon_1st",
    "slovenia_1a",
    "gb_super_league_w",
    "france_lfb_w",
  ],
  blocked: [
    "brazil_lbf_w",
    "chile_lnb2",
    "uruguay_lfb_w",
    "venezuela_sl",
    "el_salvador_lmb",
    "bal",
    "rwanda",
    "phil_mpbl",
    "indonesia_ibl",
    "italy_a2_w",
    "austria_zweite",
    "iceland_urvalsdeild_w",
    "iceland_1st",
    "portugal_taca",
    "portugal_lfb_w",
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
    "aba_pre",
    "intl_friendly",
    "club_friendly",
  ],
};
function normalizeLeagueTrustKey(league) {
  return (
    String(league || "unknown")
      .trim()
      .toLowerCase() || "unknown"
  );
}

function getLeagueTrustMeta(league) {
  const key = normalizeLeagueTrustKey(league);

  const dataMode = Object.prototype.hasOwnProperty.call(ESPN_LEAGUE_SLUGS, key)
    ? "automated"
    : "manual";
  if (LEAGUE_TRUST_PROFILES.trusted.includes(key)) {
    return {
      key,
      level: "trusted",
      label: "Trusted",
      mode: "full",
      dataMode,
      guidance:
        dataMode === "manual"
          ? "Full plays allowed via model tuning. No automated feed — enter stats manually (SofaScore) and double-check before playing."
          : "Full plays are allowed. Keep monitoring record and checkpoint review.",
    };
  }
  if (LEAGUE_TRUST_PROFILES.blocked.includes(key)) {
    return {
      key,
      level: "blocked",
      label: "Do not use",
      mode: "block",
      dataMode,
      guidance: "No-play only until this league is retuned and revalidated.",
    };
  }
  return {
    key,
    level: "advisory",
    label: "Needs retune",
    mode: "advisory",
    dataMode,
    guidance: "Advisory only for now. Treat any edge as a lean until thresholds are retuned.",
  };
}

function getLeagueCalibrationMeta(league) {
  const lk = String(league || "").toLowerCase();
  try {
    const raw = localStorage.getItem("BB_CALIBRATION_METRICS_BY_LEAGUE");
    const store = raw ? JSON.parse(raw) : {};
    if (store && store[lk]) return store[lk];
  } catch (e) {
    engineDebug("getLeagueCalibrationMeta failed to read store: " + (e?.message || String(e)), {
      league: lk,
      error: e,
    });
  }
  return {
    calibrationStatus: "unknown",
    brierScore: null,
    ece: null,
    n: 0,
    minRequired: 20,
    bins: null,
    ts: null,
  };
}

function getLeagueTrustCssClass(level) {
  const key = String(level || "advisory").toLowerCase();
  if (key === "trusted") return "trust-trusted";
  if (key === "blocked") return "trust-blocked";
  return "trust-advisory";
}

function getLeagueTrustSortRank(level) {
  const key = String(level || "advisory").toLowerCase();
  if (key === "trusted") return 0;
  if (key === "advisory") return 1;
  return 2;
}

const LEAGUE_FETCH_RULES = {
  nba: {
    recentSeasons: 2,
    scheduleTypes: ["1", "2", "3"],
    h2hScheduleTypes: ["1", "2", "3"],
    regulationPeriods: 4,
  },
  wnba: {
    recentSeasons: 2,
    scheduleTypes: ["1", "2", "3"],
    h2hScheduleTypes: ["1", "2", "3"],
    regulationPeriods: 4,
  },
  wnba_pre: {
    recentSeasons: 2,
    scheduleTypes: ["1", "2", "3"],
    h2hScheduleTypes: ["1", "2", "3"],
    regulationPeriods: 4,
  },
  ncaa: {
    recentSeasons: 3,
    scheduleTypes: ["2", "3"],
    h2hScheduleTypes: ["2", "3"],
    regulationPeriods: 2,
  },

  ncaaw: {
    recentSeasons: 3,
    scheduleTypes: ["2", "3"],
    h2hScheduleTypes: ["2", "3"],
    regulationPeriods: 2,
  },
  nba_gl: {
    recentSeasons: 2,
    scheduleTypes: ["1", "2", "3"],
    h2hScheduleTypes: ["1", "2", "3"],
    regulationPeriods: 4,
  },

  nba_summer: {
    recentSeasons: 1,
    scheduleTypes: ["1", "2", "3"],
    h2hScheduleTypes: ["1", "2", "3"],
    regulationPeriods: 4,
  },
  euroleague: {
    recentSeasons: 2,
    scheduleTypes: ["1", "2", "3"],
    h2hScheduleTypes: ["1", "2", "3"],
    regulationPeriods: 4,
  },
  eurocup: {
    recentSeasons: 2,
    scheduleTypes: ["1", "2", "3"],
    h2hScheduleTypes: ["1", "2", "3"],
    regulationPeriods: 4,
  },
  champions_league: {
    recentSeasons: 2,
    scheduleTypes: ["1", "2", "3"],
    h2hScheduleTypes: ["1", "2", "3"],
    regulationPeriods: 4,
  },
  turkey_bsl: {
    recentSeasons: 2,
    scheduleTypes: ["1", "2", "3"],
    h2hScheduleTypes: ["1", "2", "3"],
    regulationPeriods: 4,
  },
  acb: {
    recentSeasons: 2,
    scheduleTypes: ["1", "2", "3"],
    h2hScheduleTypes: ["1", "2", "3"],
    regulationPeriods: 4,
  },
  bbl: {
    recentSeasons: 2,
    scheduleTypes: ["1", "2", "3"],
    h2hScheduleTypes: ["1", "2", "3"],
    regulationPeriods: 4,
  },
  ausnbl: {
    recentSeasons: 2,
    scheduleTypes: ["1", "2", "3"],
    h2hScheduleTypes: ["1", "2", "3"],
    regulationPeriods: 4,
  },
  lba: {
    recentSeasons: 2,
    scheduleTypes: ["1", "2", "3"],
    h2hScheduleTypes: ["1", "2", "3"],
    regulationPeriods: 4,
  },
  bleague: {
    recentSeasons: 2,
    scheduleTypes: ["1", "2", "3"],
    h2hScheduleTypes: ["1", "2", "3"],
    regulationPeriods: 4,
  },
  united_league: {
    recentSeasons: 2,
    scheduleTypes: ["1", "2", "3"],
    h2hScheduleTypes: ["1", "2", "3"],
    regulationPeriods: 4,
  },
  proa: {
    recentSeasons: 2,
    scheduleTypes: ["1", "2", "3"],
    h2hScheduleTypes: ["1", "2", "3"],
    regulationPeriods: 4,
  },
  bcl: {
    recentSeasons: 2,
    scheduleTypes: ["1", "2", "3"],
    h2hScheduleTypes: ["1", "2", "3"],
    regulationPeriods: 4,
  },
  aba: {
    recentSeasons: 2,
    scheduleTypes: ["1", "2", "3"],
    h2hScheduleTypes: ["1", "2", "3"],
    regulationPeriods: 4,
  },
  isl: {
    recentSeasons: 2,
    scheduleTypes: ["1", "2", "3"],
    h2hScheduleTypes: ["1", "2", "3"],
    regulationPeriods: 4,
  },
  cebl: {
    recentSeasons: 2,
    scheduleTypes: ["1", "2", "3"],
    h2hScheduleTypes: ["1", "2", "3"],
    regulationPeriods: 4,
  },
};

const NBA_TEAM_MAP = {
  hawks: 1,
  atlanta: 1,
  celtics: 2,
  boston: 2,
  nets: 17,
  brooklyn: 17,
  hornets: 30,
  charlotte: 30,
  bulls: 4,
  chicago: 4,
  cavaliers: 5,
  cavs: 5,
  cleveland: 5,
  mavericks: 6,
  mavs: 6,
  dallas: 6,
  nuggets: 7,
  denver: 7,
  pistons: 8,
  detroit: 8,
  warriors: 9,
  "golden state": 9,
  gsw: 9,
  rockets: 10,
  houston: 10,
  pacers: 11,
  indiana: 11,
  clippers: 12,
  "la clippers": 12,
  lakers: 13,
  "los angeles lakers": 13,
  "la lakers": 13,
  grizzlies: 29,
  memphis: 29,
  heat: 14,
  miami: 14,
  bucks: 15,
  milwaukee: 15,
  timberwolves: 16,
  wolves: 16,
  minnesota: 16,
  pelicans: 3,
  "new orleans": 3,
  knicks: 18,
  "new york": 18,
  thunder: 25,
  okc: 25,
  "oklahoma city": 25,
  magic: 19,
  orlando: 19,
  "76ers": 20,
  sixers: 20,
  philadelphia: 20,
  suns: 21,
  phoenix: 21,
  "trail blazers": 22,
  trailblazers: 22,
  blazers: 22,
  portland: 22,
  kings: 23,
  sacramento: 23,
  spurs: 24,
  "san antonio": 24,
  raptors: 28,
  toronto: 28,
  jazz: 26,
  utah: 26,
  wizards: 27,
  washington: 27,
};

const NCAA_TEAM_MAP = {
  duke: 150,
  kentucky: 96,
  kansas: 2305,
  unc: 153,
  "north carolina": 153,
  uconn: 41,
  connecticut: 41,
  arizona: 12,
  gonzaga: 2250,
  purdue: 2509,
  ucla: 26,
  houston: 248,
  baylor: 239,
  tennessee: 2633,
  alabama: 333,
  auburn: 2,
  "michigan state": 127,
  wisconsin: 275,
  illinois: 356,
  texas: 251,
  arkansas: 8,
  memphis: 235,
  florida: 57,
  virginia: 258,
  villanova: 222,
  marquette: 269,
  creighton: 156,
  xavier: 2752,
  "saint marys": 2608,
  "st marys": 2608,
  "san diego state": 21,
  "new mexico": 167,
  dayton: 2168,
  byu: 252,
  "iowa state": 66,
  "texas tech": 2641,
  "texas a&m": 245,
  "texas a and m": 245,
  missouri: 142,
  indiana: 84,
  "ohio state": 194,
  michigan: 130,
  usc: 30,
  oregon: 2483,
  nevada: 4,
  "boise state": 68,
  "colorado state": 36,
  "utah state": 328,
  providence: 2507,
  "seton hall": 2550,
  "st johns": 2599,
  "saint johns": 2599,
  "wake forest": 154,
  clemson: 228,
  "florida atlantic": 2226,
  fau: 2226,
  miami: 2390,
  "texas christian": 2628,
  tcu: 2628,
  "nc state": 152,
  "north carolina state": 152,
  louisville: 97,
  syracuse: 183,
  "notre dame": 87,
  georgetown: 46,
  georgia: 61,
  "ole miss": 145,
  "mississippi state": 344,
  lsu: 99,
  vanderbilt: 238,
  butler: 2086,
  belmont: 2057,
  drake: 2181,
  "oregon state": 204,
  washington: 264,
  "washington state": 265,
};

const WNBA_TEAM_MAP = {
  aces: 17,
  "las vegas": 17,
  liberty: 9,
  "new york": 9,
  sun: 18,
  connecticut: 18,
  lynx: 8,
  minnesota: 8,
  storm: 14,
  seattle: 14,
  mercury: 11,
  phoenix: 11,
  fever: 5,
  indiana: 5,
  dream: 20,
  atlanta: 20,
  sky: 19,
  chicago: 19,
  wings: 3,
  dallas: 3,
  mystics: 16,
  washington: 16,
  sparks: 6,
  "los angeles": 6,
  valkyries: 129689,
  "golden state": 129689,
  fire: 132052,
  portland: 132052,
  tempo: 131935,
  toronto: 131935,
};

const _schedCache = new Map();
const _summaryCache = new Map();
const _fixtureCache = new Map();
const _teamCatalogCache = new Map();
let g_activeFetchController = null;

let _fixtureLoadToken = 0;
let activeDropTeam = null;
let selectedTeamIds = { A: null, B: null };
let g_teamSearchControllers = { A: null, B: null };
let g_lastFetchedTeams = { A: "", B: "" };

const defaultFetchMeta = () => ({
  A: {
    ft: { source: "manual", venueReliable: true },
    h1: { source: "manual", venueReliable: true },
  },
  B: {
    ft: { source: "manual", venueReliable: true },
    h1: { source: "manual", venueReliable: true },
  },
});

function defaultInjuryMeta() {
  return {
    scoringMult: 1,
    notes: [],
    outCount: 0,
    dtdCount: 0,
    unknownImpactCount: 0,
    hasUnknownImpact: false,
    highUncertainty: false,
  };
}

let g_fetchMeta = defaultFetchMeta();

const g_h2hManualPreference = { ft: null, h1: null, q1: null, q2: null, q3: null, q4: null };

function getH2HFieldIds(kind) {
  const map = {
    ft: ["aFTH2H", "bFTH2H", "useFTH2H"],
    h1: ["a1HH2H", "b1HH2H", "use1HH2H"],
    q1: ["aQ1H2H", "bQ1H2H", "useQ1H2H"],
    q2: ["aQ2H2H", "bQ2H2H", "useQ2H2H"],
    q3: ["aQ3H2H", "bQ3H2H", "useQ3H2H"],
    q4: ["aQ4H2H", "bQ4H2H", "useQ4H2H"],
  };
  return map[String(kind || "").toLowerCase()] || null;
}

function getH2HInputCount(kind) {
  const ids = getH2HFieldIds(kind);
  if (!ids) return 0;
  const [aId, bId] = ids;
  const parseCount = (id) => {
    const el = document.getElementById(id);
    if (!el) return 0;
    return String(el.value || "")
      .split(/[\s,]+/)
      .map((v) => v.trim())
      .filter((v) => v !== "" && !Number.isNaN(Number(v))).length;
  };
  return Math.min(parseCount(aId), parseCount(bId));
}

function syncH2HCheckbox(kind, forceAuto = false) {
  const ids = getH2HFieldIds(kind);
  if (!ids) return;
  const [, , cbId] = ids;
  const cb = document.getElementById(cbId);
  if (!cb) return;

  const minCount = getH2HInputCount(kind);
  const canEnable = minCount >= 2;
  const pref = g_h2hManualPreference[kind];

  if (!canEnable) {
    cb.checked = false;
    return;
  }

  if (pref === false && !forceAuto) {
    cb.checked = false;
    return;
  }

  cb.checked = true;
}

function syncAllH2HCheckboxes(forceAuto = false) {
  ["ft", "h1", "q1", "q2", "q3", "q4"].forEach((kind) => syncH2HCheckbox(kind, forceAuto));
}

function queueH2HCheckboxSync(forceAuto = false) {
  syncAllH2HCheckboxes(forceAuto);
}

let g_injA = defaultInjuryMeta();
let g_injB = defaultInjuryMeta();

function defaultMassacreFetchContext() {
  return {
    league: "",
    eventDate: "",
    A: {
      overall: null,
      venue: null,
      lastGameDate: "",
      restDays: null,
      ortg10: [],
      drtg10: [],
      pace10: [],
      q1Scored: [],
      q2Scored: [],
      q3Scored: [],
      q4Scored: [],
      q1Allowed: [],
      q2Allowed: [],
      q3Allowed: [],
      q4Allowed: [],
      roster: [],
      sos: null,
    },
    B: {
      overall: null,
      venue: null,
      lastGameDate: "",
      restDays: null,
      ortg10: [],
      drtg10: [],
      pace10: [],
      q1Scored: [],
      q2Scored: [],
      q3Scored: [],
      q4Scored: [],
      q1Allowed: [],
      q2Allowed: [],
      q3Allowed: [],
      q4Allowed: [],
      roster: [],
      sos: null,
    },
    h2hGames: [],
    refTendency: null,
  };
}

let g_massacreFetchContext = defaultMassacreFetchContext();
const TRACKED_PICKS_LIMIT = BB_CONFIG.limits.activePicks;
const TRACKER_ARCHIVED_LIMIT = 400;
const TRACKER_API_URL = WORKER_BASE_URL + "/cloud-sync";

const BB_DB_NAME = "BBEngineData";
const BB_STORE_NAME = "trackerStore";

function initBBDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BB_DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      if (!e.target.result.objectStoreNames.contains(BB_STORE_NAME)) {
        e.target.result.createObjectStore(BB_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readAsyncStorage(key) {
  try {
    const db = await initBBDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BB_STORE_NAME, "readonly");
      const request = tx.objectStore(BB_STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return undefined;
      try {
        return JSON.parse(raw);
      } catch (e) {
        return raw;
      }
    } catch (lsErr) {
      console.error("[BB Engine] readAsyncStorage localStorage fallback failed", lsErr);
      return undefined;
    }
  }
}

async function writeAsyncStorage(key, value) {
  if (typeof value === "string" && value.length > 4500000 && value.includes('"archivedPicks"')) {
    try {
      let parsed = JSON.parse(value);
      if (parsed.archivedPicks && parsed.archivedPicks.length > 150) {
        console.warn("[BB Engine] Pre-emptive Quota Rescue: Slicing archive to 150.");
        parsed.archivedPicks = parsed.archivedPicks.slice(0, 150);
        value = JSON.stringify(parsed);
        if (typeof g_trackerState !== "undefined" && g_trackerState) {
          g_trackerState.archivedPicks = parsed.archivedPicks;
        }
      }
    } catch (e) {
      engineDebug("Tracker archive prune/parse failed", { error: e?.message || String(e) });
    }
  }

  try {
    const db = await initBBDatabase();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(BB_STORE_NAME, "readwrite");
      tx.objectStore(BB_STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    try {
      const serialized = typeof value === "string" ? value : JSON.stringify(value);
      localStorage.setItem(key, serialized);
      console.warn(
        "[BB Engine] writeAsyncStorage: IndexedDB unavailable, using localStorage fallback.",
        { key },
      );
      return true;
    } catch (lsErr) {
      if (
        lsErr.name === "QuotaExceededError" &&
        typeof value === "string" &&
        value.includes('"archivedPicks"')
      ) {
        try {
          let parsed = JSON.parse(value);
          if (parsed.archivedPicks && parsed.archivedPicks.length > 100) {
            parsed.archivedPicks = parsed.archivedPicks.slice(0, 100);
            localStorage.setItem(key, JSON.stringify(parsed));
            if (typeof g_trackerState !== "undefined" && g_trackerState) {
              g_trackerState.archivedPicks = parsed.archivedPicks;
            }
            return true;
          }
        } catch (rescueErr) {
          engineDebug("writeAsyncStorage rescue-parse failed", {
            error: rescueErr?.message || String(rescueErr),
          });
        }
      }

      console.error(
        "[BB Engine] writeAsyncStorage localStorage fallback failed — data NOT saved:",
        lsErr?.name,
        lsErr?.message,
      );
      engineDebug("storage write failed", { key, error: lsErr?.name || String(lsErr) });
      return false;
    }
  }
}

const TRACKER_USER_KEY_STORAGE = "bb_engine_tracker_user_key";
const TRACKER_LOCAL_STATE_PREFIX = "bb_engine_tracker_state_";
const TRACKER_SAVE_DEBOUNCE_MS = 10000;
const TRACKER_NETWORK_TIMEOUT_MS = BB_CONFIG.timeouts.fetch;
const TRACKER_FIXED_USER_KEY = "THE_BET_CEO_KEY_H";
const ENGINE_MODEL_VERSION = "engine_v2_final";
const TRACKER_LEARNING_ENABLED = true;

const TRACKER_LEGACY_BUILD_KEYS = [
  "tracker_cleanup_v11_soft_live",
  "tracker_cleanup_v10_advisory",
  "tracker_cleanup_v9",
  "tracker_cleanup_v8",
  "tracker_cleanup_v7",
  "tracker_cleanup_v6",
  "tracker_cleanup_v5",
  "tracker_cleanup_v4",
];

const ENGINE_LINE_MEMORY_STORAGE = "bb_engine_line_memory_v1";
// C2 fix: this key was declared but never actually read from or written to
// storage, so every page reload silently wiped all opening-line memory and
// line-move trap detection could never fire outside the current tab session.
// Load any memory persisted by a prior session now.
let g_engineLineMemory = (function () {
  try {
    const stored = JSON.parse(localStorage.getItem(ENGINE_LINE_MEMORY_STORAGE) || "null");
    return stored && typeof stored === "object" ? stored : {};
  } catch (_e) {
    return {};
  }
})();

let g_trackerFallbackUserKey = "";
function getTrackerUserKey() {
  if (TRACKER_FIXED_USER_KEY && TRACKER_FIXED_USER_KEY.trim()) {
    const pinned = TRACKER_FIXED_USER_KEY.trim();
    g_trackerFallbackUserKey = pinned;
    try {
      localStorage.setItem(TRACKER_USER_KEY_STORAGE, pinned);
    } catch (err) {
      engineDebug("TRACKER_USER_KEY_STORAGE save failed", { error: err?.message || String(err) });
    }
    return pinned;
  }

  if (g_trackerFallbackUserKey) return g_trackerFallbackUserKey;

  try {
    let key = localStorage.getItem(TRACKER_USER_KEY_STORAGE) || "";

    if (!key) {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        key = crypto.randomUUID();
      } else if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
        key =
          "trk_" +
          Date.now() +
          "_" +
          Math.random().toString(36).slice(2, 11) +
          Math.random().toString(36).slice(2, 11);
      } else {
        key = "trk_legacy_" + Date.now() + "_" + Date.now().toString(36);
      }
      localStorage.setItem(TRACKER_USER_KEY_STORAGE, key);
    }

    g_trackerFallbackUserKey = key;
    return key;
  } catch (err) {
    console.error("[BB Engine] Fatal storage error generating tracking key.", err);
    engineDebug("CRITICAL: Storage blocked. Tracker disabled.");
    triggerGlobalEngineAlert(
      "STORAGE BLOCKED: The Tracker cannot function in strict Private Mode. Sync is disabled.",
    );
    return null;
  }
}

function getTrackerLocalStateStableKey() {
  const key = getTrackerUserKey();
  return key ? TRACKER_LOCAL_STATE_PREFIX + key : null;
}

function getTrackerLocalStateBuildKey(buildKey = APP_BUILD_VERSION) {
  const userKey = getTrackerUserKey();
  if (!userKey) return null;
  return TRACKER_LOCAL_STATE_PREFIX + String(buildKey || "") + "_" + userKey;
}

function getTrackerLocalStateCandidateKeys() {
  const keys = [getTrackerLocalStateStableKey(), getTrackerLocalStateBuildKey(APP_BUILD_VERSION)];

  TRACKER_LEGACY_BUILD_KEYS.forEach((buildKey) => {
    keys.push(getTrackerLocalStateBuildKey(buildKey));
  });

  return [...new Set(keys.filter(Boolean))];
}

function getTrackerStateLocalScore(state) {
  const active = Array.isArray(state?.activePicks) ? state.activePicks : [];
  const archived = Array.isArray(state?.archivedPicks) ? state.archivedPicks : [];
  const all = [...active, ...archived];
  const pendingActive = active.filter(
    (p) => String(p?.resultStatus || "pending").toLowerCase() === "pending",
  ).length;
  const settledCount = all.filter(
    (p) => String(p?.resultStatus || "pending").toLowerCase() !== "pending",
  ).length;
  const wins = all.filter((p) => String(p?.resultStatus || "").toLowerCase() === "win").length;
  const losses = all.filter((p) => String(p?.resultStatus || "").toLowerCase() === "loss").length;
  const pushes = all.filter((p) => String(p?.resultStatus || "").toLowerCase() === "push").length;
  const activeCount = active.length;
  const archivedCount = archived.length;
  const totalCount = activeCount + archivedCount;
  const updatedAtMs = Date.parse(state?.updatedAt || "") || 0;

  return {
    hasPicks: totalCount > 0 ? 1 : 0,
    pendingActive,
    totalCount,
    settledCount,
    wins,
    losses,
    pushes,
    activeCount,
    archivedCount,
    updatedAtMs,
  };
}

function isBetterTrackerStateCandidate(nextState, bestState) {
  if (!nextState) return false;
  if (!bestState) return true;

  const next = getTrackerStateLocalScore(nextState);
  const best = getTrackerStateLocalScore(bestState);

  if (next.updatedAtMs !== best.updatedAtMs) return next.updatedAtMs > best.updatedAtMs;

  if (next.hasPicks !== best.hasPicks) return next.hasPicks > best.hasPicks;
  if (next.settledCount !== best.settledCount) return next.settledCount > best.settledCount;
  if (next.wins !== best.wins) return next.wins > best.wins;
  if (next.losses !== best.losses) return next.losses > best.losses;
  if (next.pushes !== best.pushes) return next.pushes > best.pushes;
  if (next.totalCount !== best.totalCount) return next.totalCount > best.totalCount;
  if (next.activeCount !== best.activeCount) return next.activeCount > best.activeCount;
  if (next.archivedCount !== best.archivedCount) return next.archivedCount > best.archivedCount;
  if (next.pendingActive !== best.pendingActive) return next.pendingActive < best.pendingActive;

  return false;
}

async function loadTrackerStateFromLocal() {
  try {
    let bestState = null;
    const keys = getTrackerLocalStateCandidateKeys();

    for (const key of keys) {
      const raw = await readAsyncStorage(key);
      if (!raw) continue;

      let parsed;
      try {
        parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch (parseErr) {
        engineDebug("loadTrackerStateFromLocal: corrupt key skipped", {
          key,
          error: parseErr.message,
        });
        continue;
      }

      if (!parsed || typeof parsed !== "object") continue;

      if (!bestState || isBetterTrackerStateCandidate(parsed, bestState)) {
        bestState = parsed;
      }
    }
    return bestState;
  } catch (err) {
    engineDebug("WATCHDOG: Local load failed, using empty state", err);
    return null;
  }
}

async function saveTrackerStateToLocal() {
  try {
    const reconciled = reconcileTrackerBucketConflicts(
      AppState.tracker.state.activePicks,
      AppState.tracker.state.archivedPicks,
    );
    AppState.tracker.state.activePicks = reconciled.activePicks;
    AppState.tracker.state.archivedPicks = reconciled.archivedPicks;

    rebuildTrackerStats();

    const payload = JSON.stringify(AppState.tracker.state);

    const primaryKey = getTrackerLocalStateStableKey();
    if (!primaryKey) {
      throw new Error("Local storage write completely failed (no valid storage key).");
    }

    const writeResult = await writeAsyncStorage(primaryKey, payload);
    if (writeResult === false) {
      throw new Error("Local storage write completely failed (Quota Exceeded or Blocked).");
    }
    try {
      const _verifyDb = await initBBDatabase();
      const _isInDB = await new Promise((res) => {
        const _vtx = _verifyDb.transaction(BB_STORE_NAME, "readonly");
        _vtx.objectStore(BB_STORE_NAME).get(primaryKey).onsuccess = (e) => res(!!e.target.result);
        _vtx.onerror = () => res(false);
      }).catch(() => false);
      if (!_isInDB) {
        trackerDebug(
          "WARN: IndexedDB write failed — fell back to localStorage. Check storage quota.",
        );
      }
    } catch (_verifyErr) {
      engineDebug("IndexedDB verify step failed", {
        error: _verifyErr?.message || String(_verifyErr),
      });
    }
  } catch (err) {
    console.error("[BB Engine] saveTrackerStateToLocal async failed", err);
    engineDebug("CRITICAL: Local storage failed. Data loss imminent.", String(err));
    triggerGlobalEngineAlert(
      "STORAGE FAILURE: Your device cannot save tracker data. Ensure Private Browsing is off and storage is not full.",
    );

    const runBtn = document.getElementById("runBtn");
    if (runBtn) {
      runBtn.title = "⚠ Storage failed — data may not save";
      runBtn.style.outline = "2px solid #d91f26";
    }
  }
}

function getTrackerHeaders(includeJson = false) {
  const headers = {};

  if (includeJson) {
    headers["Content-Type"] = "text/plain";
  }

  return headers;
}

let g_trackerState = {
  vId: 1,
  sId: window.__BETCEO_SESSION_ID,
  activePicks: [],
  archivedPicks: [],
  shadowPicks: [],
  stats: {
    total: 0,
    settled: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
  },
  updatedAt: new Date().toISOString(),
  lineMemory: {},
};

function defaultTrackerDerivedState() {
  return {
    totalPicks: 0,
    settledPicks: 0,
    profiles: {},
    environments: {},
    marketSides: {},
    teams: {},
    matchups: {},
    signalBoards: {
      profiles: [],
      environments: [],
      marketSides: [],
      teams: [],
      matchups: [],
    },
    computedAt: null,
  };
}
function normalizeModelVersion(version) {
  return String(version || "legacy").trim() || "legacy";
}

function getCurrentModelVersion() {
  return normalizeModelVersion(ENGINE_MODEL_VERSION);
}

function getLiveConfigFingerprint(league) {
  try {
    // A9 fix: "extremeExpansion" removed from the fingerprint — it is not
    // wired to getParam() by any computation (see registry entry), so
    // including it here falsely implied that tuning it changes model output
    // and could cause spurious fingerprint mismatches unrelated to any real
    // config change.
    const keys = [
      "teamWeightBase",
      "h2hFactor",
      "h2hMaxWeight",
      "underEdgeFactor",
      "injuryOppBoostFactor",
      "advancedBlendWeight",
      "quarterAnchorBlendWeight",
      "fatigueB2BPenalty",
      "volatilityLimit",
      "edgeFTPointThreshold",
      "edgeH1PointThreshold",
      "edgeTeamPointThreshold",
      "edgeQPointThreshold",
      "confidenceAThresh",
      "confidenceBThresh",
      "confidenceCThresh",
    ];
    const parts = keys.map((k) => {
      const v = getParam(k, league);
      return k + ":" + (Array.isArray(v) ? v.join(",") : v);
    });
    const str = parts.join("|");
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16);
  } catch (e) {
    return "unknown";
  }
}

function isPickEligibleForLearning(pick) {
  // FIX Issue 28: require settled W/L, finite market-correct actual, non-NO-PLAY text.
  if (!TRACKER_LEARNING_ENABLED) return false;
  if (!pick) return false;
  const res = String(pick.resultStatus || pick.engineResultStatus || "").toLowerCase();
  if (res !== "win" && res !== "loss") return false;
  const txt = String(pick.predictionText || pick.pick || "").trim().toUpperCase();
  if (!txt || txt === "NO PLAY" || txt === "—" || txt === "-") return false;
  const parsed =
    typeof parseFinalScore === "function"
      ? parseFinalScore(pick.actualScore)
      : { total: parseFloat(pick.actualScore) };
  const mkt = String(pick.marketKey || "").toLowerCase();
  if (mkt === "winner" || mkt === "htft") {
    // side outcomes may be "Home"/"Away"/"Tie" — allow non-numeric
    if (pick.actualScore == null || pick.actualScore === "") return false;
  } else if (!(parsed && isFinite(parsed.total))) {
    return false;
  }
  if (pick.settledVersion && typeof ENGINE_MODEL_VERSION !== "undefined") {
    if (String(pick.settledVersion) !== String(ENGINE_MODEL_VERSION)) return false;
  }
  return true;
}

function getLearningTrackedPicks() {
  const active = Array.isArray(AppState.tracker.state.activePicks)
    ? AppState.tracker.state.activePicks
    : [];
  const archived = Array.isArray(AppState.tracker.state.archivedPicks)
    ? AppState.tracker.state.archivedPicks
    : [];

  return [...active, ...archived]
    .map((p) => ensureTrackedPickKeys(p))
    .filter((p) => isPickEligibleForLearning(p));
}

function getTotalSettledCountForLeague(league) {
  const all = getLearningTrackedPicks();
  return all.filter(
    (p) =>
      p.league === league &&
      (p.resultStatus === "win" || p.resultStatus === "loss" || p.resultStatus === "push"),
  ).length;
}

function getAllTrackedPicksForReport() {
  const active = Array.isArray(AppState.tracker.state.activePicks)
    ? AppState.tracker.state.activePicks
    : [];
  const archived = Array.isArray(AppState.tracker.state.archivedPicks)
    ? AppState.tracker.state.archivedPicks
    : [];

  const shadow = Array.isArray(AppState.tracker.state.shadowPicks)
    ? AppState.tracker.state.shadowPicks
    : [];

  return [...active, ...archived, ...shadow].map((p) => ensureTrackedPickKeys(p));
}
let g_trackerDerivedState = defaultTrackerDerivedState();

function makeDerivedBucket(label = "") {
  return {
    label,
    picks: 0,
    pending: 0,
    settled: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    decisive: 0,
    netWins: 0,
    rawWinRate: null,
    stabilizedWinRate: null,
    reliabilityScore: 0,
    reliabilityTier: "none",
    signalStrength: null,
    signalDirection: "neutral",
    isActionable: false,
    winRate: null,
  };
}

function getBucketReliabilityScore(decisiveGames = 0) {
  const n = Number(decisiveGames) || 0;

  if (n <= 0) return 0;
  if (n === 1) return 8;
  if (n === 2) return 15;
  if (n === 3) return 22;
  if (n <= 5) return 32;
  if (n <= 8) return 45;
  if (n <= 12) return 58;
  if (n <= 18) return 72;
  if (n <= 28) return 84;
  if (n <= 45) return 93;
  return 100;
}

function getBucketReliabilityTier(score = 0) {
  if (score >= 93) return "elite";
  if (score >= 84) return "strong";
  if (score >= 72) return "trusted";
  if (score >= 58) return "building";
  if (score >= 45) return "small";
  if (score >= 22) return "tiny";
  return "none";
}

function getStabilizedBucketWinRate(wins = 0, losses = 0, priorGames = 12, priorWinRate = 50) {
  const w = Number(wins) || 0;
  const l = Number(losses) || 0;
  const decisive = w + l;

  if (!decisive) return null;

  const priorWins = priorGames * (priorWinRate / 100);
  return Number((((w + priorWins) / (decisive + priorGames)) * 100).toFixed(2));
}

function getBucketSignalStrength(stabilizedWinRate = null, reliabilityScore = 0, decisive = 0) {
  if (!isFinite(stabilizedWinRate)) return null;
  const n = Math.max(1, Number(decisive) || 0);
  const stdErr = Math.sqrt(0.25 / n) * 100;
  return Number(((stabilizedWinRate - 50) / stdErr).toFixed(2));
}

function getBucketSignalDirection(signalStrength = null) {
  if (!isFinite(signalStrength)) return "neutral";
  if (signalStrength >= 1.0) return "positive";
  if (signalStrength <= -1.0) return "negative";
  return "neutral";
}

function getBucketActionability(decisive = 0, reliabilityScore = 0, signalStrength = null) {
  return decisive >= 8 && isFinite(signalStrength) && Math.abs(signalStrength) >= 1.0;
}

function finalizeDerivedBucket(bucket) {
  const settled = Number(bucket.settled || 0);
  const wins = Number(bucket.wins || 0);
  const losses = Number(bucket.losses || 0);
  const decisive = wins + losses;

  const rawWinRate = decisive ? Number(((wins / decisive) * 100).toFixed(2)) : null;

  const _empiricalPrior = (() => {
    try {
      const _settled = getLearningTrackedPicks().filter(
        (p) => p.resultStatus === "win" || p.resultStatus === "loss",
      );
      if (_settled.length < 30) return 50;
      const _w = _settled.filter((p) => p.resultStatus === "win").length;
      return Math.min(60, Math.max(40, (_w / _settled.length) * 100));
    } catch (e) {
      return 50;
    }
  })();
  const stabilizedWinRate = getStabilizedBucketWinRate(wins, losses, 12, _empiricalPrior);
  const reliabilityScore = getBucketReliabilityScore(decisive);
  const reliabilityTier = getBucketReliabilityTier(reliabilityScore);

  const signalStrength = getBucketSignalStrength(stabilizedWinRate, reliabilityScore, decisive);
  const signalDirection = getBucketSignalDirection(signalStrength);
  const isActionable = getBucketActionability(decisive, reliabilityScore, signalStrength);

  bucket.decisive = decisive;
  bucket.netWins = wins - losses;
  bucket.rawWinRate = rawWinRate;
  bucket.stabilizedWinRate = stabilizedWinRate;
  bucket.reliabilityScore = reliabilityScore;
  bucket.reliabilityTier = reliabilityTier;
  bucket.signalStrength = signalStrength;
  bucket.signalDirection = signalDirection;
  bucket.isActionable = isActionable;

  bucket.winRate = settled ? Number(((wins / settled) * 100).toFixed(2)) : null;

  return bucket;
}

function collectDerivedSignals(bucketObject = {}, topN = 12) {
  return Object.entries(bucketObject)
    .map(([key, bucket]) => ({ key, ...bucket }))
    .filter((item) => item.isActionable)
    .sort((a, b) => {
      const aSignal = Math.abs(Number(a.signalStrength || 0));
      const bSignal = Math.abs(Number(b.signalStrength || 0));

      if (bSignal !== aSignal) return bSignal - aSignal;
      if ((b.decisive || 0) !== (a.decisive || 0)) return (b.decisive || 0) - (a.decisive || 0);
      return String(a.key).localeCompare(String(b.key));
    })
    .slice(0, topN);
}
function applyResultToDerivedBucket(bucket, pick) {
  const status = String(pick?.engineResultStatus || pick?.resultStatus || "pending").toLowerCase();

  bucket.picks++;

  if (status === "pending") {
    bucket.pending++;
    return;
  }

  bucket.settled++;

  if (status === "win") bucket.wins++;
  else if (status === "loss") bucket.losses++;
  else if (status === "push") bucket.pushes++;
}
function upsertDerivedBucket(map, key, label, pick) {
  if (!key) return;

  if (!map.has(key)) {
    map.set(key, makeDerivedBucket(label || key));
  }

  applyResultToDerivedBucket(map.get(key), pick);
}

function derivedMapToObject(map) {
  const out = {};

  [...map.entries()]
    .sort((a, b) => {
      const A = a[1];
      const B = b[1];

      if ((B.settled || 0) !== (A.settled || 0)) return (B.settled || 0) - (A.settled || 0);
      if ((B.wins || 0) !== (A.wins || 0)) return (B.wins || 0) - (A.wins || 0);
      if ((A.losses || 0) !== (B.losses || 0)) return (A.losses || 0) - (B.losses || 0);

      return String(a[0]).localeCompare(String(b[0]));
    })
    .forEach(([key, bucket]) => {
      out[key] = finalizeDerivedBucket({ ...bucket });
    });

  return out;
}

function buildFallbackProfileKey(pick) {
  return [
    pick.league || "unknown",
    pick.marketKey || "other",
    pick.side || "unknown",
    pick.edgeBucket || "unknown",
    pick.lineBucket || "unknown",
    pick.sampleTier || "unknown",
    pick.projectionOnly ? "projection_only" : "normal_projection",
    pick.volatilityBucket || "unknown",
    pick.injuryBucket || "unknown",
  ].join("|");
}

function buildFallbackEnvironmentKey(pick) {
  return [
    pick.hasH2H ? "h2h" : "no_h2h",
    pick.gamePaceGapRisk ? "pace_gap" : "pace_ok",
    pick.gameDefensiveFloorFlag ? "def_floor" : "def_ok",
    (Number(pick.gameBlowoutGap) || 0) > 20 ? "blowout" : "balanced",
    pick.gameVolatilityBlock ? "vol_block" : "vol_ok",
  ].join("|");
}

function buildTrackerDerivedStateFromPicks(inputPicks = []) {
  const all = Array.isArray(inputPicks) ? inputPicks.map((p) => ensureTrackedPickKeys(p)) : [];

  const profileMap = new Map();
  const environmentMap = new Map();
  const marketSideMap = new Map();
  const teamMap = new Map();
  const matchupMap = new Map();

  all.forEach((pick) => {
    const profileKey = pick.memoryProfileKey || buildFallbackProfileKey(pick);
    const environmentKey = pick.environmentKey || buildFallbackEnvironmentKey(pick);
    const marketSideKey = [
      pick.league || "unknown",
      pick.marketKey || "other",
      pick.side || "unknown",
    ].join("|");

    upsertDerivedBucket(profileMap, profileKey, profileKey, pick);
    upsertDerivedBucket(environmentMap, environmentKey, environmentKey, pick);
    upsertDerivedBucket(marketSideMap, marketSideKey, marketSideKey, pick);

    const marketKey = String(pick.marketKey || "");

    if (["ft", "h1", "h2"].includes(marketKey)) {
      if (pick.homeTeamKey) {
        const homeBucketKey = `${pick.league || "unknown"}:${pick.homeTeamKey}`;
        upsertDerivedBucket(teamMap, homeBucketKey, pick.homeTeam || pick.homeTeamKey, pick);
      }

      if (pick.awayTeamKey && pick.awayTeamKey !== pick.homeTeamKey) {
        const awayBucketKey = `${pick.league || "unknown"}:${pick.awayTeamKey}`;
        upsertDerivedBucket(teamMap, awayBucketKey, pick.awayTeam || pick.awayTeamKey, pick);
      }
    } else if (marketKey === "team_a") {
      if (pick.homeTeamKey) {
        const homeBucketKey = `${pick.league || "unknown"}:${pick.homeTeamKey}`;
        upsertDerivedBucket(teamMap, homeBucketKey, pick.homeTeam || pick.homeTeamKey, pick);
      }
    } else if (marketKey === "team_b") {
      if (pick.awayTeamKey) {
        const awayBucketKey = `${pick.league || "unknown"}:${pick.awayTeamKey}`;
        upsertDerivedBucket(teamMap, awayBucketKey, pick.awayTeam || pick.awayTeamKey, pick);
      }
    }

    if (pick.matchupKey) {
      const matchupBucketKey = `${pick.league || "unknown"}:${pick.matchupKey}`;
      upsertDerivedBucket(
        matchupMap,
        matchupBucketKey,
        `${pick.homeTeam || "—"} vs ${pick.awayTeam || "—"}`,
        pick,
      );
    }
  });

  const profiles = derivedMapToObject(profileMap);
  const environments = derivedMapToObject(environmentMap);
  const marketSides = derivedMapToObject(marketSideMap);
  const teams = derivedMapToObject(teamMap);
  const matchups = derivedMapToObject(matchupMap);

  return {
    totalPicks: all.length,
    settledPicks: all.filter((p) => {
      const s = String(p.resultStatus || "pending").toLowerCase();
      return s === "win" || s === "loss" || s === "push";
    }).length,
    profiles,
    environments,
    marketSides,
    teams,
    matchups,
    signalBoards: {
      profiles: collectDerivedSignals(profiles, 12),
      environments: collectDerivedSignals(environments, 12),
      marketSides: collectDerivedSignals(marketSides, 12),
      teams: collectDerivedSignals(teams, 12),
      matchups: collectDerivedSignals(matchups, 12),
    },
    computedAt: new Date().toISOString(),
  };
}

function buildTrackerDerivedState() {
  return buildTrackerDerivedStateFromPicks(getLearningTrackedPicks());
}

function buildTrackerVersionStates() {
  const byVersion = new Map();
  getAllTrackedPicksForReport().forEach((pick) => {
    const version = normalizeModelVersion(pick?.modelVersion);
    if (!byVersion.has(version)) byVersion.set(version, []);
    byVersion.get(version).push(pick);
  });

  const out = {};
  byVersion.forEach((rows, version) => {
    out[version] = buildTrackerDerivedStateFromPicks(rows);
  });
  return out;
}

let g_lastDerivedUpdatedAt = null;
function rebuildTrackerDerivedState() {
  const currentUpdatedAt = AppState.tracker.state?.updatedAt || "";
  if (g_lastDerivedUpdatedAt === currentUpdatedAt && AppState.tracker.derived) {
    return AppState.tracker.derived;
  }
  AppState.tracker.derived = buildTrackerDerivedState();
  g_lastDerivedUpdatedAt = currentUpdatedAt;
  return AppState.tracker.derived;
}
let g_trackerHydratePromise = null;
let g_trackerFollowupTimer = null;
let g_trackerSaveTimer = null;
let _lastBackgroundSync = 0;
const BACKGROUND_SYNC_THROTTLE_MS = 60000;
let g_refreshTrackedPicksInFlight = false;
let g_trackerSaveVersion = 0;
let g_trackerPersistedVersion = 0;
let g_trackerSaveInFlight = false;
let g_trackerModalView = "picks";
const TRACKER_DEBUG_LIMIT = 40;
let g_trackerDebugLog = [];
const g_settlementDebugLog = new Map();
const g_liveGameStatus = new Map();

function isTrackerPicksView() {
  return AppState.ui.modalView === "picks";
}

function isTrackerReportView() {
  return AppState.ui.modalView === "report";
}

function isTrackerDebugView() {
  return AppState.ui.modalView === "debug";
}

function isTrackerConfigsView() {
  return AppState.ui.modalView === "configs";
}

function isTrackerHealthView() {
  return AppState.ui.modalView === "health";
}

function trackerDebug(message, extra = null) {
  try {
    const stamp = new Date().toLocaleTimeString([], { hour12: false });
    let detail = "";
    if (extra !== null && extra !== undefined) {
      if (typeof extra === "string") {
        detail = extra;
      } else if (extra instanceof Error) {
        detail = `${extra.message} | Stack: ${extra.stack}`;
      } else {
        const copy = Array.isArray(extra) ? [...extra] : { ...extra };
        for (const k in copy) {
          if (copy[k] instanceof Error) copy[k] = `${copy[k].message} | Stack: ${copy[k].stack}`;
        }
        try {
          detail = JSON.stringify(copy);
        } catch (err) {
          detail = String(extra);
        }
      }
    }
    const line = detail ? `[${stamp}] ${message} | ${detail}` : `[${stamp}] ${message}`;
    g_trackerDebugLog.unshift(line);
    if (g_trackerDebugLog.length > TRACKER_DEBUG_LIMIT)
      g_trackerDebugLog = g_trackerDebugLog.slice(0, TRACKER_DEBUG_LIMIT);

    if (!isIgnoredEngineWatchLine(line) && getDebugSeverity(line) === "error") {
      triggerGlobalEngineAlert(line);
    }
    renderTrackerDebugPanel();
    updateTrackerInsightsButton();
  } catch (err) {
    console.error("[BB Engine] trackerDebug failed", err);
  }
}

function renderTrackerDebugPanel() {
  if (!isTrackerPicksView()) {
    renderTrackerAnalytics();
  }
}

const ENGINE_DEBUG_LIMIT = 180;
let g_engineDebugLog = [];

const AppState = {
  debug: {
    get engineLog() {
      return g_engineDebugLog;
    },
    set engineLog(v) {
      g_engineDebugLog = v;
    },
    get trackerLog() {
      return g_trackerDebugLog;
    },
    set trackerLog(v) {
      g_trackerDebugLog = v;
    },
  },
  selection: {
    get teamAId() {
      return selectedTeamIds.A;
    },
    set teamAId(v) {
      selectedTeamIds.A = v;
    },
    get teamBId() {
      return selectedTeamIds.B;
    },
    set teamBId(v) {
      selectedTeamIds.B = v;
    },
    get lastFetchedA() {
      return g_lastFetchedTeams.A;
    },
    set lastFetchedA(v) {
      g_lastFetchedTeams.A = v;
    },
    get lastFetchedB() {
      return g_lastFetchedTeams.B;
    },
    set lastFetchedB(v) {
      g_lastFetchedTeams.B = v;
    },
    get activeDrop() {
      return activeDropTeam;
    },
    set activeDrop(v) {
      activeDropTeam = v;
    },
  },

  fetchMeta: {
    get A() {
      return g_fetchMeta.A;
    },
    set A(v) {
      g_fetchMeta.A = v;
    },
    get B() {
      return g_fetchMeta.B;
    },
    set B(v) {
      g_fetchMeta.B = v;
    },
  },

  injuries: {
    get A() {
      return g_injA;
    },
    set A(v) {
      g_injA = v;
    },
    get B() {
      return g_injB;
    },
    set B(v) {
      g_injB = v;
    },
  },

  ui: {
    get modalView() {
      return g_trackerModalView;
    },
    set modalView(v) {
      g_trackerModalView = v;
    },
    get alertNeedsReview() {
      return g_engineAlertNeedsReview;
    },
    set alertNeedsReview(v) {
      g_engineAlertNeedsReview = v;
    },
    get alertLastLine() {
      return g_engineAlertLastLine;
    },
    set alertLastLine(v) {
      g_engineAlertLastLine = v;
    },
    get saveFailureCount() {
      return g_trackerSaveFailureCount;
    },
    set saveFailureCount(v) {
      g_trackerSaveFailureCount = v;
    },
    get inputErrors() {
      return g_fetchInputErrors;
    },
    set inputErrors(v) {
      g_fetchInputErrors = v;
    },
    get auditIssues() {
      return g_fetchAuditIssues;
    },
    set auditIssues(v) {
      g_fetchAuditIssues = v;
    },
  },

  context: {
    get data() {
      return g_massacreFetchContext;
    },
    set data(v) {
      g_massacreFetchContext = v;
    },
  },

  tracker: {
    get state() {
      return g_trackerState;
    },
    set state(v) {
      g_trackerState = v;
    },
    get derived() {
      return g_trackerDerivedState;
    },
    set derived(v) {
      g_trackerDerivedState = v;
    },
  },
};

function engineDebug(message, extra = null) {
  try {
    const stamp = new Date().toLocaleTimeString([], { hour12: false });
    let detail = "";
    if (extra !== null && extra !== undefined) {
      if (typeof extra === "string") {
        detail = extra;
      } else if (extra instanceof Error) {
        detail = `${extra.message} | Stack: ${extra.stack}`;
      } else {
        const copy = Array.isArray(extra) ? [...extra] : { ...extra };
        for (const k in copy) {
          if (copy[k] instanceof Error) copy[k] = `${copy[k].message} | Stack: ${copy[k].stack}`;
        }
        try {
          detail = JSON.stringify(copy);
        } catch (err) {
          detail = String(extra);
        }
      }
    }
    const line = detail ? `[${stamp}] ${message} | ${detail}` : `[${stamp}] ${message}`;
    g_engineDebugLog.unshift(line);
    if (g_engineDebugLog.length > ENGINE_DEBUG_LIMIT)
      g_engineDebugLog = g_engineDebugLog.slice(0, ENGINE_DEBUG_LIMIT);

    if (!isIgnoredEngineWatchLine(line) && getDebugSeverity(line) === "error") {
      triggerGlobalEngineAlert(line);
    }
    renderEngineDebugPanel();
    updateTrackerInsightsButton();
  } catch (err) {
    console.error("[BB Engine] engineDebug failed", err);
  }
}

function renderEngineDebugPanel() {
  if (isTrackerDebugView() || isTrackerReportView()) {
    renderTrackerAnalytics();
  }
}

window.g_pickVarianceLog = window.g_pickVarianceLog || [];
window.recordPickVariance =
  window.recordPickVariance ||
  function (pick) {
    try {
      const proj = Number(pick?.proj);
      const actual = (typeof parseFinalScore === 'function' ? parseFinalScore(pick?.actualScore).total : parseFloat(pick?.actualScore));
      if (!isFinite(proj) || !isFinite(actual)) return;
      window.g_pickVarianceLog.push({ error: Math.abs(actual - proj), ts: Date.now() });
      if (window.g_pickVarianceLog.length > 500) {
        window.g_pickVarianceLog = window.g_pickVarianceLog.slice(-500);
      }
    } catch (e) {
      engineDebug("g_pickVarianceLog update failed", { error: e?.message || String(e) });
    }
  };
window.getRollingMeanError =
  window.getRollingMeanError ||
  function (n) {
    const log = window.g_pickVarianceLog || [];
    if (!log.length) return NaN;
    const sample = log.slice(-Math.max(1, Number(n) || 20));
    if (!sample.length) return NaN;
    return sample.reduce((s, e) => s + e.error, 0) / sample.length;
  };

let g_engineAlertNeedsReview = false;
let g_engineAlertLastLine = "";

function applyGlobalEngineAlertState() {
  document.body.classList.remove("engine-alert");
  AppState.ui.alertNeedsReview = false;
  renderHeaderErrorState();
  updateTrackerInsightsButton();
}

function triggerGlobalEngineAlert(line = "") {
  // UI alerts disabled — still record last line for debug panels only; never pulse/alert the user.
  if (line) AppState.ui.alertLastLine = String(line);
  AppState.ui.alertNeedsReview = false;
  try {
    document.body.classList.remove("engine-alert");
    const btn = document.getElementById("headerErrorBtn");
    if (btn) btn.classList.remove("active");
  } catch (_e) {}
}

function acknowledgeGlobalEngineAlert() {
  AppState.ui.alertNeedsReview = false;
  applyGlobalEngineAlertState();
}

function triggerTrackerMilitaryRaid() {
  const statusEl = document.getElementById("trackerStatusLabel");
  if (statusEl) {
    statusEl.textContent = "Triggered ⚡️";
    statusEl.style.color = "#ff6b6b";
    setTimeout(() => {
      statusEl.textContent = "Completed ⚡️";
      statusEl.style.color = "#4ade80";
    }, 500);
    setTimeout(() => {
      statusEl.textContent = "";
      statusEl.style.color = "";
    }, 1000);
  }
  if (typeof AFDB !== "undefined" && typeof AFDB.runTestFetch === "function") {
    AFDB.runTestFetch();
  }
}

function getDebugSeverity(line) {
  const text = String(line || "").toLowerCase();
  if (!text) return "";
  // Expected recovery paths — not errors
  if (
    text.includes("normal fallback") ||
    text.includes("worker path unavailable") ||
    text.includes("using direct espn") ||
    text.includes("worker fetch failed, trying direct") ||
    text.includes("trying direct espn")
  ) {
    return "ok";
  }
  if (
    /\b(critical|fatal|fail|failed|failure|error|mismatch|rejected|runtime|uncaught|exception|invalid state|invalid operation|missing competition data)\b/.test(
      text,
    )
  ) {
    return "error";
  }
  if (/\b(warning|warn|fallback|watch|pending)\b/.test(text)) return "warn";
  if (/\b(settled|success|pass|snapshot|merged|response|push start|complete|verified)\b/.test(text))
    return "ok";
  return "";
}

function getDebugSeverityClass(line) {
  const severity = getDebugSeverity(line);
  if (severity === "error") return "debug-critical";
  if (severity === "warn") return "debug-warn";
  if (severity === "ok") return "debug-ok";
  return "";
}

function prioritizeDebugLines(lines = [], limit = 10) {
  const rank = { error: 0, warn: 1, ok: 2, "": 3 };

  return (Array.isArray(lines) ? lines : [])
    .filter((line) => {
      const text = line.toLowerCase();
      const isSpam =
        text.includes("push start") ||
        text.includes("flush save") ||
        text.includes("apply response") ||
        text.includes("settle/sync") ||
        text.includes("state found") ||
        text.includes("state loaded") ||
        text.includes("merged state");
      return (
        !isSpam || text.includes("error") || text.includes("failed") || text.includes("level 2")
      );
    })
    .map((line, index) => ({ line, index, severity: getDebugSeverity(line) }))
    .sort((a, b) => {
      if (a.line.toLowerCase().includes("level 2") && !b.line.toLowerCase().includes("level 2"))
        return -1;
      if (!a.line.toLowerCase().includes("level 2") && b.line.toLowerCase().includes("level 2"))
        return 1;

      const diff = (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9);
      return diff !== 0 ? diff : a.index - b.index;
    })
    .slice(0, limit)
    .map((row) => {
      const stackSplit = row.line.indexOf(" | Stack:");
      if (stackSplit !== -1) {
        const msgPart = row.line.substring(0, stackSplit);
        const stackPart = row.line
          .substring(stackSplit + 9)
          .trim()
          .replace(/\\n/g, "\n");
        return `${msgPart}\n\n${stackPart}`;
      }

      const jsonSplit = row.line.indexOf(" | {");
      if (jsonSplit !== -1) {
        try {
          const msgPart = row.line.substring(0, jsonSplit);
          const jsonPart = row.line.substring(jsonSplit + 3);
          const parsed = JSON.parse(jsonPart);
          return msgPart + "\n" + JSON.stringify(parsed, null, 2);
        } catch (e) {
          return row.line;
        }
      }

      return row.line;
    });
}

function isIgnoredEngineWatchLine(line = "") {
  const text = String(line || "")
    .toLowerCase()
    .trim();
  if (!text) return false;

  return (
    text.includes("worker path unavailable") ||
    text.includes("trying direct espn") ||
    text.includes("normal fallback") ||
    text.includes("worker fetch failed") ||
    text.includes("validation failed") ||
    text.includes("run blocked missing league") ||
    text.includes("run blocked duplicate teams") ||
    text.includes("finished with no tracker changes") ||
    text.includes("no tracker changes") ||
    text.includes('confidence":"nan') ||
    text.includes('"no-play"') ||
    text.includes("critical network block") ||
    text.includes("fetch is aborted") ||
    text.includes("hydrate failed") ||
    text.includes("worker timeout") ||
    text.includes("fallback proxy") ||
    text.includes("http 400") ||
    text.includes("http 403") ||
    text.includes("nba-g-league")
  );
}

window.addEventListener("unhandledrejection", (event) => {
  const _r = event.reason?.message || String(event.reason);
  if (
    _r.toLowerCase().includes("fetch") ||
    _r.toLowerCase().includes("load failed") ||
    _r.toLowerCase().includes("networkerror")
  )
    return;
  engineDebug("UNHANDLED REJECTION: " + _r, "engine");
});

function maybeReadH2HEnabled(kind, snapshotOverride = null) {
  const map = {
    ft: "useFTH2H",
    h1: "use1HH2H",
    q1: "useQ1H2H",
    q2: "useQ2H2H",
    q3: "useQ3H2H",
    q4: "useQ4H2H",
  };
  const k = String(kind || "").toLowerCase();

  // FIX (HIGH #7): during replay/calibration, prefer the snapshot's captured
  // toggle state over the live DOM, so replaying a historical pick doesn't
  // silently depend on whatever the user's checkboxes happen to be set to
  // right now. snapshotOverride is null for ordinary live use, which leaves
  // this function's DOM-reading behavior unchanged.
  if (snapshotOverride && typeof snapshotOverride === "object") {
    if (k === "h2") {
      if (typeof snapshotOverride.useQ3H2H === "boolean" || typeof snapshotOverride.useQ4H2H === "boolean") {
        if (snapshotOverride.useQ3H2H || snapshotOverride.useQ4H2H) return true;
      }
    } else if (typeof snapshotOverride[map[k]] === "boolean") {
      return snapshotOverride[map[k]];
    }
  }

  if (k === "h2") {
    const q3 = document.getElementById("useQ3H2H");
    const q4 = document.getElementById("useQ4H2H");
    if ((q3 && q3.checked) || (q4 && q4.checked)) return true;

    const games =
      AppState.context && Array.isArray(AppState.context.data?.h2hGames)
        ? AppState.context.data.h2hGames
        : [];
    let usable = 0;
    for (const g of games) {
      if (
        isFinite(Number(g.h2A)) &&
        Number(g.h2A) > 0 &&
        isFinite(Number(g.h2B)) &&
        Number(g.h2B) > 0
      )
        usable++;
    }
    return usable >= 2;
  }
  const id = map[k] || null;
  if (!id) return false;
  const el = document.getElementById(id);
  return !!(el && el.checked);
}

function getVisibleDebugLines(logs, scope, limit) {
  return prioritizeDebugLines(logs, limit);
}

function summarizeFetchMetaForDebug() {
  const out = {};

  ["A", "B"].forEach((side) => {
    const sideMeta = AppState.fetchMeta[side] || {};
    out[side] = {};
    ["ft", "h1"].forEach((bucket) => {
      out[side][bucket] = {
        source: String(sideMeta?.[bucket]?.source || "manual"),
        venueReliable: sideMeta?.[bucket]?.venueReliable !== false,
      };
    });
  });
  return out;
}

function summarizeFixtureMetaForDebug(meta = {}) {
  return {
    league: String(meta?.league || ""),
    eventId: String(meta?.eventId || ""),
    eventDate: String(meta?.eventDate || ""),
    homeTeam: String(meta?.homeTeam || ""),
    awayTeam: String(meta?.awayTeam || ""),
  };
}

function summarizeParsedForDebug(parsed = {}) {
  const summary = {};
  Object.keys(parsed || {})
    .slice(0, 40)
    .forEach((key) => {
      const value = parsed[key];
      if (Array.isArray(value)) {
        summary[key] = { type: "array", count: value.length, sample: value.slice(0, 3) };
      } else if (value && typeof value === "object") {
        summary[key] = { type: "object", keys: Object.keys(value).slice(0, 8) };
      } else {
        summary[key] = value;
      }
    });
  return summary;
}

function summarizeCalcForDebug(calc = {}) {
  return {
    ftProj: Number(calc?.ftProj),
    h1Proj: Number(calc?.h1Proj),

    projAFT: Number(calc?.projAFT),
    projBFT: Number(calc?.projBFT),
    ftEdge: Number(calc?.ftEdge),
    h1Edge: Number(calc?.h1Edge),
    aEdge: Number(calc?.aEdge),
    bEdge: Number(calc?.bEdge),
    ftSampleTier: String(calc?.ftSampleTier || ""),
    h1SampleTier: String(calc?.h1SampleTier || ""),
    ftProjectionOnly: !!calc?.ftProjectionOnly,
    h1ProjectionOnly: !!calc?.h1ProjectionOnly,
    ftHasH2H: !!calc?.ftHasH2H,
    h1HasH2H: !!calc?.h1HasH2H,
    pace: Number(calc?.pace),
    paceGapRisk: !!calc?.paceGapRisk,
    defensiveFloorFlag: !!calc?.defensiveFloorFlag,
    blowoutGap: Number(calc?.blowoutGap),
    volatilityBlock: !!calc?.volatilityBlock,
    aS: Number(calc?.aS),
    bS: Number(calc?.bS),
    aS1: Number(calc?.aS1),
    bS1: Number(calc?.bS1),
    aS2: Number(calc?.aS2),
    bS2: Number(calc?.bS2),
  };
}

function summarizePickDecisionForDebug(name, pick, line, edge, confidence, note, trap = false) {
  return {
    name,
    pick,
    line: Number(line),
    edge: Number(edge),
    confidence: String(confidence || "").replace(/^NaN$/i, "no-play"),
    note: note ? String(note) : "",
    trap: !!trap,
  };
}

function getEngineFetchLabel(url) {
  try {
    const u = new URL(String(url), window.location.href);
    const params = new URLSearchParams(u.search);
    if (params.has("event")) params.set("event", params.get("event") || "");
    if (params.has("dates")) params.set("dates", params.get("dates") || "");
    return `${u.pathname}${params.toString() ? "?" + params.toString() : ""}`;
  } catch (err) {
    return String(url || "").slice(0, 160);
  }
}

function getTrackerStateDebugScore(state) {
  return getTrackerStateLocalScore(state || {});
}

function updateTrackerInsightsButton() {
  const copyBtn = document.getElementById("trackerCopyDataBtn");
  const copyJsonBtn = document.getElementById("trackerCopyDataJsonBtn");
  const configBtn = document.getElementById("trackerConfigBtn");
  const militaryBtn = document.getElementById("trackerMilitaryRaidBtn");
  const healthBtn = document.getElementById("trackerHealthBtn");
  const titleEl = document.getElementById("trackerHeadTitle");

  if (titleEl) {
    if (isTrackerPicksView()) titleEl.textContent = "Tracked Picks";
    else if (isTrackerReportView()) titleEl.textContent = "Engine Report";
    else if (isTrackerConfigsView()) titleEl.textContent = "Verified Configs";
    else if (isTrackerHealthView()) titleEl.textContent = "Engine Health";
  }

  if (militaryBtn) {
    militaryBtn.style.display = isTrackerConfigsView() || isTrackerHealthView() ? "none" : "";
  }

  if (healthBtn) {
    healthBtn.style.display = isTrackerReportView() ? "" : "none";
  }

  if (isTrackerHealthView() && typeof updateEnginePerformanceScore === "function") {
    updateEnginePerformanceScore();
  }

  if (copyJsonBtn) {
    copyJsonBtn.style.display = "none";
  }

  if (copyBtn) {
    copyBtn.style.display = isTrackerReportView() || isTrackerConfigsView() ? "" : "none";
    copyBtn.textContent = "📋";
    copyBtn.title = isTrackerReportView() ? "Copy tracker report" : "Copy config data";
    copyBtn.onclick = () => {
      if (isTrackerReportView()) copyTrackerData();
      else if (isTrackerConfigsView()) copyConfigsData();
    };
  }

  if (configBtn) {
    configBtn.style.display = isTrackerReportView() || isTrackerConfigsView() ? "" : "none";
  }
}
