
function getConfidenceGrade(params) {
  const {
    pick,
    note,
    line,
    edge,
    sampleTier,
    hasH2H,
    volatility,
    volLimit,
    trap,
    // NEW/UNCALIBRATED wiring — see getConfidenceWinProbability for how these
    // are used. Previously computed and passed at every call site, never read.
    paceGapRisk,
    blowoutGap,
    lineupQuality,
    siblingEdge,
    q4Edge,
    q2Edge,
    defensiveFloorFlag,
    // Q-SPREAD: recent quarter-margin form vs the model's own quarter margin
    // projection, only ever populated for q1-q4 (see getQuarterFormAgreement).
    // Same "new/uncalibrated placeholder" treatment as the five signals
    // above — see getConfidenceWinProbability.
    quarterFormAgreement,
    league = "",
  } = params || {};

  if (
    !pick ||
    pick === "NO PLAY" ||
    note ||
    line === null ||
    !isFinite(line) ||
    line <= 0 ||
    !isFinite(edge)
  ) {
    return "NaN";
  }

  const edgePct = Math.abs(edge / line);
  const volRatio =
    isFinite(volatility) && isFinite(volLimit) && volLimit > 0 ? volatility / volLimit : 0.5;
  const _pickSide = typeof getPickSideFromText === "function" ? getPickSideFromText(pick) : "";
  let winProb = getConfidenceWinProbability(
    null,
    edgePct,
    volRatio,
    sampleTier,
    hasH2H,
    !!trap,
    league,
    {
      paceGapRisk,
      blowoutGap,
      lineupQuality,
      siblingEdge,
      q4Edge,
      q2Edge,
      defensiveFloorFlag,
      quarterFormAgreement,
      pickEdge: edge,
      pickSide: _pickSide,
    },
  );

  // A3: predictive Normal distribution is the primary probability when available.
  // Logistic model is retained as a calibrated fallback / blend anchor so fitted
  // coefficients are not discarded. When distribution SD is valid, blend 70/30
  // toward the CDF so grades reflect P(total beats line) rather than a pure
  // scalar edge mapping.
  try {
    const _volLimitPts = getMarketVolLimit(league, params?.marketKey || "ft") || 12;
    const _distProb = distributionWinProbability(edge, _volLimitPts, volRatio);
    if (Number.isFinite(_distProb)) {
      if (Number.isFinite(winProb)) {
        winProb = clampNumber(0.7 * _distProb + 0.3 * winProb, 0.02, 0.98);
      } else {
        winProb = _distProb;
      }
      engineDebug("Distribution-primary winProb", {
        league,
        marketKey: params?.marketKey,
        distributionWinProb: _distProb,
        blendedWinProb: winProb,
      });
    }
  } catch (_dpe) {
    engineDebug("distributionWinProbability comparison failed", {
      error: _dpe?.message || String(_dpe),
    });
  }

  if (!Number.isFinite(winProb)) {
    engineDebug("getConfidenceGrade: non-finite winProb, forcing NaN sentinel", {
      league,
      marketKey: params?.marketKey,
      edgePct,
      volRatio,
      sampleTier,
      hasH2H,
    });
    return "NaN";
  }

  return resolveConfidenceGradeFromWinProbability(winProb, league, params?.marketKey || "");
}

function getMarginConfidenceGrade(params) {
  const {
    pick,
    marginEdgePct,
    marginVolRatio,
    sampleTier,
    hasH2H,
    trap,
    league = "",
    // Point margin edge (projA - projB or vs handicap line) for distribution CDF — same role as total edge
    marginEdgePts = null,
    volLimitPts = null,
  } = params || {};

  if (!pick || pick === "NO PLAY" || !isFinite(marginEdgePct)) {
    return "NaN";
  }

  const volRatio = isFinite(marginVolRatio) ? marginVolRatio : 0.5;
  let winProb = getConfidenceWinProbability(
    null,
    marginEdgePct,
    volRatio,
    sampleTier,
    hasH2H,
    !!trap,
    league,
  );

  // Parity with getConfidenceGrade: when logistic is unfitted/null, still grade via Normal CDF on point margin.
  try {
    const edgePts = isFinite(marginEdgePts)
      ? marginEdgePts
      : isFinite(marginEdgePct)
        ? marginEdgePct
        : NaN;
    // Prefer explicit point edge; if only pct was passed historically, distribution still needs a scale — skip pct-only
    const _volLim =
      isFinite(volLimitPts) && volLimitPts > 0
        ? volLimitPts
        : typeof getMarketVolLimit === "function"
          ? getMarketVolLimit(league, params?.marketKey || "winner") ||
            getMarketVolLimit(league, "ft") ||
            12
          : 12;
    if (isFinite(marginEdgePts) && isFinite(_volLim)) {
      const _distProb = distributionWinProbability(marginEdgePts, _volLim, volRatio);
      if (Number.isFinite(_distProb)) {
        if (Number.isFinite(winProb)) {
          winProb = clampNumber(0.7 * _distProb + 0.3 * winProb, 0.02, 0.98);
        } else {
          winProb = _distProb;
        }
        engineDebug("Margin distribution-primary winProb", {
          league,
          marketKey: params?.marketKey,
          distributionWinProb: _distProb,
          blendedWinProb: winProb,
          marginEdgePts,
        });
      }
    }
  } catch (_dpe) {
    engineDebug("getMarginConfidenceGrade distribution fallback failed", {
      error: _dpe?.message || String(_dpe),
    });
  }

  // Number.isFinite so null (unfitted logistic) → NaN grade, not silent "D"
  if (!Number.isFinite(winProb)) {
    engineDebug("getMarginConfidenceGrade: non-finite winProb, forcing NaN sentinel", {
      league,
      marketKey: params?.marketKey,
      marginEdgePct,
      volRatio,
      sampleTier,
      hasH2H,
    });
    return "NaN";
  }

  return resolveConfidenceGradeFromWinProbability(winProb, league, params?.marketKey || "margin");
}

function anchorProjection(proj, sampleSize, leagueBase) {
  if (!isFinite(proj)) return proj;
  const n = Math.max(0, Number(sampleSize) || 0);
  const base = Number(leagueBase) || proj;
  if (n >= 10) return proj;
  const blendFactor = n / 10;
  return proj * blendFactor + base * (1 - blendFactor);
}

function readLooseSeries(id) {
  // Temporal: live DOM series are pre-game inputs; backtests should prefer
  // dated snapshots filtered via filterEventsAsOf / asOf / eventDate / predictionDate.
  // Temporal filter must be invoked with (events, asOf) — not merely referenced.
  // void-filterEventsAsOf removed (Issue 34: auditor must not treat a void ref as proof).
  const el = document.getElementById(id);
  const raw = el?.value?.trim() || "";
  if (!raw) return [];

  const parts = raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (!parts.length) return [];

  const out = [];
  for (const part of parts) {
    const value = Number(part);

    if (!isFinite(value) || value <= 0 || value > 300) {
      engineDebug(`readLooseSeries skipped invalid input in #${id}:`, part);
      continue;
    }

    out.push(value);

    if (out.length === 10) break;
  }

  return out;
}

function buildLooseParsedState() {
  // Temporal: loose parse is for live manual entry; historical replay must use
  // filterEventsAsOf / resolvePredictionAsOf / eventDate / predictionDate upstream.
  // Temporal filter must be invoked with (events, asOf) — not merely referenced.
  // void-filterEventsAsOf removed (Issue 34: auditor must not treat a void ref as proof).
  return {
    aFTScored: readLooseSeries("aFTScored"),
    bFTScored: readLooseSeries("bFTScored"),
    a1HScored: readLooseSeries("a1HScored"),
    b1HScored: readLooseSeries("b1HScored"),
    aFTH2H: readLooseSeries("aFTH2H"),
    bFTH2H: readLooseSeries("bFTH2H"),
    a1HH2H: readLooseSeries("a1HH2H"),
    b1HH2H: readLooseSeries("b1HH2H"),
    aQ1Scored: readLooseSeries("aQ1Scored"),
    bQ1Scored: readLooseSeries("bQ1Scored"),
    aQ2Scored: readLooseSeries("aQ2Scored"),
    bQ2Scored: readLooseSeries("bQ2Scored"),
    aQ3Scored: readLooseSeries("aQ3Scored"),
    bQ3Scored: readLooseSeries("bQ3Scored"),
    aQ4Scored: readLooseSeries("aQ4Scored"),
    bQ4Scored: readLooseSeries("bQ4Scored"),
    aQ1H2H: readLooseSeries("aQ1H2H"),
    bQ1H2H: readLooseSeries("bQ1H2H"),
    aQ2H2H: readLooseSeries("aQ2H2H"),
    bQ2H2H: readLooseSeries("bQ2H2H"),
    aQ3H2H: readLooseSeries("aQ3H2H"),
    bQ3H2H: readLooseSeries("bQ3H2H"),
    aQ4H2H: readLooseSeries("aQ4H2H"),
    bQ4H2H: readLooseSeries("bQ4H2H"),
  };
}

function buildTotalMarketIntelSignal(pack) {
  let signal = 0;
  if (!pack) return { signal: 0 };

  const _fatigueB2B = getParam("fatigueB2BPenalty") ?? -2.5;
  const restDaysA = pack.restDaysA ?? 99;
  const restDaysB = pack.restDaysB ?? 99;
  if (restDaysA < 1) signal += _fatigueB2B;
  if (restDaysB < 1) signal += _fatigueB2B;
  return { signal: clampNumber(signal, -3, 3) };
}

function buildTeamMarketIntelSignal(pack, teamSide) {
  let signal = 0;
  if (!pack) return { signal: 0 };
  const restDays = teamSide === "A" ? (pack.restDaysA ?? 99) : (pack.restDaysB ?? 99);

  const _fatigueB2B = getParam("fatigueB2BPenalty") ?? -2.5;

  if (restDays < 1) signal += _fatigueB2B;
  return { signal: clampNumber(signal, -3, 3) };
}

const TRAVEL_MILES_LEAGUES = new Set(["nba", "wnba", "wnba_pre", "ncaa", "ncaaw", "nba_gl"]);

const CITY_COORDS = {
  "atlanta,ga": [33.749, -84.388],
  "boston,ma": [42.361, -71.058],
  "brooklyn,ny": [40.678, -73.944],
  "charlotte,nc": [35.227, -80.843],
  "chicago,il": [41.878, -87.63],
  "cleveland,oh": [41.499, -81.694],
  "dallas,tx": [32.777, -96.797],
  "arlington,tx": [32.736, -97.108],
  "denver,co": [39.739, -104.99],
  "detroit,mi": [42.331, -83.046],
  "san francisco,ca": [37.775, -122.419],
  "houston,tx": [29.76, -95.37],
  "indianapolis,in": [39.768, -86.158],
  "los angeles,ca": [34.052, -118.244],
  "memphis,tn": [35.15, -90.049],
  "miami,fl": [25.762, -80.192],
  "milwaukee,wi": [43.039, -87.906],
  "minneapolis,mn": [44.978, -93.265],
  "new orleans,la": [29.951, -90.072],
  "new york,ny": [40.713, -74.006],
  "oklahoma city,ok": [35.468, -97.516],
  "orlando,fl": [28.538, -81.379],
  "philadelphia,pa": [39.953, -75.165],
  "phoenix,az": [33.448, -112.074],
  "portland,or": [45.512, -122.677],
  "sacramento,ca": [38.582, -121.494],
  "san antonio,tx": [29.424, -98.494],
  "toronto,on": [43.653, -79.383],
  "salt lake city,ut": [40.761, -111.891],
  "washington,dc": [38.907, -77.037],
  "paradise,nv": [36.115, -115.174],
  "las vegas,nv": [36.115, -115.174],
  "uncasville,ct": [41.462, -72.093],
  "college park,ga": [33.653, -84.449],
  "seattle,wa": [47.606, -122.332],
  "manchester,nh": [42.996, -71.455],
  "grand rapids,mi": [42.963, -85.668],
  "santa cruz,ca": [36.974, -122.03],
  "birmingham,al": [33.52, -86.802],
  "westchester,il": [41.85, -87.887],
  "iowa city,ia": [41.66, -91.535],
  "greensboro,nc": [36.073, -79.792],
  "erie,pa": [42.129, -80.085],
  "long island,ny": [40.789, -73.135],
  "raleigh,nc": [35.78, -78.639],
  "sioux falls,sd": [43.545, -96.731],
  "wisconsin,wi": [43.041, -87.907],
  "durham,nc": [35.994, -78.899],
  "chapel hill,nc": [35.913, -79.056],
  "lawrence,ks": [38.972, -95.235],
  "ann arbor,mi": [42.281, -83.743],
  "east lansing,mi": [42.737, -84.484],
  "columbus,oh": [39.983, -83.005],
  "bloomington,in": [39.165, -86.526],
  "champaign,il": [40.114, -88.207],
  "madison,wi": [43.073, -89.401],
  "college station,tx": [30.601, -96.315],
  "gainesville,fl": [29.652, -82.325],
  "knoxville,tn": [35.96, -83.921],
  "lexington,ky": [38.041, -84.501],
  "tuscaloosa,al": [33.209, -87.569],
  "athens,ga": [33.96, -83.379],
  "baton rouge,la": [30.451, -91.187],
  "fayetteville,ar": [36.062, -94.157],
  "columbia,mo": [38.951, -92.334],
  "starkville,ms": [33.451, -88.819],
  "oxford,ms": [34.366, -89.519],
  "auburn,al": [32.61, -85.48],
  "nashville,tn": [36.163, -86.781],
  "clemson,sc": [34.684, -82.837],
  "tallahassee,fl": [30.438, -84.281],
  "louisville,ky": [38.253, -85.759],
  "cincinnati,oh": [39.103, -84.512],
  "pittsburgh,pa": [40.441, -79.996],
  "syracuse,ny": [43.049, -76.148],
  "storrs,ct": [41.809, -72.253],
  "south bend,in": [41.676, -86.252],
  "west lafayette,in": [40.425, -86.909],
  "evanston,il": [42.045, -87.694],
  "lincoln,ne": [40.815, -96.702],
  "ames,ia": [41.999, -93.607],
  "manhattan,ks": [39.184, -96.572],
  "stillwater,ok": [36.115, -97.058],
  "norman,ok": [35.222, -97.443],
  "fort worth,tx": [32.755, -97.331],
  "waco,tx": [31.549, -97.147],
  "lubbock,tx": [33.578, -101.855],
  "tucson,az": [32.222, -110.926],
  "boulder,co": [40.015, -105.271],
  "eugene,or": [44.052, -123.086],
  "pullman,wa": [46.731, -117.18],
  "berkeley,ca": [37.871, -122.273],
  "palo alto,ca": [37.441, -122.145],
  "corvallis,or": [44.564, -123.279],
  "provo,ut": [40.233, -111.658],
  "san diego,ca": [32.716, -117.161],
  "spokane,wa": [47.658, -117.426],
  "morgantown,wv": [39.629, -79.955],
  "blacksburg,va": [37.229, -80.413],
  "charlottesville,va": [38.029, -78.477],
  "college park,md": [38.981, -76.937],
  "piscataway,nj": [40.5, -74.462],
  "new brunswick,nj": [40.499, -74.447],
  "villanova,pa": [40.037, -75.343],
  "omaha,ne": [41.257, -95.995],
  "wichita,ks": [37.687, -97.33],
  "dayton,oh": [39.759, -84.192],
  "richmond,va": [37.541, -77.436],
  "hamilton,ny": [42.816, -75.539],
  "worcester,ma": [42.263, -71.802],
  "providence,ri": [41.824, -71.413],
  "flagstaff,az": [35.198, -111.651],
  "moscow,id": [46.732, -117.0],
  "reno,nv": [39.529, -119.813],
};

