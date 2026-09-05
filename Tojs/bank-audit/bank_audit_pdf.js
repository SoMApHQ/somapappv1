(function(global) {
  'use strict';
  const money = value => value == null ? 'Not reported' : global.SomapBankAuditEngine.formatTsh(value);
  const sourceLabels = { pdf: 'PDF', xls: 'XLS', xlsx: 'XLSX', csv: 'CSV' };
  async function createDocument(audit) {
    if (!global.jspdf?.jsPDF) throw new Error('PDF library missing.');
    if (!audit.validation?.valid) throw new Error('Reparse and validate this statement before generating a successful audit report.');
    const doc = new global.jspdf.jsPDF({orientation:'portrait',unit:'pt',format:'a4',compress:true});
    const margin=36, width=doc.internal.pageSize.getWidth(), height=doc.internal.pageSize.getHeight();
    const masked = audit.statement?.accountNumber ? '••••' + audit.statement.accountNumber.slice(-4) : 'Not reported';
    let y=80, logo=null;
    try {
      const response=await fetch(audit.schoolLogoUrl || '../images/somap-logo.png.jpg');
      if(response.ok) { const blob=await response.blob(); logo=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);}); }
    } catch (_) {}
    function header() {
      doc.setFillColor(15,23,42);doc.rect(0,0,width,58,'F');
      if(logo) doc.addImage(logo, margin,10,34,34);
      doc.setTextColor(255,255,255);doc.setFontSize(14);doc.text('SoMAp Bank Audit & Analyzer',logo?82:margin,28);
      doc.setFontSize(9);doc.text(String(audit.schoolName || 'Company financial accountability'),logo?82:margin,44);doc.setTextColor(15,23,42);
    }
    // Ordinary topics continue on the current page. A page break is only forced before a
    // genuinely new report part (see newPart) or when too little room remains for a heading
    // plus its first row, so a title is never stranded alone at the bottom of a page.
    function ensureSpace(minHeight) { if (y > height - minHeight) { doc.addPage(); header(); y = 80; } }
    function heading(title) { ensureSpace(140); doc.setFontSize(13); doc.text(title,margin,y); y+=22; }
    function newPart(title) { doc.addPage(); header(); y=80; heading(title); }
    function table(head,body) {
      doc.autoTable({startY:y,head:[head],body:body.length?body:[['No records.']],showHead:'everyPage',
        margin:{left:margin,right:margin,top:78,bottom:52},
        styles:{fontSize:10,cellPadding:6,overflow:'linebreak'},headStyles:{fillColor:[30,64,175],fontSize:10},
        alternateRowStyles:{fillColor:[245,248,252]},pageBreak:'auto',rowPageBreak:'avoid',didDrawPage:header});
      y=doc.lastAutoTable.finalY+16;
    }
    function cards(title,rows,forceBreak) {
      if (forceBreak) { doc.addPage(); header(); y=80; }
      heading(title);
      if(!rows.length) {table(['Status'],[['No records.']]);return;}
      rows.forEach(t=>{
        table(['Transaction','Details'],[
          ['Posting',`${t.date} (${t.dayOfWeek}) ${t.postingTime || ''}`],
          ['References',`Bank: ${t.bankReference || t.reference || 'Not stated'}\nPayment: ${t.paymentReference || 'Not stated'}`],
          ['Name and sender',`${t.detectedStudentName || 'Child name not stated'} | ${t.extractedClass || ''}\nSender: ${t.sender || 'Not stated'}`],
          ['Purpose and category',`${t.writtenPurpose || 'Not stated'} | ${t.category}`],
          ['Accounting',`Debit: ${money(t.moneyOut)}\nCredit: ${money(t.moneyIn)}\nBook balance: ${money(t.balance)}`],
          ['Student match / allocation',`${t.studentMatch?.name || 'Awaiting manual matching'}\n${t.allocationStatus || 'Unallocated'} | Confidence: ${t.studentMatch?.confidence ?? 'Not assessed'}`],
          ['Original narration',t.rawNarration || t.description || 'Not stated'],
          ['Review note',(t.reviewFlags || []).join('; ') || 'No automatic flags']
        ]);
      });
    }
    header();heading('Company Financial Accountability Report');
    table(['Report','Information'],[['Statement period',`${audit.statementPeriodFrom} to ${audit.statementPeriodTo}`],['Bank / account',`${audit.bankName || 'CRDB'} / ${masked}`],['Source',`${sourceLabels[audit.sourceType] || 'Statement'} statement`],['Source file',audit.uploadedFileName || 'Not reported'],['Purpose','Company reconciliation and supporting-evidence review. The same rules apply to every account operator and recipient.'],['Parser',audit.parserVersion],['Generated',new Date().toISOString()]]);
    newPart('Company and account information');
    table(['Field','Statement value'],Object.entries(audit.statement || {}).map(([k,v])=>[k,k==='accountNumber'?masked:String(v ?? 'Not reported')]));
    heading('Executive summary');
    table(['Metric','Value'],Object.entries(audit.totals || {}).map(([k,v])=>[k,/Count|Items/.test(k)?String(v):money(v)]));
    heading('Statement reconciliation');
    table(['Balance concept','Value'],[['Implied opening book balance',money(audit.totals.openingBalance)],['Printed book balance',money(audit.statement?.bookBalance)],['Printed cleared balance',money(audit.statement?.clearedBalance)],['Available balance',money(audit.statement?.availableBalance)],['Transaction-derived balance',money(audit.totals.recalculatedClosingBalance)]]);
    heading('Category totals');table(['Category','Amount'],Object.entries(audit.categoryTotals).map(([k,v])=>[k,money(v)]));
    const txns=audit.transactions || [], income=txns.filter(t=>t.moneyIn>0);
    cards('Complete incoming-payment ledger and student trace',income,true);
    cards('Transport collection register',income.filter(t=>t.category==='Transport / Usafiri'));
    cards('Remedial collection register',income.filter(t=>t.category==='Remedial'));
    cards('Graduation collection register',income.filter(t=>t.category==='Graduation'));
    cards('Named payments with unclear purpose',income.filter(t=>t.detectedStudentName&&t.category==='Unknown income'));
    cards('Known purpose without child name',income.filter(t=>!t.detectedStudentName&&t.category!=='Unknown income'));
    cards('Neither name nor purpose',income.filter(t=>!t.detectedStudentName&&t.category==='Unknown income'));
    newPart('Grouped withdrawal register and transfer charges');
    (audit.withdrawalEvents || []).forEach(w=>table(['Withdrawal','Evidence'],[['Posting',`${w.date} (${w.dayOfWeek}) ${w.postingTime}`],['Bank reference',w.bankReference || w.reference],['Recipient / account',`${w.recipient || 'Not stated'} / ${w.recipientAccount || 'Not stated'}`],['Principal',money(w.amountWithdrawn)],['Charges',money(w.charges)],['Total bank debit',money(w.totalImpact)],['Principal / charge basis',w.principalBasis],['Narration',w.rawNarration || w.description],['Business purpose',w.businessPurpose],['Evidence / reviewer / status',`${w.evidence} / ${w.reviewer || 'Not assigned'} / ${w.reviewStatus}`]]));
    cards('Raw withdrawal-line appendix',txns.filter(t=>t.moneyOut>0));
    heading('Running-balance discontinuities');table(['Posting / transaction','Expected / printed / difference'],(audit.discontinuities || []).map(d=>[`${d.date} / ${d.transactionId}`,`${money(d.expected)} / ${money(d.displayed)} / ${money(d.difference)}`]));
    cards('Review items and supporting-evidence status',audit.reviewItems || []);
    newPart('Governance recommendations');table(['Company records'],[['Purpose not stated in bank narration: supporting documentation required for company records.'],['Confirm ambiguous incoming-payment purposes with the payer. Preserve AB references for finance reconciliation.'],['Resolve running-balance discontinuities against the original statement.'],['Apply the same documentation rule to every account operator and recipient.']]);
    cards('Full raw transaction appendix',txns);
    newPart('Report-generation details');table(['Field','Value'],[['Parser version',audit.parserVersion],['Audit ID',audit.id || 'Unsaved preview'],['Source SHA-256',audit.parserMeta?.sourceHash || 'Not available'],['Generated at',new Date().toISOString()],['Generated by',audit.reparsedBy?.email || audit.uploadedBy?.email || 'Current signed-in reviewer'],['Validation','Passed statement checks'],['Prior analysis versions',String(Object.keys(audit.history || {}).length)]]);
    const count=doc.getNumberOfPages();
    for(let n=1;n<=count;n++){doc.setPage(n);doc.setTextColor(71,85,105);doc.setFontSize(9);doc.text(`Confidential | Account ${masked} | Page ${n} of ${count}`,margin,height-30);doc.text(`${audit.statementPeriodFrom} to ${audit.statementPeriodTo}`,margin,height-17);}
    return doc;
  }
  function fileName(audit){return `SoMAp_Bank_Audit_${audit.bankName || 'Statement'}_${audit.year || ''}_${audit.id || 'preview'}.pdf`.replace(/[^\w.-]+/g,'_');}
  async function toBlob(audit){return (await createDocument(audit)).output('blob');}
  async function download(audit){(await createDocument(audit)).save(fileName(audit));}
  global.SomapBankAuditPdf={createDocument,toBlob,download,fileName};
})(window);
