const StatementState = {
  mode: "guest",
  uid: null,
  currentCashbookId: "default",
  cashbooks: {},
  potsByCashbook: {},
  transactionsByCashbook: {},
  settings: {
    currency: "TZS"
  }
};

document.addEventListener("DOMContentLoaded", initStatement);

async function initStatement() {
  await hydrateStatement();
  bindStatementHandlers();
  renderCashbookOptions();
  setQuickRange("month");
  generateStatement();
}

async function hydrateStatement() {
  const user = window.firebase?.auth?.().currentUser || null;
  if (user) {
    StatementState.mode = "firebase";
    StatementState.uid = user.uid;
    await loadFromFirebaseStatement(user.uid);
  } else {
    loadFromLocalStorageStatement();
  }
  ensureDefaultStatement();
}

async function loadFromFirebaseStatement(uid) {
  const snap = await firebase.database().ref("society/" + uid).once("value");
  const data = snap.val() || {};
  const cashbooks = data.cashbooks || {};
  StatementState.cashbooks = {};
  StatementState.potsByCashbook = {};
  StatementState.transactionsByCashbook = {};
  StatementState.settings = { ...StatementState.settings, ...(data.settings || {}) };
  Object.keys(cashbooks).forEach((cbId) => {
    const cb = cashbooks[cbId];
    StatementState.cashbooks[cbId] = cb.meta || { id: cbId, name: cbId, currency: StatementState.settings.currency };
    StatementState.potsByCashbook[cbId] = cb.pots || {};
    StatementState.transactionsByCashbook[cbId] = cb.transactions || {};
  });
  StatementState.currentCashbookId =
    data.settings?.lastOpenedCashbookId || data.settings?.defaultCashbookId || "default";
}

function loadFromLocalStorageStatement() {
  const raw = localStorage.getItem("society_money_memory_v1");
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    StatementState.cashbooks = data.cashbooks || {};
    StatementState.potsByCashbook = data.potsByCashbook || {};
    StatementState.transactionsByCashbook = data.transactionsByCashbook || {};
    StatementState.settings = { ...StatementState.settings, ...(data.settings || {}) };
    StatementState.currentCashbookId = data.currentCashbookId || "default";
  } catch (e) {
    console.warn("Failed to parse statement cache", e);
  }
}

function ensureDefaultStatement() {
  if (!StatementState.cashbooks["default"]) {
    StatementState.cashbooks["default"] = {
      id: "default",
      name: "Familia",
      emoji: "🏠",
      currency: StatementState.settings.currency,
      startingBalance: 0
    };
  }
}

function bindStatementHandlers() {
  document.getElementById("stmt-generate")?.addEventListener("click", generateStatement);
  document.querySelectorAll("[data-quick]").forEach((btn) =>
    btn.addEventListener("click", () => {
      setQuickRange(btn.getAttribute("data-quick"));
      generateStatement();
    })
  );
  const cbSelect = document.getElementById("stmt-cashbook");
  cbSelect?.addEventListener("change", () => {
    StatementState.currentCashbookId = cbSelect.value;
    generateStatement();
  });
  document.getElementById("stmt-print")?.addEventListener("click", () => window.print());
}

function renderCashbookOptions() {
  const sel = document.getElementById("stmt-cashbook");
  if (!sel) return;
  sel.innerHTML = "";
  Object.values(StatementState.cashbooks).forEach((cb) => {
    const opt = document.createElement("option");
    opt.value = cb.id;
    opt.textContent = `${cb.emoji || "📒"} ${cb.name}`;
    if (cb.id === StatementState.currentCashbookId) opt.selected = true;
    sel.appendChild(opt);
  });
}