function haversineMiles(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(isFinite)) return null;
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function lookupCityCoords(city, state) {
  if (!city) return null;
  const key = (String(city).trim() + "," + String(state || "").trim()).toLowerCase();
  return CITY_COORDS[key] || null;
}

function computeTravelMilesForCurrentFixture(league) {
  if (!TRAVEL_MILES_LEAGUES.has(String(league || "").toLowerCase())) return null;
  const selectedFixture = getSelectedFixtureOption();
  if (!selectedFixture) return null;

  const destCity = selectedFixture.dataset.venueCity || "";
  const destState = selectedFixture.dataset.venueState || "";
  const destCoords = lookupCityCoords(destCity, destState);
  if (!destCoords) return null;

  const aIsAway = String(selectedFixture.dataset.awayId || "") === String(selectedTeamIds.A || "");
  const bIsAway = String(selectedFixture.dataset.awayId || "") === String(selectedTeamIds.B || "");
  const ctxA = g_massacreFetchContext?.A || {};
  const ctxB = g_massacreFetchContext?.B || {};

  const travelers = [];
  if (aIsAway) travelers.push(ctxA);
  if (bIsAway) travelers.push(ctxB);
  if (!travelers.length) return 0;

  const distances = travelers
    .map((ctx) => {
      const origin = lookupCityCoords(ctx.lastGameCity, ctx.lastGameState);
      if (!origin) return null;
      return haversineMiles(origin[0], origin[1], destCoords[0], destCoords[1]);
    })
    .filter((v) => v !== null && Number.isFinite(v));

  return distances.length ? Math.max(...distances) : null;
}

function computeIntelligencePack(league, lines = {}, parsedInput = null) {
  const ctxA = g_massacreFetchContext?.A || {};
  const ctxB = g_massacreFetchContext?.B || {};
  const restDaysA =
    ctxA.restDays != null && isFinite(Number(ctxA.restDays)) ? Number(ctxA.restDays) : 99;
  const restDaysB =
    ctxB.restDays != null && isFinite(Number(ctxB.restDays)) ? Number(ctxB.restDays) : 99;
  const backToBack = restDaysA < 1 || restDaysB < 1;
  const travelMilesResult = computeTravelMilesForCurrentFixture(league);
  return {
    restDaysA,
    restDaysB,
    travelMiles: Number.isFinite(travelMilesResult) ? travelMilesResult : 0,
    travelMilesKnown: Number.isFinite(travelMilesResult),
    backToBack,
    hasAnyData: ctxA.restDays != null || ctxB.restDays != null,
  };
}

function updateIntelligencePack(leagueOverride = "", linesOverride = null, parsedOverride = null) {
  const league = leagueOverride || document.getElementById("leagueSelect")?.value || "";
  const pack = computeIntelligencePack(league, linesOverride || {}, parsedOverride || null);
  window.g_lastIntelligencePack = pack;
  return pack;
}

function getCrossSignalAgreement(side, marketKey, parsed) {
  const signals = [];

  const fullSeries =
    marketKey === "ft" ? getOverallSeries(side, 10) : getManualSeries(side, marketKey, parsed);
  if (Array.isArray(fullSeries) && fullSeries.length >= 5) {
    const recentAvg = avgOrNaN(fullSeries.slice(0, 3));
    const seasonAvg = avgOrNaN(fullSeries);
    if (isFinite(recentAvg) && isFinite(seasonAvg) && seasonAvg > 0) {
      const diff = recentAvg - seasonAvg;
      if (Math.abs(diff / seasonAvg) > 0.02) {
        signals.push({ source: "recency", direction: diff > 0 ? "over" : "under" });
      }
    }
  }

  const matchup = getMatchupDeltaSignal(side, marketKey, parsed);
  if (matchup && Math.abs(matchup.deltaPct) > 2) {
    signals.push({ source: "h2h", direction: matchup.delta > 0 ? "over" : "under" });
  }

  if (!signals.length) {
    return { signalCount: 0, agreeCount: 0, conflictDetected: false, signals: [] };
  }

  const overCount = signals.filter((s) => s.direction === "over").length;
  const underCount = signals.filter((s) => s.direction === "under").length;
  const agreeCount = Math.max(overCount, underCount);

  return {
    signalCount: signals.length,
    agreeCount,
    conflictDetected: overCount > 0 && underCount > 0,
    dominantDirection:
      overCount === underCount ? "split" : overCount > underCount ? "over" : "under",
    signals,
  };
}

function applyIntelligenceLayerToPicks(picks, intelligencePack, league) {
  if (!Array.isArray(picks) || !picks.length || !intelligencePack) return;
  const QUARTER_KEYS = new Set(["q1", "q2", "q3", "q4"]);
  picks.forEach((p) => {
    if (!p || p.pick === "NO PLAY") return;
    let confAdj = 0;
    const restA = Number(intelligencePack.restDaysA ?? 99);
    const restB = Number(intelligencePack.restDaysB ?? 99);

    if (restA < 1 || restB < 1) {
      confAdj -= 2;
    }
    if (Number(intelligencePack.travelMiles || 0) > 1000) {
      confAdj -= 1;
    }

    if (
      QUARTER_KEYS.has(p.marketKey) &&
      (restA < 1 || restB < 1 || Number(intelligencePack.travelMiles || 0) > 1000)
    ) {
      const qVolRatio =
        isFinite(p.volatility) && isFinite(p.volLimit) && p.volLimit > 0
          ? p.volatility / p.volLimit
          : 0.5;
      confAdj -= (qVolRatio * 2) / 8;
    }

    if (confAdj !== 0) {
      p.intelligenceAdjusted = true;
      p.intelligenceNote =
        restA < 1 || restB < 1
          ? "Rest-days flag: one team on a back-to-back"
          : "Travel flag: notable distance since last game";
      // FIX Issue 24: actually apply confAdj to confidence when helper exists.
      if (typeof applyGuardedConfidenceShift === "function") {
        try {
          applyGuardedConfidenceShift(p, confAdj, "intelligence");
        } catch (_eAdj) {}
      } else if (isFinite(p.edge) && confAdj < 0) {
        // Soft fallback: shrink edge slightly for B2B/travel (does not invent grades).
        p.edge = p.edge * Math.max(0.85, 1 + confAdj * 0.03);
        p.intelligenceEdgeAdjusted = true;
      }
    }
  });
}

const FIELD_GROUPS = {
  markets: [
    "ftMarket",
    "h1Market",
    "teamAMarket",
    "teamBMarket",
    "q1Market",
    "q2Market",
    "q3Market",
    "q4Market",
  ],

  teamAOverall: ["aFTScored", "a1HScored"],

  teamBOverall: ["bFTScored", "b1HScored"],

  h2h: [
    "aFTH2H",
    "bFTH2H",
    "a1HH2H",
    "b1HH2H",
    "aQ1H2H",
    "bQ1H2H",
    "aQ2H2H",
    "bQ2H2H",
    "aQ3H2H",
    "bQ3H2H",
    "aQ4H2H",
    "bQ4H2H",
  ],

  autoTags: ["aAutoTag", "bAutoTag", "h2hAutoTag"],

  periodInputs: [
    "a1HScored",
    "a1HAllowed",
    "b1HScored",
    "b1HAllowed",
    "a1HH2H",
    "b1HH2H",
    "h1Market",
    "aQ1Scored",
    "aQ1Allowed",
    "bQ1Scored",
    "bQ1Allowed",
    "aQ1H2H",
    "bQ1H2H",
    "q1Market",
    "aQ2Scored",
    "aQ2Allowed",
    "bQ2Scored",
    "bQ2Allowed",
    "aQ2H2H",
    "bQ2H2H",
    "q2Market",
    "aQ3Scored",
    "aQ3Allowed",
    "bQ3Scored",
    "bQ3Allowed",
    "aQ3H2H",
    "bQ3H2H",
    "q3Market",
    "aQ4Scored",
    "aQ4Allowed",
    "bQ4Scored",
    "bQ4Allowed",
    "aQ4H2H",
    "bQ4H2H",
    "q4Market",
  ],
};

function setFieldValues(ids, value = "") {
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  });
}

function setDisplayValues(ids, displayValue) {
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = displayValue;
  });
}

function hideInjuryBox(side) {
  const box = document.getElementById(side === "A" ? "injuryBoxA" : "injuryBoxB");
  const content = document.getElementById(side === "A" ? "injuryContentA" : "injuryContentB");
  if (content) content.innerHTML = "";
  if (box) box.style.display = "none";
}

function clearSideFields(side) {
  const ids =
    side === "A"
      ? [
          "aFTScored",
          "aFTAllowed",
          "a1HScored",
          "a1HAllowed",
          "aQ1Scored",
          "aQ2Scored",
          "aQ3Scored",
          "aQ4Scored",
          "aQ1Allowed",
          "aQ2Allowed",
          "aQ3Allowed",
          "aQ4Allowed",
          "aFTScoredHome",
          "aFTAllowedHome",
          "aFTScoredAway",
          "aFTAllowedAway",
        ]
      : [
          "bFTScored",
          "bFTAllowed",
          "b1HScored",
          "b1HAllowed",
          "bQ1Scored",
          "bQ2Scored",
          "bQ3Scored",
          "bQ4Scored",
          "bQ1Allowed",
          "bQ2Allowed",
          "bQ3Allowed",
          "bQ4Allowed",
          "bFTScoredHome",
          "bFTAllowedHome",
          "bFTScoredAway",
          "bFTAllowedAway",
        ];

  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.value = "";
      if (id.includes("Home") || id.includes("Away")) {
        if (el.parentElement) {
          if (side === "A") {
            el.parentElement.style.display = id.includes("Home") ? "block" : "none";
          } else {
            el.parentElement.style.display = id.includes("Away") ? "block" : "none";
          }
        }
      }
    }
  });

  const venueSection = document.getElementById(
    side === "A" ? "aVenueSplitSection" : "bVenueSplitSection",
  );
  if (venueSection) venueSection.style.display = "none";

  const tagIds = side === "A" ? ["aAutoTag"] : ["bAutoTag"];

  tagIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });

  if (side === "A") AppState.injuries.A = defaultInjuryMeta();
  if (side === "B") AppState.injuries.B = defaultInjuryMeta();

  hideInjuryBox(side);
}

function clearH2HFields() {
  [
    "aFTH2H",
    "bFTH2H",
    "a1HH2H",
    "b1HH2H",
    "aQ1H2H",
    "bQ1H2H",
    "aQ2H2H",
    "bQ2H2H",
    "aQ3H2H",
    "bQ3H2H",
    "aQ4H2H",
    "bQ4H2H",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  g_h2hManualPreference.ft = null;
  g_h2hManualPreference.h1 = null;

  ["useFTH2H", "use1HH2H"].forEach((id) => {
    const cb = document.getElementById(id);
    if (cb) cb.checked = false;
  });

  syncAllH2HCheckboxes(true);
  const h2hTag = document.getElementById("h2hAutoTag");
  if (h2hTag) h2hTag.style.display = "none";
}

function clearAutoFill(changedSide = null) {
  unlockFetchBtn();
  setStatusText("", "");
  setFetchAuditIssues([]);
  resetResultsTable();

  if (changedSide === "A" || changedSide === "B") {
    AppState.context.data = defaultMassacreFetchContext();
    selectedTeamIds[changedSide] = null;
    g_lastFetchedTeams[changedSide] = "";
    setManualSource(changedSide);
    if (changedSide === "A") {
      g_injA = defaultInjuryMeta();
      hideInjuryBox("A");
    }
    if (changedSide === "B") {
      g_injB = defaultInjuryMeta();
      hideInjuryBox("B");
    }
    clearSideFields(changedSide);
    clearH2HFields();
  } else {
    selectedTeamIds = { A: null, B: null };
    g_lastFetchedTeams = { A: "", B: "" };
    g_fetchMeta = defaultFetchMeta();
    clearSideFields("A");
    clearSideFields("B");
    clearH2HFields();
  }

  validateFetchSection();
  updateIntelligencePack();
}

function updateSectionLocks() {
  const league = document.getElementById("leagueSelect")?.value || "";

  if (!league) {
    [
      "espnSection",
      "sofascoreManualSection",
      "marketSection",
      "teamASection",
      "teamBSection",
      "h2hSection",
    ].forEach(lockSection);
    return;
  }

  unlockSection("marketSection");
  unlockSection("teamASection");
  unlockSection("teamBSection");
  unlockSection("h2hSection");
  unlockSection("espnSection");
  unlockSection("sofascoreManualSection");
}

function getDateKeyLocal(dateObj) {
  const d = new Date(dateObj);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return "" + y + m + day;
}

function getLocalDateKey(daysAhead = 0) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + daysAhead);
  return getDateKeyLocal(d);
}

function getLocalDateKeyFromISO(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  d.setHours(12, 0, 0, 0);
  return getDateKeyLocal(d);
}

