async function exportAdmittedCSV() {
  if (!window.db || !window.SOMAP) {
    alert("Database not ready");
    return;
  }

  const fromInput = document.getElementById("csvFrom").value;
  const toInput   = document.getElementById("csvTo").value;
  const referralOnly = document.getElementById("csvReferralOnly").checked;

  const fromTs = fromInput ? new Date(fromInput).setHours(0,0,0,0) : null;
  const toTs   = toInput
    ? new Date(toInput).setHours(23,59,59,999)
    : null;

  const snap = await db.ref(SOMAP.P("admittedStudents")).once("value");
  const raw  = snap.val() || {};

  const rows = [];

  Object.values(raw).forEach(r => {
    if (!r || !r.joinedAt) return;

    if (fromTs && r.joinedAt < fromTs) return;
    if (toTs && r.joinedAt > toTs) return;
    if (referralOnly && !r.referral?.code) return;

    rows.push({
      AdmissionNumber: r.student?.admissionNumber || "",
      StudentName: `${r.student?.firstName || ""} ${r.student?.lastName || ""}`.trim(),
      Class: r.student?.classLevel || "",
      Gender: r.student?.gender || "",
      ParentName: r.parent?.name || "",
      ParentPhone: r.parent?.phone || "",
      AcademicYear: r.academicYear || "",
      ReferralCode: r.referral?.code || "",
      Source: r.source || "",
      JoinedDate: new Date(r.joinedAt).toISOString().slice(0,10)
    });
  });

  if (!rows.length) {
    alert("No records match the selected filters.");
    return;
  }

  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });

  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `admitted_students_${Date.now()}.csv`;
  link.click();
}
async function exportAdmittedExcel() {
  if (!window.db || !window.SOMAP) {
    alert("Database not ready");
    return;
  }

  const fromInput = document.getElementById("csvFrom").value;
  const toInput   = document.getElementById("csvTo").value;
  const referralOnly = document.getElementById("csvReferralOnly").checked;

  const fromTs = fromInput ? new Date(fromInput).setHours(0,0,0,0) : null;
  const toTs   = toInput
    ? new Date(toInput).setHours(23,59,59,999)
    : null;

  const snap = await db.ref(SOMAP.P("admittedStudents")).once("value");
  const raw  = snap.val() || {};

  const rows = [];

  Object.values(raw).forEach(r => {
    if (!r || !r.joinedAt) return;

    if (fromTs && r.joinedAt < fromTs) return;
    if (toTs && r.joinedAt > toTs) return;
    if (referralOnly && !r.referral?.code) return;

    rows.push({
      "Admission Number": r.student?.admissionNumber || "",
      "Student Name": `${r.student?.firstName || ""} ${r.student?.lastName || ""}`.trim(),
      "Class": r.student?.classLevel || "",
      "Gender": r.student?.gender || "",
      "Parent Name": r.parent?.name || "",
      "Parent Phone": r.parent?.phone || "",
      "Academic Year": r.academicYear || "",
      "Referral Code": r.referral?.code || "",
      "Source": r.source || "",
      "Joined Date": new Date(r.joinedAt).toISOString().slice(0,10)
    });
  });

  if (!rows.length) {
    alert("No records match the selected filters.");
    return;
  }

  // Create worksheet
  const worksheet = XLSX.utils.json_to_sheet(rows);

  // Create workbook
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Admitted Students");

  // Export file
  XLSX.writeFile(
    workbook,
    `admitted_students_${Date.now()}.xlsx`
  );
}