function setQuickRange(key) {
  const from = document.getElementById("stmt-from");
  const to = document.getElementById("stmt-to");
  const now = new Date();
  if (key === "month") {
    from.value = formatYMD(new Date(now.getFullYear(), now.getMonth(), 1));
    to.value = formatYMD(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  } else if (key === "last-month") {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    from.value = formatYMD(prev);
    to.value = formatYMD(new Date(prev.getFullYear(), prev.getMonth() + 1, 0));
  } else if (key === "year") {
    from.value = `${now.getFullYear()}-01-01`;
    to.value = `${now.getFullYear()}-12-31`;
  }
}

function generateStatement() {
  const cbId = StatementState.currentCashbookId;
  const from = document.getElementById("stmt-from").value;
  const to = document.getElementById("stmt-to").value;
  const txns = Object.values(StatementState.transactionsByCashbook[cbId] || {});
  const openingBalance = StatementState.cashbooks[cbId]?.startingBalance || 0;
  const beforeRangeNet = txns
    .filter((t) => t.date && t.date < from)
    .reduce((s, t) => s + (t.direction === "in" ? Number(t.amount) || 0 : -Number(t.amount || 0)), 0);
  const inRange = txns.filter((t) => t.date && t.date >= from && t.date <= to);
  const totalIn = inRange.filter((t) => t.direction === "in").reduce((s, t) => s + Number(t.amount || 0), 0);
  const totalOut = inRange.filter((t) => t.direction === "out").reduce((s, t) => s + Number(t.amount || 0), 0);
  const closing = openingBalance + beforeRangeNet + totalIn - totalOut;

  setText("stmt-opening", formatCurrency(openingBalance + beforeRangeNet));
  setText("stmt-in", formatCurrency(totalIn));
  setText("stmt-out", formatCurrency(totalOut));
  setText("stmt-closing", formatCurrency(closing));
  setText("stmt-title", `Statement ya ${StatementState.cashbooks[cbId]?.name || cbId}`);
  setText("stmt-period", `${from} hadi ${to}`);

  renderStatementList(inRange);
  renderSummaryByPot(inRange);
  renderSummaryByCategory(inRange);
}

function renderStatementList(inRange) {
  const list = document.getElementById("stmt-list");
  if (!list) return;
  if (!inRange.length) {
    list.innerHTML = `<p class="text-slate-400">Hakuna miamala kwenye kipindi hiki.</p>`;
    return;
  }
  const sorted = [...inRange].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  list.innerHTML = "";
  sorted.forEach((tx) => {
    const row = document.createElement("div");
    row.className = "glass rounded-lg p-3 border border-white/10 flex items-center justify-between";
    const pot = StatementState.potsByCashbook[StatementState.currentCashbookId]?.[tx.potId];
    row.innerHTML = `
      <div>
        <div class="font-semibold text-white">${tx.date} · ${pot?.emoji || "📦"} ${pot?.name || tx.potId || "Pot"}</div>
        <div class="text-slate-300 text-xs">${tx.note || tx.category || "Muamala"}</div>
      </div>
      <div class="${tx.direction === "in" ? "text-emerald-300" : "text-rose-300"} font-bold">
        ${tx.direction === "in" ? "+" : "-"}${formatCurrency(tx.amount || 0)}
      </div>
    `;
    list.appendChild(row);
  });
}

function renderSummaryByPot(inRange) {
  const holder = document.getElementById("stmt-pot-summary");
  if (!holder) return;
  const totals = {};
  inRange.forEach((tx) => {
    const key = tx.potId || "other";
    if (!totals[key]) totals[key] = 0;
    totals[key] += tx.direction === "in" ? Number(tx.amount) || 0 : -Number(tx.amount || 0);
  });
  holder.innerHTML = Object.keys(totals)
    .map((key) => {
      const pot = StatementState.potsByCashbook[StatementState.currentCashbookId]?.[key];
      return `<div class="${totals[key] >= 0 ? "text-emerald-200" : "text-rose-200"}">${pot?.emoji || "📦"} ${pot?.name || key}: ${formatCurrency(totals[key])}</div>`;
    })
    .join("");
}

function renderSummaryByCategory(inRange) {
  const holder = document.getElementById("stmt-cat-summary");
  if (!holder) return;
  const totals = {};
  inRange.forEach((tx) => {
    const key = tx.category || "Nyingine";
    if (!totals[key]) totals[key] = 0;
    totals[key] += tx.direction === "in" ? Number(tx.amount) || 0 : -Number(tx.amount || 0);
  });
  holder.innerHTML = Object.keys(totals)
    .map((key) => `<div class="${totals[key] >= 0 ? "text-emerald-200" : "text-rose-200"}">${key}: ${formatCurrency(totals[key])}</div>`)
    .join("");
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function formatYMD(d) {
  const date = d instanceof Date ? d : new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatCurrency(amount) {
  const c = StatementState.settings.currency || "TZS";
  const rounded = Math.round(Number(amount) || 0);
  const withSep = rounded.toLocaleString("en-KE");
  if (c === "TZS") return `TSh ${withSep}`;
  if (c === "KES") return `KSh ${withSep}`;
  return `${c} ${withSep}`;
}
