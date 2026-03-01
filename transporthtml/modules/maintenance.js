(() => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const DURABLE_RULES = [
    { keys: ["battery"], minDays: 180 },
    { keys: ["tyre", "tire"], minDays: 180 },
    { keys: ["shock", "absorber"], minDays: 150 },
    { keys: ["rack end", "rackend"], minDays: 120 },
    { keys: ["brake", "pedal"], minDays: 90 },
    { keys: ["brake pad", "brake shoe"], minDays: 90 },
  ];

  function db() {
    return firebase.database();
  }

  async function ensureReadAuth() {
    try {
      if (!firebase.auth || typeof firebase.auth !== "function") return;
      const auth = firebase.auth();
      if (auth.currentUser) return;
      await auth.signInAnonymously();
    } catch (_err) {
      // Keep going; some projects allow public reads without auth.
    }
  }

  function clean(value) {
    return String(value || "").trim();
  }

  function slug(value) {
    if (window.TransportHelpers && typeof window.TransportHelpers.slug === "function") {
      return window.TransportHelpers.slug(value);
    }
    return clean(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function fmtMoney(amount, currency = "TZS") {
    const num = Number(amount || 0);
    return `${currency} ${num.toLocaleString("en-US")}`;
  }

  function normalizeModel(model) {
    return clean(model).toLowerCase().replace(/\s+/g, " ");
  }

  function tokenize(text) {
    return clean(text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  }

  function minDaysForPart(partName) {
    const hay = clean(partName).toLowerCase();
    for (const rule of DURABLE_RULES) {
      if (rule.keys.some((key) => hay.includes(key))) return rule.minDays;
    }
    return 90;
  }

  function isSocratesAlias(school) {
    const s = clean(school).toLowerCase();
    return s === "socrates-school" || s === "socrates" || s === "default";
  }

  async function readFirstExisting(paths) {
    for (const path of paths) {
      const snap = await db().ref(path).get();
      if (snap.exists() && snap.val()) {
        const val = snap.val();
        if (typeof val !== "object" || Object.keys(val).length) {
          return { path, value: val };
        }
      }
    }
    return { path: paths[0], value: {} };
  }

  function vehiclePaths(context) {
    const school = clean(context.school);
    const year = Number(context.year) || new Date().getFullYear();
    const paths = [
      `schools/${school}/years/${year}/transport/buses`,
      `transport/${school}/${year}/buses`,
    ];
    if (isSocratesAlias(school)) {
      paths.push(`transport/socrates-school/${year}/buses`);
      paths.push(`transport/socrates/${year}/buses`);
    }
    return paths;
  }

  function normalizeVehicle(id, raw = {}) {
    return {
      id,
      plate: clean(raw.plate || id),
      makeModel: clean(raw.makeModel || raw.model || raw.vehicleModel || ""),
      assignedDriverUid: clean(raw.assignedDriverUid || raw.driverUid || ""),
      assignedDriverName: clean(raw.assignedDriverName || raw.driverName || raw.driver || ""),
      status: clean(raw.status || "active"),
    };
  }

  async function listVehicles(context) {
    const found = await readFirstExisting(vehiclePaths(context));
    const out = [];
    Object.entries(found.value || {}).forEach(([id, value]) => {
      out.push(normalizeVehicle(id, value || {}));
    });
    out.sort((a, b) => a.plate.localeCompare(b.plate));
    return out;
  }

  function normalizePhoneDigits(input = "") {
    return (String(input).match(/\d+/g) || []).join("");
  }

  async function listSokoVehicleItems() {
    await ensureReadAuth();
    const [shopsSnap, itemsSnap, catsSnap] = await Promise.all([
      db().ref("marketinghub/public/shops").get(),
      db().ref("marketinghub/public/items").get(),
      db().ref("marketinghub/public/categories").get(),
    ]);

    const shops = shopsSnap.val() || {};
    const itemsBySeller = itemsSnap.val() || {};
    const categories = catsSnap.val() || {};
    const vehicleCategoryIds = new Set(["vehicle_spares", "car_spares", "car-spares"]);
    Object.entries(categories).forEach(([id, cat]) => {
      const nameSw = clean(cat?.nameSw).toLowerCase();
      const nameEn = clean(cat?.nameEn).toLowerCase();
      const icon = clean(cat?.icon).toLowerCase();
      const bag = `${id} ${nameSw} ${nameEn} ${icon}`;
      if (
        bag.includes("vehicle") ||
        bag.includes("magari") ||
        bag.includes("spare") ||
        bag.includes("car-spares") ||
        bag.includes("vifaa vya magari")
      ) {
        vehicleCategoryIds.add(id);
      }
    });
    const rows = [];

    Object.entries(itemsBySeller).forEach(([sellerId, sellerItems]) => {
      const shop = shops[sellerId] || {};
      const shopCategoryKeys = new Set(
        Object.keys(shop?.categories || {}).filter((key) => shop?.categories?.[key])
      );
      Object.entries(sellerItems || {}).forEach(([itemId, item]) => {
        const row = item || {};
        if (row.status === "inactive") return;
        const catId = clean(row.catId);
        const itemModel = clean(row.vehicleModel).toLowerCase();
        const title = clean(row.title).toLowerCase();
        const isVehicleByCat = catId && vehicleCategoryIds.has(catId);
        const isVehicleByShopCat = [...shopCategoryKeys].some((id) => vehicleCategoryIds.has(id));
        const isVehicleByContent =
          !!itemModel ||
          title.includes("shock") ||
          title.includes("rack") ||
          title.includes("battery") ||
          title.includes("brake") ||
          title.includes("tyre") ||
          title.includes("tire") ||
          title.includes("filter");
        if (!isVehicleByCat && !isVehicleByShopCat && !isVehicleByContent) return;
        const phoneRaw = clean(shop.whatsappPhone || (shop.phones || [])[0] || "");
        const phoneDigits = normalizePhoneDigits(phoneRaw);
        rows.push({
          itemId,
          sellerId,
          title: clean(row.title),
          titleSlug: slug(row.title),
          vehicleModel: clean(row.vehicleModel),
          vehicleModelNorm: normalizeModel(row.vehicleModel),
          brand: clean(row.brand),
          price: Number(row.price || 0),
          currency: clean(row.currency || "TZS"),
          unit: clean(row.unit || "pcs"),
          notes: clean(row.notes),
          catId,
          shopName: clean(shop.shopName || "Unknown shop"),
          ownerName: clean(shop.ownerName),
          country: clean(shop.country),
          region: clean(shop.region),
          city: clean(shop.city),
          area: clean(shop.area),
          phoneRaw,
          phoneDigits,
          whatsappUrl: phoneDigits ? `https://wa.me/${phoneDigits}` : "",
          lipaNumber: clean(shop.lipaNumber),
        });
      });
    });

    rows.sort((a, b) => {
      const byTitle = a.title.localeCompare(b.title);
      if (byTitle !== 0) return byTitle;
      return a.shopName.localeCompare(b.shopName);
    });
    return rows;
  }

  function scoreItemMatch(item, wantedPart, vehicleModel) {
    const wantedTokens = tokenize(wantedPart);
    const itemTokens = tokenize(item.title);
    let score = 0;
    if (slug(wantedPart) && item.titleSlug === slug(wantedPart)) score += 100;
    wantedTokens.forEach((token) => {
      if (itemTokens.includes(token)) score += 12;
      if (item.title.toLowerCase().includes(token)) score += 5;
    });
    const vm = normalizeModel(vehicleModel);
    if (vm && item.vehicleModelNorm) {
      if (item.vehicleModelNorm === vm) score += 30;
      else if (item.vehicleModelNorm.includes(vm) || vm.includes(item.vehicleModelNorm)) score += 12;
    }
    return score;
  }

  function findBestSokoMatch(items, wantedPart, vehicleModel) {
    let best = null;
    let bestScore = -1;
    (items || []).forEach((item) => {
      const score = scoreItemMatch(item, wantedPart, vehicleModel);
      if (score > bestScore) {
        best = item;
        bestScore = score;
      }
    });
    if (!best || bestScore < 12) return null;
    return { item: best, score: bestScore };
  }

  async function getPartHistory(vehicleId, partName) {
    const partSlug = slug(partName);
    if (!vehicleId || !partSlug) return [];
    const path = `maintenance_ledger/${vehicleId}/partsHistory/${partSlug}`;
    const snap = await db().ref(path).get();
    const raw = snap.val() || [];
    const list = Array.isArray(raw) ? raw : Object.values(raw);
    return list
      .map((row) => ({
        ts: Number(row?.ts || 0),
        cost: Number(row?.cost || 0),
        reqId: row?.reqId || row?.requestId || "",
      }))
      .filter((row) => row.ts > 0)
      .sort((a, b) => b.ts - a.ts);
  }

  async function buildPurchaseGuard(vehicleId, partName, nowTs = Date.now()) {
    const history = await getPartHistory(vehicleId, partName);
    const minDays = minDaysForPart(partName);
    const last = history[0] || null;
    const daysSinceLast = last ? Math.floor((nowTs - last.ts) / DAY_MS) : null;
    const purchasedTooSoon = last ? daysSinceLast < minDays : false;
    const boughtWithin90 = history.filter((h) => nowTs - h.ts <= 90 * DAY_MS).length;
    const repeatPart = purchasedTooSoon || boughtWithin90 >= 2;
    return {
      minDays,
      lastPurchaseTs: last ? last.ts : null,
      daysSinceLast,
      purchasedTooSoon,
      repeatPart,
      recentCount90d: boughtWithin90,
      history,
    };
  }

  function computePriceSignals(quotedPrice, sokoPrice) {
    const q = Number(quotedPrice || 0);
    const s = Number(sokoPrice || 0);
    if (!(q > 0) || !(s > 0)) {
      return { delta: 0, deltaPct: 0, direction: "NA", needsReview: false };
    }
    const delta = q - s;
    const deltaPct = (delta / s) * 100;
    let direction = "MATCH";
    if (deltaPct >= 15) direction = "ABOVE_SOKO";
    else if (deltaPct <= -15) direction = "BELOW_SOKO";
    return {
      delta,
      deltaPct,
      direction,
      needsReview: Math.abs(deltaPct) >= 15,
    };
  }

  function buildFlags(guard, priceSignal) {
    const out = [];
    if (guard.repeatPart) out.push("REPEAT_PART");
    if (guard.purchasedTooSoon) out.push("RECENT_PURCHASE");
    if (priceSignal.needsReview) out.push("PRICE_VARIANCE");
    return out;
  }

  function buildInvoiceObject(request, reviewer = {}) {
    const issuedAt = Date.now();
    const invoiceNo = `MAIN-${new Date(issuedAt).getFullYear()}-${String(request.id || "").slice(-6).toUpperCase()}`;
    const spare = Number(request.estCost || 0);
    const labour = Number(request.fundiLabourCost || 0);
    return {
      invoiceNo,
      requestId: request.id,
      school: request.school || "",
      year: Number(request.year || 0),
      vehicleId: request.vehicleId || "",
      vehiclePlate: request.vehiclePlate || "",
      vehicleModel: request.vehicleModel || "",
      part: request.part || "",
      driverName: request.driverName || "",
      driverUid: request.driverUid || "",
      fundiName: request.fundiName || "",
      fundiLabourCost: labour,
      spareCost: spare,
      total: spare + labour,
      soko: {
        shopName: request.sokoShopName || "",
        ownerName: request.sokoOwnerName || "",
        phone: request.sokoPhone || "",
        whatsapp: request.sokoWhatsapp || "",
        lipaNumber: request.sokoLipaNumber || "",
        itemId: request.sokoItemId || "",
      },
      approvals: {
        accountantUid: reviewer.uid || "",
        accountantName: reviewer.name || "",
        approvedAt: issuedAt,
        signatures: {
          driver: "",
          accountant: "",
          headteacher: "",
        },
      },
      createdAt: issuedAt,
      logoPath: `${window.location.origin}/images/somap-logo.png.jpg`,
    };
  }

  function invoiceStyles() {
    return `
    .inv-root { font-family: Arial, sans-serif; color: #111827; padding: 20px; }
    .inv-card { border: 2px solid #0f766e; border-radius: 14px; overflow: hidden; }
    .inv-head { display:flex; justify-content:space-between; align-items:center; gap:14px; padding:16px; background: linear-gradient(135deg, #0f766e, #115e59); color:#f0fdfa; }
    .inv-logo { height:60px; object-fit:contain; background:#fff; padding:4px 8px; border-radius:8px; }
    .inv-title { font-size: 22px; font-weight: 800; margin:0; }
    .inv-sub { font-size:12px; opacity:0.95; margin-top:2px; }
    .inv-meta { background:#f8fafc; border-top:1px solid #d1d5db; border-bottom:1px solid #d1d5db; padding:10px 16px; font-size:12px; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px 12px; }
    .inv-section { padding: 14px 16px; }
    .inv-note { background:#fffbeb; border:1px solid #f59e0b; color:#78350f; border-radius:10px; padding:10px 12px; font-size:13px; margin-bottom:10px; }
    .inv-list { margin:0; padding-left: 18px; font-size:13px; line-height:1.5; }
    .inv-table { width:100%; border-collapse:collapse; margin-top:10px; font-size:13px; }
    .inv-table th, .inv-table td { border:1px solid #d1d5db; padding:8px; text-align:left; }
    .inv-table th { background:#ecfeff; }
    .inv-total { font-weight:800; font-size:14px; background:#f0fdfa; }
    .inv-sign { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-top:22px; }
    .inv-sign-box { border-top:1px solid #111827; min-height:46px; font-size:12px; padding-top:6px; }
    .inv-foot { margin-top:8px; font-size:11px; color:#4b5563; }
    `;
  }

  function schoolDisplay(invoice) {
    const key = String(invoice.school || "").toLowerCase();
    if (key.includes("socrates")) {
      return "Socrates School, Arusha";
    }
    return invoice.school || "-";
  }

  function schoolAddress(invoice) {
    const key = String(invoice.school || "").toLowerCase();
    if (key.includes("socrates")) {
      return "P.O. Box 14256, Arusha, Tanzania";
    }
    return "Arusha, Tanzania";
  }

  function invoiceBodyHtml(invoice) {
    const approvedDate = invoice.approvals?.approvedAt
      ? new Date(invoice.approvals.approvedAt).toLocaleString()
      : "-";
    return `
      <div class="inv-root">
        <div class="inv-card">
          <div class="inv-head">
            <div>
              <h1 class="inv-title">Approved Maintenance Invoice</h1>
              <div class="inv-sub">${schoolDisplay(invoice)}</div>
              <div class="inv-sub">${schoolAddress(invoice)}</div>
            </div>
            <img src="${invoice.logoPath}" class="inv-logo" alt="SoMAp Logo" />
          </div>

          <div class="inv-meta">
            <div><strong>Invoice #:</strong> ${invoice.invoiceNo || "-"}</div>
            <div><strong>Approved Date:</strong> ${approvedDate}</div>
            <div><strong>Vehicle:</strong> ${invoice.vehiclePlate || invoice.vehicleId || "-"}</div>
            <div><strong>Model:</strong> ${invoice.vehicleModel || "-"}</div>
            <div><strong>Driver:</strong> ${invoice.driverName || "-"}</div>
            <div><strong>Fundi:</strong> ${invoice.fundiName || "-"}</div>
          </div>

          <div class="inv-section">
            <div class="inv-note">
              This is an invoice requesting you to do the following approved maintenance work.
            </div>
            <ol class="inv-list">
              <li>Purchase and replace spare part: <strong>${invoice.part || "Spare part"}</strong>.</li>
              <li>Perform required vehicle maintenance and labour tasks for the stated vehicle.</li>
              <li>Use seller contact and payment details below for procurement.</li>
            </ol>

            <table class="inv-table">
              <thead><tr><th>Approved Work Item</th><th>Amount</th></tr></thead>
              <tbody>
                <tr><td>${invoice.part || "Spare part"}</td><td>${fmtMoney(invoice.spareCost)}</td></tr>
                <tr><td>Fundi Labour</td><td>${fmtMoney(invoice.fundiLabourCost)}</td></tr>
                <tr class="inv-total"><td>Total Approved Amount</td><td>${fmtMoney(invoice.total)}</td></tr>
              </tbody>
            </table>

            <table class="inv-table">
              <thead><tr><th colspan="2">Seller / Shop Contact & Payment Details</th></tr></thead>
              <tbody>
                <tr><td>Shop Name</td><td>${invoice.soko.shopName || "-"}</td></tr>
                <tr><td>Seller Name</td><td>${invoice.soko.ownerName || "-"}</td></tr>
                <tr><td>Phone</td><td>${invoice.soko.phone || "-"}</td></tr>
                <tr><td>WhatsApp</td><td>${invoice.soko.whatsapp || "-"}</td></tr>
                <tr><td>Payment (Lipa Number)</td><td>${invoice.soko.lipaNumber || "-"}</td></tr>
              </tbody>
            </table>

            <div class="inv-sign">
              <div class="inv-sign-box">Driver Signature</div>
              <div class="inv-sign-box">Accountant Signature</div>
              <div class="inv-sign-box">Headteacher Signature</div>
            </div>

            <div class="inv-foot">
              Generated by SoMAp Transport Maintenance System.
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function invoiceHtml(invoice) {
    return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${invoice.invoiceNo}</title>
  <style>${invoiceStyles()}</style>
</head>
<body>
${invoiceBodyHtml(invoice)}
</body>
</html>`;
  }

  function openPrintableInvoice(invoice) {
    const win = window.open("", "_blank");
    if (!win) throw new Error("Unable to open invoice window");
    win.document.write(invoiceHtml(invoice));
    win.document.close();
    setTimeout(() => win.print(), 400);
  }

  function ensureHtml2Pdf() {
    if (window.html2pdf) return Promise.resolve(window.html2pdf);
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-lib="html2pdf"]');
      if (existing) {
        existing.addEventListener("load", () => resolve(window.html2pdf));
        existing.addEventListener("error", reject);
        return;
      }
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
      script.async = true;
      script.dataset.lib = "html2pdf";
      script.onload = () => resolve(window.html2pdf);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function downloadInvoicePdf(invoice) {
    const html2pdf = await ensureHtml2Pdf();
    const wrapper = document.createElement("div");
    wrapper.style.position = "fixed";
    wrapper.style.left = "-99999px";
    wrapper.style.top = "0";
    wrapper.innerHTML = `<style>${invoiceStyles()}</style>${invoiceBodyHtml(invoice)}`;
    document.body.appendChild(wrapper);
    const node = wrapper.querySelector(".inv-root") || wrapper;
    try {
      await html2pdf()
        .set({
          margin: 8,
          filename: `${invoice.invoiceNo || "maintenance-invoice"}.pdf`,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        })
        .from(node)
        .save();
    } finally {
      wrapper.remove();
    }
  }

  function flagBadges(request) {
    const flags = Array.isArray(request.flags) ? request.flags : [];
    if (!flags.length) return '<span class="chip ok">OK</span>';
    return flags
      .map((flag) => {
        if (flag === "REPEAT_PART") return '<span class="chip warn">Repeat Part</span>';
        if (flag === "RECENT_PURCHASE") return '<span class="chip bad">Bought Recently</span>';
        if (flag === "PRICE_VARIANCE") return '<span class="chip warn">Price Variance</span>';
        return `<span class="chip">${flag}</span>`;
      })
      .join(" ");
  }

  window.TransportMaintenance = {
    DAY_MS,
    minDaysForPart,
    listVehicles,
    listSokoVehicleItems,
    findBestSokoMatch,
    buildPurchaseGuard,
    computePriceSignals,
    buildFlags,
    buildInvoiceObject,
    openPrintableInvoice,
    downloadInvoicePdf,
    flagBadges,
    fmtMoney,
    slug,
  };
})();
