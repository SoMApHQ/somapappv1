// marketing/marketing.js
// Entry point for MarketingHub card + app shell (React via CDN, no build step).

const REACT_URL = "https://unpkg.com/react@18/umd/react.production.min.js";
const REACT_DOM_URL =
  "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js";

const STYLE_URL = new URL("./marketing.css", import.meta.url).href;

const isBrowser = typeof window !== "undefined";

function loadScriptOnce(src, globalKey) {
  if (!isBrowser) return Promise.resolve();
  if (globalKey && window[globalKey]) return Promise.resolve();
  const existing = document.querySelector(`script[data-src="${src}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", resolve);
      existing.addEventListener("error", reject);
    });
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function ensureReact() {
  return loadScriptOnce(REACT_URL, "React").then(() =>
    loadScriptOnce(REACT_DOM_URL, "ReactDOM")
  );
}

function ensureStyle() {
  if (!isBrowser) return;
  const existing = document.querySelector(`link[data-mh-style="marketing"]`);
  if (existing) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLE_URL;
  link.dataset.mhStyle = "marketing";
  document.head.appendChild(link);
}

function createRootCompat(el) {
  if (window.ReactDOM && typeof ReactDOM.createRoot === "function") {
    return ReactDOM.createRoot(el);
  }
  return {
    render: (node) => ReactDOM.render(node, el),
  };
}

// ---- UI strings (Swahili-first) ----
const STRINGS = {
  sw: {
    title: "MarketingHub",
    subtitle: "Soko Huru • Nunua / Uze Haraka",
    cta: "Anza Sasa",
    buyer: "Mnunzi / Buyer",
    seller: "Muuzaji / Seller",
    landingLead:
      "Karibu Soko Huru. Tengeneza biashara yako, au tafuta bidhaa papo hapo bila kusajili.",
    searchPlaceholder: "Tafuta bidhaa, eneo, au muuzaji…",
    filters: "Vichujio",
    delivery: "Uwasilishaji",
    payOnDelivery: "Lipa ukipokea",
    priceMin: "Bei ndogo",
    priceMax: "Bei kubwa",
    category: "Kipengele",
    location: "Eneo",
    contact: "Wasiliana",
    like: "Penda",
    liked: "Umeweka Like",
    enterBuyer: "Ingia kama Mnunzi",
    enterSeller: "Anza kama Muuzaji",
    sellerGate:
      "Ingiza akaunti yako ya kuuza (Phone/Email) ili tukuthibitishe.",
    kycTitle: "KYC ya Muuzaji",
    submitKyc: "Tuma KYC",
    notAuthed: "Tafadhali ingia ili uendelee kama muuzaji.",
    quotaBlocked:
      "Umefika ukomo wa bure. Tuma malipo: TZ 2,000 kwa 255686828732 au KE 100 kwa 254704479105.",
    uploadNote: "Pakia 1-3 picha; tutakagua kabla ya kuchapisha.",
    appTitle: "Soko Huru",
  },
  en: {
    title: "MarketingHub",
    subtitle: "Soko Huru • Buy & sell fast",
    cta: "Get Started",
    buyer: "Buyer",
    seller: "Seller",
    landingLead:
      "Welcome to Soko Huru. Explore instantly; sellers are verified for safety.",
    searchPlaceholder: "Search products, location, or seller…",
    filters: "Filters",
    delivery: "Delivery",
    payOnDelivery: "Pay on delivery",
    priceMin: "Min price",
    priceMax: "Max price",
    category: "Category",
    location: "Location",
    contact: "Contact",
    like: "Like",
    liked: "Liked",
    enterBuyer: "Enter as Buyer",
    enterSeller: "Start as Seller",
    sellerGate:
      "Sign in (phone/email) so we can verify you before listings go live.",
    kycTitle: "Seller KYC",
    submitKyc: "Submit KYC",
    notAuthed: "Please sign in to continue as seller.",
    quotaBlocked:
      "Free upload quota reached. Pay: TZ 2,000 to 255686828732 or KE 100 to 254704479105.",
    uploadNote: "Upload 1-3 photos; we review before publishing.",
    appTitle: "Soko Huru",
  },
};

function useLangStrings(lang) {
  return STRINGS[lang] || STRINGS.sw;
}

function useFirebase() {
  const hasFb =
    isBrowser && window.firebase && firebase.apps && firebase.apps.length > 0;
  const db = hasFb ? firebase.database() : null;
  const auth = hasFb && firebase.auth ? firebase.auth() : null;
  return { hasFb, db, auth };
}

function ensureAnonAuth(auth) {
  if (!auth) return Promise.resolve(null);
  const user = auth.currentUser;
  if (user) return Promise.resolve(user);
  return auth.signInAnonymously().then((cred) => cred.user);
}

// ---- Components ----
function MarketingCard({ onClick, lang = "sw" }) {
  const t = useLangStrings(lang);
  return React.createElement(
    "div",
    { className: "mh-card-shell" },
    React.createElement(
      "div",
      { className: "mh-card-body" },
      React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { className: "mh-chip" },
          "MarketingHub",
          React.createElement("span", { className: "mh-pill" }, "Soko Huru")
        ),
        React.createElement("div", { className: "mh-title" }, t.title),
        React.createElement("p", { className: "mh-sub" }, t.subtitle)
      ),
      React.createElement("button", { className: "mh-cta", onClick }, t.cta)
    )
  );
}

function ListingCard({ listing, onLike, onContact, liked, lang }) {
  const t = useLangStrings(lang);
  return React.createElement(
    "div",
    { className: "mh-listing" },
    React.createElement("img", {
      src:
        listing.photos?.[0] ||
        "https://images.pexels.com/photos/1666021/pexels-photo-1666021.jpeg?auto=compress&cs=tinysrgb&h=400",
      alt: listing.title || "Listing",
    }),
    React.createElement(
      "div",
      { className: "mh-listing-body" },
      React.createElement(
        "div",
        { style: { display: "flex", justifyContent: "space-between", gap: 8 } },
        React.createElement("strong", null, listing.title || "Bidhaa"),
        React.createElement(
          "span",
          { className: "mh-tag" },
          listing.price ? `TZS ${Number(listing.price).toLocaleString()}` : "—"
        )
      ),
      React.createElement(
        "div",
        { className: "mh-muted", style: { fontSize: "0.9rem" } },
        listing.location || "Eneo halijawekewa"
      ),
      React.createElement(
        "div",
        { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
        listing.category
          ? React.createElement(
              "span",
              { className: "mh-tag" },
              listing.category
            )
          : null,
        listing.delivery
          ? React.createElement("span", { className: "mh-tag" }, t.delivery)
          : null,
        listing.payOnDelivery
          ? React.createElement(
              "span",
              { className: "mh-tag" },
              t.payOnDelivery
            )
          : null
      ),
      React.createElement(
        "div",
        { style: { display: "flex", gap: 8, marginTop: 10 } },
        React.createElement(
          "button",
          {
            className: "mh-btn secondary",
            onClick: () => onLike && onLike(listing),
          },
          liked ? `${t.liked}` : `${t.like}`
        ),
        React.createElement(
          "button",
          {
            className: "mh-btn",
            onClick: () => onContact && onContact(listing),
          },
          t.contact
        )
      )
    )
  );
}

function ContactModal({ listing, onClose }) {
  if (!listing) return null;
  const phone = listing.contactPhone || listing.phone || "";
  const wa = phone ? `https://wa.me/${phone.replace(/[^0-9]/g, "")}` : null;
  return React.createElement(
    "div",
    { className: "mh-modal", onClick: onClose },
    React.createElement(
      "div",
      { className: "mh-modal-card", onClick: (e) => e.stopPropagation() },
      React.createElement(
        "h3",
        { style: { margin: "0 0 8px 0" } },
        listing.title || "Wasiliana"
      ),
      React.createElement(
        "p",
        { className: "mh-muted", style: { marginTop: 0 } },
        listing.location || ""
      ),
      React.createElement(
        "div",
        { className: "mh-grid two", style: { marginTop: 12 } },
        phone
          ? React.createElement(
              "a",
              {
                className: "mh-btn",
                href: `tel:${phone}`,
              },
              "Piga Simu"
            )
          : null,
        wa
          ? React.createElement(
              "a",
              {
                className: "mh-btn secondary",
                href: wa,
                target: "_blank",
              },
              "WhatsApp"
            )
          : null,
        phone
          ? React.createElement(
              "a",
              { className: "mh-btn secondary", href: `sms:${phone}` },
              "SMS"
            )
          : null
      ),
      React.createElement(
        "button",
        {
          className: "mh-btn secondary",
          style: { width: "100%", marginTop: 14 },
          onClick: onClose,
        },
        "Close"
      )
    )
  );
}

function MarketingHubAppShell({ lang = "sw" }) {
  const t = useLangStrings(lang);
  const { hasFb, db, auth } = useFirebase();
  const [mode, setMode] = React.useState("landing"); // landing | buyer | seller
  const [listings, setListings] = React.useState([]);
  const [liked, setLiked] = React.useState({});
  const [contactItem, setContactItem] = React.useState(null);
  const [filters, setFilters] = React.useState({
    q: "",
    category: "",
    location: "",
    delivery: "",
    payOnDelivery: "",
    itemType: "",
    min: "",
    max: "",
  });
  const [langState, setLang] = React.useState(lang);
  const strings = useLangStrings(langState);

  React.useEffect(() => {
    ensureAnonAuth(auth).catch(() => {});
  }, [auth]);

  React.useEffect(() => {
    ensureAnonAuth(auth).then((user) => {
      if (hasFb && db && user) {
        const likesRef = db.ref(`marketinghub/public/likes`);
        likesRef.on("value", (snap) => {
          const val = snap.val() || {};
          const userLikes = {};
          Object.entries(val).forEach(([listingId, users]) => {
            if (users && users[user.uid]) userLikes[listingId] = true;
          });
          setLiked(userLikes);
        });
        const listRef = db.ref("marketinghub/public/listings").limitToLast(50);
        listRef.on("value", (snap) => {
          const val = snap.val() || {};
          const arr = Object.entries(val)
            .map(([id, v]) => ({ id, ...v }))
            .filter((x) => (x.status || "approved") !== "rejected");
          arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          setListings(arr);
        });
        return () => {
          listRef.off();
          likesRef.off();
        };
      }
      // fallback demo data
      setListings([
        {
          id: "demo-1",
          title: "Samaki ya Mama Omary",
          price: 12000,
          category: "Chakula",
          location: "Kitengela",
          itemType: "Samaki",
          delivery: true,
          payOnDelivery: true,
          photos: [
            "https://images.pexels.com/photos/3296273/pexels-photo-3296273.jpeg?auto=compress&cs=tinysrgb&h=400",
          ],
          contactPhone: "255686828732",
        },
        {
          id: "demo-2",
          title: "Uniformu za Shule",
          price: 25000,
          category: "Uniformu",
          itemType: "t-shirt",
          location: "Dar es Salaam",
          delivery: true,
          payOnDelivery: false,
          photos: [
            "https://images.pexels.com/photos/1250402/pexels-photo-1250402.jpeg?auto=compress&cs=tinysrgb&h=400",
          ],
          contactPhone: "254704479105",
        },
      ]);
    });
  }, [hasFb, db, auth]);

  function handleLike(item) {
    if (!auth) return;
    ensureAnonAuth(auth).then((user) => {
      if (!user) return;
      if (hasFb && db) {
        db.ref(`marketinghub/public/likes/${item.id}/${user.uid}`).set(true);
      }
      setLiked((prev) => ({ ...prev, [item.id]: true }));
    });
  }

  function handleContact(item) {
    if (hasFb && auth && db) {
      ensureAnonAuth(auth).then((user) => {
        if (user) {
          db.ref(`marketinghub/private/analytics/contactClicked`).push({
            listingId: item.id,
            actor: user.uid,
            at: Date.now(),
          });
        }
      });
    }
    setContactItem(item);
  }

  const filtered = listings.filter((item) => {
    const q = filters.q.toLowerCase();
    const matchesQ =
      !q ||
      (item.title || "").toLowerCase().includes(q) ||
      (item.location || "").toLowerCase().includes(q) ||
      (item.category || "").toLowerCase().includes(q);
    const matchesCat =
      !filters.category ||
      (item.category || "")
        .toLowerCase()
        .includes(filters.category.toLowerCase());
    const matchesLoc =
      !filters.location ||
      (item.location || "")
        .toLowerCase()
        .includes(filters.location.toLowerCase());
    const matchesDelivery =
      filters.delivery === "" || String(item.delivery) === filters.delivery;
    const matchesPOD =
      filters.payOnDelivery === "" ||
      String(item.payOnDelivery) === filters.payOnDelivery;
    const matchesType = !filters.itemType || item.itemType === filters.itemType;

    const minOk =
      !filters.min || Number(item.price || 0) >= Number(filters.min);
    const maxOk =
      !filters.max || Number(item.price || 0) <= Number(filters.max);
    return (
      matchesQ &&
      matchesCat &&
      matchesLoc &&
      matchesDelivery &&
      matchesPOD &&
      matchesType &&
      minOk &&
      maxOk
    );
  });

  function SellerPanel() {
    const { hasFb, db, auth } = useFirebase();

    /* ---------- AUTH STATE ---------- */
    const [email, setEmail] = React.useState("");
    const [pass, setPass] = React.useState("");
    const [status, setStatus] = React.useState("");

    /* ---------- PRODUCT STATE ---------- */
    const [product, setProduct] = React.useState({
      title: "",
      itemType: "",
      category: "",
      price: "",
      available: true,
    });

    /* ---------- SIGN IN / REGISTER ---------- */
    function signInSeller() {
      if (!auth) return;
      setStatus("Signing in…");

      auth
        .signInWithEmailAndPassword(email, pass)
        .then(() => setStatus("Signed in successfully"))
        .catch(() =>
          auth
            .createUserWithEmailAndPassword(email, pass)
            .then(() => setStatus("Seller account created"))
            .catch((err) => setStatus(err.message || "Authentication error"))
        );
    }

    /* ---------- ADD PRODUCT (SAFE MODE) ---------- */
    async function submitProduct() {
      if (!hasFb || !db || !auth || !auth.currentUser) {
        setStatus("Please sign in as seller first.");
        return;
      }

      if (!product.title || !product.itemType || !product.price) {
        setStatus("Title, item type, and price are required.");
        return;
      }

      try {
        const uid = auth.currentUser.uid;

        const listingRef = db.ref("marketinghub/public/listings").push();

        await listingRef.set({
          title: product.title,
          itemType: product.itemType,
          category: product.category || "",
          price: Number(product.price),
          available: product.available,
          sellerId: uid,
          createdAt: Date.now(),
          status: "pending", // safe default
        });

        setStatus("Product saved (images coming next).");
        setProduct({
          title: "",
          itemType: "",
          category: "",
          price: "",
          available: true,
        });
      } catch (err) {
        setStatus(err.message || "Failed to save product.");
      }
    }

    /* ---------- UI ---------- */
    return React.createElement(
      "div",
      { className: "mh-app-card" },

      /* --- SELLER LOGIN --- */
      React.createElement(
        "div",
        { className: "mh-section-title" },
        "Seller Login"
      ),
      React.createElement("input", {
        className: "mh-input",
        placeholder: "Email",
        value: email,
        onChange: (e) => setEmail(e.target.value),
        type: "email",
      }),
      React.createElement("input", {
        className: "mh-input",
        placeholder: "Password",
        value: pass,
        onChange: (e) => setPass(e.target.value),
        type: "password",
      }),
      React.createElement(
        "button",
        { className: "mh-btn", onClick: signInSeller },
        "Sign in / Create Seller"
      ),

      /* --- ADD PRODUCT --- */
      React.createElement(
        "div",
        { className: "mh-section-title", style: { marginTop: 20 } },
        "Add Product"
      ),
      React.createElement("input", {
        className: "mh-input",
        placeholder: "Product title",
        value: product.title,
        onChange: (e) => setProduct({ ...product, title: e.target.value }),
      }),
      React.createElement(
        "select",
        {
          className: "mh-select",
          value: product.itemType,
          onChange: (e) => setProduct({ ...product, itemType: e.target.value }),
        },
        React.createElement("option", { value: "" }, "Select item type"),
        React.createElement("option", { value: "tshirt" }, "T-Shirt"),
        React.createElement("option", { value: "shoes" }, "Shoes"),
        React.createElement("option", { value: "tie" }, "Tie")
      ),
      React.createElement("input", {
        className: "mh-input",
        placeholder: "Category (e.g. Uniform)",
        value: product.category,
        onChange: (e) => setProduct({ ...product, category: e.target.value }),
      }),
      React.createElement("input", {
        className: "mh-input",
        type: "number",
        placeholder: "Price (TZS)",
        value: product.price,
        onChange: (e) => setProduct({ ...product, price: e.target.value }),
      }),
      React.createElement(
        "label",
        { style: { display: "flex", gap: 8 } },
        React.createElement("input", {
          type: "checkbox",
          checked: product.available,
          onChange: (e) =>
            setProduct({ ...product, available: e.target.checked }),
        }),
        "Available"
      ),
      React.createElement(
        "button",
        { className: "mh-btn", onClick: submitProduct },
        "Save Product"
      ),

      React.createElement(
        "p",
        { className: "mh-muted", style: { marginTop: 10 } },
        status
      )
    );
  }

  if (mode === "landing") {
    return React.createElement(
      "div",
      { className: "mh-app-shell" },
      React.createElement(
        "header",
        { className: "mh-app-header" },
        React.createElement(
          "div",
          {
            style: {
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            },
          },
          React.createElement(
            "h1",
            { style: { margin: 0, fontSize: "2rem", fontWeight: 800 } },
            strings.appTitle
          ),
          React.createElement(
            "div",
            { className: "mh-lang-toggle" },
            ["sw", "en"].map((code) =>
              React.createElement(
                "button",
                {
                  key: code,
                  className: code === langState ? "active" : "",
                  onClick: () => setLang(code),
                },
                code.toUpperCase()
              )
            )
          )
        ),
        React.createElement(
          "p",
          { className: "mh-muted", style: { marginTop: 6 } },
          strings.landingLead
        ),
        React.createElement(
          "div",
          {
            style: {
              display: "flex",
              gap: 12,
              marginTop: 16,
              flexWrap: "wrap",
            },
          },
          React.createElement(
            "button",
            { className: "mh-btn", onClick: () => setMode("buyer") },
            strings.enterBuyer
          ),
          React.createElement(
            "button",
            { className: "mh-btn secondary", onClick: () => setMode("seller") },
            strings.enterSeller
          )
        )
      ),
      React.createElement(
        "main",
        {
          style: {
            maxWidth: "1100px",
            margin: "0 auto",
            padding: "0 20px 30px",
          },
        },
        React.createElement(
          "div",
          { className: "mh-grid two" },
          React.createElement(
            "div",
            { className: "mh-app-card" },
            React.createElement(
              "div",
              { className: "mh-section-title" },
              strings.buyer
            ),
            React.createElement(
              "p",
              { className: "mh-muted" },
              "Hakuna login. Browse, like, wasiliana moja kwa moja."
            )
          ),
          React.createElement(
            "div",
            { className: "mh-app-card" },
            React.createElement(
              "div",
              { className: "mh-section-title" },
              strings.seller
            ),
            React.createElement(
              "p",
              { className: "mh-muted" },
              "Muuzaji lazima athibitishwe (KYC, NIDA/ID, mawasiliano)."
            )
          )
        )
      )
    );
  }

  if (mode === "seller") {
    return React.createElement(
      "div",
      { className: "mh-app-shell" },
      React.createElement(
        "header",
        { className: "mh-app-header" },
        React.createElement(
          "h1",
          { style: { margin: 0, fontSize: "1.6rem", fontWeight: 800 } },
          strings.seller
        ),
        React.createElement(
          "p",
          { className: "mh-muted" },
          "Usalama kwanza: KYC, mawasiliano, na ukomo wa upakiaji."
        )
      ),
      React.createElement(
        "main",
        {
          style: {
            maxWidth: "1100px",
            margin: "0 auto",
            padding: "0 20px 40px",
          },
        },
        React.createElement(SellerPanel, null)
      )
    );
  }

  // Buyer mode
  return React.createElement(
    "div",
    { className: "mh-app-shell" },
    React.createElement(
      "header",
      { className: "mh-app-header" },
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
          },
        },
        React.createElement(
          "h1",
          { style: { margin: 0, fontSize: "1.8rem", fontWeight: 800 } },
          strings.buyer
        ),
        React.createElement(
          "div",
          { className: "mh-lang-toggle" },
          ["sw", "en"].map((code) =>
            React.createElement(
              "button",
              {
                key: code,
                className: code === langState ? "active" : "",
                onClick: () => setLang(code),
              },
              code.toUpperCase()
            )
          )
        )
      ),
      React.createElement(
        "p",
        { className: "mh-muted" },
        "Browse bila login ya manual. Tunatumia anonymous auth kurekodi likes na ripoti."
      ),
      React.createElement(
        "div",
        { className: "mh-filters", style: { marginTop: 12 } },
        React.createElement("input", {
          className: "mh-input",
          placeholder: strings.searchPlaceholder,
          value: filters.q,
          onChange: (e) => setFilters({ ...filters, q: e.target.value }),
        }),
        React.createElement("input", {
          className: "mh-input",
          placeholder: strings.category,
          value: filters.category,
          onChange: (e) => setFilters({ ...filters, category: e.target.value }),
        }),
        React.createElement("input", {
          className: "mh-input",
          placeholder: strings.location,
          value: filters.location,
          onChange: (e) => setFilters({ ...filters, location: e.target.value }),
        }),
        React.createElement("input", {
          className: "mh-input",
          placeholder: strings.priceMin,
          type: "number",
          value: filters.min,
          onChange: (e) => setFilters({ ...filters, min: e.target.value }),
        }),
        React.createElement("input", {
          className: "mh-input",
          placeholder: strings.priceMax,
          type: "number",
          value: filters.max,
          onChange: (e) => setFilters({ ...filters, max: e.target.value }),
        }),
        React.createElement(
          "select",
          {
            className: "mh-select",
            value: filters.delivery,
            onChange: (e) =>
              setFilters({ ...filters, delivery: e.target.value }),
          },
          React.createElement("option", { value: "" }, strings.delivery),
          React.createElement("option", { value: "true" }, "Yes"),
          React.createElement("option", { value: "false" }, "No")
        ),
        React.createElement(
          "select",
          {
            className: "mh-select",
            value: filters.payOnDelivery,
            onChange: (e) =>
              setFilters({ ...filters, payOnDelivery: e.target.value }),
          },
          React.createElement("option", { value: "" }, strings.payOnDelivery),
          React.createElement("option", { value: "true" }, "Yes"),
          React.createElement("option", { value: "false" }, "No")
        ),
        React.createElement(
          "select",
          {
            className: "mh-select",
            value: filters.itemType,
            onChange: (e) =>
              setFilters({ ...filters, itemType: e.target.value }),
          },
          React.createElement("option", { value: "" }, "All Items"),
          React.createElement("option", { value: "tshirt" }, "T-Shirt"),
          React.createElement("option", { value: "shoes" }, "Shoes"),
          React.createElement("option", { value: "tie" }, "Tie")
        )
      )
    ),
    React.createElement(
      "main",
      {
        style: { maxWidth: "1100px", margin: "0 auto", padding: "0 20px 40px" },
      },
      React.createElement(
        "div",
        { className: "mh-listings-grid" },
        filtered.map((item) =>
          React.createElement(ListingCard, {
            key: item.id,
            listing: item,
            onLike: handleLike,
            onContact: handleContact,
            liked: liked[item.id],
            lang: langState,
          })
        )
      )
    ),
    React.createElement(ContactModal, {
      listing: contactItem,
      onClose: () => setContactItem(null),
    })
  );
}

// ---- Public mounts ----
export function mountMarketingHubCard({ el, context, lang = "sw" }) {
  if (!el) return;
  ensureStyle();
  ensureReact().then(() => {
    const onClick = () => {
      const url = new URL("./index.html", import.meta.url).href;
      window.open(url, "_blank");
    };
    const root = createRootCompat(el);
    root.render(React.createElement(MarketingCard, { onClick, lang, context }));
  });
}

export function mountMarketingHubApp({ el, lang = "sw" }) {
  if (!el) return;
  ensureStyle();
  ensureReact().then(() => {
    const root = createRootCompat(el);
    root.render(React.createElement(MarketingHubAppShell, { lang }));
  });
}
