
const { useState, useEffect, createElement: h, Fragment } = React;

// --- Config & Helpers ---
const SCHOOL_ID = localStorage.getItem('somap.currentSchoolId');
const WORKER_ID = localStorage.getItem('workerId');
const YEAR_KEY = localStorage.getItem('workers.yearKey') || new Date().getFullYear().toString();

const getDbPath = (path) => {
  const base = SCHOOL_ID ? `schools/${SCHOOL_ID}/usafi/${YEAR_KEY}` : `usafi/${YEAR_KEY}`;
  return `${base}/${path}`;
};

const localTs = () => new Date().toISOString();
const todayYMD = () => new Date().toISOString().split('T')[0];

const toast = (msg, type = 'info') => {
  // Simple toast fallback if workers_ui.js toast isn't available or just alert
  const div = document.createElement('div');
  div.className = `workers-toast workers-toast-${type} visible`;
  div.textContent = msg;
  div.style.position = 'fixed';
  div.style.top = '20px';
  div.style.right = '20px';
  div.style.zIndex = '9999';
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
};

// --- Seed Data ---
const SEED_FACILITIES = [
  { id: 'toilets_girls', name: 'Vyoo (Wasichana)', count: 0 },
  { id: 'toilets_boys', name: 'Vyoo (Wavulana)', count: 0 },
  { id: 'toilets_staff', name: 'Vyoo (Walimu)', count: 0 },
  { id: 'taps_inside', name: 'Mabomba (Ndani)', count: 0 },
  { id: 'taps_outside', name: 'Mabomba (Nje)', count: 0 },
];
const SEED_EQUIPMENT = [
  { name: 'Fagio', qtyTotal: 0 },
  { name: 'Mop', qtyTotal: 0 },
  { name: 'Ndoo', qtyTotal: 0 },
  { name: 'Beseni', qtyTotal: 0 },
  { name: 'Gloves', qtyTotal: 0 },
];
const SEED_MATERIALS = [
  { name: 'Sabuni (Lita)', unit: 'L' },
  { name: 'Bleach (Lita)', unit: 'L' },
  { name: 'Disinfectant (Lita)', unit: 'L' },
  { name: 'Tissue', unit: 'Pkt' },
];

