const db = firebase.database();
let CASHBOOK_USER = null;

const cleanKey = (n) => (n || "").toLowerCase().replace(/[^a-z0-9]/g, "_");
const hash = (str) => btoa(unescape(encodeURIComponent(str || ""))).replace(/=/g, "");

async function signInFlow(name, pass, repeat) {
  const key = cleanKey(name);
  if (!key || !pass) {
    alert("Weka jina na nenosiri kwanza.");
    return false;
  }
  const ref = db.ref("/cashbookUsers/" + key);
  const snap = await ref.once("value");
  if (snap.exists()) {
    const user = snap.val();
    if (user.passwordHash === hash(pass)) {
      CASHBOOK_USER = key;
      window.CASHBOOK_USER = key;
      localStorage.setItem("cashbook_user", key);
      return true;
    } else {
      alert("Wrong password");
      return false;
    }
  } else {
    if (pass !== repeat) {
      alert("Passwords do not match");
      return false;
    }
    const fav = prompt("Set recovery question: Who is your favourite family member?");
    await ref.set({ passwordHash: hash(pass), recovery: fav || "" });
    CASHBOOK_USER = key;
    window.CASHBOOK_USER = key;
    localStorage.setItem("cashbook_user", key);
    return true;
  }
}

async function recoverPassword(name, ans) {
  const key = cleanKey(name);
  const snap = await db.ref("/cashbookUsers/" + key).once("value");
  if (snap.exists() && (snap.val().recovery || "").toLowerCase() === (ans || "").toLowerCase()) {
    alert("Your password cannot be shown, but you can reset now.");
    await db.ref("/cashbookUsers/" + key).remove();
  } else {
    alert("Incorrect answer.");
  }
}

function userPath(sub) {
  const base = `/cashbook/${CASHBOOK_USER || "guest"}`;
  return sub ? `${base}/${sub}` : base;
}

