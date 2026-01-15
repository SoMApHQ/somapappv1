function esc(v) {
  return String(v || "").replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[m]));
}

function renderJoinApprovalCard(id, r) {
  const student  = r.studentSnapshot || {};
  const parent   = r.parentSnapshot || {};
  const docs     = r.documents || {};
  const referral = r.referral || null;
  const status   = r.status || "unknown";

  return `
    <div class="bg-white border rounded-xl p-4">
      <div class="flex justify-between items-start">
        <div>
          <h3 class="font-semibold text-lg">
            ${esc(student.firstName)} ${esc(student.lastName)}
          </h3>

          <p class="text-sm text-slate-600">
            Class: <b>${esc(student.classLevel)}</b>
          </p>

          <p class="text-sm text-slate-600">
            Academic Year: ${esc(r.academicYear)}
          </p>

          <p class="text-sm text-slate-600">
            Parent: ${esc(parent.name)} (${esc(parent.phone)})
          </p>

          ${
            referral?.code
              ? `<p class="text-xs mt-1 text-indigo-600">
                   <i class="fas fa-link mr-1"></i>
                   Referred (Code: ${esc(referral.code)})
                 </p>`
              : `<p class="text-xs mt-1 text-slate-400 italic">
                   Direct / Public Join
                 </p>`
          }
        </div>

        ${
          status === "pending"
            ? `
              <div class="flex gap-2">
                <button
                  class="px-3 py-1 text-sm rounded bg-green-600 text-white"
                  onclick="approveRequest('${id}')">
                  Approve
                </button>

                <button
                  class="px-3 py-1 text-sm rounded bg-red-600 text-white"
                  onclick="rejectRequest('${id}')">
                  Reject
                </button>
              </div>
            `
            : `
              <div class="flex gap-2 items-center">
                <span class="text-xs px-2 py-1 rounded bg-slate-200 text-slate-700">
                  ${esc(status.replace(/_/g, " "))}
                </span>

                <button
                  class="px-3 py-1 text-sm rounded bg-red-600 text-white"
                  onclick="deleteRequest('${id}')">
                  Delete
                </button>
              </div>
            `
        }
      </div>

      <div class="mt-3 text-sm">
        <b>Documents:</b>
        <div class="flex flex-wrap gap-3 mt-1">
          ${docs.passportPhotoUrl ? `<a href="${docs.passportPhotoUrl}" target="_blank" class="text-indigo-600 underline">Passport</a>` : ""}
          ${docs.birthCertUrl ? `<a href="${docs.birthCertUrl}" target="_blank" class="text-indigo-600 underline">Birth Cert</a>` : ""}
          ${docs.reportCardUrl ? `<a href="${docs.reportCardUrl}" target="_blank" class="text-indigo-600 underline">Report Card</a>` : ""}
          ${docs.joiningLetterUrl ? `<a href="${docs.joiningLetterUrl}" target="_blank" class="text-indigo-600 underline">Joining Letter</a>` : ""}
          ${docs.medicalDocsUrl ? `<a href="${docs.medicalDocsUrl}" target="_blank" class="text-indigo-600 underline">Medical</a>` : ""}
        </div>
      </div>
    </div>
  `;
}