// --- Main App Component ---
function App() {
  const [view, setView] = useState('daily'); // daily, facilities, equipment, materials, weekly
  const [loading, setLoading] = useState(true);
  const [workerProfile, setWorkerProfile] = useState(null);
  const [dateKey, setDateKey] = useState(todayYMD());
  
  // Data
  const [facilities, setFacilities] = useState({});
  const [equipment, setEquipment] = useState({});
  const [materials, setMaterials] = useState({});
  const [dailyReport, setDailyReport] = useState(null);

  // Load User & Initial Data
  useEffect(() => {
    checkAuth().then(async (profile) => {
      if (profile) {
        setWorkerProfile(profile);
        await loadMasterData();
        await loadDailyReport(dateKey);
        setLoading(false);
      }
    });
  }, []);

  // Reload daily report when date changes
  useEffect(() => {
    if (workerProfile) {
      loadDailyReport(dateKey);
    }
  }, [dateKey]);

  async function checkAuth() {
    if (!WORKER_ID) {
      window.location.href = '../index.html?login=1';
      return null;
    }
    try {
      // Check profile in standard path
      const snap = await firebase.database().ref(`workers/${WORKER_ID}/profile`).once('value');
      const p = snap.val();
      if (!p) throw new Error('Profile not found');
      
      // Allow cleaner or admin
      const isAdmin = localStorage.getItem('somap_admin_auth'); 
      if (p.role !== 'cleaner' && !isAdmin) {
        alert('Access denied: Cleaners only');
        window.location.href = '../index.html';
        return null;
      }
      return p;
    } catch (e) {
      console.error(e);
      window.location.href = '../index.html?login=1';
      return null;
    }
  }

  async function loadMasterData() {
    const base = getDbPath('');
    const snap = await firebase.database().ref(base).once('value');
    const val = snap.val() || {};
    
    // Seed if empty
    if (!val.seeded) {
      await seedData();
      return loadMasterData(); // reload
    }
    
    setFacilities(val.facilities || {});
    setEquipment(val.equipment || {});
    setMaterials(val.materials || {});
  }

  async function seedData() {
    const updates = {};
    SEED_FACILITIES.forEach(f => {
      const id = f.id; 
      updates[`facilities/${id}`] = { ...f, updatedTs: localTs() };
    });
    SEED_EQUIPMENT.forEach((e, i) => {
      const id = `eq_${Date.now()}_${i}`;
      updates[`equipment/${id}`] = { ...e, active: true, updatedTs: localTs() };
    });
    SEED_MATERIALS.forEach((m, i) => {
      const id = `mat_${Date.now()}_${i}`;
      updates[`materials/${id}`] = { ...m, qtyNow: 0, active: true, updatedTs: localTs() };
    });
    updates['seeded'] = true;
    
    await firebase.database().ref(getDbPath('')).update(updates);
  }

  async function loadDailyReport(date) {
    const path = getDbPath(`daily/${date}/${WORKER_ID}`);
    const snap = await firebase.database().ref(path).once('value');
    setDailyReport(snap.val() || null);
  }

  // --- Sub-components ---

  const StatCard = ({ label, value, status }) => {
    let statusClass = 'status-badge ';
    if (status === 'good' || status === true) statusClass += 'status-ok';
    else if (status === 'bad' || status === false) statusClass += 'status-flagged';
    else statusClass += 'status-missing';

    return h('div', { className: 'mini-card text-center' },
      h('p', { className: 'mini-card__label' }, label),
      h('div', { className: 'mini-card__value' }, value),
      h('div', { className: statusClass }, 
        status === true ? 'Yapo/Safi' : 
        status === false ? 'Hakuna/Chafu' : 
        status === 'good' ? 'OK' : 
        status === 'bad' ? 'Tatizo' : '-'
      )
    );
  };

  const TopStats = () => {
    const d = dailyReport || {};
    const water = d.water?.available;
    const toilet = d.toilets?.clean; // boolean or rating
    const soap = d.soap?.available;
    const chamber = d.chamber?.status;

    return h('div', { className: 'quick-cards' },
      h(StatCard, { 
        label: 'Maji', 
        value: water === true ? 'Yapo' : water === false ? 'Hamna' : '-', 
        status: water 
      }),
      h(StatCard, { 
        label: 'Vyoo', 
        value: toilet ? 'Safi' : '?', 
        status: toilet 
      }),
      h(StatCard, { 
        label: 'Sabuni', 
        value: soap === true ? 'Ipo' : soap === false ? 'Hamna' : '-', 
        status: soap 
      }),
      h(StatCard, { 
        label: 'Chamber', 
        value: chamber === 'full' ? 'Imejaa!' : chamber === 'near_full' ? 'Karibu' : 'OK', 
        status: chamber === 'full' ? 'bad' : 'good' 
      })
    );
  };

  const TabNav = () => {
    const tabs = [
      { id: 'daily', label: 'Ripoti ya Leo' },
      { id: 'materials', label: 'Vifaa (Sabuni/Bleach)' },
      { id: 'equipment', label: 'Vifaa (Fagio/Ndoo)' },
      { id: 'facilities', label: 'Majengo/Maji' },
      { id: 'weekly', label: 'Ripoti ya Wiki (PDF)' },
    ];
    return h('div', { className: 'tab-strip' },
      tabs.map(t => h('button', {
        key: t.id,
        className: `tab-btn ${view === t.id ? 'active' : ''}`,
        onClick: () => setView(t.id)
      }, t.label))
    );
  };

  // --- Views ---

  const DailyReportView = () => {
    const [form, setForm] = useState(dailyReport || {
      water: { available: true, enough: true, note: '' },
      toilets: { clean: true, rating: 5, note: '' },
      soap: { available: true },
      bleach: { available: true },
      usage: { soap_ml: 0, bleach_ml: 0 },
      chamber: { status: 'ok', truckCalled: false, company: '', cost: 0, note: '' },
      tasks: { classesCleanedCount: 0, office: false, corridors: false, gardenWatered: false, gardenGreen: false },
      notes: ''
    });

    const updateForm = (path, val) => {
      const keys = path.split('.');
      if (keys.length === 1) {
        setForm(prev => ({ ...prev, [keys[0]]: val }));
      } else {
        setForm(prev => ({
          ...prev,
          [keys[0]]: { ...prev[keys[0]], [keys[1]]: val }
        }));
      }
    };

    const handleSave = async () => {
      const path = getDbPath(`daily/${dateKey}/${WORKER_ID}`);
      const data = {
        ...form,
        createdTs: dailyReport?.createdTs || localTs(),
        updatedTs: localTs()
      };
      await firebase.database().ref(path).set(data);
      setDailyReport(data);
      toast('Ripoti imehifadhiwa!', 'success');
    };

    return h('div', { className: 'workers-card' },
      h('header', { className: 'workers-card__header space-between' },
        h('h2', null, `Ripoti: ${dateKey}`),
        h('div', { className: 'flex', style: { gap: '10px', alignItems: 'center'} },
          h('label', null, 'Tarehe: '),
          h('input', { 
            type: 'date', 
            value: dateKey, 
            onChange: (e) => setDateKey(e.target.value) 
          }),
          h('button', { className: 'workers-btn secondary', onClick: () => loadDailyReport(dateKey) }, 'Load')
        )
      ),

      h('div', { className: 'workers-form' },
        
        // Water Section
        h('fieldset', { className: 'workers-fieldset' },
          h('legend', null, '💧 Hali ya Maji'),
          h('div', { className: 'workers-grid' },
            h('label', null, 'Maji yapo?', 
              h('select', { 
                value: form.water.available, 
                onChange: e => updateForm('water.available', e.target.value === 'true') 
              },
                h('option', { value: 'true' }, 'Ndiyo'),
                h('option', { value: 'false' }, 'Hapana')
              )
            ),
            h('label', null, 'Yalitosha?', 
              h('select', { 
                value: form.water.enough, 
                onChange: e => updateForm('water.enough', e.target.value === 'true') 
              },
                h('option', { value: 'true' }, 'Ndiyo'),
                h('option', { value: 'false' }, 'Hapana')
              )
            ),
            h('label', null, 'Maelezo',
              h('input', { 
                type: 'text', 
                value: form.water.note || '', 
                onChange: e => updateForm('water.note', e.target.value) 
              })
            )
          )
        ),

        // Toilets Section
        h('fieldset', { className: 'workers-fieldset' },
          h('legend', null, '🚽 Hali ya Vyoo'),
          h('div', { className: 'workers-grid' },
            h('label', null, 'Viko Safi?', 
              h('select', { 
                value: form.toilets.clean, 
                onChange: e => updateForm('toilets.clean', e.target.value === 'true') 
              },
                h('option', { value: 'true' }, 'Safi'),
                h('option', { value: 'false' }, 'Vichafu')
              )
            ),
            h('label', null, 'Kadiria Usafi (1-5)', 
              h('input', { 
                type: 'range', min: 1, max: 5,
                value: form.toilets.rating || 5, 
                onChange: e => updateForm('toilets.rating', Number(e.target.value)) 
              })
            ),
             h('label', null, 'Maelezo',
              h('input', { 
                type: 'text', 
                value: form.toilets.note || '', 
                onChange: e => updateForm('toilets.note', e.target.value) 
              })
            )
          )
        ),

        // Supplies Check
        h('fieldset', { className: 'workers-fieldset' },
          h('legend', null, '🧼 Vifaa Leo'),
          h('div', { className: 'workers-grid' },
            h('label', null, 'Sabuni Ipo?',
               h('select', { 
                value: form.soap.available, 
                onChange: e => updateForm('soap.available', e.target.value === 'true') 
              },
                h('option', { value: 'true' }, 'Ipo'),
                h('option', { value: 'false' }, 'Imeisha')
              )
            ),
            h('label', null, 'Bleach Ipo?',
              h('select', { 
                value: form.bleach.available, 
                onChange: e => updateForm('bleach.available', e.target.value === 'true') 
              },
                h('option', { value: 'true' }, 'Ipo'),
                h('option', { value: 'false' }, 'Imeisha')
              )
            ),
            // Show purchase note fields if supplies missing
            (!form.soap.available || !form.bleach.available) && h('div', { className: 'workers-error', style: { gridColumn: '1 / -1' } },
               h('p', null, '⚠️ Vifaa vimeisha! Tafadhali jaza hapa:'),
               h('div', { className: 'workers-grid' },
                 h('label', null, 'Nani anunue?', 
                   h('input', { type: 'text', placeholder: 'Jina', onChange: e => updateForm('notes', form.notes + ` [Ununuzi: ${e.target.value}]`) })
                 ),
                 h('label', null, 'Kiasi/Bei?',
                   h('input', { type: 'text', placeholder: 'Tsh', onChange: e => updateForm('notes', form.notes + ` [Gharama: ${e.target.value}]`) })
                 )
               )
            ),
            h('label', null, 'Matumizi Sabuni (ml)',
              h('input', { 
                type: 'number',
                value: form.usage.soap_ml || 0,
                onChange: e => updateForm('usage.soap_ml', Number(e.target.value))
              })
            ),
             h('label', null, 'Matumizi Bleach (ml)',
              h('input', { 
                type: 'number',
                value: form.usage.bleach_ml || 0,
                onChange: e => updateForm('usage.bleach_ml', Number(e.target.value))
              })
            )
          )
        ),

        // Chamber
        h('fieldset', { className: 'workers-fieldset' },
          h('legend', null, '🕳️ Chamber / Septic'),
          h('div', { className: 'workers-grid' },
            h('label', null, 'Hali',
               h('select', { 
                value: form.chamber.status, 
                onChange: e => updateForm('chamber.status', e.target.value) 
              },
                h('option', { value: 'ok' }, 'OK (Iko chini)'),
                h('option', { value: 'near_full' }, 'Inajaa'),
                h('option', { value: 'full' }, 'IMEJAA!')
              )
            ),
             h('label', null, 'Gari limeitwa?',
               h('select', { 
                value: form.chamber.truckCalled, 
                onChange: e => updateForm('chamber.truckCalled', e.target.value === 'true') 
              },
                h('option', { value: 'false' }, 'Hapana'),
                h('option', { value: 'true' }, 'Ndiyo')
              )
            ),
             h('label', null, 'Kampuni',
              h('input', { 
                type: 'text', 
                value: form.chamber.company || '', 
                onChange: e => updateForm('chamber.company', e.target.value) 
              })
            ),
             h('label', null, 'Gharama',
              h('input', { 
                type: 'number', 
                value: form.chamber.cost || 0, 
                onChange: e => updateForm('chamber.cost', Number(e.target.value)) 
              })
            )
          )
        ),

        // Tasks
        h('fieldset', { className: 'workers-fieldset' },
          h('legend', null, '✅ Kazi za Leo'),
          h('div', { className: 'workers-grid' },
            h('label', null, 'Madarasa Mangapi Yamesafishwa?',
              h('input', { 
                type: 'number', 
                value: form.tasks.classesCleanedCount, 
                onChange: e => updateForm('tasks.classesCleanedCount', Number(e.target.value)) 
              })
            ),
            h('div', { className: 'flex', style: { gap: '20px', alignItems: 'center', marginTop: '10px' } },
              h('label', { style: { flexDirection: 'row', alignItems: 'center' } }, 
                h('input', { 
                  type: 'checkbox', 
                  checked: form.tasks.office,
                  onChange: e => updateForm('tasks.office', e.target.checked)
                }), ' Ofisi'
              ),
              h('label', { style: { flexDirection: 'row', alignItems: 'center' } }, 
                h('input', { 
                  type: 'checkbox', 
                  checked: form.tasks.corridors,
                  onChange: e => updateForm('tasks.corridors', e.target.checked)
                }), ' Corridors'
              ),
               h('label', { style: { flexDirection: 'row', alignItems: 'center' } }, 
                h('input', { 
                  type: 'checkbox', 
                  checked: form.tasks.gardenWatered,
                  onChange: e => updateForm('tasks.gardenWatered', e.target.checked)
                }), ' Bustani (Maji)'
              )
            )
          )
        ),
        
        h('label', null, 'Maoni / Notes',
          h('textarea', { 
            value: form.notes, 
            onChange: e => updateForm('notes', e.target.value) 
          })
        ),

        h('button', { className: 'workers-btn primary', onClick: handleSave }, 'Hifadhi Ripoti')
      )
    );
  };

  const MaterialsView = () => {
    // List materials + add stock
    const [newItem, setNewItem] = useState({ name: '', unit: 'L' });
    const [editing, setEditing] = useState(null);

    const saveMaterial = async (id, data) => {
      const path = getDbPath(`materials/${id}`);
      await firebase.database().ref(path).set({ ...data, updatedTs: localTs() });
      await loadMasterData();
      setEditing(null);
      setNewItem({ name: '', unit: 'L' });
    };

    return h('div', { className: 'workers-card' },
      h('h2', null, 'Materials (Vifaa vinavyoisha)'),
      h('table', { className: 'workers-table' },
        h('thead', null, 
          h('tr', null, h('th', null, 'Jina'), h('th', null, 'Kiasi (Stock)'), h('th', null, 'Unit'), h('th', null, 'Action'))
        ),
        h('tbody', null,
          Object.entries(materials).map(([id, mat]) => 
            h('tr', { key: id },
              h('td', null, mat.name),
              h('td', null, 
                editing === id ? 
                h('input', { type: 'number', defaultValue: mat.qtyNow, id: `qty-${id}`, style: {width:'80px'} }) : 
                mat.qtyNow
              ),
              h('td', null, mat.unit),
              h('td', null, 
                editing === id ? 
                  h('button', { className: 'workers-btn success', onClick: () => {
                     const qty = Number(document.getElementById(`qty-${id}`).value);
                     saveMaterial(id, { ...mat, qtyNow: qty });
                  }}, 'Save') :
                  h('button', { className: 'workers-btn secondary', onClick: () => setEditing(id) }, 'Update Stock')
              )
            )
          )
        )
      ),
      h('fieldset', { className: 'workers-fieldset' },
        h('legend', null, 'Ongeza Item Mpya'),
        h('div', { className: 'flex' },
          h('input', { placeholder: 'Jina (mf. Dawa ya mbu)', value: newItem.name, onChange: e => setNewItem({...newItem, name: e.target.value}) }),
          h('select', { value: newItem.unit, onChange: e => setNewItem({...newItem, unit: e.target.value}) },
            h('option', { value: 'L' }, 'Lita'),
            h('option', { value: 'kg' }, 'Kg'),
            h('option', { value: 'Pkt' }, 'Packet'),
            h('option', { value: 'pcs' }, 'Pcs')
          ),
          h('button', { className: 'workers-btn primary', onClick: () => {
            if(!newItem.name) return;
            const id = `mat_${Date.now()}`;
            saveMaterial(id, { ...newItem, qtyNow: 0, active: true });
          }}, 'Ongeza')
        )
      )
    );
  };

  const EquipmentView = () => {
    // List equipment (assets)
     const [newItem, setNewItem] = useState({ name: '', qtyTotal: 1 });

    const saveEq = async (id, data) => {
       const path = getDbPath(`equipment/${id}`);
      await firebase.database().ref(path).set({ ...data, updatedTs: localTs() });
      await loadMasterData();
      setNewItem({ name: '', qtyTotal: 1 });
    };

    return h('div', { className: 'workers-card' },
       h('h2', null, 'Equipment (Vifaa vya Kudumu)'),
       h('table', { className: 'workers-table' },
        h('thead', null, h('tr', null, h('th', null, 'Jina'), h('th', null, 'Idadi'), h('th', null, 'Action'))),
        h('tbody', null,
           Object.entries(equipment).map(([id, eq]) => 
             h('tr', { key: id },
               h('td', null, eq.name),
               h('td', null, eq.qtyTotal),
               h('td', null, 
                 h('button', { className: 'workers-btn danger', onClick: () => {
                   if(confirm('Delete?')) {
                      firebase.database().ref(getDbPath(`equipment/${id}`)).remove();
                      loadMasterData();
                   }
                 }}, 'X')
               )
             )
           )
        )
       ),
       h('fieldset', { className: 'workers-fieldset' },
         h('legend', null, 'Ongeza Equipment'),
         h('div', { className: 'flex' },
           h('input', { placeholder: 'Jina (mf. Rake)', value: newItem.name, onChange: e => setNewItem({...newItem, name: e.target.value}) }),
           h('input', { type:'number', placeholder: 'Idadi', value: newItem.qtyTotal, onChange: e => setNewItem({...newItem, qtyTotal: Number(e.target.value)}) }),
           h('button', { className: 'workers-btn primary', onClick: () => {
             if(!newItem.name) return;
             const id = `eq_${Date.now()}`;
             saveEq(id, { ...newItem, active: true });
           }}, 'Ongeza')
         )
       )
    );
  };
  
  const FacilitiesView = () => {
     // Read-only mostly, maybe update counts
     return h('div', { className: 'workers-card' },
       h('h2', null, 'Majengo & Facilities'),
       h('div', { className: 'workers-grid' },
         Object.entries(facilities).map(([id, f]) => 
           h('div', { className: 'mini-card', key: id },
             h('p', { className: 'mini-card__label' }, f.name),
             h('div', { className: 'mini-card__value' }, f.count || 0),
             h('button', { className: 'workers-btn secondary', style:{marginTop:'8px', fontSize:'0.7rem'}, onClick: async () => {
                const newCount = prompt(`Weka idadi mpya ya ${f.name}:`, f.count);
                if (newCount !== null) {
                   await firebase.database().ref(getDbPath(`facilities/${id}`)).update({ count: Number(newCount), updatedTs: localTs() });
                   loadMasterData();
                }
             }}, 'Badilisha')
           )
         )
       )
     );
  };

  const WeeklyReportView = () => {
    const [weekDate, setWeekDate] = useState(todayYMD());

    const generatePDF = async () => {
       toast('Inatengeneza PDF...', 'info');
       // Calculate Monday to Friday
       const date = new Date(weekDate);
       const day = date.getDay(); 
       const diff = date.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
       const monday = new Date(date.setDate(diff));
       
       const days = [];
       for (let i = 0; i < 5; i++) {
         const d = new Date(monday);
         d.setDate(monday.getDate() + i);
         days.push(d.toISOString().split('T')[0]);
       }

       // Fetch data for all days
       const rows = [];
       for (const d of days) {
         const snap = await firebase.database().ref(getDbPath(`daily/${d}/${WORKER_ID}`)).once('value');
         const r = snap.val();
         if (r) {
           rows.push([
             d,
             r.water?.available ? 'Ndiyo' : 'Hapana',
             r.toilets?.clean ? `Safi (${r.toilets.rating}/5)` : 'Chafu',
             r.soap?.available ? 'Ipo' : 'Hapana',
             r.chamber?.status === 'full' ? 'IMEJAA' : 'OK',
             r.tasks?.classesCleanedCount || 0,
             r.notes || ''
           ]);
         } else {
            rows.push([d, '-', '-', '-', '-', '-', 'Hakuna Ripoti']);
         }
       }

       // PDF Generation
       const { jsPDF } = window.jspdf;
       const doc = new jsPDF();
       
       doc.setFontSize(18);
       doc.text(`Ripoti ya Usafi: Wiki ya ${days[0]}`, 14, 20);
       doc.setFontSize(11);
       doc.text(`Mhudumu: ${workerProfile.fullNameUpper || 'Cleaner'}`, 14, 30);
       
       doc.autoTable({
         startY: 40,
         head: [['Tarehe', 'Maji', 'Vyoo', 'Sabuni', 'Chamber', 'Madarasa', 'Maoni']],
         body: rows,
         theme: 'grid',
         headStyles: { fillColor: [79, 70, 229] },
         styles: { fontSize: 10 },
       });
       
       doc.save(`Usafi_Report_${days[0]}.pdf`);
       toast('PDF imepakuliwa!', 'success');
    };

    return h('div', { className: 'workers-card' },
      h('h2', null, 'Ripoti ya Wiki (PDF)'),
      h('p', null, 'Chagua tarehe yoyote ndani ya wiki unayotaka kupakua.'),
      h('div', { className: 'flex', style: { alignItems: 'center' } },
        h('input', { type: 'date', value: weekDate, onChange: e => setWeekDate(e.target.value) }),
        h('button', { className: 'workers-btn primary', onClick: generatePDF }, 'Download PDF')
      )
    );
  };

  // --- Render ---
  if (loading) return h('div', { className: 'loading' }, 'Loading...');

  return h(Fragment, null,
    h('header', null,
      h('h1', null, 'Usafi Hub'),
      h('p', null, `Karibu, ${workerProfile?.fullNameUpper || 'Mhudumu'}`)
    ),
    h(TopStats),
    h(TabNav),
    view === 'daily' && h(DailyReportView),
    view === 'materials' && h(MaterialsView),
    view === 'equipment' && h(EquipmentView),
    view === 'facilities' && h(FacilitiesView),
    view === 'weekly' && h(WeeklyReportView)
  );
}

const root = ReactDOM.createRoot(document.getElementById('app'));
root.render(h(App));

