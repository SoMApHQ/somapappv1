const PlannerState = {
  mode: "guest",
  uid: null,
  month: new Date(),
  currentCashbookId: "default",
  cashbooks: {},
  potsByCashbook: {},
  transactionsByCashbook: {},
  settings: {
    currency: "TZS",
    startOfWeek: "monday"
  }
};

document.addEventListener("DOMContentLoaded", initPlanner);

async function initPlanner() {
  await hydrateData();
  bindPlannerHandlers();
  renderPlanner();
}

async function hydrateData() {
  const user = window.firebase?.auth?.().currentUser || null;
  if (user) {
    PlannerState.mode = "firebase";
    PlannerState.uid = user.uid;
    await loadFromFirebasePlanner(user.uid);
  } else {
    loadFromLocalStoragePlanner();
  }
  ensureDefaultPlanner();
}

async function loadFromFirebasePlanner(uid) {
  const snapshot = await firebase.database().ref("society/" + uid).once("value");
  const data = snapshot.val() || {};
  const cashbooks = data.cashbooks || {};
  PlannerState.cashbooks = {};
  PlannerState.potsByCashbook = {};
  PlannerState.transactionsByCashbook = {};
  PlannerState.settings = { ...PlannerState.settings, ...(data.settings || {}) };
  Object.keys(cashbooks).forEach((cbId) => {
    const cb = cashbooks[cbId];
    PlannerState.cashbooks[cbId] = cb.meta || { id: cbId, name: cbId, currency: PlannerState.settings.currency };
    PlannerState.potsByCashbook[cbId] = cb.pots || {};
    PlannerState.transactionsByCashbook[cbId] = cb.transactions || {};
  });
  PlannerState.currentCashbookId =
    data.settings?.lastOpenedCashbookId || data.settings?.defaultCashbookId || "default";
}

function loadFromLocalStoragePlanner() {
  const raw = localStorage.getItem("society_money_memory_v1");
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    PlannerState.cashbooks = data.cashbooks || {};
    PlannerState.potsByCashbook = data.potsByCashbook || {};
    PlannerState.transactionsByCashbook = data.transactionsByCashbook || {};
    PlannerState.settings = { ...PlannerState.settings, ...(data.settings || {}) };
    PlannerState.currentCashbookId = data.currentCashbookId || "default";
  } catch (e) {
    console.warn("Failed to read planner cache", e);
  }
}

function ensureDefaultPlanner() {
  if (!PlannerState.cashbooks["default"]) {
    PlannerState.cashbooks["default"] = {
      id: "default",
      name: "Familia",
      emoji: "🏠",
      currency: PlannerState.settings.currency
    };
  }
  if (!PlannerState.potsByCashbook["default"]) {
    PlannerState.potsByCashbook["default"] = {
      nyumbani: { id: "nyumbani", name: "Nyumbani", emoji: "🏠" },
      shule: { id: "shule", name: "Shule", emoji: "🏫" },
      biashara: { id: "biashara", name: "Biashara", emoji: "💼" },
      mj: { id: "mj", name: "MJ", emoji: "🧒" },
      gari: { id: "gari", name: "Gari", emoji: "🚗" },
      akiba: { id: "akiba", name: "Akiba", emoji: "💰" }
    };
  }
}

function bindPlannerHandlers() {
  const prev = document.getElementById("prev-month");
  const next = document.getElementById("next-month");
  prev?.addEventListener("click", () => {
    PlannerState.month = new Date(PlannerState.month.getFullYear(), PlannerState.month.getMonth() - 1, 1);
    renderPlanner();
  });
  next?.addEventListener("click", () => {
    PlannerState.month = new Date(PlannerState.month.getFullYear(), PlannerState.month.getMonth() + 1, 1);
    renderPlanner();
  });
  const cbSelect = document.getElementById("planner-cashbook");
  if (cbSelect) {
    cbSelect.addEventListener("change", () => {
      PlannerState.currentCashbookId = cbSelect.value;
      renderPlanner();
    });
  }
  document.getElementById("split-calc")?.addEventListener("click", calcSplitDays);
  document.getElementById("pots-calc")?.addEventListener("click", calcPots);
  document.getElementById("goal-calc")?.addEventListener("click", calcGoal);
}

function renderPlanner() {
  renderCashbookSelect();
  renderMonthLabel();
  renderCalendar();
}

function renderCashbookSelect() {
  const sel = document.getElementById("planner-cashbook");
  if (!sel) return;
  sel.innerHTML = "";
  Object.values(PlannerState.cashbooks).forEach((cb) => {
    const opt = document.createElement("option");
    opt.value = cb.id;
    opt.textContent = `${cb.emoji || "📒"} ${cb.name}`;
    if (cb.id === PlannerState.currentCashbookId) opt.selected = true;
    sel.appendChild(opt);
  });
}