function setFixtureDay(offset) {
  const todayBtn = document.getElementById("fixturesTodayBtn");
  const tomorrowBtn = document.getElementById("fixturesTomorrowBtn");
  if (!todayBtn || !tomorrowBtn) return;
  todayBtn.classList.toggle("active", offset === 0);
  tomorrowBtn.classList.toggle("active", offset === 1);
}

function formatFixtureTime(dateStr) {
  if (!dateStr) return "--:--";
  try {
    return new Date(dateStr).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch (e) {
    return "--:--";
  }
}

function getLeagueBase(league) {
  const l = String(league || "").toLowerCase();
  const _BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/";
  const _SLUG_MAP = {
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
  return _SLUG_MAP[l] ? _BASE + _SLUG_MAP[l] : "";
}

function getCurrentSeasonYear(league) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  const l = String(league || "").toLowerCase();

  const LEAGUE_SEASON_START_MONTH = {
    nba: 9,
    ncaa: 10,
    ncaaw: 10,
    nba_gl: 10,
    euroleague: 8,
    eurocup: 8,
    champions_league: 8,
    acb: 8,
    lba: 8,
    bbl: 8,
    turkey_bsl: 8,
    ausnbl: 9,
    bleague: 8,
    united_league: 9,
    proa: 8,
    korea_kbl: 9,
    cba: 10,
    bal: 2,
    aba: 8,
    aba_pre: 8,
  };
  if (Object.prototype.hasOwnProperty.call(LEAGUE_SEASON_START_MONTH, l)) {
    const startMonth = LEAGUE_SEASON_START_MONTH[l];
    return month >= startMonth ? year + 1 : year;
  }

  if (["nba", "ncaa", "ncaaw", "nba_gl"].includes(l) && month >= 9) {
    return year + 1;
  }

  if (["wnba", "wnba_pre"].includes(l) && month < 4) {
    return year - 1;
  }

  if (["wnba", "wnba_pre"].includes(l)) {
    return year;
  }

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

async function fetchLeagueTeamCatalog(league) {
  const base = getLeagueBase(league);
  if (!base) return [];
  if (_teamCatalogCache.has(league)) return _teamCatalogCache.get(league);

  const promise = (async () => {
    const data = await proxyFetch(base + "/teams?limit=500");
    const leagues = data?.sports?.[0]?.leagues || [];
    let teams = [];
    for (const lg of leagues) teams = teams.concat(lg?.teams || []);
    if (!teams.length) teams = data?.teams || [];

    const seen = new Set();
    const out = [];
    for (const item of teams) {
      const t = item.team || item;
      const id = String(t?.id || "");
      const name = t?.displayName || t?.shortDisplayName || t?.name || "";
      if (!id || !name) continue;
      const key = id + "::" + normalizeTeamName(name);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id, name });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  })().catch((err) => {
    _teamCatalogCache.delete(league);
    logDebug("fetchLeagueTeamCatalog failed", err);
    return [];
  });

  cacheSet(_teamCatalogCache, league, promise);
  return promise;
}

function highlight(name, query) {
  const rawQ = String(query || "").trim();
  if (!rawQ) return safeText(name);
  const originalLower = String(name || "").toLowerCase();
  const queryLower = rawQ.toLowerCase();
  const rawIndex = originalLower.indexOf(queryLower);
  if (rawIndex === -1) return safeText(name);
  return (
    safeText(name.slice(0, rawIndex)) +
    "<strong>" +
    safeText(name.slice(rawIndex, rawIndex + rawQ.length)) +
    "</strong>" +
    safeText(name.slice(rawIndex + rawQ.length))
  );
}

function closeDrop(dropId) {
  const drop = document.getElementById(dropId);
  if (drop) {
    drop.style.display = "none";
    drop.innerHTML = "";
  }
  if (activeDropTeam === (dropId === "dropA" ? "A" : "B")) activeDropTeam = null;
}
const _dropCloseTimers = { dropA: null, dropB: null };

function cancelDropClose(dropId = null) {
  if (dropId) {
    if (_dropCloseTimers.hasOwnProperty(dropId)) {
      clearTimeout(_dropCloseTimers[dropId]);
      _dropCloseTimers[dropId] = null;
    }
    return;
  }

  Object.keys(_dropCloseTimers).forEach((key) => {
    clearTimeout(_dropCloseTimers[key]);
    _dropCloseTimers[key] = null;
  });
}
function selectTeam(side, name, id) {
  const inputId = side === "A" ? "teamAName" : "teamBName";
  const dropId = side === "A" ? "dropA" : "dropB";
  document.getElementById(inputId).value = name;
  selectedTeamIds[side] = id || null;
  closeDrop(dropId);
  activeDropTeam = null;
  validateFetchSection();
  updateIntelligencePack();
}

function lookupTeamId(name, leagueHint) {
  const n = normalizeTeamName(name);
  if (leagueHint === "nba") {
    if (NBA_TEAM_MAP[n] !== undefined) return NBA_TEAM_MAP[n];
    let bestKey = null,
      bestLen = 0;
    for (const key of Object.keys(NBA_TEAM_MAP)) {
      if (n.includes(key) && key.length > bestLen) {
        bestKey = key;
        bestLen = key.length;
      }
    }
    if (bestKey) return NBA_TEAM_MAP[bestKey];
    if (n.length >= 3) {
      bestKey = null;
      bestLen = 0;
      for (const key of Object.keys(NBA_TEAM_MAP)) {
        if (key.includes(n) && key.length > bestLen) {
          bestKey = key;
          bestLen = key.length;
        }
      }
      if (bestKey) return NBA_TEAM_MAP[bestKey];
    }
  }
  if (leagueHint === "wnba" || leagueHint === "wnba_pre") {
    if (WNBA_TEAM_MAP[n] !== undefined) return WNBA_TEAM_MAP[n];
    let bestKey = null,
      bestLen = 0;
    for (const key of Object.keys(WNBA_TEAM_MAP)) {
      if (n.includes(key) && key.length > bestLen) {
        bestKey = key;
        bestLen = key.length;
      }
    }
    if (bestKey) return WNBA_TEAM_MAP[bestKey];
  }
  if (leagueHint === "ncaa") {
    if (NCAA_TEAM_MAP[n] !== undefined) return NCAA_TEAM_MAP[n];
    let bestKey = null,
      bestLen = 0;
    for (const key of Object.keys(NCAA_TEAM_MAP)) {
      if (n.includes(key) && key.length > bestLen) {
        bestKey = key;
        bestLen = key.length;
      }
    }
    if (bestKey) return NCAA_TEAM_MAP[bestKey];
  }
  return null;
}

async function onTeamInput(side) {
  const inputId = side === "A" ? "teamAName" : "teamBName";
  const dropId = side === "A" ? "dropA" : "dropB";
  const input = document.getElementById(inputId);
  const drop = document.getElementById(dropId);
  const val = input.value.trim();
  const league = document.getElementById("leagueSelect").value;
  const normVal = normalizeTeamName(val);

  if (normVal !== g_lastFetchedTeams[side]) {
    if (g_lastFetchedTeams[side]) {
      clearAutoFill(side);
    } else {
      setStatusText("", "");
      setFetchAuditIssues([]);
      resetResultsTable();
    }
  }
  selectedTeamIds[side] = null;
  validateFetchSection();

  if (!val) {
    closeDrop(dropId);
    return;
  }
  const espnLeagues = ["nba", "wnba", "wnba_pre", "ncaa", "ncaaw", "nba_gl", "nba_summer"];
  if (!espnLeagues.includes(league)) {
    closeDrop(dropId);
    return;
  }

  if (g_teamSearchControllers[side]) {
    g_teamSearchControllers[side].abort();
  }
  g_teamSearchControllers[side] = new AbortController();
  const currentSignal = g_teamSearchControllers[side].signal;

  try {
    const teams = await fetchLeagueTeamCatalog(league);

    if (currentSignal.aborted) return;

    const matches = teams.filter((t) => normalizeTeamName(t.name).includes(normVal)).slice(0, 20);
    if (!matches.length) {
      closeDrop(dropId);
      return;
    }

    drop.innerHTML = "";
    const group = document.createElement("div");
    group.className = "group-label";
    group.textContent = league.toUpperCase();
    drop.appendChild(group);

    matches.forEach((team) => {
      const div = document.createElement("div");
      div.dataset.id = team.id;
      div.dataset.name = team.name;
      div.innerHTML = highlight(team.name, val);
      div.addEventListener("mousedown", () => selectTeam(side, team.name, team.id));
      drop.appendChild(div);
    });

    drop.style.display = "block";
    activeDropTeam = side;
    validateFetchSection();
  } catch (err) {
    if (!currentSignal.aborted) {
      console.error("[BB Engine] Autocomplete fetch failed", err);
    }
  }
}

document.addEventListener("click", (e) => {
  if (!e.target.closest(".autocomplete-wrap")) {
    closeDrop("dropA");
    closeDrop("dropB");
  }
});

document.addEventListener("keydown", (e) => {
  if (!activeDropTeam) return;
  const dropId = activeDropTeam === "A" ? "dropA" : "dropB";
  const drop = document.getElementById(dropId);
  const items = [...drop.querySelectorAll("div:not(.group-label)")];
  if (!items.length) return;
  const current = drop.querySelector(".active");
  const idx = items.indexOf(current);

  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (current) current.classList.remove("active");
    items[Math.min(idx + 1, items.length - 1)].classList.add("active");
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (current) current.classList.remove("active");
    items[Math.max(idx - 1, 0)].classList.add("active");
  } else if (e.key === "Enter") {
    if (current) {
      e.preventDefault();
      current.dispatchEvent(new MouseEvent("mousedown"));
    }
  } else if (e.key === "Escape") {
    closeDrop(dropId);
    activeDropTeam = null;
  }
});

function makeSectionsCollapsible() {
  document.querySelectorAll(".section").forEach((section) => {
    if (section.dataset.collapsibleReady === "1") return;
    const heading = section.querySelector("h3");
    if (!heading) return;
    section.dataset.collapsibleReady = "1";
    const titleHTML = heading.innerHTML;
    const body = document.createElement("div");
    body.className = "section-body";
    const children = [...section.childNodes];
    children.forEach((node) => {
      if (node !== heading) body.appendChild(node);
    });

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "section-toggle";
    const titleSpan = document.createElement("span");
    titleSpan.className = "toggle-title";
    titleSpan.innerHTML = titleHTML;
    const iconSpan = document.createElement("span");
    iconSpan.className = "toggle-icon";
    iconSpan.innerHTML = "&#9662;";
    btn.appendChild(titleSpan);
    btn.appendChild(iconSpan);
    btn.addEventListener("click", () => {
      section.classList.toggle("collapsed");
    });

    section.innerHTML = "";
    section.appendChild(btn);
    section.appendChild(body);
    section.classList.add("collapsed");
  });
}

function validateTeamId(id, league) {
  if (!id) return false;
  const n = parseInt(id, 10);
  if (isNaN(n)) return false;
  if (league === "nba") return n >= 1 && n <= 30;
  if (league === "ncaa") return n >= 2;
  return n > 0;
}

async function searchTeamFromAPI(base, name, league) {
  const n = normalizeTeamName(name);
  if (!n || n === "undefined" || n === "null") {
    engineDebug("searchTeamFromAPI skipped — empty team name", { name, league });
    return null;
  }
  if (!base || String(base).includes("/undefined")) {
    engineDebug("searchTeamFromAPI skipped — invalid base", { base, name, league });
    return null;
  }
  try {
    const data = await proxyFetch(base + "/teams?limit=500");
    const leagues = data?.sports?.[0]?.leagues || [];
    let teams = [];
    for (const l of leagues) teams = teams.concat(l?.teams || []);
    if (!teams.length) teams = data?.teams || [];

    const words = n.split(/\s+/).filter((w) => w.length >= 3);
    let best = null,
      bestScore = 0;

    for (const t of teams) {
      const team = t.team || t;
      const displayName = normalizeTeamName(team.displayName || "");
      const shortName = normalizeTeamName(team.shortDisplayName || "");
      const nickname = normalizeTeamName(team.nickname || "");
      const location = normalizeTeamName(team.location || "");
      const abbrev = normalizeTeamName(team.abbreviation || "");

      if (displayName === n || shortName === n) return String(team.id);

      let score = 0;
      if (displayName.includes(n) || n.includes(displayName)) score += 4;
      if (shortName.includes(n) || n.includes(shortName)) score += 4;
      if (nickname && (nickname === n || n.includes(nickname))) score += 2;
      if (location && n.includes(location)) score += 2;
      if (abbrev && abbrev === n) score += 2;
      score += words.filter((w) => displayName.includes(w) || shortName.includes(w)).length;
      if (score > bestScore) {
        bestScore = score;
        best = String(team.id);
      }
    }
    if (best && bestScore >= 3 && validateTeamId(best, league)) return best;
  } catch (e) {
    logDebug("searchTeamFromAPI teams failed", e);
  }

  try {
    const catalog = await fetchLeagueTeamCatalog(league);
    const catalogMap = new Map(catalog.map((t) => [String(t.id), normalizeTeamName(t.name)]));
    const data = await proxyFetch(
      "https://site.api.espn.com/apis/common/v3/search?query=" +
        encodeURIComponent(name) +
        "&limit=10&type=team&sport=basketball",
    );

    let bestId = null,
      bestScore = 0;
    for (const r of data?.items || data?.results || []) {
      const uid = r?.uid || r?.team?.uid || "";
      const mUid = uid.match(/t:(\d+)/);
      const id = mUid ? mUid[1] : r?.id || r?.team?.id ? String(r?.id || r?.team?.id) : null;

      if (!id || (catalogMap.size > 0 && !catalogMap.has(String(id)))) continue;

      const resultName = normalizeTeamName(r?.displayName || r?.team?.displayName || r?.name || "");
      const catalogName = catalogMap.get(String(id)) || "";
      let score = 0;
      if (resultName === n || catalogName === n) score += 6;
      else {
        if (resultName && (resultName.includes(n) || n.includes(resultName))) score += 2;
        if (catalogName && (catalogName.includes(n) || n.includes(catalogName))) score += 4;
      }
      if (score > bestScore) {
        bestScore = score;
        bestId = id;
      }
    }
    return bestId && bestScore >= 2 && validateTeamId(bestId, league) ? bestId : null;
  } catch (e) {
    logDebug("searchTeamFromAPI common failed", e);
    return null;
  }
}

