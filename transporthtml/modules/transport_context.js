(() => {
  const STORAGE_KEYS = {
    school: "somap_school",
    schoolName: "somap_school_name",
    year: "somap_year",
    month: "somap_month",
    day: "somap_day",
  };

  const YEAR_RANGE = (() => {
    const years = [];
    for (let year = 2024; year <= 2042; year += 1) {
      years.push(year);
    }
    return years;
  })();

  const MONTHS = [
    { value: "1", label: "Jan" },
    { value: "2", label: "Feb" },
    { value: "3", label: "Mar" },
    { value: "4", label: "Apr" },
    { value: "5", label: "May" },
    { value: "6", label: "Jun" },
    { value: "7", label: "Jul" },
    { value: "8", label: "Aug" },
    { value: "9", label: "Sep" },
    { value: "10", label: "Oct" },
    { value: "11", label: "Nov" },
    { value: "12", label: "Dec" },
  ];

  function parseQueryContext() {
    if (typeof window === "undefined" || !window.location) {
      return {};
    }
    const overrides = {};
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.has("school")) {
        const school = params.get("school").trim();
        if (school) overrides.school = school;
      }
      if (params.has("schoolName")) {
        const schoolName = params.get("schoolName").trim();
        if (schoolName) overrides.schoolName = schoolName;
      }
      if (params.has("year")) {
        const year = Number(params.get("year"));
        if (Number.isFinite(year) && year >= 2000 && year <= 2100) {
          overrides.year = year;
        }
      }
      if (params.has("month")) {
        const month = Number(params.get("month"));
        if (Number.isFinite(month) && month >= 1 && month <= 12) {
          overrides.month = month;
        }
      }
      if (params.has("day")) {
        const day = Number(params.get("day"));
        if (Number.isFinite(day) && day >= 1 && day <= 31) {
          overrides.day = day;
        }
      }
    } catch (err) {
      console.warn("Unable to parse context query params", err);
    }
    return overrides;
  }

  function getStored(key, fallback) {
    try {
      return localStorage.getItem(STORAGE_KEYS[key]) || fallback;
    } catch (err) {
      return fallback;
    }
  }

  function setStored(key, value) {
    try {
      localStorage.setItem(STORAGE_KEYS[key], value);
    } catch (err) {
      console.warn("Unable to persist context", key, err);
    }
  }

  function getContext() {
    const base = {
      school: getStored("school", "socrates-school"),
      schoolName: getStored("schoolName", "Socrates School"),
      year: Number(getStored("year", String(new Date().getFullYear()))) || 2026,
      month: Number(getStored("month", String(new Date().getMonth() + 1))) || 1,
      day: Number(getStored("day", "1")) || 1,
    };
    const overrides = parseQueryContext();
    const ctx = { ...base, ...overrides };
    
    
    if (overrides.school) setStored("school", ctx.school);
    if (overrides.schoolName) setStored("schoolName", ctx.schoolName);
    if (overrides.year !== undefined) setStored("year", ctx.year);
    if (overrides.month !== undefined) setStored("month", ctx.month);
    if (overrides.day !== undefined) setStored("day", ctx.day);
    return ctx;
  }

  function setContext(partial) {
    const ctx = { ...getContext(), ...partial };
    setStored("school", ctx.school);
    if (partial.schoolName) {
      setStored("schoolName", ctx.schoolName);
    }
    setStored("year", ctx.year);
    setStored("month", ctx.month);
    setStored("day", ctx.day);
    return ctx;
  }

  async function fetchSchools() {
    try {
      const snapshot = await firebase.database().ref("schools").get();
      if (!snapshot.exists()) return null;
      const value = snapshot.val();
      const entries = Object.keys(value).map((key) => ({
        id: key,
        name: value[key].name || key,
      }));
      return entries;
    } catch (err) {
      console.warn("Failed to fetch schools", err);
      return null;
    }
  }

  function createYearButton(year, currentYear, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = year;
    button.className = "btn" + (year === currentYear ? "" : " secondary");
    button.style.padding = "0.35rem 0.75rem";
    button.style.fontSize = "0.85rem";
    if (year === currentYear) {
      button.disabled = true;
    }
    button.addEventListener("click", () => onClick(year));
    return button;
  }

  function buildDayOptions() {
    const options = [];
    for (let day = 1; day <= 31; day += 1) {
      options.push({ value: String(day), label: day });
    }
    return options;
  }

  async function attachContextSelectors(container, onChange) {
    if (!container) return;
    const ctx = getContext();
    container.innerHTML = "";
    container.classList.add("card");

    const topRow = document.createElement("div");
    topRow.className = "flex space center";

    const title = document.createElement("div");
    title.innerHTML = `<h1>TRANSPORT · ${ctx.schoolName}</h1><small>School year focus · ${ctx.year}</small>`;

    const controls = document.createElement("div");
    controls.className = "filter-bar";

    const schoolSelect = document.createElement("select");
    schoolSelect.id = "context-school";
    schoolSelect.innerHTML = `<option value="${ctx.school}">${ctx.schoolName}</option>`;
    controls.appendChild(schoolSelect);

    const yearContainer = document.createElement("div");
    yearContainer.className = "flex";
    yearContainer.style.flexWrap = "wrap";
    YEAR_RANGE.forEach((year) => {
      yearContainer.appendChild(
        createYearButton(year, ctx.year, (selectedYear) => {
          const updated = setContext({ year: selectedYear });
          if (onChange) onChange(updated, "year");
          attachContextSelectors(container, onChange);
        })
      );
    });

    const monthSelect = document.createElement("select");
    monthSelect.id = "context-month";
    MONTHS.forEach(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      if (Number(value) === ctx.month) option.selected = true;
      monthSelect.appendChild(option);
    });

    const daySelect = document.createElement("select");
    daySelect.id = "context-day";
    buildDayOptions().forEach(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      if (Number(value) === ctx.day) option.selected = true;
      daySelect.appendChild(option);
    });

    monthSelect.addEventListener("change", () => {
      const updated = setContext({ month: Number(monthSelect.value) });
      if (onChange) onChange(updated, "month");
    });

    daySelect.addEventListener("change", () => {
      const updated = setContext({ day: Number(daySelect.value) });
      if (onChange) onChange(updated, "day");
    });

    controls.appendChild(yearContainer);
    controls.appendChild(monthSelect);
    controls.appendChild(daySelect);

    topRow.appendChild(title);
    topRow.appendChild(controls);
    container.appendChild(topRow);

    // Populate schools asynchronously
    fetchSchools().then((schools) => {
      if (!schools || !schools.length) return;
      schoolSelect.innerHTML = "";
      schools.forEach((school) => {
        const option = document.createElement("option");
        option.value = school.id;
        option.textContent = school.name;
        if (school.id === ctx.school) option.selected = true;
        schoolSelect.appendChild(option);
      });
    });

    schoolSelect.addEventListener("change", (event) => {
      const selectedId = event.target.value;
      const selectedName =
        event.target.options[event.target.selectedIndex].textContent;
      const updated = setContext({
        school: selectedId,
        schoolName: selectedName,
      });
      if (onChange) onChange(updated, "school");
      attachContextSelectors(container, onChange);
    });
  }

  window.TransportContext = {
    getContext,
    setContext,
    parseQueryContext,
    attachContextSelectors,
  };
})();
