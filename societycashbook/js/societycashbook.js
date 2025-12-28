let db;

/**
 * Lazy DB getter.
 * - Works even if societycashbook.js loads before firebase.js
 * - Falls back to window.db when available
 */
function getDb() {
  if (db) return db;
  try {
    if (window.firebase && firebase.database) db = firebase.database();
  } catch (e) {
    // Firebase might not be loaded yet.
  }
  if (!db && window.db) db = window.db;
  return db;
}

let CASHBOOK_USER = null;

const cleanKey = (n) => (n || "").toLowerCase().replace(/[^a-z0-9]/g, "_");

// Legacy weak hash (base64) kept only for backward compatibility.
const legacyHash = (str) => btoa(unescape(encodeURIComponent(str || ""))).replace(/=/g, "");

// Stronger (still client-side) hash using SHA-256.
async function sha256Hex(str) {
  const input = new TextEncoder().encode(str || "");
  const buf = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function passwordHash(str) {
  try {
    return await sha256Hex(str);
  } catch (e) {
    // Very old browsers fallback (still better than crashing)
    return legacyHash(str);
  }
}

async function verifyPassword(storedHash, pass) {
  if (!storedHash) return false;
  const modern = await passwordHash(pass);
  if (storedHash === modern) return true;
  // Accept legacy hashes so old users can still sign in.
  return storedHash === legacyHash(pass);
}

function setSignedInUser(key, displayName) {
  CASHBOOK_USER = key;
  window.CASHBOOK_USER = key;
  localStorage.setItem("cashbook_user", key);
  if (displayName) localStorage.setItem("cashbook_display_name", displayName);
}

async function signInFlow(name, pass, repeat) {
  const _db = getDb();
  if (!_db) {
    return { ok: false, code: "DB_NOT_READY", message: "Connection error: Database not ready. Please refresh." };
  }

  const displayName = (name || "").trim();
  const key = cleanKey(displayName);

  if (!key || !pass) {
    return { ok: false, code: "MISSING_FIELDS", message: "Please enter a name and password." };
  }

  const ref = _db.ref("/cashbookUsers/" + key);
  const snap = await ref.once("value");

  if (snap.exists()) {
    const user = snap.val() || {};
    const ok = await verifyPassword(user.passwordHash, pass);
    if (!ok) return { ok: false, code: "WRONG_PASSWORD", message: "Wrong password" };

    // Upgrade legacy hash silently.
    const modern = await passwordHash(pass);
    if (user.passwordHash !== modern) {
      ref.child("passwordHash").set(modern);
    }

    // Ensure profile displayName exists.
    if (!user.profile || !user.profile.displayName) {
      ref.child("profile/displayName").set(displayName);
    }

    setSignedInUser(key, user.profile?.displayName || displayName);
    return { ok: true, action: "login", message: `Welcome back, ${user.profile?.displayName || displayName}` };
  }

  // Register
  if (!repeat) {
    return { ok: false, code: "NEED_REPEAT", message: "Repeat password to register." };
  }
  if (pass !== repeat) {
    return { ok: false, code: "PASS_MISMATCH", message: "Passwords do not match." };
  }

  const fav = prompt("Recovery question: Who is your favourite family member?") || "";
  const payload = {
    passwordHash: await passwordHash(pass),
    recovery: (fav || "").trim(),
    profile: {
      displayName,
      avatarDataUrl: ""
    },
    createdAt: new Date().toISOString()
  };

  await ref.set(payload);
  setSignedInUser(key, displayName);
  return { ok: true, action: "register", message: `Registered successfully. Welcome, ${displayName}` };
}

async function recoverPasswordFlow(name, ans, newPass, repeat) {
  const _db = getDb();
  if (!_db) return { ok: false, message: "Connection error: Database not ready. Please refresh." };

  const displayName = (name || "").trim();
  const key = cleanKey(displayName);
  if (!key) return { ok: false, message: "Please enter your name." };

  const snap = await _db.ref("/cashbookUsers/" + key).once("value");
  if (!snap.exists()) return { ok: false, message: "Account not found." };

  const user = snap.val() || {};
  const expected = (user.recovery || "").toLowerCase().trim();
  const got = (ans || "").toLowerCase().trim();

  if (!expected) return { ok: false, message: "This account has no recovery answer set." };
  if (expected !== got) return { ok: false, message: "Incorrect answer." };

  if (!newPass) return { ok: false, message: "Enter a new password." };
  if (newPass !== repeat) return { ok: false, message: "Passwords do not match." };

  await _db.ref("/cashbookUsers/" + key).update({
    passwordHash: await passwordHash(newPass),
    updatedAt: new Date().toISOString()
  });

  return { ok: true, message: "Password reset successful. You can sign in now." };
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
      const _db = getDb();
      if (CASHBOOK_USER && _db) {
        MoneyMemoryState.mode = "firebase";
        MoneyMemoryState.uid = CASHBOOK_USER;
        db = _db;
        await loadFromFirebase();
      } else {
        // If DB isn't ready, fall back to local-only mode (still private on this device).
        MoneyMemoryState.mode = "guest";
        MoneyMemoryState.uid = null;
        loadFromLocalStorage();
      }

      if (!MoneyMemoryState.currentCashbookId) {
        MoneyMemoryState.currentCashbookId = "default";
      }
      ensureDefaultCashbook();
      await initUserChip();
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

  async function initUserChip() {
    const chip = document.getElementById("mm-user-chip");
    const logoutBtn = document.getElementById("mm-logout-btn");
    if (!chip) return;

    const loggedIn = MoneyMemoryState.mode === "firebase" && MoneyMemoryState.uid;
    chip.classList.toggle("hidden", !loggedIn);
    if (logoutBtn) logoutBtn.classList.toggle("hidden", !loggedIn);

    if (!loggedIn) return;

    // Load profile (Firebase → local fallback)
    let profile = {
      displayName: localStorage.getItem("cashbook_display_name") || MoneyMemoryState.uid,
      avatarDataUrl: localStorage.getItem("cashbook_avatar") || ""
    };

    try {
      const snap = await db.ref(`/cashbookUsers/${MoneyMemoryState.uid}/profile`).once("value");
      profile = { ...profile, ...(snap.val() || {}) };
    } catch (e) {
      console.warn("Failed to load profile, using local cache.", e);
    }

    renderUserChip(profile);
    bindUserChipHandlers();
  }

  function renderUserChip(profile) {
    const nameEl = document.getElementById("mm-user-name");
    const img = document.getElementById("mm-user-avatar");
    const icon = document.getElementById("mm-user-avatar-icon");

    if (nameEl) nameEl.textContent = profile?.displayName || "User";

    const dataUrl = profile?.avatarDataUrl || "";
    if (img && icon) {
      if (dataUrl) {
        img.src = dataUrl;
        img.classList.remove("hidden");
        icon.classList.add("hidden");
      } else {
        img.classList.add("hidden");
        icon.classList.remove("hidden");
      }
    }
  }

  function bindUserChipHandlers() {
    const avatarBtn = document.getElementById("mm-avatar-btn");
    const fileInput = document.getElementById("mm-avatar-input");
    const logoutBtn = document.getElementById("mm-logout-btn");

    if (avatarBtn && fileInput && !avatarBtn.dataset.bound) {
      avatarBtn.dataset.bound = "1";
      avatarBtn.addEventListener("click", () => fileInput.click());
    }

    if (fileInput && !fileInput.dataset.bound) {
      fileInput.dataset.bound = "1";
      fileInput.addEventListener("change", async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;

        try {
          const dataUrl = await toSquareAvatarDataUrl(file, 96, 0.85);
          localStorage.setItem("cashbook_avatar", dataUrl);

          // Update UI immediately
          renderUserChip({
            displayName: localStorage.getItem("cashbook_display_name") || MoneyMemoryState.uid,
            avatarDataUrl: dataUrl
          });

          // Persist to Firebase for this user
          if (MoneyMemoryState.mode === "firebase" && MoneyMemoryState.uid) {
            await db.ref(`/cashbookUsers/${MoneyMemoryState.uid}/profile`).update({
              avatarDataUrl: dataUrl,
              updatedAt: new Date().toISOString()
            });
          }
        } catch (e) {
          console.error("Avatar upload failed", e);
          alert("Failed to set profile photo. Try a smaller image.");
        } finally {
          fileInput.value = "";
        }
      });
    }

    if (logoutBtn && !logoutBtn.dataset.bound) {
      logoutBtn.dataset.bound = "1";
      logoutBtn.addEventListener("click", () => {
        localStorage.removeItem("cashbook_user");
        localStorage.removeItem("cashbook_display_name");
        localStorage.removeItem("cashbook_avatar");
        location.reload();
      });
    }
  }

  function toSquareAvatarDataUrl(file, size = 96, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Failed to read file."));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Invalid image."));
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");

          // Crop center square
          const side = Math.min(img.width, img.height);
          const sx = Math.floor((img.width - side) / 2);
          const sy = Math.floor((img.height - side) / 2);

          ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

          const dataUrl = canvas.toDataURL("image/jpeg", quality);

          // Guard size (~120KB)
          if (dataUrl.length > 160000) {
            resolve(canvas.toDataURL("image/jpeg", 0.7));
            return;
          }
          resolve(dataUrl);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
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
  // Use DOMContentLoaded if load is too slow, but load ensures CSS/Fonts are ready.
});