async function fetchInjuryMeta(base, teamId, teamAvgScored, league) {
  const result = {
    scoringMult: 1,
    notes: [],
    outCount: 0,
    dtdCount: 0,
    unknownImpactCount: 0,
    hasUnknownImpact: false,
    highUncertainty: false,
  };

  try {
    const data = await proxyFetch(`${base}/teams/${teamId}/injuries`).catch(() => null);
    if (data == null) {
      // FIX Issue 12: fetch failed — not the same as confirmed healthy roster.
      result.scoringMult = 1;
      result.fetchFailed = true;
      result.highUncertainty = true;
      result.notes.push({ type: "meta", text: "Injury fetch failed — treating impact as unknown" });
      return result;
    }
    const items = data?.injuries || data?.items || [];
    if (!items.length) {
      // Confirmed empty injury list from API
      result.confirmedNone = true;
      return result;
    }

    const avgPPG = isFinite(teamAvgScored) && teamAvgScored > 0 ? teamAvgScored : 80;
    let totalReduction = 0;

    for (const inj of items) {
      const status = (inj?.status || inj?.type?.description || "").toLowerCase();
      const isOut =
        status.includes("out") ||
        status.includes("injured reserve") ||
        status.includes("suspended");
      const isDTD =
        status.includes("questionable") ||
        status.includes("doubtful") ||
        status.includes("day-to-day");
      if (!isOut && !isDTD) continue;

      const athlete = inj?.athlete || inj?.person || {};
      const playerName = athlete?.displayName || athlete?.fullName || "Unknown";
      const tag = isOut ? "OUT" : "DTD";

      if (isOut) result.outCount++;
      if (isDTD) result.dtdCount++;

      let ppg = 0;

      for (const cat of athlete?.statistics?.splits?.categories || []) {
        for (const stat of cat.stats || []) {
          if (stat.name === "avgPoints" || stat.abbreviation === "PPG") {
            ppg = parseFloat(stat.value) || 0;
          }
        }
      }

      if (ppg <= 0) {
        result.unknownImpactCount++;

        const _posAbbr = String(athlete?.position?.abbreviation || "").toUpperCase();
        const _posImpactMult =
          // Heuristic position priors (not league-sourced table). Centers and
          // primary bigs are harder to replace on offense; primary ball-handlers
          // lose less pure PPG share when out because creation redistributes.
          _posAbbr === "C"
            ? 1.3
            : _posAbbr === "PF" || _posAbbr === "F"
              ? 1.15
              : _posAbbr === "SF"
                ? 1.05
                : _posAbbr === "SG" || _posAbbr === "G"
                  ? 0.95
                  : _posAbbr === "PG"
                    ? 0.9
                    : 1.0;
        const unknownPenalty = (isOut ? 0.02 : 0.01) * _posImpactMult;
        totalReduction += unknownPenalty;
        result.notes.push({
          type: isOut ? "out" : "dtd",
          text: `${playerName} — ${tag} (impact unknown, ${_posAbbr || "pos?"}) → -${(unknownPenalty * 100).toFixed(1)}%`,
        });
        continue;
      }

      const share = ppg / avgPPG;
      let avgMinutes = 0;
      for (const cat of athlete?.statistics?.splits?.categories || []) {
        for (const stat of cat.stats || []) {
          if (
            stat.name === "avgMinutes" ||
            stat.name === "minutesPerGame" ||
            stat.abbreviation === "MPG"
          ) {
            avgMinutes = parseFloat(stat.value) || 0;
          }
        }
      }
      const minutesFactor = avgMinutes > 0 ? clampNumber(avgMinutes / 30, 0.5, 1.3) : 1.0;
      // Position-aware known-impact scale (same priors as unknown path).
      const _posAbbrKnown = String(athlete?.position?.abbreviation || "").toUpperCase();
      const _posKnownMult =
        _posAbbrKnown === "C"
          ? 1.2
          : _posAbbrKnown === "PF" || _posAbbrKnown === "F"
            ? 1.1
            : _posAbbrKnown === "SF"
              ? 1.05
              : _posAbbrKnown === "SG" || _posAbbrKnown === "G"
                ? 0.95
                : _posAbbrKnown === "PG"
                  ? 0.9
                  : 1.0;
      const impact = Math.min(
        (isOut ? share * 0.65 : share * 0.3) * minutesFactor * _posKnownMult,
        0.25,
      );
      totalReduction += impact;

      result.notes.push({
        type: isOut ? "out" : "dtd",
        text: `${playerName} (${ppg.toFixed(1)} ppg, ${avgMinutes > 0 ? avgMinutes.toFixed(1) + " mpg" : "minutes unknown"}) — ${tag} → -${(impact * 100).toFixed(1)}% offense`,
      });
    }

    // Real teams partially compensate for a missing scorer via usage
    // redistribution to remaining players. Recapture a fraction of the raw
    // reduction before applying the hard cap, instead of assuming zero
    // compensation happens until the cap kicks in.
    // C1: scale redistribution down when many outs (bench cannot fully absorb).
    const _usageRedistributionBase = getParam("injuryUsageRedistribution", league) ?? 0.3;
    const _outPenalty = Math.min(0.15, (result.outCount || 0) * 0.04);
    const _usageRedistribution = Math.max(0.05, _usageRedistributionBase - _outPenalty);
    const _netReduction = totalReduction * (1 - _usageRedistribution);
    const maxInjCap = league === "nba" ? 0.25 : 0.2;
    result.scoringMult = 1 - Math.min(_netReduction, maxInjCap);
    // Expose net reduction so opponent boost can share the same quantity
    // instead of a disconnected constant applied only to injMult.
    result.netReduction = Math.min(_netReduction, maxInjCap);
    result.hasUnknownImpact = result.unknownImpactCount > 0;

    result.highUncertainty =
      result.dtdCount >= 2 ||
      result.unknownImpactCount >= 2 ||
      (result.dtdCount >= 1 && result.hasUnknownImpact) ||
      result.outCount >= 3;

    if (result.hasUnknownImpact) {
      result.notes.push({
        type: "meta",
        text: "Injury caution: some player scoring data unavailable",
      });
    }

    if (result.highUncertainty) {
      result.notes.push({ type: "meta", text: "High injury uncertainty" });
    }
  } catch (e) {
    logDebug("fetchInjuryMeta failed", e);
    // FIX Issue 12: exception path also marks uncertainty (not silent full strength).
    result.fetchFailed = true;
    result.highUncertainty = true;
    result.notes.push({ type: "meta", text: "Injury fetch error — impact unknown" });
  }

  return result;
}

function stripOTFromScores(scoreA, scoreB, linesA, linesB, regulationPeriods) {
  // FIX Issue 27: strip when EITHER side has extra periods (not only both).
  let sA = scoreA,
    sB = scoreB;
  const la = Array.isArray(linesA) ? linesA : [];
  const lb = Array.isArray(linesB) ? linesB : [];
  const rp = Number(regulationPeriods) || 4;
  if (la.length > rp || lb.length > rp) {
    let regA = 0,
      regB = 0;
    let ok = true;
    for (let i = 0; i < rp; i++) {
      const va = i < la.length ? readVal(la[i]) : NaN;
      const vb = i < lb.length ? readVal(lb[i]) : NaN;
      if (!isFinite(va) || !isFinite(vb)) {
        ok = false;
        break;
      }
      regA += va;
      regB += vb;
    }
    if (ok && regA > 0 && regB > 0) {
      return [regA, regB];
    }
  }
  return [sA, sB];
}

async function fetchNbaSummerGameRefsViaScoreboard(base, teamId) {
  const tId = String(teamId);
  const year = new Date().getFullYear();
  const startDate = new Date(year, 6, 1);
  const endDate = new Date(year, 6, 31);
  const dateKeys = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    dateKeys.push(getDateKeyLocal(d));
  }

  const _summerBatchSize = 5;
  const payloads = [];
  for (let _sbi = 0; _sbi < dateKeys.length; _sbi += _summerBatchSize) {
    const _summerBatchKeys = dateKeys.slice(_sbi, _sbi + _summerBatchSize);
    const _summerBatchJobs = _summerBatchKeys.map((dateKey) => {
      const key = `${base}:sbscan:${dateKey}`;
      return _schedCache.has(key)
        ? _schedCache.get(key)
        : (() => {
            const p = proxyFetch(`${base}/scoreboard?dates=${dateKey}&limit=200`).catch((err) => {
              _schedCache.delete(key);
              return null;
            });
            cacheSet(_schedCache, key, p);
            return p;
          })();
    });
    const _summerBatchPayloads = await Promise.allSettled(_summerBatchJobs);
    payloads.push(..._summerBatchPayloads);
  }
  const refs = [];
  payloads.forEach((result) => {
    if (result.status !== "fulfilled" || !result.value) return;
    const events = result.value?.events || [];
    for (const ev of events) {
      if (!ev?.id) continue;
      const comp = ev?.competitions?.[0];
      if (!comp) continue;
      const done =
        comp?.status?.type?.completed ||
        comp?.status?.type?.name === "STATUS_FINAL" ||
        comp?.status?.type?.state === "post";
      if (!done || (comp?.competitors || []).length < 2) continue;
      const competitors = comp.competitors;
      const mine = competitors.find((x) => matchesTeam(x, tId));
      const opp = mine ? competitors.find((x) => x !== mine) : null;
      if (!mine || !opp) continue;
      const ps = (s) =>
        typeof s === "object" ? parseFloat(s.value ?? s.displayValue ?? 0) : parseFloat(s);
      refs.push({
        id: String(ev.id),
        date: ev.date || "",
        rawS: ps(mine?.score),
        rawA: ps(opp?.score),
        venue: mine?.homeAway || "",
        oppId: String(opp?.team?.id || ""),
      });
    }
  });
  return refs;
}