(function () {
  const MoneyMemoryState = {
    mode: "guest",
    uid: null,
    initialized: false,
    currentCashbookId: "default",
    cashbooks: {},
    potsByCashbook: {},
    transactionsByCashbook: {},
    budgetsByCashbook: {},
    settings: {
      language: "sw",
      currency: "TZS",
      timezone: "Africa/Nairobi",
      startOfWeek: "monday",
      lastOpenedCashbookId: "default",
      defaultCashbookId: "default"
    },
    filters: {
      period: "month",
      from: null,
      to: null,
      potId: "all",
      direction: "both",
      search: ""
    },
    ui: {
      activeTab: "summary",
      isLoading: false,
      error: null
    }
  };

  async function initMoneyMemory() {
    MoneyMemoryState.ui.isLoading = true;
    renderLoading();
    try {
      if (CASHBOOK_USER) {
        MoneyMemoryState.mode = "firebase";
        MoneyMemoryState.uid = CASHBOOK_USER;
        await loadFromFirebase();
      } else {
        MoneyMemoryState.mode = "guest";
        loadFromLocalStorage();
      }

      if (!MoneyMemoryState.currentCashbookId) {
        MoneyMemoryState.currentCashbookId = "default";
      }
      ensureDefaultCashbook();
      bindUIHandlers();
      renderAll();
      MoneyMemoryState.initialized = true;
    } catch (err) {
      console.error("Init Money Memory failed", err);
      MoneyMemoryState.ui.error = "Imeshindikana kupakia data ya pesa.";
      renderError();
    } finally {
      MoneyMemoryState.ui.isLoading = false;
      setModePill();
    }
  }

async function loadFromFirebase() {
    const snapshot = await db.ref(userPath("")).once("value");
    const data = snapshot.val() || {};
    const cashbooks = data.cashbooks || {};
    MoneyMemoryState.cashbooks = {};
    MoneyMemoryState.potsByCashbook = {};
    MoneyMemoryState.transactionsByCashbook = {};
    MoneyMemoryState.budgetsByCashbook = {};
    MoneyMemoryState.settings = {
      ...MoneyMemoryState.settings,
      ...(data.settings || {})
    };

    Object.keys(cashbooks).forEach((cbId) => {
      const cb = cashbooks[cbId];
      MoneyMemoryState.cashbooks[cbId] = cb.meta || {
        id: cbId,
        name: cbId,
        currency: MoneyMemoryState.settings.currency
      };
      MoneyMemoryState.potsByCashbook[cbId] = cb.pots || {};
      MoneyMemoryState.transactionsByCashbook[cbId] = cb.transactions || {};
      MoneyMemoryState.budgetsByCashbook[cbId] = cb.budgets || {};
    });

    MoneyMemoryState.currentCashbookId =
      data.settings?.lastOpenedCashbookId ||
      data.settings?.defaultCashbookId ||
      "default";
  }

  function loadFromLocalStorage() {
    const raw = localStorage.getItem("society_money_memory_v1");
    if (!raw) {
      ensureDefaultCashbook();
      return;
    }
    try {
      const data = JSON.parse(raw);
      Object.assign(MoneyMemoryState, {
        ...MoneyMemoryState,
        ...data
      });
    } catch (e) {
      console.warn("Failed to parse local cache", e);
      ensureDefaultCashbook();
    }
  }

  function saveToLocalStorage() {
    const snapshot = {
      mode: MoneyMemoryState.mode,
      currentCashbookId: MoneyMemoryState.currentCashbookId,
      cashbooks: MoneyMemoryState.cashbooks,
      potsByCashbook: MoneyMemoryState.potsByCashbook,
      transactionsByCashbook: MoneyMemoryState.transactionsByCashbook,
      budgetsByCashbook: MoneyMemoryState.budgetsByCashbook,
      settings: MoneyMemoryState.settings
    };
    localStorage.setItem("society_money_memory_v1", JSON.stringify(snapshot));
  }

  function ensureDefaultCashbook() {
    if (!MoneyMemoryState.cashbooks["default"]) {
      MoneyMemoryState.cashbooks["default"] = {
        id: "default",
        name: "Familia",
        emoji: "🏠",
        color: "#1d4ed8",
        startingBalance: 0,
        currency: MoneyMemoryState.settings.currency
      };
    }
    if (!MoneyMemoryState.potsByCashbook["default"]) {
      MoneyMemoryState.potsByCashbook["default"] = {
        nyumbani: { id: "nyumbani", name: "Nyumbani", emoji: "🏠" },
        shule: { id: "shule", name: "Shule", emoji: "🏫" },
        biashara: { id: "biashara", name: "Biashara", emoji: "💼" },
        mj: { id: "mj", name: "MJ", emoji: "🧒" },
        gari: { id: "gari", name: "Gari", emoji: "🚗" },
        akiba: { id: "akiba", name: "Akiba", emoji: "💰" }
      };
    }
  }

  function bindUIHandlers() {
    document.querySelectorAll("[data-mm-tab]").forEach((btn) => {
      btn.addEventListener("click", () => setActiveTab(btn.getAttribute("data-mm-tab")));
    });

    const menuBtn = document.getElementById("mm-menu-btn");
    const menu = document.getElementById("mm-menu");
    if (menuBtn && menu) {
      menuBtn.addEventListener("click", () => menu.classList.toggle("hidden"));
      document.addEventListener("click", (e) => {
        if (!menu.contains(e.target) && !menuBtn.contains(e.target)) {
          menu.classList.add("hidden");
        }
      });
    }

    const cashbookSelect = document.getElementById("mm-cashbook-select");
    if (cashbookSelect) {
      cashbookSelect.addEventListener("change", () => {
        MoneyMemoryState.currentCashbookId = cashbookSelect.value;
        MoneyMemoryState.settings.lastOpenedCashbookId = cashbookSelect.value;
        saveLastOpenedCashbook();
        renderAll();
      });
    }

    const addTxForm = document.getElementById("mm-add-transaction");
    if (addTxForm) {
      addTxForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const direction = addTxForm.elements["direction"].value;
        const amount = Number(document.getElementById("mm-amount").value || 0);
        const date = document.getElementById("mm-date").value || formatYMD(new Date());
        const time = document.getElementById("mm-time").value || "12:00";
        const potId = (document.getElementById("mm-pot").value || "nyumbani").trim();
        const category = (document.getElementById("mm-category").value || "").trim();
        const note = (document.getElementById("mm-note").value || "").trim();
        const method = document.getElementById("mm-method").value || "cash";
        const tx = {
          direction,
          amount,
          currency: MoneyMemoryState.cashbooks[MoneyMemoryState.currentCashbookId]?.currency || MoneyMemoryState.settings.currency,
          potId,
          category,
          note,
          method,
          date,
          time,
          timestamp: Date.now(),
          createdAt: new Date().toISOString(),
          createdBy: MoneyMemoryState.uid || "guest",
          cashbookId: MoneyMemoryState.currentCashbookId
        };
        saveTransaction(tx);
        addTxForm.reset();
        document.getElementById("mm-date").value = formatYMD(new Date());
        document.getElementById("mm-time").value = formatTimeHM(new Date());
        renderAll();
      });
    }

    const addBudgetBtn = document.getElementById("mm-add-budget");
    if (addBudgetBtn) {
      addBudgetBtn.addEventListener("click", () => {
        const name = prompt("Jina la bajeti?");
        if (!name) return;
        const plannedAmount = Number(prompt("Kiasi cha bajeti?") || 0);
        const periodStart = prompt("Anza (YYYY-MM-DD)", formatYMD(startOfMonth(new Date())));
        const periodEnd = prompt("Mwisho (YYYY-MM-DD)", formatYMD(endOfMonth(new Date())));
        const potId = prompt("Pot (mf. nyumbani)") || "nyumbani";
        const budgetId = "bdg_" + Date.now();
        const cbId = MoneyMemoryState.currentCashbookId;
        if (!MoneyMemoryState.budgetsByCashbook[cbId]) {
          MoneyMemoryState.budgetsByCashbook[cbId] = {};
        }
        MoneyMemoryState.budgetsByCashbook[cbId][budgetId] = {
          id: budgetId,
          cashbookId: cbId,
          potId,
          name,
          periodStart,
          periodEnd,
          plannedAmount
        };
        persistState();
        renderBudgets();
      });
    }

    const addPotBtn = document.getElementById("mm-add-pot");
    if (addPotBtn) {
      addPotBtn.addEventListener("click", () => {
        const name = prompt("Jina la pot? (mf. Nyumbani)");
        if (!name) return;
        const emoji = prompt("Emoji (hiari)", "💡");
        const id = name.toLowerCase().replace(/\s+/g, "-");
        const cbId = MoneyMemoryState.currentCashbookId;
        if (!MoneyMemoryState.potsByCashbook[cbId]) {
          MoneyMemoryState.potsByCashbook[cbId] = {};
        }
        MoneyMemoryState.potsByCashbook[cbId][id] = {
          id,
          name,
          emoji: emoji || ""
        };
        persistState();
        renderPots();
        renderTransactions();
      });
    }
  }

  function setActiveTab(tab) {
    MoneyMemoryState.ui.activeTab = tab;
    document.querySelectorAll("[data-mm-tab]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-mm-tab") === tab);
    });
    document.querySelectorAll("section[id^='tab-']").forEach((section) => {
      section.classList.toggle("hidden", section.id !== `tab-${tab}`);
    });
  }

  function renderAll() {
    renderCashbookOptions();
    setModePill();
    renderSummaryCards();
    renderTransactions();
    renderBudgets();
    renderTimeline();
    renderPots();
    renderTodaySummary();
  }

  function renderCashbookOptions() {
    const select = document.getElementById("mm-cashbook-select");
    if (!select) return;
    select.innerHTML = "";
    Object.values(MoneyMemoryState.cashbooks).forEach((cb) => {
      const opt = document.createElement("option");
      opt.value = cb.id;
      opt.textContent = `${cb.emoji || "📒"} ${cb.name}`;
      if (cb.id === MoneyMemoryState.currentCashbookId) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function setModePill() {
    const pill = document.getElementById("mm-mode-pill");
    if (!pill) return;
    if (MoneyMemoryState.mode === "firebase" && MoneyMemoryState.uid) {
      pill.textContent = "Logged in";
      pill.classList.add("bg-emerald-500/20");
    } else {
      pill.textContent = "Guest mode";
    }
  }

  function computeAggregates() {
    const cbId = MoneyMemoryState.currentCashbookId;
    const txMap = MoneyMemoryState.transactionsByCashbook[cbId] || {};
    const txns = Object.values(txMap);

    const now = new Date();
    const todayYMD = formatYMD(now);
    const startMonthYMD = formatYMD(startOfMonth(now));
    const startWeekYMD = formatYMD(startOfWeek(now, MoneyMemoryState.settings.startOfWeek));

    let totalIn = 0,
      totalOut = 0,
      monthIn = 0,
      monthOut = 0,
      weekIn = 0,
      weekOut = 0,
      dayIn = 0,
      dayOut = 0;

    for (const tx of txns) {
      const amt = Number(tx.amount) || 0;
      if (!tx.date) continue;
      const isIn = tx.direction === "in";
      if (isIn) totalIn += amt;
      else totalOut += amt;

      if (tx.date >= startMonthYMD) {
        if (isIn) monthIn += amt;
        else monthOut += amt;
      }
      if (tx.date >= startWeekYMD) {
        if (isIn) weekIn += amt;
        else weekOut += amt;
      }
      if (tx.date === todayYMD) {
        if (isIn) dayIn += amt;
        else dayOut += amt;
      }
    }

    const opening = MoneyMemoryState.cashbooks[cbId]?.startingBalance || 0;
    const net = opening + totalIn - totalOut;

    return {
      opening,
      totalIn,
      totalOut,
      net,
      monthIn,
      monthOut,
      weekIn,
      weekOut,
      dayIn,
      dayOut
    };
  }

  function renderSummaryCards() {
    const a = computeAggregates();
    setText("mm-net-balance", formatCurrency(a.net));
    setText("mm-income-month-main", formatCurrency(a.monthIn));
    setText("mm-income-month-sub", `Wiki hii: ${formatCurrency(a.weekIn)} • Leo: ${formatCurrency(a.dayIn)}`);
    setText("mm-expense-month-main", formatCurrency(a.monthOut));
    setText("mm-expense-month-sub", `Wiki hii: ${formatCurrency(a.weekOut)} • Leo: ${formatCurrency(a.dayOut)}`);
  }

  function renderTodaySummary() {
    const txns = getCurrentTransactions();
    const today = formatYMD(new Date());
    const todays = txns.filter((tx) => tx.date === today);
    if (todays.length === 0) {
      setText("mm-today-quick", "Hakuna miamala leo bado.");
      return;
    }
    const inSum = todays.filter((t) => t.direction === "in").reduce((s, t) => s + Number(t.amount || 0), 0);
    const outSum = todays.filter((t) => t.direction === "out").reduce((s, t) => s + Number(t.amount || 0), 0);
    setText("mm-today-quick", `Mapato: ${formatCurrency(inSum)} • Matumizi: ${formatCurrency(outSum)} • Net: ${formatCurrency(inSum - outSum)}`);
    const potTotals = {};
    todays.forEach((t) => {
      const amt = Number(t.amount) || 0;
      potTotals[t.potId || "nyumbani"] = (potTotals[t.potId || "nyumbani"] || 0) + (t.direction === "in" ? amt : -amt);
    });
    const topPots = Object.entries(potTotals)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 3);
    const holder = document.getElementById("mm-top-pots");
    if (holder) {
      holder.innerHTML = "";
      topPots.forEach(([id, val]) => {
        const pot = getPot(id);
        const row = document.createElement("div");
        row.className = "flex items-center justify-between text-sm text-slate-200";
        row.innerHTML = `<span>${pot?.emoji || "📦"} ${pot?.name || id}</span><span class="${val < 0 ? "text-rose-300" : "text-emerald-300"}">${formatCurrency(val)}</span>`;
        holder.appendChild(row);
      });
    }
  }

  function renderTransactions() {
    const txns = getCurrentTransactions().sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.timestamp || 0) - (a.timestamp || 0));
    const list = document.getElementById("mm-transaction-list");
    const dateInput = document.getElementById("mm-date");
    const timeInput = document.getElementById("mm-time");
    if (dateInput && !dateInput.value) dateInput.value = formatYMD(new Date());
    if (timeInput && !timeInput.value) timeInput.value = formatTimeHM(new Date());
    if (!list) return;
    if (txns.length === 0) {
      list.innerHTML = `<p class="text-slate-400">Hakuna miamala bado.</p>`;
      return;
    }
    const groups = {};
    txns.forEach((tx) => {
      if (!groups[tx.date]) groups[tx.date] = [];
      groups[tx.date].push(tx);
    });
    const orderedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));
    list.innerHTML = "";
    orderedDates.forEach((date) => {
      const section = document.createElement("div");
      section.className = "bg-white/5 rounded-xl border border-white/10";
      const header = document.createElement("div");
      header.className = "px-3 py-2 border-b border-white/10 text-sm text-slate-200";
      header.textContent = formatFriendlyDate(date);
      section.appendChild(header);
      const inner = document.createElement("div");
      inner.className = "divide-y divide-white/10";
      groups[date].forEach((tx) => {
        const row = document.createElement("div");
        row.className = "px-3 py-2 flex items-center justify-between text-sm text-slate-100";
        const pot = getPot(tx.potId);
        row.innerHTML = `
          <div>
            <div class="font-semibold">${pot?.emoji || "📦"} ${pot?.name || tx.potId || "Pot"}</div>
            <div class="text-slate-300 text-xs">${tx.note || tx.category || "Muamala"}</div>
            <div class="text-slate-400 text-xs">${tx.time || ""}</div>
          </div>
          <div class="${tx.direction === "in" ? "text-emerald-300" : "text-rose-300"} font-bold">
            ${tx.direction === "in" ? "+" : "-"}${formatCurrency(tx.amount || 0)}
          </div>
        `;
        inner.appendChild(row);
      });
      section.appendChild(inner);
      list.appendChild(section);
    });
  }

  function renderBudgets() {
    const holder = document.getElementById("mm-budgets");
    if (!holder) return;
    const cbId = MoneyMemoryState.currentCashbookId;
    const budgets = MoneyMemoryState.budgetsByCashbook[cbId] || {};
    const values = Object.values(budgets);
    if (values.length === 0) {
      holder.innerHTML = `<p class="text-slate-400">Hakuna bajeti imeongezwa.</p>`;
      return;
    }
    holder.innerHTML = "";
    values.forEach((b) => {
      const spent = computeBudgetSpent(b);
      const remaining = (Number(b.plannedAmount) || 0) - spent;
      const progress = Math.min(100, Math.round((spent / (b.plannedAmount || 1)) * 100));
      const pot = getPot(b.potId);
      const card = document.createElement("article");
      card.className = "glass rounded-xl p-4 border border-white/10";
      card.innerHTML = `
        <div class="flex items-center justify-between">
          <div>
            <p class="text-xs text-slate-400 uppercase tracking-wide">${pot?.emoji || "📦"} ${pot?.name || b.potId}</p>
            <h4 class="text-lg font-bold text-white">${b.name}</h4>
          </div>
          <span class="text-xs pill px-3 py-1 rounded-full text-slate-200">${b.periodStart} → ${b.periodEnd}</span>
        </div>
        <div class="mt-3 text-sm text-slate-200">Planned: ${formatCurrency(b.plannedAmount || 0)}</div>
        <div class="text-sm text-slate-200">Spent: ${formatCurrency(spent)} · Baki: ${formatCurrency(remaining)}</div>
        <div class="w-full bg-white/10 rounded-full h-2 mt-2 overflow-hidden">
          <div class="${progress > 100 ? "bg-rose-400" : "bg-emerald-400"} h-2" style="width:${Math.min(progress, 100)}%"></div>
        </div>
      `;
      holder.appendChild(card);
    });
  }

  function renderTimeline() {
    const holder = document.getElementById("mm-timeline");
    if (!holder) return;
    const txns = getCurrentTransactions();
    if (txns.length === 0) {
      holder.innerHTML = `<p class="text-slate-400">Hakuna data ya timeline bado.</p>`;
      return;
    }
    const groups = {};
    txns.forEach((tx) => {
      if (!groups[tx.date]) groups[tx.date] = [];
      groups[tx.date].push(tx);
    });
    const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a));
    holder.innerHTML = "";
    dates.forEach((d) => {
      const inSum = groups[d].filter((t) => t.direction === "in").reduce((s, t) => s + Number(t.amount || 0), 0);
      const outSum = groups[d].filter((t) => t.direction === "out").reduce((s, t) => s + Number(t.amount || 0), 0);
      const row = document.createElement("div");
      row.className = "glass rounded-xl p-3 border border-white/10 flex items-center justify-between text-sm text-slate-100";
      row.innerHTML = `
        <div>
          <div class="font-semibold">${formatFriendlyDate(d)}</div>
          <div class="text-slate-400 text-xs">In ${formatCurrency(inSum)} • Out ${formatCurrency(outSum)}</div>
        </div>
        <div class="${inSum - outSum >= 0 ? "text-emerald-300" : "text-rose-300"} font-bold">${formatCurrency(inSum - outSum)}</div>
      `;
      holder.appendChild(row);
    });
  }

  function renderPots() {
    const holder = document.getElementById("mm-pots");
    if (!holder) return;
    const cbId = MoneyMemoryState.currentCashbookId;
    const pots = MoneyMemoryState.potsByCashbook[cbId] || {};
    const txns = getCurrentTransactions();
    const potTotals = {};
    Object.values(pots).forEach((p) => (potTotals[p.id] = 0));
    txns.forEach((tx) => {
      const amt = Number(tx.amount) || 0;
      const delta = tx.direction === "in" ? amt : -amt;
      potTotals[tx.potId || "nyumbani"] = (potTotals[tx.potId || "nyumbani"] || 0) + delta;
    });
    const values = Object.values(pots);
    if (values.length === 0) {
      holder.innerHTML = `<p class="text-slate-400">Ongeza pot mpya kuanza kufuatilia.</p>`;
      return;
    }
    holder.innerHTML = "";
    values.forEach((p) => {
      const card = document.createElement("article");
      card.className = "glass rounded-xl p-4 border border-white/10";
      const current = potTotals[p.id] || 0;
      card.innerHTML = `
        <div class="flex items-center justify-between">
          <div class="text-lg font-bold text-white">${p.emoji || "📦"} ${p.name}</div>
          ${p.targetAmount ? `<span class="text-xs pill px-2 py-1 rounded-full text-slate-200">Lengo: ${formatCurrency(p.targetAmount)}</span>` : ""}
        </div>
        <p class="text-sm text-slate-300 mt-1">Salio: ${formatCurrency(current)}</p>
        ${p.targetAmount ? `<div class="w-full bg-white/10 rounded-full h-2 mt-2 overflow-hidden"><div class="bg-emerald-400 h-2" style="width:${Math.min(100, Math.round((current / p.targetAmount) * 100))}%"></div></div>` : ""}
      `;
      holder.appendChild(card);
    });
  }

  function getCurrentTransactions() {
    const cbId = MoneyMemoryState.currentCashbookId;
    const txMap = MoneyMemoryState.transactionsByCashbook[cbId] || {};
    return Object.values(txMap);
  }

  function getPot(potId) {
    const cbId = MoneyMemoryState.currentCashbookId;
    return MoneyMemoryState.potsByCashbook[cbId]?.[potId];
  }

  function computeBudgetSpent(budget) {
    const txns = getCurrentTransactions();
    return txns
      .filter((tx) => tx.direction === "out" && tx.potId === budget.potId && tx.date >= budget.periodStart && tx.date <= budget.periodEnd)
      .reduce((s, tx) => s + Number(tx.amount || 0), 0);
  }

  function saveTransaction(tx) {
    const cbId = MoneyMemoryState.currentCashbookId;
    if (MoneyMemoryState.mode === "firebase" && MoneyMemoryState.uid) {
      const ref = db.ref(`${userPath("cashbooks")}/${cbId}/transactions`).push();
      const id = ref.key;
      const fullTx = { ...tx, id };
      ref.set(fullTx);
      if (!MoneyMemoryState.transactionsByCashbook[cbId]) {
        MoneyMemoryState.transactionsByCashbook[cbId] = {};
      }
      MoneyMemoryState.transactionsByCashbook[cbId][id] = fullTx;
      saveLastOpenedCashbook();
    } else {
      const id = "tx_" + Date.now();
      const fullTx = { ...tx, id };
      if (!MoneyMemoryState.transactionsByCashbook[cbId]) {
        MoneyMemoryState.transactionsByCashbook[cbId] = {};
      }
      MoneyMemoryState.transactionsByCashbook[cbId][id] = fullTx;
      saveToLocalStorage();
    }
  }

  function saveLastOpenedCashbook() {
    MoneyMemoryState.settings.lastOpenedCashbookId = MoneyMemoryState.currentCashbookId;
    if (MoneyMemoryState.mode === "firebase" && MoneyMemoryState.uid) {
      db.ref(`${userPath("settings")}/lastOpenedCashbookId`).set(MoneyMemoryState.currentCashbookId);
    } else {
      saveToLocalStorage();
    }
  }

  function persistState() {
    if (MoneyMemoryState.mode === "firebase" && MoneyMemoryState.uid) {
      const cbId = MoneyMemoryState.currentCashbookId;
      const updates = {};
      updates[`${userPath("cashbooks")}/${cbId}/pots`] = MoneyMemoryState.potsByCashbook[cbId] || {};
      updates[`${userPath("cashbooks")}/${cbId}/budgets`] = MoneyMemoryState.budgetsByCashbook[cbId] || {};
      updates[`${userPath("cashbooks")}/${cbId}/meta`] = MoneyMemoryState.cashbooks[cbId];
      updates[userPath("settings")] = MoneyMemoryState.settings;
      db.ref().update(updates);
    } else {
      saveToLocalStorage();
    }
  }

  function renderLoading() {
    const list = document.getElementById("mm-transaction-list");
    if (list) list.textContent = "Loading...";
  }

  function renderError() {
    const list = document.getElementById("mm-transaction-list");
    if (list) list.textContent = MoneyMemoryState.ui.error || "Hitilafu imetokea.";
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function formatCurrency(amount) {
    const c = MoneyMemoryState.settings.currency || "TZS";
    const rounded = Math.round(Number(amount) || 0);
    const withSep = rounded.toLocaleString("en-KE");
    if (c === "TZS") return `TSh ${withSep}`;
    if (c === "KES") return `KSh ${withSep}`;
    return `${c} ${withSep}`;
  }

  function formatYMD(d) {
    const date = d instanceof Date ? d : new Date(d);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function formatTimeHM(d) {
    const date = d instanceof Date ? d : new Date(d);
    const h = String(date.getHours()).padStart(2, "0");
    const m = String(date.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }

  function startOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  function endOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0);
  }

  function startOfWeek(d, start = "monday") {
    const day = d.getDay(); // 0=Sun
    const diff = start === "sunday" ? -day : day === 0 ? -6 : 1 - day;
    const res = new Date(d);
    res.setDate(d.getDate() + diff);
    return res;
  }

  function formatFriendlyDate(ymd) {
    const parts = ymd.split("-");
    if (parts.length !== 3) return ymd;
    const [y, m, d] = parts.map((p) => Number(p));
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString("en-KE", { day: "numeric", month: "short" });
  }

  window.initCashbook = function () {
    if (MoneyMemoryState.initialized) return;
    initMoneyMemory();
  };
})();