function setupAuthUI() {
  const overlay = document.getElementById("signin-overlay");
  const signinBox = document.getElementById("signin-box");
  const recoverBox = document.getElementById("recover-box");

  const cashName = document.getElementById("cashName");
  const cashPass = document.getElementById("cashPass");
  const cashPassRepeat = document.getElementById("cashPassRepeat");
  const signinBtn = document.getElementById("signinBtn");
  const forgotLink = document.getElementById("forgotLink");
  const authMsg = document.getElementById("authMsg");

  const recoverName = document.getElementById("recoverName");
  const recoveryInput = document.getElementById("recoveryInput");
  const recoverNewPass = document.getElementById("recoverNewPass");
  const recoverNewPassRepeat = document.getElementById("recoverNewPassRepeat");
  const recoverBtn = document.getElementById("recoverBtn");
  const backToSignin = document.getElementById("backToSignin");
  const recoverMsg = document.getElementById("recoverMsg");

  const eyeToggles = document.querySelectorAll(".eye-toggle");

  if (setupAuthUI._bound) return;
  setupAuthUI._bound = true;

  const setMsg = (el, text, kind = "info") => {
    if (!el) return;
    el.classList.remove("hidden");
    el.textContent = text || "";
    el.classList.remove("text-rose-300", "text-emerald-300", "text-slate-300");
    if (kind === "error") el.classList.add("text-rose-300");
    else if (kind === "success") el.classList.add("text-emerald-300");
    else el.classList.add("text-slate-300");
  };

  const clearMsg = (el) => {
    if (!el) return;
    el.classList.add("hidden");
    el.textContent = "";
  };

  const showSignin = () => {
    clearMsg(authMsg);
    clearMsg(recoverMsg);
    if (recoverBox) recoverBox.classList.add("hidden");
    if (signinBox) signinBox.classList.remove("hidden");
    if (overlay) overlay.style.display = "flex";
  };

  const showRecover = () => {
    clearMsg(authMsg);
    clearMsg(recoverMsg);
    if (signinBox) signinBox.classList.add("hidden");
    if (recoverBox) recoverBox.classList.remove("hidden");
    if (overlay) overlay.style.display = "flex";

    // Carry over name for convenience
    if (recoverName && cashName && cashName.value && !recoverName.value) recoverName.value = cashName.value;
  };

  // Auto sign-in if user already saved
  const localUser = localStorage.getItem("cashbook_user");
  if (!localUser) {
    showSignin();
  } else {
    CASHBOOK_USER = localUser;
    window.CASHBOOK_USER = localUser;
    if (overlay) overlay.style.display = "none";
    window.initCashbook();
  }

  if (signinBtn) {
    signinBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearMsg(authMsg);

      const n = cashName?.value || "";
      const p = cashPass?.value || "";
      const r = cashPassRepeat?.value || "";

      signinBtn.textContent = "Processing...";
      signinBtn.disabled = true;

      try {
        const res = await signInFlow(n, p, r);

        if (!res.ok) {
          setMsg(authMsg, res.message || "Sign in failed.", "error");
          return;
        }

        setMsg(authMsg, res.message || "Success.", "success");

        // Hide overlay & load app
        setTimeout(() => {
          if (signinBox) signinBox.classList.add("hidden");
          if (recoverBox) recoverBox.classList.add("hidden");
          if (overlay) overlay.style.display = "none";
          window.initCashbook();
        }, 250);
      } catch (err) {
        console.error("Sign in crashed", err);
        setMsg(authMsg, "System error during sign in: " + (err?.message || err), "error");
      } finally {
        signinBtn.textContent = "Sign In / Register";
        signinBtn.disabled = false;
      }
    });
  }

  if (forgotLink) {
    forgotLink.addEventListener("click", (e) => {
      e.preventDefault();
      showRecover();
    });
  }

  if (recoverBtn) {
    recoverBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      clearMsg(recoverMsg);

      const n = recoverName?.value || cashName?.value || "";
      const ans = recoveryInput?.value || "";
      const newP = recoverNewPass?.value || "";
      const rep = recoverNewPassRepeat?.value || "";

      recoverBtn.textContent = "Processing...";
      recoverBtn.disabled = true;

      try {
        const res = await recoverPasswordFlow(n, ans, newP, rep);
        if (!res.ok) {
          setMsg(recoverMsg, res.message || "Failed.", "error");
          return;
        }
        setMsg(recoverMsg, res.message || "Password reset successful.", "success");
        setTimeout(() => showSignin(), 600);
      } catch (err) {
        console.error("Recover crashed", err);
        setMsg(recoverMsg, "System error: " + (err?.message || err), "error");
      } finally {
        recoverBtn.textContent = "Reset Password";
        recoverBtn.disabled = false;
      }
    });
  }

  if (backToSignin) {
    backToSignin.addEventListener("click", (e) => {
      e.preventDefault();
      showSignin();
    });
  }

  // Eye toggles for password fields
  eyeToggles.forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const targetId = btn.getAttribute("data-target");
      let input = targetId ? document.getElementById(targetId) : null;

      if (!input) {
        // Fallback: find the closest input within the same container
        input = btn.closest(".relative")?.querySelector("input") || null;
      }

      if (!input) return;

      if (input.type === "password") {
        input.type = "text";
        btn.innerHTML = '<i class="fa fa-eye-slash"></i>';
      } else {
        input.type = "password";
        btn.innerHTML = '<i class="fa fa-eye"></i>';
      }
    });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupAuthUI);
} else {
  setupAuthUI();
}