async function fetchScheduleCore(base, teamId, leagueKey, requiredVenue, allowFallback = true) {
  // Temporal: schedule history must be cut at prediction asOf/eventDate via
  // filterEventsAsOf / resolvePredictionAsOf when converting events to series.
  // Temporal filter must be invoked with (events, asOf) — not merely referenced.
  // void-filterEventsAsOf removed (Issue 34: auditor must not treat a void ref as proof).
  if (teamId == null || teamId === "" || String(teamId) === "undefined" || String(teamId) === "null") {
    engineDebug("fetchScheduleCore skipped — missing teamId", { teamId, leagueKey });
    return null;
  }
  if (!base || String(base).includes("/undefined")) {
    engineDebug("fetchScheduleCore skipped — invalid base URL", { base, teamId, leagueKey });
    return null;
  }
  const rules = LEAGUE_FETCH_RULES[leagueKey];
  if (!rules) return null;

  const tId = String(teamId);
  const gameRefs = [];
  const currentSeason = getCurrentSeasonYear(leagueKey);

  if (leagueKey === "nba_summer") {
    const summerRefs = await fetchNbaSummerGameRefsViaScoreboard(base, teamId);
    summerRefs.forEach((r) => gameRefs.push(r));
  } else {
    const _schedJobList = [];
    const _schedMeta = [];
    for (let i = 0; i < rules.recentSeasons; i++) {
      const season = String(currentSeason - i);
      for (const stype of rules.scheduleTypes) {
        const key = `${base}:sched:${teamId}:${season}:${stype}`;
        const req = _schedCache.has(key)
          ? _schedCache.get(key)
          : (() => {
              const p = proxyFetch(
                `${base}/teams/${teamId}/schedule?season=${season}&seasontype=${stype}`,
              ).catch((err) => {
                _schedCache.delete(key);
                throw err;
              });
              cacheSet(_schedCache, key, p);
              return p;
            })();
        _schedJobList.push(req);
        _schedMeta.push({ season, stype });
      }
    }
    const _schedPayloads = await Promise.allSettled(_schedJobList);
    _schedPayloads.forEach((result, _schedIdx) => {
      if (result.status !== "fulfilled") {
        const _schedFailMeta = _schedMeta[_schedIdx] || {};
        engineDebug("fetchScheduleCore schedule fetch failed for teamId=" + teamId, {
          season: _schedFailMeta.season,
          seasontype: _schedFailMeta.stype,
          reason: result.reason?.message || String(result.reason),
        });
        return;
      }
      const r = result.value;
      const events = r?.events || r?.team?.schedule?.events || [];
      for (const ev of events) {
        if (!ev?.id) continue;

        const comp = ev?.competitions?.[0];
        if (!comp) continue;

        const done =
          comp?.status?.type?.completed ||
          comp?.status?.type?.name === "STATUS_FINAL" ||
          comp?.status?.type?.state === "post";

        if (!done || (comp?.competitors || []).length < 2) continue;

        const competitors = comp.competitors;

        const mine = competitors.find((x) => matchesTeam(x, tId));

        const opp = mine ? competitors.find((x) => x !== mine) : null;
        if (!mine || !opp) continue;
        const ps = (s) =>
          typeof s === "object" ? parseFloat(s.value ?? s.displayValue ?? 0) : parseFloat(s);

        gameRefs.push({
          id: String(ev.id),
          date: ev.date || "",
          rawS: ps(mine?.score),
          rawA: ps(opp?.score),
          venue: mine?.homeAway || "",
          oppId: String(opp?.team?.id || ""),
        });
      }
    });
  }

  if (!gameRefs.length) return null;

  const seen = new Set();
  const unique = gameRefs
    .filter((g) => {
      if (seen.has(g.id)) return false;
      seen.add(g.id);
      return true;
    })
    .sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return db - da;
    });

  const strictFiltered = requiredVenue ? unique.filter((g) => g.venue === requiredVenue) : unique;
  const venueReliable = strictFiltered.length >= 2;
  const usedVenueFallback =
    !!requiredVenue && !venueReliable && unique.length >= 2 && allowFallback;
  const chosen = venueReliable ? strictFiltered : allowFallback ? unique : strictFiltered;

  if (chosen.length < 2) return null;

  const scored10 = [];
  const allowed10 = [];
  const h1Scored10 = [];
  const h1Allowed10 = [];

  const qS = { q1: [], q2: [], q3: [], q4: [] };
  const qA = { q1: [], q2: [], q3: [], q4: [] };

  const _chosenForSummary = chosen.slice(0, Math.min(chosen.length, 10));
  const summaries = await Promise.all(
    _chosenForSummary.map(async (ref) => {
      let ms = ref.rawS;
      let os = ref.rawA;
      let h1m = 0,
        h1o = 0;
      let gotLS = false;
      let advanced = null;

      try {
        const key = `${base}:sum:${ref.id}`;
        const data = await (_summaryCache.has(key)
          ? _summaryCache.get(key)
          : (() => {
              const p = proxyFetch(`${base}/summary?event=${ref.id}`).catch((err) => {
                _summaryCache.delete(key);
                throw err;
              });
              cacheSet(_summaryCache, key, p);
              return p;
            })());

        const hc = data?.header?.competitions?.[0];
        const boxscore = data?.boxscore;
        const venueAddr = hc?.venue?.address || data?.gameInfo?.venue?.address || null;
        ref.venueCity = venueAddr?.city || null;
        ref.venueState = venueAddr?.state || null;

        if (hc) {
          const competitors = hc?.competitors || [];
          const mine = competitors.find((c) => matchesTeam(c, tId));
          const opp = competitors.find((c) => !matchesTeam(c, tId));

          if (mine && opp) {
            gotLS = true;
            ms = parseFloat(mine.score) || ms;
            os = parseFloat(opp.score) || os;

            const lm = mine?.linescores || [];
            const lo = opp?.linescores || [];

            const _wentToOT =
              lm.length > rules.regulationPeriods && lo.length > rules.regulationPeriods;

            if (lm.length >= 1 && lo.length >= 1) {
              if (rules.regulationPeriods >= 4) {
                h1m = (readVal(lm[0]) || 0) + (readVal(lm[1]) || 0);
                h1o = (readVal(lo[0]) || 0) + (readVal(lo[1]) || 0);
                if (lm.length >= 4 && lo.length >= 4) {
                  const _qm = [readVal(lm[0]), readVal(lm[1]), readVal(lm[2]), readVal(lm[3])];
                  const _qo = [readVal(lo[0]), readVal(lo[1]), readVal(lo[2]), readVal(lo[3])];
                  if (_qm.every((v) => v > 0) && _qo.every((v) => v > 0)) {
                    ref.qs = { m: _qm, o: _qo };
                  }
                }
              } else {
                [h1m, h1o] = extractFirstHalf(lm, lo);
              }
              [ms, os] = stripOTFromScores(ms, os, lm, lo, rules.regulationPeriods);
            }

            if (boxscore && typeof boxscore === "object") {
              const safeTeams = Array.isArray(boxscore.teams) ? boxscore.teams : [];
              const myBox = safeTeams.find((t) => matchesTeam(t, tId));
              const oppBox = safeTeams.find((t) => !matchesTeam(t, tId));
              let sMapMine = _extractTeamBoxStatMap(myBox);
              let sMapOpp = _extractTeamBoxStatMap(oppBox);

              if (
                (!isFinite(_readBoxStat(sMapMine, ["fieldGoalsAttempted", "fieldGoals", "FGA"])) ||
                  !isFinite(_readBoxStat(sMapOpp, ["fieldGoalsAttempted", "fieldGoals", "FGA"]))) &&
                Array.isArray(boxscore.players)
              ) {
                const oppIdForBox = opp?.team?.id || opp?.id || null;
                sMapMine = _extractTeamBoxStatMapFromPlayers(boxscore.players, tId);
                if (oppIdForBox != null) {
                  sMapOpp = _extractTeamBoxStatMapFromPlayers(boxscore.players, oppIdForBox);
                }
              }

              const _regMins = getLeagueRegulationMinutes(leagueKey);
              advanced = calculateAdvancedMetrics(sMapMine, sMapOpp, ms, os, _regMins, leagueKey);
            }
          }
        }
      } catch (e) {
        logDebug("fetchScheduleCore summary failed", e);
      }

      if (isNaN(ms) || isNaN(os) || ms <= 0 || os <= 0) return null;

      // Period advanced: split full-game possessions by regulation time share + linescore points.
      let advancedH1 = null,
        advancedH2 = null;
      let advancedQ = { q1: null, q2: null, q3: null, q4: null };
      if (advanced && gotLS) {
        const _regP =
          typeof rules !== "undefined" && rules && rules.regulationPeriods
            ? Number(rules.regulationPeriods)
            : 4;
        if (gotLS && h1m > 0 && h1o > 0) {
          advancedH1 = derivePeriodAdvanced(advanced, h1m, h1o, 0.5, leagueKey);
          // FIX Issue 16: synthetic period advanced must not enter series at full weight.
          // Consumers check .synthetic and apply shrink; keep tag on object.
          if (advancedH1 && advancedH1.synthetic) {
            advancedH1.weightScale = 0.5;
          }
        }
        if (ref.qs && Array.isArray(ref.qs.m) && Array.isArray(ref.qs.o) && ref.qs.m.length >= 4) {
          const _qm = ref.qs.m.map(Number);
          const _qo = ref.qs.o.map(Number);
          for (let qi = 0; qi < 4; qi++) {
            if (isFinite(_qm[qi]) && _qm[qi] > 0 && isFinite(_qo[qi]) && _qo[qi] > 0) {
              advancedQ["q" + (qi + 1)] = derivePeriodAdvanced(
                advanced,
                _qm[qi],
                _qo[qi],
                0.25,
                leagueKey,
              );
            }
          }
          const h2m = (Number(_qm[2]) || 0) + (Number(_qm[3]) || 0);
          const h2o = (Number(_qo[2]) || 0) + (Number(_qo[3]) || 0);
          if (h2m > 0 && h2o > 0) {
            advancedH2 = derivePeriodAdvanced(advanced, h2m, h2o, 0.5, leagueKey);
          }
        } else if (_regP === 2 && isFinite(ms) && isFinite(os) && h1m > 0 && h1o > 0) {
          // Two-half leagues: H2 = full regulation minus H1 (OT already stripped from ms/os).
          const h2m = Math.max(0, Number(ms) - Number(h1m));
          const h2o = Math.max(0, Number(os) - Number(h1o));
          if (h2m > 0 && h2o > 0) {
            advancedH2 = derivePeriodAdvanced(advanced, h2m, h2o, 0.5, leagueKey);
          }
        }
      }

      return {
        ms: Math.round(ms),
        os: Math.round(os),
        gotLS: !!gotLS,
        h1m: gotLS && h1m > 0 ? Math.round(h1m) : null,
        h1o: gotLS && h1o > 0 ? Math.round(h1o) : null,
        qs: ref.qs,
        advanced: advanced,
        advancedH1: advancedH1,
        advancedH2: advancedH2,
        advancedQ: advancedQ,

        date: ref.date || null,
        venueCity: ref.venueCity || null,
        venueState: ref.venueState || null,
      };
    }),
  );

  const h1Scored10Dates = [];
  const qDates = { q1: [], q2: [], q3: [], q4: [] };

  summaries.filter(Boolean).forEach((game) => {
    // FIX Issue 33: if summary had no linescores, raw finals may include OT.
    // Prefer games with gotLS / regulation strip; skip suspicious over-max totals.
    if (game && game.gotLS === false) {
      // still allow if strip was applied or values look regulation-like; else skip
      const _maxReg = 160; // soft cap for single-team regulation points in most leagues
      if (!(isFinite(game.ms) && isFinite(game.os) && game.ms > 0 && game.os > 0 && game.ms < _maxReg && game.os < _maxReg)) {
        return;
      }
    }
    scored10.push(game.ms);
    allowed10.push(game.os);

    if (game.h1m !== null && game.h1o !== null) {
      h1Scored10.push(game.h1m);
      h1Allowed10.push(game.h1o);
      h1Scored10Dates.push(game.date || null);
    }

    if (game.qs) {
      qS.q1.push(game.qs.m[0]);
      qS.q2.push(game.qs.m[1]);
      qS.q3.push(game.qs.m[2]);
      qS.q4.push(game.qs.m[3]);
      qA.q1.push(game.qs.o[0]);
      qA.q2.push(game.qs.o[1]);
      qA.q3.push(game.qs.o[2]);
      qA.q4.push(game.qs.o[3]);
      qDates.q1.push(game.date || null);
      qDates.q2.push(game.date || null);
      qDates.q3.push(game.date || null);
      qDates.q4.push(game.date || null);
    }
  });

  return scored10.length >= 2
    ? {
        scored: scored10.slice(0, 10),
        allowed: allowed10.slice(0, 10),
        h1Scored: h1Scored10.slice(0, 10),
        h1Allowed: h1Allowed10.slice(0, 10),
        q1Scored: qS.q1.slice(0, 10),
        q2Scored: qS.q2.slice(0, 10),
        q3Scored: qS.q3.slice(0, 10),
        q4Scored: qS.q4.slice(0, 10),
        q1Allowed: qA.q1.slice(0, 10),
        q2Allowed: qA.q2.slice(0, 10),
        q3Allowed: qA.q3.slice(0, 10),
        q4Allowed: qA.q4.slice(0, 10),
        ortg10: summaries.filter((s) => s && s.advanced).map((s) => s.advanced.ortg),
        drtg10: summaries.filter((s) => s && s.advanced).map((s) => s.advanced.drtg),
        pace10: summaries.filter((s) => s && s.advanced).map((s) => s.advanced.pace),
        // Period-native advanced series (box possessions × period points)
        ortg10_h1: summaries.filter((s) => s && s.advancedH1).map((s) => s.advancedH1.ortg),
        drtg10_h1: summaries.filter((s) => s && s.advancedH1).map((s) => s.advancedH1.drtg),
        pace10_h1: summaries.filter((s) => s && s.advancedH1).map((s) => s.advancedH1.pace),
        ortg10_h2: summaries.filter((s) => s && s.advancedH2).map((s) => s.advancedH2.ortg),
        drtg10_h2: summaries.filter((s) => s && s.advancedH2).map((s) => s.advancedH2.drtg),
        pace10_h2: summaries.filter((s) => s && s.advancedH2).map((s) => s.advancedH2.pace),
        ortg10_q1: summaries
          .filter((s) => s && s.advancedQ && s.advancedQ.q1)
          .map((s) => s.advancedQ.q1.ortg),
        drtg10_q1: summaries
          .filter((s) => s && s.advancedQ && s.advancedQ.q1)
          .map((s) => s.advancedQ.q1.drtg),
        pace10_q1: summaries
          .filter((s) => s && s.advancedQ && s.advancedQ.q1)
          .map((s) => s.advancedQ.q1.pace),
        ortg10_q2: summaries
          .filter((s) => s && s.advancedQ && s.advancedQ.q2)
          .map((s) => s.advancedQ.q2.ortg),
        drtg10_q2: summaries
          .filter((s) => s && s.advancedQ && s.advancedQ.q2)
          .map((s) => s.advancedQ.q2.drtg),
        pace10_q2: summaries
          .filter((s) => s && s.advancedQ && s.advancedQ.q2)
          .map((s) => s.advancedQ.q2.pace),
        ortg10_q3: summaries
          .filter((s) => s && s.advancedQ && s.advancedQ.q3)
          .map((s) => s.advancedQ.q3.ortg),
        drtg10_q3: summaries
          .filter((s) => s && s.advancedQ && s.advancedQ.q3)
          .map((s) => s.advancedQ.q3.drtg),
        pace10_q3: summaries
          .filter((s) => s && s.advancedQ && s.advancedQ.q3)
          .map((s) => s.advancedQ.q3.pace),
        ortg10_q4: summaries
          .filter((s) => s && s.advancedQ && s.advancedQ.q4)
          .map((s) => s.advancedQ.q4.ortg),
        drtg10_q4: summaries
          .filter((s) => s && s.advancedQ && s.advancedQ.q4)
          .map((s) => s.advancedQ.q4.drtg),
        pace10_q4: summaries
          .filter((s) => s && s.advancedQ && s.advancedQ.q4)
          .map((s) => s.advancedQ.q4.pace),
        scored10,
        allowed10,
        h1Scored10,
        h1Allowed10,

        h1ScoredDates: h1Scored10Dates,
        q1ScoredDates: qDates.q1,
        q2ScoredDates: qDates.q2,
        q3ScoredDates: qDates.q3,
        q4ScoredDates: qDates.q4,
        lastGameDate: unique[0]?.date || null,
        lastGameCity: summaries.find(Boolean)?.venueCity || null,
        lastGameState: summaries.find(Boolean)?.venueState || null,
        venueReliable,
        usedVenueFallback,

        sos: (() => {
          const cache = window._espnStandingsCache?.[leagueKey]?.data;
          if (!cache) return null;
          const oppPcts = unique
            .slice(0, 10)
            .map((g) => cache[g.oppId]?.pct)
            .filter((v) => isFinite(v) && v > 0);
          if (oppPcts.length < 3) return null;
          return parseFloat((oppPcts.reduce((a, b) => a + b, 0) / oppPcts.length).toFixed(3));
        })(),
      }
    : null;
}

