(function (global) {
  const STREAM_ALL = "__all__";
  const CLASS_OPTIONS = [
    "Baby Class",
    "Middle Class",
    "Pre Unit Class",
    "Class 1",
    "Class 2",
    "Class 3",
    "Class 4",
    "Class 5",
    "Class 6",
    "Class 7",
  ];

  function titleCase(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function normalizeClassDisplay(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const lower = raw.toLowerCase();
    if (lower.includes("baby")) return "Baby Class";
    if (lower.includes("middle")) return "Middle Class";
    if (lower.includes("pre") || lower.includes("unit") || lower.includes("nursery")) {
      return "Pre Unit Class";
    }
    const match = lower.match(/class\s*(\d+)/) || lower.match(/\b(\d+)\b/);
    if (match) return `Class ${parseInt(match[1], 10)}`;
    return titleCase(raw.replace(/\s+/g, " "));
  }

  function normalizeClassKey(value) {
    return normalizeClassDisplay(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function sanitizeStream(value) {
    return String(value || "")
      .replace(/^stream\b/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeStreamKey(value) {
    const cleaned = sanitizeStream(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
    return cleaned || STREAM_ALL;
  }

  function streamDisplay(value) {
    const cleaned = sanitizeStream(value);
    return cleaned ? cleaned.toUpperCase() : "All Streams";
  }

  function formatPhoneLocal(phone) {
    const raw = String(phone || "").trim();
    if (!raw) return "";
    let digits = raw.replace(/\D/g, "");
    if (!digits) return raw;
    if (digits.startsWith("255")) digits = digits.slice(3);
    if (digits.startsWith("0")) return digits;
    if (digits.length === 9) return `0${digits}`;
    return raw;
  }

  function teacherNameFromProfile(profile) {
    return (
      profile?.fullNameUpper ||
      profile?.fullName ||
      [profile?.firstName, profile?.middleName, profile?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      ""
    );
  }

  function teacherSnapshotFromWorker(workerId, worker) {
    const profile = worker?.profile || worker || {};
    const docs = worker?.docs || {};
    const phoneRaw = profile?.phone || profile?.phoneNumber || "";
    const role = String(profile?.role || "").trim();
    return {
      workerId: String(workerId || "").trim(),
      name: teacherNameFromProfile(profile),
      role,
      phoneRaw,
      phone: formatPhoneLocal(phoneRaw),
      photoUrl: docs.passportPhotoUrl || docs.idPhotoUrl || "",
      cvUrl: docs.cvPdfUrl || docs.cvUrl || "",
      active: profile?.active !== false,
    };
  }

  function normalizeAssignmentPerson(person) {
    if (!person || typeof person !== "object") return null;
    const phoneRaw = person.phoneRaw || person.phone || "";
    return {
      workerId: String(person.workerId || person.id || "").trim(),
      name: String(person.name || "").trim(),
      role: String(person.role || "teacher").trim(),
      phoneRaw,
      phone: formatPhoneLocal(phoneRaw),
      photoUrl: String(person.photoUrl || "").trim(),
      cvUrl: String(person.cvUrl || "").trim(),
    };
  }

  function buildAssignmentPayload(input) {
    const className = normalizeClassDisplay(input?.className || input?.class || "");
    const stream = sanitizeStream(input?.stream || "");
    return {
      year: Number(input?.year) || "",
      className,
      classKey: normalizeClassKey(className),
      stream,
      streamKey: normalizeStreamKey(stream),
      classTeacher: normalizeAssignmentPerson(input?.classTeacher),
      assistantTeacher: normalizeAssignmentPerson(input?.assistantTeacher),
      updatedAt: Number(input?.updatedAt) || Date.now(),
      updatedBy: input?.updatedBy
        ? {
            workerId: String(input.updatedBy.workerId || "").trim(),
            name: String(input.updatedBy.name || "").trim(),
          }
        : null,
    };
  }

  function normalizeAssignmentsMap(raw) {
    const out = {};
    Object.entries(raw || {}).forEach(([classKey, bucket]) => {
      if (!bucket || typeof bucket !== "object") return;
      const normalizedClassKey = normalizeClassKey(classKey) || String(classKey || "").trim();
      if (!normalizedClassKey) return;
      out[normalizedClassKey] = out[normalizedClassKey] || {};
      Object.entries(bucket || {}).forEach(([streamKey, value]) => {
        if (!value || typeof value !== "object") return;
        const payload = buildAssignmentPayload({
          ...value,
          className: value.className || classKey,
          stream: value.stream || (streamKey === STREAM_ALL ? "" : streamKey),
        });
        out[normalizedClassKey][payload.streamKey || normalizeStreamKey(streamKey)] = payload;
      });
    });
    return out;
  }

  function resolveAssignment(assignments, className, stream) {
    const normalized = normalizeAssignmentsMap(assignments);
    const classKey = normalizeClassKey(className);
    if (!classKey) return null;
    const bucket = normalized[classKey];
    if (!bucket) return null;
    const streamKey = normalizeStreamKey(stream);
    return bucket[streamKey] || bucket[STREAM_ALL] || Object.values(bucket)[0] || null;
  }

  global.SomapClassTeachers = {
    STREAM_ALL,
    CLASS_OPTIONS,
    normalizeClassDisplay,
    normalizeClassKey,
    sanitizeStream,
    normalizeStreamKey,
    streamDisplay,
    formatPhoneLocal,
    teacherSnapshotFromWorker,
    buildAssignmentPayload,
    normalizeAssignmentsMap,
    resolveAssignment,
  };
})(window);