function renderMonthLabel() {
  const label = document.getElementById("planner-month");
  if (!label) return;
  label.textContent = PlannerState.month.toLocaleDateString("sw-TZ", { month: "long", year: "numeric" });
}

function renderCalendar() {
  const holder = document.getElementById("planner-calendar");
  if (!holder) return;
  holder.innerHTML = "";
  const monthStart = new Date(PlannerState.month.getFullYear(), PlannerState.month.getMonth(), 1);
  const monthEnd = new Date(PlannerState.month.getFullYear(), PlannerState.month.getMonth() + 1, 0);
  const startDay = startOfWeek(monthStart, PlannerState.settings.startOfWeek);
  const daysToRender = Math.ceil((monthEnd - startDay) / (1000 * 60 * 60 * 24)) + 1;
  for (let i = 0; i < daysToRender; i++) {
    const day = new Date(startDay);
    day.setDate(startDay.getDate() + i);
    const isOtherMonth = day.getMonth() !== PlannerState.month.getMonth();
    const net = netForDate(formatYMD(day));
    const cell = document.createElement("div");
    cell.className =
      "rounded-xl p-2 border border-white/10 text-xs flex flex-col gap-1 " +
      (isOtherMonth ? "text-slate-500 bg-white/5" : "bg-white/10 text-slate-100");
    cell.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="font-semibold">${day.getDate()}</span>
        <span class="${net >= 0 ? "text-emerald-300" : "text-rose-300"} font-bold">${net === 0 ? "–" : formatCurrency(net)}</span>
      </div>
    `;
    holder.appendChild(cell);
  }
}

function netForDate(ymd) {
  const txns = Object.values(PlannerState.transactionsByCashbook[PlannerState.currentCashbookId] || {});
  const todays = txns.filter((t) => t.date === ymd);
  return todays.reduce((s, t) => s + (t.direction === "in" ? Number(t.amount) || 0 : -Number(t.amount || 0)), 0);
}

function calcSplitDays() {
  const amt = Number(document.getElementById("split-amount").value || 0);
  const start = document.getElementById("split-start").value;
  const end = document.getElementById("split-end").value;
  const out = document.getElementById("split-output");
  if (!start || !end || amt === 0) {
    out.textContent = "Weka tarehe na kiasi.";
    return;
  }
  const days = Math.max(1, Math.round((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24)) + 1);
  const perDay = amt / days;
  out.textContent = `Siku ${days}: Kila siku ${formatCurrency(perDay)}`;
}

function calcPots() {
  const raw = document.getElementById("pots-input").value;
  const out = document.getElementById("pots-output");
  if (!raw.trim()) {
    out.textContent = "Andika uwiano wa pots.";
    return;
  }
  const entries = raw.split(",").map((p) => p.trim()).filter(Boolean);
  const pairs = entries.map((item) => {
    const [name, val] = item.split("=");
    return { name: name?.trim(), percent: Number(val) || 0 };
  });
  const amount = Number(document.getElementById("split-amount").value || 0);
  const totalPercent = pairs.reduce((s, p) => s + p.percent, 0) || 100;
  const calcFrom = amount;
  const lines = pairs
    .map((p) => {
      const portion = (p.percent / totalPercent) * calcFrom;
      return `${p.name}: ${formatCurrency(portion)}`;
    })
    .join("<br>");
  out.innerHTML = lines;
}

function calcGoal() {
  const target = Number(document.getElementById("goal-target").value || 0);
  const deadline = document.getElementById("goal-deadline").value;
  const current = Number(document.getElementById("goal-current").value || 0);
  const out = document.getElementById("goal-output");
  if (!deadline || target <= 0) {
    out.textContent = "Weka lengo na tarehe ya mwisho.";
    return;
  }
  const remaining = target - current;
  const daysLeft = Math.max(1, Math.round((new Date(deadline) - new Date()) / (1000 * 60 * 60 * 24)));
  const perDay = remaining / daysLeft;
  const perWeek = perDay * 7;
  const perMonth = perDay * 30;
  out.textContent = `Unahitaji ${formatCurrency(perDay)} kwa siku, ${formatCurrency(perWeek)} kwa wiki, ${formatCurrency(perMonth)} kwa mwezi.`;
}

function formatYMD(d) {
  const date = d instanceof Date ? d : new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfWeek(d, start = "monday") {
  const day = d.getDay();
  const diff = start === "sunday" ? -day : day === 0 ? -6 : 1 - day;
  const res = new Date(d);
  res.setDate(d.getDate() + diff);
  return res;
}

function formatCurrency(amount) {
  const c = PlannerState.settings.currency || "TZS";
  const rounded = Math.round(Number(amount) || 0);
  const withSep = rounded.toLocaleString("en-KE");
  if (c === "TZS") return `TSh ${withSep}`;
  if (c === "KES") return `KSh ${withSep}`;
  return `${c} ${withSep}`;
}