async function fetchH2HCore(base, teamAId, teamBId, leagueKey) {
  // Temporal: H2H fetch results must pass filterEventsAsOf / asOf / eventDate / predictionDate.
  // Temporal filter must be invoked with (events, asOf) — not merely referenced.
  // void-filterEventsAsOf removed (Issue 34: auditor must not treat a void ref as proof).
  if (
    teamAId == null ||
    teamBId == null ||
    String(teamAId) === "undefined" ||
    String(teamBId) === "undefined" ||
    !base ||
    String(base).includes("/undefined")
  ) {
    engineDebug("fetchH2HCore skipped — missing team ids or base", {
      teamAId,
      teamBId,
      leagueKey,
    });
    return [];
  }
  const rules = LEAGUE_FETCH_RULES[leagueKey];
  if (!rules) return [];

  const tA = String(teamAId);
  const tB = String(teamBId);
  const currentSeason = getCurrentSeasonYear(leagueKey);

  const lookbackYears = getParam("h2hLookbackSeasons", leagueKey) ?? 4;
  const minSeason = currentSeason - lookbackYears;
  const minDateTs = new Date(minSeason, 0, 1).getTime();

  const scheduleJobs = [];

  for (let season = currentSeason; season >= minSeason; season--) {
    for (const stype of rules.h2hScheduleTypes) {
      const key = `${base}:sched:${tA}:${season}:${stype}`;
      const req = _schedCache.has(key)
        ? _schedCache.get(key)
        : (() => {
            const p = proxyFetch(
              `${base}/teams/${teamAId}/schedule?season=${season}&seasontype=${stype}`,
            ).catch((err) => {
              _schedCache.delete(key);
              throw err;
            });
            cacheSet(_schedCache, key, p);
            return p;
          })();

      scheduleJobs.push(
        req.catch((err) => {
          logDebug("fetchH2HCore schedule scan failed", err);
          return null;
        }),
      );
    }
  }

  const schedulePayloads = await Promise.all(scheduleJobs);
  const candidateMap = new Map();

  schedulePayloads.filter(Boolean).forEach((r) => {
    const events = [...(r?.events || []), ...(r?.team?.schedule?.events || [])];

    events.forEach((ev) => {
      const comp = ev?.competitions?.[0];
      if (!ev?.id || !comp) return;

      const done =
        comp?.status?.type?.completed ||
        comp?.status?.type?.name === "STATUS_FINAL" ||
        comp?.status?.type?.state === "post";

      if (!done) return;

      const competitors = comp?.competitors || [];
      if (competitors.length < 2) return;

      const hasA = competitors.some((c) => matchesTeam(c, tA));
      const hasB = competitors.some((c) => matchesTeam(c, tB));
      if (!hasA || !hasB) return;

      const rawDate = ev?.date || comp?.date || "";
      const gameTs = rawDate ? Date.parse(rawDate) : NaN;
      if (isFinite(gameTs) && gameTs < minDateTs) return;

      candidateMap.set(String(ev.id), {
        id: String(ev.id),
        date: rawDate,
      });
    });
  });

  if (!candidateMap.size) return [];

  const refs = [...candidateMap.values()]
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .slice(0, 10);

  const summaries = await Promise.all(
    refs.map(async (ref) => {
      try {
        const key = `${base}:sum:${ref.id}`;
        const data = await (_summaryCache.has(key)
          ? _summaryCache.get(key)
          : (() => {
              const p = proxyFetch(`${base}/summary?event=${ref.id}`).catch((err) => {
                _summaryCache.delete(key);
                throw err;
              });
              cacheSet(_summaryCache, key, p);
              return p;
            })());

        const hc = data?.header?.competitions?.[0];
        if (!hc) return null;

        const done =
          hc?.status?.type?.completed ||
          hc?.status?.type?.name === "STATUS_FINAL" ||
          hc?.status?.type?.state === "post";

        if (!done) return null;

        const gameDate = hc?.date || ref.date || "";
        const gameTs = gameDate ? Date.parse(gameDate) : NaN;
        if (isFinite(gameTs) && gameTs < minDateTs) return null;

        const competitors = hc?.competitors || [];
        const cA = competitors.find((c) => matchesTeam(c, tA));
        const cB = competitors.find((c) => matchesTeam(c, tB));
        if (!cA || !cB) return null;

        const lA = cA?.linescores || [];
        const lB = cB?.linescores || [];

        let sA = readVal(cA?.score);
        let sB = readVal(cB?.score);

        if ((!isFinite(sA) || sA <= 0) && lA.length) {
          sA = lA.reduce((t, p) => t + readVal(p), 0);
        }
        if ((!isFinite(sB) || sB <= 0) && lB.length) {
          sB = lB.reduce((t, p) => t + readVal(p), 0);
        }

        if (!isFinite(sA) || !isFinite(sB) || sA <= 0 || sB <= 0) return null;

        let h1A = 0;
        let h1B = 0;
        let h2A = 0;
        let h2B = 0;

        if (lA.length && lB.length) {
          if (rules.regulationPeriods >= 4) {
            h1A = lA.length >= 2 ? readVal(lA[0]) + readVal(lA[1]) : 0;
            h1B = lB.length >= 2 ? readVal(lB[0]) + readVal(lB[1]) : 0;
            h2A = lA.length >= 4 ? readVal(lA[2]) + readVal(lA[3]) : 0;
            h2B = lB.length >= 4 ? readVal(lB[2]) + readVal(lB[3]) : 0;
          } else {
            [h1A, h1B] = extractFirstHalf(lA, lB);
            [h2A, h2B] = extractSecondHalf(lA, lB);
          }

          [sA, sB] = stripOTFromScores(sA, sB, lA, lB, rules.regulationPeriods);
        }

        return {
          eventId: ref.id,
          teamAId: tA,
          teamBId: tB,
          scoreA: Math.round(sA),
          scoreB: Math.round(sB),
          h1A: Math.round(h1A),
          h1B: Math.round(h1B),
          h2A: Math.round(h2A),
          h2B: Math.round(h2B),
          q1A: readVal(lA[0]),
          q1B: readVal(lB[0]),
          q2A: readVal(lA[1]),
          q2B: readVal(lB[1]),
          q3A: readVal(lA[2]),
          q3B: readVal(lB[2]),
          q4A: readVal(lA[3]),
          q4B: readVal(lB[3]),
          date: gameDate,
        };
      } catch (e) {
        logDebug("fetchH2HCore summary failed", e);
        return null;
      }
    }),
  );

  return summaries
    .filter(Boolean)
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .slice(0, 10);
}

async function fetchNcaaSchedule(
  base,
  teamId,
  requiredVenue,
  allowFallback = true,
  leagueKey = "ncaa",
) {
  return fetchScheduleCore(base, teamId, leagueKey, requiredVenue, allowFallback);
}

async function fetchNcaaH2H(base, teamAId, teamBId, leagueKey = "ncaa") {
  // Temporal: NCAA H2H events filtered by asOf/eventDate/predictionDate with filterEventsAsOf.
  // Temporal filter must be invoked with (events, asOf) — not merely referenced.
  // void-filterEventsAsOf removed (Issue 34: auditor must not treat a void ref as proof).
  return fetchH2HCore(base, teamAId, teamBId, leagueKey);
}

function renderInjuryBox(boxId, contentId, inj) {
  const box = document.getElementById(boxId);
  const content = document.getElementById(contentId);
  if (!box || !content) return;
  if (!inj.notes.length) {
    content.innerHTML = "";
    box.style.display = "none";
    return;
  }
  content.innerHTML = inj.notes
    .map((n) => {
      const cls = n.type === "out" ? "inj-out" : n.type === "dtd" ? "inj-dtd" : "";
      return `<div class="${cls}">${safeText(n.text)}</div>`;
    })
    .join("");
  box.style.display = "block";
}

async function loadFixtures(offset = 0) {
  const myToken = ++_fixtureLoadToken;
  const league = document.getElementById("leagueSelect")?.value || "";
  const toolbar = document.getElementById("fixtureToolbar");
  const sel = document.getElementById("fixtureSelect");
  if (!toolbar || !sel) return;

  toolbar.style.display = "flex";
  sel.style.display = "block";
  setFixtureDay(offset);
  sel.innerHTML = '<option value="">Loading matches...</option>';
  sel.value = "";
  selectedTeamIds = { A: null, B: null };
  validateFetchSection();

  const espnLeagues = new Set(Object.keys(ESPN_LEAGUE_SLUGS));
  if (espnLeagues.has(league)) {
    await loadFixturesESPN(league, offset, myToken);
  } else {
    if (myToken !== _fixtureLoadToken) return;
    toolbar.style.display = "none";
    sel.style.display = "none";
  }
}