window.addEventListener("load", () => {
  const overlay = document.getElementById("signin-overlay");
  const signinBox = document.getElementById("signin-box");
  const recoverBox = document.getElementById("recover-box");
  const cashName = document.getElementById("cashName");
  const cashPass = document.getElementById("cashPass");
  const cashPassRepeat = document.getElementById("cashPassRepeat");
  const recoveryInput = document.getElementById("recoveryInput");
  const signinBtn = document.getElementById("signinBtn");
  const forgotLink = document.getElementById("forgotLink");
  const recoverBtn = document.getElementById("recoverBtn");
  const eyeToggles = document.querySelectorAll(".eye-toggle");

  const localUser = localStorage.getItem("cashbook_user");
  if (!localUser) {
    if (overlay) overlay.style.display = "flex";
    if (signinBox) signinBox.style.display = "block";
  } else {
    CASHBOOK_USER = localUser;
    window.CASHBOOK_USER = localUser;
    if (overlay) overlay.style.display = "none";
    window.initCashbook();
  }

  if (signinBtn) {
    signinBtn.onclick = async () => {
      const n = cashName?.value || "";
      const p = cashPass?.value || "";
      const r = cashPassRepeat?.value || "";
      if (await signInFlow(n, p, r)) {
        if (signinBox) signinBox.style.display = "none";
        if (recoverBox) recoverBox.classList.add("hidden");
        if (overlay) overlay.style.display = "none";
        window.initCashbook();
      }
    };
  }

  if (forgotLink) {
    forgotLink.onclick = () => {
      if (recoverBox) recoverBox.classList.remove("hidden");
    };
  }

  if (recoverBtn) {
    recoverBtn.onclick = () => {
      recoverPassword(cashName?.value || "", recoveryInput?.value || "");
    };
  }

  eyeToggles.forEach((btn) => {
    btn.onclick = () => {
      const targetId = btn.getAttribute("data-target");
      const input = document.getElementById(targetId);
      if (!input) return;
      input.type = input.type === "password" ? "text" : "password";
      btn.innerHTML = `<i class="fa ${input.type === "password" ? "fa-eye" : "fa-eye-slash"}"></i>`;
    };
  });
});
