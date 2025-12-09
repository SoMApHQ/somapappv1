(function (global) {
  'use strict';

  function num(val) {
    const n = Number(val);
    return Number.isFinite(n) ? n : 0;
  }

  function round2(val) {
    return Math.round((num(val) + Number.EPSILON) * 100) / 100;
  }

  function getYear(rawInputs) {
    const fromPayload = Number(rawInputs?.year || rawInputs?.currentYear);
    if (Number.isFinite(fromPayload) && fromPayload > 1900) return fromPayload;
    const fromMeta = Number((rawInputs?.yearMeta?.yearEndDate || '').slice(0, 4));
    if (Number.isFinite(fromMeta) && fromMeta > 1900) return fromMeta;
    return new Date().getFullYear();
  }

  function sumYearKeys(bucket, year) {
    const y = String(year || '');
    return Object.entries(bucket || {}).reduce((sum, [k, v]) => {
      return k.includes(y) ? sum + num(v) : sum;
    }, 0);
  }

  function pickYearValue(bucket, baseKey, year) {
    const y = String(year || '');
    const direct = bucket ? bucket[baseKey] : undefined;
    if (direct !== undefined) return num(direct);
    const foundKey = Object.keys(bucket || {}).find((k) => k.toLowerCase().includes(baseKey.toLowerCase()) && (y ? k.includes(y) : true));
    if (foundKey) return num(bucket[foundKey]);
    return 0;
  }

  function collectYearItems(bucket, year) {
    const y = String(year || '');
    const items = {};
    Object.entries(bucket || {}).forEach(([k, v]) => {
      if (k.includes(y)) items[k.replace(y, '').replace(/[_-]+$/, '')] = num(v);
    });
    return items;
  }

  function computeClassFeesForYear(classFees = {}, year, financeAggregates = {}) {
    const yFees = classFees?.[year] || {};
    const res = { total: 0, totalStudents: 0, breakdown: {} };
    Object.entries(yFees).forEach(([cls, row]) => {
      const students = num(row.students);
      const feePerStudent = num(row.feePerStudent || row.fee);
      const total = round2(students * feePerStudent);
      res.total += total;
      res.totalStudents += students;
      res.breakdown[cls] = { students, feePerStudent, total };
    });
    if (res.total <= 0 && financeAggregates?.totalFeesExpected) {
      res.total = num(financeAggregates.totalFeesExpected);
    }
    if (res.totalStudents <= 0 && financeAggregates?.totalStudents) {
      res.totalStudents = num(financeAggregates.totalStudents);
    }
    return res;
  }

  function computePpe(ppeInputs = {}) {
    const result = {
      openingCost: 0,
      additions: 0,
      closingCost: 0,
      openingAccumDep: 0,
      depreciation: 0,
      closingAccumDep: 0,
      carryingAmount: 0,
      breakdown: {},
    };
    Object.entries(ppeInputs || {}).forEach(([key, row]) => {
      const openingCost = num(row.openingCost || row.cost);
      const additions = num(row.count) * num(row.costPerUnit);
      const cost = openingCost + additions;
      const openingAccumDep = num(row.openingAccumDep);
      const depRate = num(row.depRate || row.depreciationRate);
      const depreciation = depRate > 0 ? round2(cost * (depRate / 100)) : 0;
      const closingAccumDep = openingAccumDep + depreciation;
      const carryingAmount = cost - closingAccumDep;
      result.breakdown[key] = {
        openingCost,
        additions,
        cost,
        openingAccumDep,
        depreciation,
        closingAccumDep,
        carryingAmount,
        depRate,
      };
      result.openingCost += openingCost;
      result.additions += additions;
      result.closingCost += cost;
      result.openingAccumDep += openingAccumDep;
      result.depreciation += depreciation;
      result.closingAccumDep += closingAccumDep;
      result.carryingAmount += carryingAmount;
    });
    return result;
  }

  function buildNotesForYear(year, rawInputs = {}, financeAggregates = {}, ppeStats = {}) {
    const incomeManual = rawInputs.incomeManual || {};
    const expensesManual = rawInputs.expensesManual || {};
    const assetsManual = rawInputs.assetsManual || {};
    const liabilitiesManual = rawInputs.liabilitiesManual || {};
    const taxManual = rawInputs.taxManual || {};
    const yearStr = String(year || '');
    const matchesYear = (key) => {
      if (!yearStr) return true;
      const hasYearNumber = /\d{4}/.test(String(key));
      return (String(key).includes(yearStr)) || !hasYearNumber;
    };

    const classFeesInfo = computeClassFeesForYear(rawInputs.classFees, year, financeAggregates);
    const otherIncome = sumYearKeys(incomeManual, year);
    const note1 = {
      title: 'Income',
      tuitionFees: classFeesInfo.total,
      otherIncome,
      total: round2(classFeesInfo.total + otherIncome),
      students: classFeesInfo.totalStudents,
      incomeItems: collectYearItems(incomeManual, year),
    };

    const direct = collectYearItems(expensesManual.directExpenses, year);
    const admin = collectYearItems(expensesManual.adminExpenses, year);
    const personnel = collectYearItems(expensesManual.personnelExpenses, year);
    const professional = collectYearItems(expensesManual.professionalExpenses, year);
    const financial = collectYearItems(expensesManual.financialExpenses, year);

    const depreciationOverrideKey = Object.keys(expensesManual.directExpenses || {}).find(
      (k) => k.toLowerCase().includes('depreciation') && k.includes(String(year))
    );
    const depreciationOverride = depreciationOverrideKey
      ? num(expensesManual.directExpenses[depreciationOverrideKey])
      : null;

    const depreciation = depreciationOverride !== null ? depreciationOverride : num(ppeStats.depreciation);
    if (depreciation > 0) {
      direct.depreciation = depreciation;
    }

    const note2 = { title: 'Direct expenses', items: direct, total: round2(Object.values(direct).reduce((s, v) => s + num(v), 0)) };
    const note3 = { title: 'Administrative expenses', items: admin, total: round2(Object.values(admin).reduce((s, v) => s + num(v), 0)) };
    const note4 = { title: 'Personnel expenses', items: personnel, total: round2(Object.values(personnel).reduce((s, v) => s + num(v), 0)) };
    const note5 = { title: 'Professional expenses', items: professional, total: round2(Object.values(professional).reduce((s, v) => s + num(v), 0)) };
    const note6 = { title: 'Financial expenses', items: financial, total: round2(Object.values(financial).reduce((s, v) => s + num(v), 0)) };

    const receivablesKeys = ['debtorsFees', 'debtorsBusFees', 'otherReceivables', 'advanceTax', 'receivable'];
    const receivables = {};
    Object.entries(assetsManual.currentAssets || {}).forEach(([k, v]) => {
      if (receivablesKeys.some((needle) => k.toLowerCase().includes(needle)) && matchesYear(k)) {
        receivables[k] = num(v);
      }
    });
    const note7 = { title: 'Accounts receivable and other current assets', items: receivables, total: round2(Object.values(receivables).reduce((s, v) => s + num(v), 0)) };

    const cashItems = {};
    Object.entries(assetsManual.currentAssets || {}).forEach(([k, v]) => {
      if (['bank', 'cash'].some((needle) => k.toLowerCase().includes(needle)) && matchesYear(k)) {
        cashItems[k] = num(v);
      }
    });
    const note8 = { title: 'Cash and cash equivalents', items: cashItems, total: round2(Object.values(cashItems).reduce((s, v) => s + num(v), 0)) };

    const shareCapital = num(taxManual.shareCapital || taxManual.paidUpCapital || 0);
    const note9 = { title: "Owner's equity / Share capital", items: { shareCapital }, total: round2(shareCapital) };

    const liabilitiesItems = {};
    Object.entries(liabilitiesManual || {}).forEach(([k, v]) => {
      if (!String(k).toLowerCase().includes('tax') && matchesYear(k)) {
        liabilitiesItems[k] = num(v);
      }
    });
    const note11 = { title: 'Accounts payables and accruals', items: liabilitiesItems, total: round2(Object.values(liabilitiesItems).reduce((s, v) => s + num(v), 0)) };

    const taxKey = Object.keys(liabilitiesManual || {}).find((k) => k.toLowerCase().includes('taxpayable') && String(k).includes(String(year)))
      || Object.keys(liabilitiesManual || {}).find((k) => k.toLowerCase().includes('taxpayable'));
    const taxPayable = num(taxKey ? liabilitiesManual[taxKey] : (liabilitiesManual.taxPayable || taxManual.taxPayable));
    const note12 = { title: 'Taxation', items: { taxPayable }, total: round2(taxPayable) };

    return {
      metaYear: year,
      note1,
      note2,
      note3,
      note4,
      note5,
      note6,
      note7,
      note8,
      note9,
      note10: { title: 'Retained earnings', items: {}, total: 0 },
      note11,
      note12,
      ppe: ppeStats,
    };
  }

  function computeTax(pl, notes, taxManual = {}, prevTaxComp = null, year) {
    const taxRate = num(taxManual.taxRate || 30) / 100;
    const wearAndTear = pickYearValue(taxManual, 'wearAndTearDeductionOverride', year) || num(notes?.ppe?.depreciation || 0);
    const taxPaidAdvance = pickYearValue(taxManual, 'taxPaidInAdvance', year);
    const taxableProfit = pl.profitBeforeTax + num(notes?.ppe?.depreciation) - wearAndTear;
    const taxCharge = Math.max(0, round2(taxableProfit * taxRate));
    const taxPayable = round2(taxCharge - taxPaidAdvance);
    return {
      taxRate: taxRate * 100,
      taxableProfit: round2(taxableProfit),
      addBackDepreciation: round2(num(notes?.ppe?.depreciation)),
      wearAndTear,
      taxCharge,
      taxPaidAdvance,
      taxPayable,
      prev: prevTaxComp || null,
    };
  }

  function computeProfitAndLoss(notes) {
    const revenue = num(notes.note1.total);
    const direct = num(notes.note2.total);
    const admin = num(notes.note3.total);
    const personnel = num(notes.note4.total);
    const professional = num(notes.note5.total);
    const financeCosts = num(notes.note6.total);

    const grossProfit = revenue - direct;
    const operatingExpenses = admin + personnel + professional;
    const operatingProfit = grossProfit - operatingExpenses;
    const profitBeforeTax = operatingProfit - financeCosts;

    return {
      revenue,
      directExpenses: direct,
      grossProfit: round2(grossProfit),
      adminExpenses: admin,
      personnelExpenses: personnel,
      professionalExpenses: professional,
      financeCosts,
      operatingProfit: round2(operatingProfit),
      profitBeforeTax: round2(profitBeforeTax),
      taxExpense: 0,
      profitAfterTax: round2(profitBeforeTax),
    };
  }

  function computeRetainedEarnings(pl, taxManual = {}, prevEquity) {
    const openingRetained = num(taxManual.openingRetainedEarnings || prevEquity?.closingRetainedEarnings || prevEquity?.retainedEarnings || 0);
    const drawings = num(taxManual.drawings || 0);
    const currentProfit = num(pl.profitAfterTax);
    const closingRetained = round2(openingRetained + currentProfit - drawings);
    return {
      openingRetained,
      currentProfit,
      drawings,
      closingRetained,
    };
  }

  function computeEquity(note9, retained) {
    const shareCapital = num(note9.total || note9.items?.shareCapital);
    const retainedEarnings = num(retained.closingRetained);
    const totalEquity = round2(shareCapital + retainedEarnings);
    return {
      shareCapital,
      retainedEarnings,
      totalEquity,
    };
  }

  function computeBalanceSheet(notes, pl, equity) {
    const ppe = num(notes.ppe?.carryingAmount);
    const receivables = num(notes.note7.total);
    const cash = num(notes.note8.total);
    const currentAssets = round2(receivables + cash);
    const totalAssets = round2(ppe + currentAssets);

    const payables = num(notes.note11.total);
    const taxLiabilities = num(notes.note12.total);
    const currentLiabilities = round2(payables + taxLiabilities);

    const totalEquityLiabilities = round2(num(equity.totalEquity) + currentLiabilities);

    return {
      assets: {
        propertyPlantEquipment: ppe,
        currentAssets,
        receivables,
        cashAndBank: cash,
        totalAssets,
      },
      equityAndLiabilities: {
        equityTotal: num(equity.totalEquity),
        payables,
        taxLiabilities,
        currentLiabilities,
        totalEquityLiabilities,
      },
    };
  }

  function computeCashFlow(notes, prevNotes, pl, taxComp) {
    const depreciation = num(notes.ppe?.depreciation);
    const profitBeforeTax = num(pl.profitBeforeTax);
    const receivablesChange = num(notes.note7.total) - num(prevNotes?.note7?.total || 0);
    const payablesChange = num(notes.note11.total) - num(prevNotes?.note11?.total || 0);
    const taxPaid = num(taxComp.taxPaidAdvance);

    const cashFromOperations = round2(
      profitBeforeTax + depreciation - receivablesChange + payablesChange - taxPaid
    );
    const capex = -num(notes.ppe?.additions);
    const financeCostsPaid = -num(notes.note6.total);
    const cashFromInvesting = round2(capex);
    const cashFromFinancing = round2(financeCostsPaid);

    const openingCash = num(prevNotes?.note8?.total || 0);
    const netChange = round2(cashFromOperations + cashFromInvesting + cashFromFinancing);
    const closingCash = round2(openingCash + netChange);

    return {
      openingCash,
      cashFromOperations,
      cashFromInvesting,
      cashFromFinancing,
      netChange,
      closingCash,
    };
  }

  function computeFinancialStatements(rawInputs = {}, financeAggregates = {}, prevYearComputed = null) {
    const year = getYear(rawInputs);
    const prevYear = year - 1;

    const ppeCurrent = computePpe(rawInputs?.assetsManual?.ppe || {});
    const notesCurrent = buildNotesForYear(year, rawInputs, financeAggregates, ppeCurrent);
    const notesPrev = prevYearComputed?.notes?.[prevYear] || buildNotesForYear(prevYear, rawInputs, financeAggregates, computePpe(rawInputs?.assetsManual?.ppe || {}));

    const plCurrent = computeProfitAndLoss(notesCurrent);
    const plPrev = prevYearComputed?.pl?.previous || computeProfitAndLoss(notesPrev);

    const taxCurrent = computeTax(plCurrent, notesCurrent, rawInputs.taxManual, prevYearComputed?.taxComputation?.previous, year);
    const taxPrev = prevYearComputed?.taxComputation?.current || computeTax(plPrev, notesPrev, rawInputs.taxManual, null, prevYear);

    plCurrent.taxExpense = num(taxCurrent.taxCharge);
    plCurrent.profitAfterTax = round2(plCurrent.profitBeforeTax - plCurrent.taxExpense);
    plPrev.taxExpense = num(taxPrev.taxCharge);
    plPrev.profitAfterTax = round2(plPrev.profitBeforeTax - plPrev.taxExpense);

    const retainedCurrent = computeRetainedEarnings(plCurrent, rawInputs.taxManual, prevYearComputed?.equity?.current || prevYearComputed?.equity);
    const retainedPrev = prevYearComputed?.equity?.previous?.retainedSchedule || computeRetainedEarnings(plPrev, rawInputs.taxManual, null);

    notesCurrent.note10.total = retainedCurrent.closingRetained;
    notesPrev.note10.total = retainedPrev.closingRetained || retainedPrev.closingRetained === 0 ? retainedPrev.closingRetained : notesPrev.note10.total;

    const equityCurrent = computeEquity(notesCurrent.note9, retainedCurrent);
    const equityPrev = prevYearComputed?.equity?.previous || computeEquity(notesPrev.note9, retainedPrev);

    const bsCurrent = computeBalanceSheet(notesCurrent, plCurrent, equityCurrent);
    const bsPrev = computeBalanceSheet(notesPrev, plPrev, equityPrev);

    const cashCurrent = computeCashFlow(notesCurrent, notesPrev, plCurrent, taxCurrent);
    const cashPrev = computeCashFlow(notesPrev, null, plPrev, taxPrev);

    return {
      meta: { year, prevYear },
      notes: {
        [year]: notesCurrent,
        [prevYear]: notesPrev,
      },
      pl: {
        current: plCurrent,
        previous: plPrev,
      },
      bs: {
        current: bsCurrent,
        previous: bsPrev,
      },
      cashFlow: {
        current: cashCurrent,
        previous: cashPrev,
      },
      equity: {
        current: { ...equityCurrent, retainedSchedule: retainedCurrent },
        previous: { ...equityPrev, retainedSchedule: retainedPrev },
      },
      taxComputation: {
        current: taxCurrent,
        previous: taxPrev,
      },
    };
  }

  global.computeFinancialStatements = computeFinancialStatements;
})(window);