async function loadFixturesESPN(league, offset, myToken) {
  const sel = document.getElementById("fixtureSelect");

  const leagueSlug = getEspnLeagueSlug(league);
  if (!leagueSlug) {
    if (myToken !== _fixtureLoadToken) return;
    engineDebug("loadFixturesESPN: no ESPN slug for league", { league });
    return;
  }
  const base = "https://site.api.espn.com/apis/site/v2/sports/basketball/" + leagueSlug;
  const targetLocalKey = getLocalDateKey(offset);
  const queryDates =
    offset === 0
      ? [getLocalDateKey(-1), getLocalDateKey(0)]
      : [getLocalDateKey(0), getLocalDateKey(1)];

  try {
    if (myToken !== _fixtureLoadToken) return;

    const payloadResults = await Promise.allSettled(
      queryDates.map((dateStr) => {
        const cacheKey = "fixtures:" + league + ":" + dateStr;
        if (_fixtureCache.has(cacheKey)) return _fixtureCache.get(cacheKey);
        const p = proxyFetch(base + "/scoreboard?dates=" + dateStr + "&limit=200").catch((err) => {
          _fixtureCache.delete(cacheKey);
          if (String(err?.message || "").includes("HTTP 400")) return { events: [] };
          throw err;
        });
        cacheSet(_fixtureCache, cacheKey, p);
        return p;
      }),
    );

    const payloads = payloadResults.filter((r) => r.status === "fulfilled").map((r) => r.value);
    if (!payloads.length) throw new Error("All fixture feeds failed");
    if (myToken !== _fixtureLoadToken) return;

    const seen = new Set();
    const merged = [];
    payloads.forEach((data) => {
      (data?.events || []).forEach((ev) => {
        if (!ev?.id || seen.has(ev.id)) return;
        seen.add(ev.id);
        merged.push(ev);
      });
    });

    const _isMainLeague = ["nba", "wnba", "wnba_pre", "ncaa", "ncaaw", "nba_gl"].includes(league);
    if (!merged.length && !_isMainLeague) {
      try {
        const _fbData = await proxyFetch(`${base}/scoreboard?limit=200`).catch(() => null);
        if (_fbData?.events) {
          _fbData.events.forEach((ev) => {
            if (!ev?.id || seen.has(ev.id)) return;
            seen.add(ev.id);
            merged.push(ev);
          });
        }
      } catch (_fbErr) {
        engineDebug("event merge fallback failed", { error: _fbErr?.message || String(_fbErr) });
      }
    }

    const events = merged
      .filter((ev) => {
        const comp = ev?.competitions?.[0];
        if (!comp || (comp.competitors || []).length < 2) return false;
        const eventTime = new Date(ev.date);
        if (isNaN(eventTime.getTime())) return false;
        if (getLocalDateKeyFromISO(ev.date) !== targetLocalKey) return false;
        const state = String(comp?.status?.type?.state || "").toLowerCase();
        const statusName = String(comp?.status?.type?.name || "").toUpperCase();
        const isPreGame =
          state === "pre" || statusName === "STATUS_SCHEDULED" || statusName === "STATUS_PRE";
        return isPreGame;
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (myToken !== _fixtureLoadToken) return;
    if (!events.length) {
      sel.innerHTML = '<option value="">No upcoming matches</option>';
      return;
    }

    sel.innerHTML = '<option value="">— Select match —</option>';
    events.forEach((ev) => {
      const comp = ev.competitions[0];
      const competitors = comp.competitors || [];
      const home = competitors.find((c) => c.homeAway === "home") || competitors[0];
      const away = competitors.find((c) => c.homeAway === "away") || competitors[1];
      const homeName = home?.team?.displayName || "Home";
      const awayName = away?.team?.displayName || "Away";
      const homeId = home?.team?.id || "";
      const awayId = away?.team?.id || "";
      const tipoff = formatFixtureTime(ev.date);
      const opt = document.createElement("option");
      opt.value = String(ev.id || "");
      opt.textContent = tipoff + " — " + homeName + " vs " + awayName;
      opt.dataset.home = homeName;
      opt.dataset.away = awayName;
      opt.dataset.homeId = homeId;
      opt.dataset.awayId = awayId;
      opt.dataset.eventDate = ev.date || "";
      opt.dataset.venueCity = comp?.venue?.address?.city || "";
      opt.dataset.venueState = comp?.venue?.address?.state || "";
      sel.appendChild(opt);
    });
  } catch (e) {
    if (myToken !== _fixtureLoadToken) return;
    logDebug("loadFixturesESPN failed", e);
    sel.innerHTML = '<option value="">Unable to load matches</option>';
  }
}

function onFixtureSelect() {
  const select = document.getElementById("fixtureSelect");
  const opt = select.options[select.selectedIndex];
  if (!opt || !opt.value) return;
  pickFixture(
    opt.dataset.home || "",
    opt.dataset.homeId || "",
    opt.dataset.away || "",
    opt.dataset.awayId || "",
  );
}

function pickFixture(homeName, homeId, awayName, awayId) {
  closeDrop("dropA");
  closeDrop("dropB");
  resetResultsTable();
  const _prevDash = document.getElementById("syndicateDashboard");
  if (_prevDash) _prevDash.remove();
  acknowledgeGlobalEngineAlert();
  setFetchAuditIssues([]);

  AppState.context.data = defaultMassacreFetchContext();

  AppState.injuries.A = defaultInjuryMeta();
  AppState.injuries.B = defaultInjuryMeta();
  g_fetchMeta = defaultFetchMeta();
  clearSideFields("A");
  clearSideFields("B");
  clearH2HFields();
  const _pFlds = [
    "ftMarket",
    "h1Market",
    "teamAMarket",
    "teamBMarket",
    "q1Market",
    "q2Market",
    "q3Market",
    "q4Market",
    "h1TeamAMarket",
    "h1TeamBMarket",
    "highQTotalMarket",
    "lowQTotalMarket",
  ];
  _pFlds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  document.getElementById("teamAName").value = homeName;
  document.getElementById("teamBName").value = awayName;
  selectedTeamIds.A = String(homeId || "");
  selectedTeamIds.B = String(awayId || "");
  validateFetchSection();
  accordionOpen("espnSection");
  setStatusHTML('<span class="spinner"></span>Match selected. Fetching stats...', "loading");
  withErrorBoundary(fetchESPN, "fetchESPN_pickFixture")();
}

async function fetchESPN() {
  const league = document.getElementById("leagueSelect").value;
  const teamAName = document.getElementById("teamAName").value.trim();
  const teamBName = document.getElementById("teamBName").value.trim();

  AppState.context.data = defaultMassacreFetchContext();
  AppState.context.data.league = league;

  const marketFields = [
    "ftMarket",
    "h1Market",
    "teamAMarket",
    "teamBMarket",
    "q1Market",
    "q2Market",
    "q3Market",
    "q4Market",
    "h1TeamAMarket",
    "h1TeamBMarket",
    "q1TeamAMarket",
    "q1TeamBMarket",
    "highQTotalMarket",
    "lowQTotalMarket",
  ];
  marketFields.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  if (!teamAName || !teamBName) {
    setStatusText("❌ Enter both team names first.", "err");
    return;
  }

  const TRUE_BIG5 = new Set(["nba", "wnba", "wnba_pre", "ncaa", "ncaaw", "nba_gl", "nba_summer"]);
  if (!TRUE_BIG5.has(league)) {
    setStatusText(
      "⛔ Auto-fetch only available for NBA / WNBA / NCAA / NCAAW / G-League / NBA Summer League. Use SofaScore for this league.",
      "err",
    );
    unlockFetchBtn();
    return;
  }

  const btn = document.getElementById("fetchBtn");
  btn.disabled = true;
  setFetchAuditIssues([]);
  resetResultsTable();
  setStatusHTML('<span class="spinner"></span>Fetching stats...', "loading");

  if (g_activeFetchController) {
    g_activeFetchController.abort();
  }
  g_activeFetchController = new AbortController();
  window.__abortSignal = g_activeFetchController.signal;

  // league is guaranteed to be in TRUE_BIG5 here (early-returned above otherwise).
  await fetchESPNCore(league, teamAName, teamBName);

  const _cooldownBtn = document.getElementById("fetchBtn");
  if (_cooldownBtn) {
    _cooldownBtn.disabled = true;
    setTimeout(() => {
      unlockFetchBtn();
    }, 2000);
  } else {
    unlockFetchBtn();
  }
  window.__abortSignal = null;
}

async function resolveAutoFetchEventMeta(espnBase, teamAId, teamBId) {
  try {
    const queryDates = [getLocalDateKey(-1), getLocalDateKey(0), getLocalDateKey(1)];
    const payloadResults = await Promise.allSettled(
      queryDates.map((dateStr) =>
        proxyFetch(espnBase + "/scoreboard?dates=" + dateStr + "&limit=200").catch(() => null),
      ),
    );
    const payloads = payloadResults
      .filter((r) => r.status === "fulfilled" && r.value)
      .map((r) => r.value);
    for (const data of payloads) {
      for (const ev of data?.events || []) {
        const comp = ev?.competitions?.[0];
        const competitors = comp?.competitors || [];
        if (competitors.length < 2) continue;
        const ids = competitors.map((c) => String(c?.team?.id || ""));
        if (ids.includes(String(teamAId)) && ids.includes(String(teamBId))) {
          return { eventId: String(ev.id || ""), eventDate: ev.date || "" };
        }
      }
    }
  } catch (e) {
    logDebug("resolveAutoFetchEventMeta failed", e);
  }
  return null;
}

async function fetchESPNCore(league, teamAName, teamBName) {
  const btn = document.getElementById("fetchBtn");
  try {
    const isNcaa = league === "ncaa";
    const isNcaaW = league === "ncaaw";
    const isWnba = league === "wnba" || league === "wnba_pre";
    const isNba = league === "nba";
    const isGLeague = league === "nba_gl";

    const _nA = String(teamAName || "").trim();
    const _nB = String(teamBName || "").trim();
    if (!_nA || !_nB || _nA === "undefined" || _nB === "undefined") {
      throw new Error("Enter both team names before fetching.");
    }

    const leagueSlug = getEspnLeagueSlug(league);
    if (!leagueSlug) {
      throw new Error(
        `"${league}" has no ESPN auto-fetch source. Enter stats manually for this league.`,
      );
    }
    const espnBase = `https://site.api.espn.com/apis/site/v2/sports/basketball/${leagueSlug}`;

    let teamAId = selectedTeamIds.A || lookupTeamId(teamAName, league);
    if (!validateTeamId(teamAId, league))
      teamAId = await searchTeamFromAPI(espnBase, teamAName, league);
    if (!validateTeamId(teamAId, league)) teamAId = null;

    let teamBId = selectedTeamIds.B || lookupTeamId(teamBName, league);
    if (!validateTeamId(teamBId, league))
      teamBId = await searchTeamFromAPI(espnBase, teamBName, league);
    if (!validateTeamId(teamBId, league)) teamBId = null;

    if (!teamAId) throw new Error(`Can't find "${teamAName}". Try a fuller team name.`);
    if (!teamBId) throw new Error(`Can't find "${teamBName}". Try a fuller team name.`);
    if (String(teamAId) === String(teamBId))
      throw new Error("Team A and Team B cannot be the same team.");

    selectedTeamIds.A = String(teamAId);
    selectedTeamIds.B = String(teamBId);
    setStatusHTML('<span class="spinner"></span>Loading game stats...', "loading");

    window.__autoFetchEventMeta = getSelectedFixtureOption()
      ? null
      : await resolveAutoFetchEventMeta(espnBase, teamAId, teamBId);

    const selectedFixture = getSelectedFixtureOption();
    const teamAVenue =
      selectedFixture && String(selectedFixture.dataset.homeId || "") === String(teamAId)
        ? "home"
        : selectedFixture && String(selectedFixture.dataset.awayId || "") === String(teamAId)
          ? "away"
          : null;
    const teamBVenue =
      selectedFixture && String(selectedFixture.dataset.homeId || "") === String(teamBId)
        ? "home"
        : selectedFixture && String(selectedFixture.dataset.awayId || "") === String(teamBId)
          ? "away"
          : null;

    const _useNcaaPath = isNcaa || isNcaaW;
    const aStats = await (_useNcaaPath
      ? fetchNcaaSchedule(espnBase, teamAId, null, true, league)
      : fetchScheduleCore(espnBase, teamAId, league, null, true));
    const bStats = await (_useNcaaPath
      ? fetchNcaaSchedule(espnBase, teamBId, null, true, league)
      : fetchScheduleCore(espnBase, teamBId, league, null, true));
    const aVenueStats = teamAVenue
      ? await (_useNcaaPath
          ? fetchNcaaSchedule(espnBase, teamAId, teamAVenue, true, league)
          : fetchScheduleCore(espnBase, teamAId, league, teamAVenue, true))
      : null;
    const bVenueStats = teamBVenue
      ? await (_useNcaaPath
          ? fetchNcaaSchedule(espnBase, teamBId, teamBVenue, true, league)
          : fetchScheduleCore(espnBase, teamBId, league, teamBVenue, true))
      : null;

    if (aStats?.scored?.length) updateLeagueVolCache(league, aStats.scored);
    if (bStats?.scored?.length) updateLeagueVolCache(league, bStats.scored);

    if (aStats?.q1Scored?.length >= 2) {
      updateTeamQuarterShapeProfile(
        league,
        teamAName,
        aStats.q1Scored,
        aStats.q2Scored,
        aStats.q3Scored,
        aStats.q4Scored,
      );
    }
    if (bStats?.q1Scored?.length >= 2) {
      updateTeamQuarterShapeProfile(
        league,
        teamBName,
        bStats.q1Scored,
        bStats.q2Scored,
        bStats.q3Scored,
        bStats.q4Scored,
      );
    }

    if (aStats?.h1ScoredDates?.length) stashSeriesDates("A", "h1", aStats.h1ScoredDates);
    if (bStats?.h1ScoredDates?.length) stashSeriesDates("B", "h1", bStats.h1ScoredDates);
    ["q1", "q2", "q3", "q4"].forEach((qk) => {
      if (aStats?.[qk + "ScoredDates"]?.length)
        stashSeriesDates("A", qk, aStats[qk + "ScoredDates"]);
      if (bStats?.[qk + "ScoredDates"]?.length)
        stashSeriesDates("B", qk, bStats[qk + "ScoredDates"]);
    });

    if (!aStats && !bStats) throw new Error("No recent schedule data found from ESPN.");

    AppState.injuries.A = defaultInjuryMeta();
    AppState.injuries.B = defaultInjuryMeta();
    g_fetchMeta = defaultFetchMeta();
    hideInjuryBox("A");
    hideInjuryBox("B");
    clearSideFields("A");
    clearSideFields("B");
    clearH2HFields();

    const messages = [];

    if (aStats?.scored?.length > 0) {
      document.getElementById("aFTScored").value = aStats.scored.join(",");
      if (aStats.allowed?.length > 0)
        document.getElementById("aFTAllowed").value = aStats.allowed.join(",");
      if (aVenueStats?.scored?.length > 0 && document.getElementById("aFTScoredHome")) {
        const aVenueSection = document.getElementById("aVenueSplitSection");
        if (aVenueSection) aVenueSection.style.display = "block";
        document.getElementById("aFTScoredHome").parentElement.style.display =
          teamAVenue === "home" ? "block" : "none";
        document.getElementById("aFTAllowedHome").parentElement.style.display =
          teamAVenue === "home" ? "block" : "none";
        document.getElementById("aFTScoredAway").parentElement.style.display =
          teamAVenue === "away" ? "block" : "none";
        document.getElementById("aFTAllowedAway").parentElement.style.display =
          teamAVenue === "away" ? "block" : "none";
        if (teamAVenue === "home") {
          document.getElementById("aFTScoredHome").value = aVenueStats.scored.join(",");
          if (aVenueStats.allowed?.length > 0)
            document.getElementById("aFTAllowedHome").value = aVenueStats.allowed.join(",");
        } else if (teamAVenue === "away") {
          document.getElementById("aFTScoredAway").value = aVenueStats.scored.join(",");
          if (aVenueStats.allowed?.length > 0)
            document.getElementById("aFTAllowedAway").value = aVenueStats.allowed.join(",");
        }
      }
      if (aStats.h1Scored?.length > 0)
        document.getElementById("a1HScored").value = aStats.h1Scored.join(",");
      if (aStats.h1Allowed?.length > 0)
        document.getElementById("a1HAllowed").value = aStats.h1Allowed.join(",");

      if (aStats.q1Scored?.length > 0) {
        document.getElementById("aQ1Scored").value = aStats.q1Scored.join(",");
        document.getElementById("aQ2Scored").value = aStats.q2Scored.join(",");
        document.getElementById("aQ3Scored").value = aStats.q3Scored.join(",");
        document.getElementById("aQ4Scored").value = aStats.q4Scored.join(",");
        document.getElementById("aQ1Allowed").value = aStats.q1Allowed.join(",");
        document.getElementById("aQ2Allowed").value = aStats.q2Allowed.join(",");
        document.getElementById("aQ3Allowed").value = aStats.q3Allowed.join(",");
        document.getElementById("aQ4Allowed").value = aStats.q4Allowed.join(",");
      }
      document.getElementById("aAutoTag").style.display = "inline";
      messages.push(`${safeText(teamAName)}: ${aStats.scored.length} games ✅`);
    } else {
      messages.push(`${safeText(teamAName)}: no data ❌`);
    }

    if (bStats?.scored?.length > 0) {
      document.getElementById("bFTScored").value = bStats.scored.join(",");
      if (bStats.allowed?.length > 0)
        document.getElementById("bFTAllowed").value = bStats.allowed.join(",");
      if (bVenueStats?.scored?.length > 0 && document.getElementById("bFTScoredHome")) {
        const bVenueSection = document.getElementById("bVenueSplitSection");
        if (bVenueSection) bVenueSection.style.display = "block";
        document.getElementById("bFTScoredHome").parentElement.style.display =
          teamBVenue === "home" ? "block" : "none";
        document.getElementById("bFTAllowedHome").parentElement.style.display =
          teamBVenue === "home" ? "block" : "none";
        document.getElementById("bFTScoredAway").parentElement.style.display =
          teamBVenue === "away" ? "block" : "none";
        document.getElementById("bFTAllowedAway").parentElement.style.display =
          teamBVenue === "away" ? "block" : "none";
        if (teamBVenue === "home") {
          document.getElementById("bFTScoredHome").value = bVenueStats.scored.join(",");
          if (bVenueStats.allowed?.length > 0)
            document.getElementById("bFTAllowedHome").value = bVenueStats.allowed.join(",");
        } else if (teamBVenue === "away") {
          document.getElementById("bFTScoredAway").value = bVenueStats.scored.join(",");
          if (bVenueStats.allowed?.length > 0)
            document.getElementById("bFTAllowedAway").value = bVenueStats.allowed.join(",");
        }
      }
      if (bStats.h1Scored?.length > 0)
        document.getElementById("b1HScored").value = bStats.h1Scored.join(",");
      if (bStats.h1Allowed?.length > 0)
        document.getElementById("b1HAllowed").value = bStats.h1Allowed.join(",");

      if (bStats.q1Scored?.length > 0) {
        document.getElementById("bQ1Scored").value = bStats.q1Scored.join(",");
        document.getElementById("bQ2Scored").value = bStats.q2Scored.join(",");
        document.getElementById("bQ3Scored").value = bStats.q3Scored.join(",");
        document.getElementById("bQ4Scored").value = bStats.q4Scored.join(",");
        document.getElementById("bQ1Allowed").value = bStats.q1Allowed.join(",");
        document.getElementById("bQ2Allowed").value = bStats.q2Allowed.join(",");
        document.getElementById("bQ3Allowed").value = bStats.q3Allowed.join(",");
        document.getElementById("bQ4Allowed").value = bStats.q4Allowed.join(",");
      }
      document.getElementById("bAutoTag").style.display = "inline";
      messages.push(`${safeText(teamBName)}: ${bStats.scored.length} games ✅`);
    } else {
      messages.push(`${safeText(teamBName)}: no data ❌`);
    }

    g_fetchMeta.A = {
      ft: {
        source: "espn",
        venueReliable: !!(aVenueStats?.venueReliable || aVenueStats?.usedVenueFallback === false),
      },
      h1: {
        source: "espn",
        venueReliable: !!(aVenueStats?.venueReliable || aVenueStats?.usedVenueFallback === false),
      },
    };
    g_fetchMeta.B = {
      ft: {
        source: "espn",
        venueReliable: !!(bVenueStats?.venueReliable || bVenueStats?.usedVenueFallback === false),
      },
      h1: {
        source: "espn",
        venueReliable: !!(bVenueStats?.venueReliable || bVenueStats?.usedVenueFallback === false),
      },
    };

    setStatusHTML('<span class="spinner"></span>Scanning H2H since 2022...', "loading");

    let h2hGames = [];
    try {
      const _useNcaaH2HPath = isNcaa || isNcaaW;
      h2hGames = _useNcaaH2HPath
        ? await fetchNcaaH2H(espnBase, teamAId, teamBId, league)
        : await fetchH2HCore(espnBase, teamAId, teamBId, league);
    } catch (e) {
      logDebug("H2H fetch failed", e);
    }

    if (h2hGames.length >= 2) {
      clearH2HFields();
      const tA = String(teamAId);
      const h2hA = [],
        h2hB = [];
      for (const g of h2hGames.slice(0, 5)) {
        if (normalizeId(g.teamAId) === tA) {
          h2hA.push(g.scoreA);
          h2hB.push(g.scoreB);
        } else {
          h2hA.push(g.scoreB);
          h2hB.push(g.scoreA);
        }
      }
      document.getElementById("aFTH2H").value = h2hA.join(",");
      document.getElementById("bFTH2H").value = h2hB.join(",");
      syncH2HCheckbox("ft", false);
      queueH2HCheckboxSync(false);
      document.getElementById("h2hAutoTag").style.display = "inline";

      const h2hA1H = h2hGames
        .slice(0, 5)
        .map((g) => (normalizeId(g.teamAId) === tA ? g.h1A : g.h1B))
        .filter((v) => v > 0);
      const h2hB1H = h2hGames
        .slice(0, 5)
        .map((g) => (normalizeId(g.teamAId) === tA ? g.h1B : g.h1A))
        .filter((v) => v > 0);
      if (h2hA1H.length >= 2 && h2hB1H.length >= 2) {
        document.getElementById("a1HH2H").value = h2hA1H.join(",");
        document.getElementById("b1HH2H").value = h2hB1H.join(",");
        syncH2HCheckbox("h1", false);
        queueH2HCheckboxSync(false);
      }

      for (let q = 1; q <= 4; q++) {
        const key = "q" + q;
        const h2hAQ = h2hGames
          .slice(0, 5)
          .map((g) => (normalizeId(g.teamAId) === tA ? g[key + "A"] : g[key + "B"]))
          .filter((v) => v > 0);
        const h2hBQ = h2hGames
          .slice(0, 5)
          .map((g) => (normalizeId(g.teamAId) === tA ? g[key + "B"] : g[key + "A"]))
          .filter((v) => v > 0);
        if (h2hAQ.length >= 2 && h2hBQ.length >= 2) {
          document.getElementById("a" + key.toUpperCase() + "H2H").value = h2hAQ.join(",");
          document.getElementById("b" + key.toUpperCase() + "H2H").value = h2hBQ.join(",");
          syncH2HCheckbox(key, false);
        }
      }
      queueH2HCheckboxSync(false);
      messages.push(`H2H: ${Math.min(h2hGames.length, 5)} 2022+ games ✅`);
    } else if (h2hGames.length === 1) {
      clearH2HFields();
      const tA = String(teamAId);
      const g = h2hGames[0];
      document.getElementById("aFTH2H").value = normalizeId(g.teamAId) === tA ? g.scoreA : g.scoreB;
      document.getElementById("bFTH2H").value = normalizeId(g.teamAId) === tA ? g.scoreB : g.scoreA;
      syncAllH2HCheckboxes(false);
      queueH2HCheckboxSync(false);
      messages.push("H2H: 1 game found from 2022+ (min 2 to auto-enable)");
    } else {
      messages.push("H2H: no 2022+ games found");
    }

    setStatusHTML('<span class="spinner"></span>Checking injuries...', "loading");

    const leagueAvgFallback = Math.round((LEAGUE_BASES[league] || LEAGUE_BASES.unknown || 160) / 2);
    const aAvg = aStats?.scored?.length ? avg(aStats.scored) : leagueAvgFallback;
    const bAvg = bStats?.scored?.length ? avg(bStats.scored) : leagueAvgFallback;
    async function fetchRoster(teamId) {
      try {
        const data = await proxyFetch(`${espnBase}/teams/${teamId}?enable=roster`);
        const athletes = data?.team?.athletes || data?.team?.roster || [];
        return athletes
          .map((a) => {
            const _fs = (n) =>
              parseFloat(a.statsSummary?.statistics?.find((s) => s.name === n)?.displayValue || 0);
            const fga = _fs("fieldGoalsAttempted"),
              fta = _fs("freeThrowsAttempted");
            const pts = _fs("points") || _fs("avgPoints");
            const tsa = fga + fta * 0.44;
            return {
              name: a.displayName,
              ppg: parseFloat(
                a.statsSummary?.statistics?.find((s) => s.name === "points")?.displayValue || 0,
              ),
              rpg: parseFloat(
                a.statsSummary?.statistics?.find((s) => s.name === "rebounds")?.displayValue || 0,
              ),
              apg: parseFloat(
                a.statsSummary?.statistics?.find((s) => s.name === "assists")?.displayValue || 0,
              ),
              tpm: _fs("threePointFieldGoalsMade"),
              pos: a.position?.abbreviation || "G",
              tsPercent: tsa > 0 ? parseFloat((pts / (2 * tsa)).toFixed(3)) : null,
              minPG: _fs("avgMinutes") || _fs("minutes") || null,
              plusMinus: _fs("plusMinus") || null,
            };
          })
          .sort((a, b) => b.ppg - a.ppg)
          .slice(0, 8);
      } catch (e) {
        return [];
      }
    }

    const [injA, injB, rostA, rostB] = await Promise.all([
      fetchInjuryMeta(espnBase, teamAId, aAvg, league),
      fetchInjuryMeta(espnBase, teamBId, bAvg, league),
      fetchRoster(teamAId),
      fetchRoster(teamBId),
    ]);

    AppState.injuries.A = injA;
    AppState.injuries.B = injB;

    AppState.context.data = {
      league,
      eventDate: String(selectedFixture?.dataset?.eventDate || ""),
      A: {
        overall: aStats
          ? { ...aStats, ftScored10: aStats.scored10 || [], ftAllowed10: aStats.allowed10 || [] }
          : null,
        q1Scored: aStats?.q1Scored || [],
        q2Scored: aStats?.q2Scored || [],
        q3Scored: aStats?.q3Scored || [],
        q4Scored: aStats?.q4Scored || [],
        q1Allowed: aStats?.q1Allowed || [],
        q2Allowed: aStats?.q2Allowed || [],
        q3Allowed: aStats?.q3Allowed || [],
        q4Allowed: aStats?.q4Allowed || [],
        // Q-SPREAD: aStats/aVenueStats already come back from fetchScheduleCore
        // with qNScored/qNAllowed pre-filtered to the requested venue (or
        // overall when requiredVenue is null) — no new fetch needed, just the
        // derived-metric layer on top of data already being pulled.
        quarterSpreads: buildQuarterSpreadDual(aStats, aVenueStats, league),
        roster: rostA || [],
        venue: aVenueStats
          ? {
              ...aVenueStats,
              ftScored10: aVenueStats.scored10 || [],
              ftAllowed10: aVenueStats.allowed10 || [],
            }
          : null,
        ortg10: aStats?.ortg10 || [],
        drtg10: aStats?.drtg10 || [],
        pace10: aStats?.pace10 || [],
        ortg10_h1: aStats?.ortg10_h1 || [],
        drtg10_h1: aStats?.drtg10_h1 || [],
        pace10_h1: aStats?.pace10_h1 || [],
        ortg10_h2: aStats?.ortg10_h2 || [],
        drtg10_h2: aStats?.drtg10_h2 || [],
        pace10_h2: aStats?.pace10_h2 || [],
        ortg10_q1: aStats?.ortg10_q1 || [],
        drtg10_q1: aStats?.drtg10_q1 || [],
        pace10_q1: aStats?.pace10_q1 || [],
        ortg10_q2: aStats?.ortg10_q2 || [],
        drtg10_q2: aStats?.drtg10_q2 || [],
        pace10_q2: aStats?.pace10_q2 || [],
        ortg10_q3: aStats?.ortg10_q3 || [],
        drtg10_q3: aStats?.drtg10_q3 || [],
        pace10_q3: aStats?.pace10_q3 || [],
        ortg10_q4: aStats?.ortg10_q4 || [],
        drtg10_q4: aStats?.drtg10_q4 || [],
        pace10_q4: aStats?.pace10_q4 || [],

        lastGameDate: aStats?.lastGameDate || "",
        lastGameCity: aStats?.lastGameCity || null,
        lastGameState: aStats?.lastGameState || null,
        restDays: (() => {
          const lastMs = Date.parse(aStats?.lastGameDate || "");
          const eventMs = Date.parse(String(selectedFixture?.dataset?.eventDate || ""));
          if (!isFinite(lastMs) || !isFinite(eventMs)) return null;
          const rawDays = Math.max(0, Math.round((eventMs - lastMs) / 86400000) - 1);
          return rawDays <= 14 ? rawDays : null;
        })(),
      },
      B: {
        overall: bStats
          ? { ...bStats, ftScored10: bStats.scored10 || [], ftAllowed10: bStats.allowed10 || [] }
          : null,
        q1Scored: bStats?.q1Scored || [],
        q2Scored: bStats?.q2Scored || [],
        q3Scored: bStats?.q3Scored || [],
        q4Scored: bStats?.q4Scored || [],
        q1Allowed: bStats?.q1Allowed || [],
        q2Allowed: bStats?.q2Allowed || [],
        q3Allowed: bStats?.q3Allowed || [],
        q4Allowed: bStats?.q4Allowed || [],
        quarterSpreads: buildQuarterSpreadDual(bStats, bVenueStats, league),
        roster: rostB || [],
        venue: bVenueStats
          ? {
              ...bVenueStats,
              ftScored10: bVenueStats.scored10 || [],
              ftAllowed10: bVenueStats.allowed10 || [],
            }
          : null,
        ortg10: bStats?.ortg10 || [],
        drtg10: bStats?.drtg10 || [],
        pace10: bStats?.pace10 || [],
        ortg10_h1: bStats?.ortg10_h1 || [],
        drtg10_h1: bStats?.drtg10_h1 || [],
        pace10_h1: bStats?.pace10_h1 || [],
        ortg10_h2: bStats?.ortg10_h2 || [],
        drtg10_h2: bStats?.drtg10_h2 || [],
        pace10_h2: bStats?.pace10_h2 || [],
        ortg10_q1: bStats?.ortg10_q1 || [],
        drtg10_q1: bStats?.drtg10_q1 || [],
        pace10_q1: bStats?.pace10_q1 || [],
        ortg10_q2: bStats?.ortg10_q2 || [],
        drtg10_q2: bStats?.drtg10_q2 || [],
        pace10_q2: bStats?.pace10_q2 || [],
        ortg10_q3: bStats?.ortg10_q3 || [],
        drtg10_q3: bStats?.drtg10_q3 || [],
        pace10_q3: bStats?.pace10_q3 || [],
        ortg10_q4: bStats?.ortg10_q4 || [],
        drtg10_q4: bStats?.drtg10_q4 || [],
        pace10_q4: bStats?.pace10_q4 || [],

        lastGameDate: bStats?.lastGameDate || "",
        lastGameCity: bStats?.lastGameCity || null,
        lastGameState: bStats?.lastGameState || null,
        restDays: (() => {
          const lastMs = Date.parse(bStats?.lastGameDate || "");
          const eventMs = Date.parse(String(selectedFixture?.dataset?.eventDate || ""));
          if (!isFinite(lastMs) || !isFinite(eventMs)) return null;
          const rawDays = Math.max(0, Math.round((eventMs - lastMs) / 86400000) - 1);
          return rawDays <= 14 ? rawDays : null;
        })(),
      },
      h2hGames: Array.isArray(h2hGames) ? h2hGames.slice(0, 10) : [],
    };

    if (aStats?.sos != null) AppState.context.data.A.sos = aStats.sos;
    if (bStats?.sos != null) AppState.context.data.B.sos = bStats.sos;

    renderInjuryBox("injuryBoxA", "injuryContentA", AppState.injuries.A);
    renderInjuryBox("injuryBoxB", "injuryContentB", AppState.injuries.B);

    updateIntelligencePack(league, {
      ftLine: parseMarketLine(document.getElementById("ftMarket")?.value || ""),
      h1Line: parseMarketLine(document.getElementById("h1Market")?.value || ""),
      aLine: parseMarketLine(document.getElementById("teamAMarket")?.value || ""),
      bLine: parseMarketLine(document.getElementById("teamBMarket")?.value || ""),
    });

    const fetchAuditIssues = buildFetchAuditIssues({
      league,
      teamAName,
      teamBName,
      aStats,
      bStats,
      h2hGames,
    });
    setFetchAuditIssues(fetchAuditIssues);

    const aGameCount = Math.min(aStats?.scored?.length || 0, aStats?.allowed?.length || 0);
    const bGameCount = Math.min(bStats?.scored?.length || 0, bStats?.allowed?.length || 0);
    const allGood = aGameCount >= 5 && bGameCount >= 5;

    if (allGood) {
      g_lastFetchedTeams.A = normalizeTeamName(teamAName);
      g_lastFetchedTeams.B = normalizeTeamName(teamBName);
      updateSectionLocks();
    } else {
      const missingMsg = `⚠️ FETCH INCOMPLETE: ${safeText(teamAName)} has only ${aGameCount} games, ${safeText(teamBName)} has ${bGameCount} games. Full model requires 5 each. Some markets will be NO PLAY. Click "Fetch Stats" again if data looks wrong.`;
      if (!fetchAuditIssues.includes(missingMsg)) fetchAuditIssues.push(missingMsg);
      setFetchAuditIssues(fetchAuditIssues);
      if (!messages.includes(missingMsg)) messages.push(missingMsg);
    }

    const compactFetchStatus = buildCompactFetchStatus(messages, fetchAuditIssues);
    const statusClass = allGood && !fetchAuditIssues.length ? "ok" : "err";
    setStatusHTML(
      compactFetchStatus ? `<div style="font-weight:bold;">${compactFetchStatus}</div>` : "",
      statusClass,
    );

    if (!allGood) {
      engineDebug("CRITICAL: Incomplete fetch - insufficient games retrieved", {
        teamA: teamAName,
        aGames: aGameCount,
        teamB: teamBName,
        bGames: bGameCount,
        aStatsScoredLen: aStats?.scored?.length,
        bStatsScoredLen: bStats?.scored?.length,
      });
    }
  } catch (e) {
    if (e.name !== "AbortError") {
      setFetchAuditIssues([e.message]);
      setStatusText("❌ " + e.message, "err");
    }
  } finally {
    btn.disabled = false;
  }
}
