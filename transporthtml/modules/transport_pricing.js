// Unified TransportPricing module (single source of truth)
(function(){
  const DEFAULT_MULTIPLIERS = { 1:1.5, 2:1.0, 3:1.0, 4:0.8, 5:1.0, 6:0.0, 7:1.5, 8:1.0, 9:0.8, 10:1.0, 11:1.25, 12:0.0 };

  const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
  const parseYMD = s => { const [y,m,d] = String(s||'').split('-').map(n=>parseInt(n,10)); return {y,m,d}; };

  // Unmultiplied baseMonthlyFee = sum(morning+evening) before month multiplier
  // Now supports date-aware pricing via amStop/pmStop OR legacy baseMonthlyFee
  async function dueForMonth({year, month, baseMonthlyFee, amStop, pmStop, startDate, multipliers}){
    // If stops provided, compute base fee for that month using priceHistory
    let base = baseMonthlyFee;
    if (amStop || pmStop) {
      base = await computeBaseMonthlyFeeOnMonth({year, month, amStop, pmStop});
    } else {
      base = Number(baseMonthlyFee||0);
    }
    
    const multMap = multipliers && typeof multipliers==='object' ? multipliers : DEFAULT_MULTIPLIERS;
    const mult = multMap[month] ?? 1.0;
    if (mult <= 0) return 0;

    const dim = daysInMonth(year, month);
    const start = startDate ? parseYMD(startDate) : {y:year,m:1,d:1};

    if (year < start.y) return 0;
    if (year === start.y && month < start.m) return 0;

    if (year === start.y && month === start.m){
      const activeDays = Math.max(0, dim - (start.d - 1));
      return (base * mult) * (activeDays / dim);
    }
    return base * mult;
  }

  async function buildLedger({year, baseMonthlyFee, amStop, pmStop, startDate, payments, multipliers}){
    const approvedPayments = Array.isArray(payments) ? payments : Object.values(payments || {});
    const totalPaidInput = approvedPayments.reduce((sum, p) => {
      const amount = Number(p?.amount || p?.paidAmount || p?.value || 0);
      return sum + (Number.isFinite(amount) ? amount : 0);
    }, 0);

    const monthNumbers = Array.from({ length: 12 }, (_, i) => i + 1);
    const dues = await Promise.all(
      monthNumbers.map((m) => dueForMonth({ year, month: m, baseMonthlyFee, amStop, pmStop, startDate, multipliers }))
    );

    // Business rule: approved amount covers oldest unpaid month(s) first.
    const months = [];
    let totalDue = 0;
    let carry = totalPaidInput;
    monthNumbers.forEach((m, idx) => {
      const due = Number(dues[idx] || 0);
      const paid = Math.min(due, Math.max(0, carry));
      carry = Math.max(0, carry - paid);
      const balance = Math.max(0, +(due - paid).toFixed(2));
      const status = (due === 0) ? 'SKIP' : (paid <= 0 ? 'UNPAID' : (balance > 0 ? 'PARTIAL' : 'PAID'));
      months.push({
        month: m,
        mult: (multipliers?.[m] ?? DEFAULT_MULTIPLIERS[m] ?? 1.0),
        due: +due.toFixed(2),
        paid: +paid.toFixed(2),
        balance,
        status
      });
      totalDue += due;
    });

    return {
      months,
      totals: {
        due: +totalDue.toFixed(2),
        paid: +Number(totalPaidInput || 0).toFixed(2),
        balance: +Math.max(0, totalDue - totalPaidInput).toFixed(2),
        credit: +Math.max(0, totalPaidInput - totalDue).toFixed(2)
      }
    };
  }

  // === DB helpers (Firebase compat assumed present on page) ===
  async function loadYearMultipliers(year){
    try{
      if (!window.firebase || !firebase.database) return DEFAULT_MULTIPLIERS;
      const snap = await firebase.database().ref(`transportSettings/${year}/monthMultipliers`).once('value');
      const val = snap.val();
      if (!val) return DEFAULT_MULTIPLIERS;
      // sanitize to numbers
      const out = {...DEFAULT_MULTIPLIERS};
      Object.keys(val).forEach(k=>{ const n=Number(val[k]); if(!Number.isNaN(n)) out[Number(k)] = n; });
      return out;
    }catch(_){ return DEFAULT_MULTIPLIERS; }
  }

  async function loadStopsForYear(year){
    try{
      if (!window.firebase || !firebase.database) return [];
      const snap = await firebase.database().ref(`transportCatalog/${year}/stops`).once('value');
      const stops = snap.val() || {};
      // normalize { stopId: {name, baseFee, active} }
      return Object.entries(stops).map(([id,s])=>({ id, name:s.name||id, baseFee:Number(s.baseFee)||0, active: s.active !== false }));
    }catch(_){ return []; }
  }

  // Helper to index stops by ID
  function indexStopsById(stops){
    const map = {};
    (stops||[]).forEach(s => { map[s.id] = s; });
    return map;
  }

  // === Date-aware pricing functions ===
  const NAME = s => String(s||'').trim().toLowerCase();

  // Load stops map by name (with priceHistory)
  async function loadStopsMap(year){
    const snap = await firebase.database().ref(`transportCatalog/${year}/stops`).once('value');
    const data = snap.val() || {};
    const byName = {};
    Object.entries(data).forEach(([id, s])=>{
      const key = NAME(s.name);
      byName[key] = { id, ...s, priceHistory: s.priceHistory || {} };
    });
    return byName;
  }

  // Pick price for a specific date from priceHistory
  function pickPriceForDate(stop, onDateIso){
    // if no history => fallback to baseFee
    const list = Object.values(stop.priceHistory||{}).map(r=>({
      amount: Number(r.amount)||0,
      eff: String(r.effectiveFrom||'1970-01-01')
    })).sort((a,b)=> a.eff.localeCompare(b.eff));
    
    const target = String(onDateIso||new Date().toISOString().slice(0,10));
    let price = Number(stop.baseFee)||0;
    
    for (const r of list) {
      if (r.eff <= target) price = r.amount;
      else break;
    }
    
    // If target is in same month as most recent priceHistory entry, use that entry's amount
    // (so route edits made mid-month apply to the whole current month)
    if (list.length > 0) {
      const last = list[list.length - 1];
      const targetYM = target.slice(0, 7); // "2026-02"
      const lastYM = last.eff.slice(0, 7);
      if (targetYM === lastYM) price = last.amount;
    }
    
    return price;
  }

  // Get base fee for a stop on a specific date
  async function baseFeeOnDate({year, stopName, onDate}){
    if (!stopName) return 0;
    try {
      const map = await loadStopsMap(year);
      const stop = map[NAME(stopName)];
      if (!stop) {
        // Fallback to legacy synchronous priceForStop (defined later)
        return getLegacyPriceForStop(stopName);
      }
      // Use date string directly when already YYYY-MM-DD (avoids timezone shift from toISOString)
      const iso = (typeof onDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(onDate))
        ? onDate
        : (onDate ? new Date(onDate) : new Date()).toISOString().slice(0, 10);
      return pickPriceForDate(stop, iso);
    } catch (err) {
      console.warn('Error in baseFeeOnDate, using legacy:', err);
      return getLegacyPriceForStop(stopName);
    }
  }

  // Helper to get legacy price (synchronous, used as fallback)
  function getLegacyPriceForStop(stopName){
    const key = String(stopName||'').toLowerCase().trim();
    const legacyMap = {
      'jirani na shule':17000, 'mazengo':17000, 'mbezi':17000, 'msikitini':17000, 'mlimani rc':17000,
      'uswahilini kanisani':17000, 'international':17000, 'kona dampo':17000, 'mauwa':17000, 'mwisho wa fensi':17000,
      'ghati':17000, 'mnara wa halotel':17000,
      'sinoni':18500, 'kidemi':18500, 'soko mjinga':18500, 'mnara wa voda':18500, 'mbugani kwenye lami tu':18500,
      'glorious':21000, 'ushirika':21000, 'tanga kona':21000, 'njia mtoni':21000, 'kaburi moja':21000,
      'kwa malaika':21000, 'savanna':21000, 'dampo':21000, 'darajani':21000, 'kikwete road':21000,
      'boma kubwa':21000, 'kiwetu pazuri':21000, 'umoja road':21000, 'njiro ndogo':21000, 'king david':21000,
      'chavda':24000, 'matokeo':24000, 'milano':24000, 'jamhuri':24000, 'felix mrema':24000, 'lemara':24000,
      'bonisite':24000, 'intel':24000, 'patel':24000, 'terrati':24000, 'si mbaoil':24000,
      'mapambazuko':25000, 'mkono wa madukani':25000, 'soweto':25000, 'mianzini barabarani':25000, 'eliboru jr':25000,
      'green valley':25000, 'country coffee':25000, 'maua':25000, 'pepsi':25000, 'majengo':25000,
      'sanawari':28000, 'sekei':28000, 'shabani':28000, 'kimandolu':28000, 'kijenge':28000, 'mkono wa shuleni':28000,
      'suye':38000, 'moshono':38000, 'nado':38000, 'mwanama reli':38000, 'kisongo':38000,
      'kiserian':44000, 'chekereni':44000, 'duka bovu':44000, 'tengeru':44000, 'ngulelo':44000, 'kwamrefu':44000, 'shangarai atomic':44000
    };
    if (legacyMap[key]) return legacyMap[key];
    const hit = Object.keys(legacyMap).find(k => key.includes(k));
    return hit ? legacyMap[hit] : 28000;
  }

  // Get month start ISO date (timezone-safe: avoid toISOString which shifts to UTC)
  function monthStartIso(year, month){ 
    const y = String(Number(year) || new Date().getFullYear());
    const m = String(Number(month) || 1).padStart(2, '0');
    return `${y}-${m}-01`;
  }

  // Compute base monthly fee for a specific month (using priceHistory)
  async function computeBaseMonthlyFeeOnMonth({year, month, amStop, pmStop}){
    const onDate = monthStartIso(year, month);
    const [am, pm] = await Promise.all([
      baseFeeOnDate({year, stopName: amStop, onDate}),
      baseFeeOnDate({year, stopName: pmStop, onDate})
    ]);
    return (am + pm);
  }

  // Legacy compatibility: keep old priceForStop and expectedForMonth for backward compat
  const LEGACY_STOP_PRICE = (function(){
    const map = Object.create(null);
    function add(stops, price){ stops.forEach(s=>{ map[String(s).toLowerCase().trim()] = price; }); }
    add(['jirani na shule','mazengo','mbezi','msikitini','mlimani rc','uswahilini kanisani','international','kona dampo','mauwa','mwisho wa fensi','ghati','mnara wa halotel'], 17000);
    add(['sinoni','kidemi','soko mjinga','mnara wa voda','mbugani kwenye lami tu'], 18500);
    add(['glorious','ushirika','tanga kona','njia mtoni','kaburi moja','kwa malaika','savanna','dampo','darajani','kikwete road','boma kubwa','kiwetu pazuri','umoja road','njiro ndogo','king david'], 21000);
    add(['chavda','matokeo','milano','jamhuri','felix mrema','lemara','bonisite','intel','patel','terrati','si mbaoil'], 24000);
    add(['mapambazuko','mkono wa madukani','soweto','mianzini barabarani','eliboru jr','green valley','country coffee','maua','pepsi','majengo'], 25000);
    add(['sanawari','sekei','shabani','kimandolu','kijenge','mkono wa shuleni'], 28000);
    add(['suye','moshono','nado','mwanama reli','kisongo'], 38000);
    add(['kiserian','chekereni','duka bovu','tengeru','ngulelo','kwamrefu','shangarai atomic'], 44000);
    return map;
  })();

  function priceForStop(stopName, opts){
    // Backward-compatible: allow priceForStop(stop, {year, onDate})
    if (opts && (opts.year || opts.onDate)) {
      return baseFeeOnDate({year: opts.year, stopName, onDate: opts.onDate});
    }
    
    // Legacy synchronous fallback
    const key = String(stopName||'').toLowerCase().trim();
    if (LEGACY_STOP_PRICE[key]) return LEGACY_STOP_PRICE[key];
    // Fuzzy contains match fallback
    const hit = Object.keys(LEGACY_STOP_PRICE).find(k => key.includes(k));
    return hit ? LEGACY_STOP_PRICE[hit] : 28000; // default mid-band when unknown
  }

  function getMonthMultiplier(m) { return DEFAULT_MULTIPLIERS[m] || 1.0; }

  function expectedForMonth(amStop, pmStop, month){
    const base = (priceForStop(amStop) + priceForStop(pmStop));
    return Math.round(base * getMonthMultiplier(month));
  }

  function scheduleForYear(year, amStop, pmStop){
    const months = [];
    let totalExpected = 0; let totalBase = 0;
    for (let m=1; m<=12; m++){
      const base = priceForStop(amStop) + priceForStop(pmStop);
      const expected = Math.round(base * getMonthMultiplier(m));
      months.push({ month: m, base, multiplier: getMonthMultiplier(m), expected });
      totalExpected += expected; totalBase += base;
    }
    return { year, months, totals: { base: totalBase, expected: totalExpected } };
  }

  window.TransportPricing = {
    DEFAULT_MULTIPLIERS,
    MONTH_MULTIPLIERS: DEFAULT_MULTIPLIERS, // backward compat
    getMonthMultiplier,
    priceForStop,
    expectedForMonth,
    dueForMonth,
    buildLedger,
    scheduleForYear,
    loadYearMultipliers,
    loadStopsForYear,
    indexStopsById,
    // Date-aware pricing functions
    loadStopsMap,
    pickPriceForDate,
    baseFeeOnDate,
    computeBaseMonthlyFeeOnMonth,
    monthStartIso
  };
})();
