// SoMAp Daily Inventory ("Docket") — default item catalog and role templates.
//
// Item types
//   count  countable things: good + damaged + lost = total on the docket
//   cond   a condition: Sawa / Si sawa (Not OK needs a description)
//   cons   consumable: quantity left + "needs restock"
//   num    a reading (mileage, borrowed books)
//   level  fuel level
//   date   an expiry date (warns 30 days before)
//
// Item ids are shared across roles ("desk", "computer"...) so school totals can
// add the same thing up from every docket. `personal: true` marks kit that each
// worker holds on their own (uniform, torch); everything else belongs to the
// docket area and is counted once per area even when two workers share it.
// Admins can override any template per school/year (inventoryDocket/templates).
(function (global) {
  'use strict';

  const CATEGORIES = {
    furniture: { sw: 'Samani', en: 'Furniture' },
    building: { sw: 'Jengo', en: 'Building' },
    teaching: { sw: 'Vifaa vya kufundishia', en: 'Teaching' },
    kitchen: { sw: 'Jikoni', en: 'Kitchen' },
    security: { sw: 'Ulinzi', en: 'Security' },
    cleaning: { sw: 'Usafi', en: 'Cleaning' },
    vehicles: { sw: 'Magari', en: 'Vehicles' },
    ict: { sw: 'TEHAMA', en: 'ICT' },
    books: { sw: 'Vitabu', en: 'Books' },
    office: { sw: 'Ofisi', en: 'Office' },
    other: { sw: 'Mengineyo', en: 'Other' },
  };

  const c = (sw, en, cat, extra) => Object.assign({ type: 'count', sw, en, cat, unit: 'pcs' }, extra || {});
  const k = (sw, en, cat, extra) => Object.assign({ type: 'cond', sw, en, cat }, extra || {});
  const s = (sw, en, cat, unit, extra) => Object.assign({ type: 'cons', sw, en, cat, unit: unit || 'pcs' }, extra || {});

  const CATALOG = {
    // furniture & building
    desk: c('Madawati', 'Desks', 'furniture'),
    chair: c('Viti', 'Chairs', 'furniture'),
    table: c('Meza', 'Tables', 'furniture'),
    shelf: c('Makabati / Shelfu', 'Shelves / cupboards', 'furniture'),
    office_chair: c('Viti vya ofisi', 'Office chairs', 'furniture'),
    office_table: c('Meza za ofisi', 'Office tables', 'furniture'),
    cabinet: c('Kabati la mafaili', 'Filing cabinet', 'furniture'),
    door: k('Milango', 'Doors', 'building'),
    window: k('Madirisha (vioo)', 'Windows (glass)', 'building'),
    wall_clean: k('Kuta safi (bila matope / alama)', 'Walls clean (no mud / marks)', 'building'),
    floor: k('Sakafu', 'Floor', 'building'),
    bulb: c('Balbu za taa', 'Light bulbs', 'building'),
    socket: k('Swichi na soketi', 'Switches / sockets', 'building'),
    keys: c('Funguo', 'Keys', 'security'),
    dustbin: c('Ndoo za taka', 'Dustbins', 'cleaning'),
    // teaching
    board: k('Ubao (blackboard / whiteboard)', 'Blackboard / whiteboard', 'teaching'),
    chalk: s('Chaki / marker', 'Chalk / markers', 'teaching', 'boxes'),
    duster: c('Vifutio vya ubao', 'Dusters', 'teaching'),
    charts: c('Chati / vifaa vya kufundishia', 'Charts / teaching aids', 'teaching'),
    class_books: c('Vitabu vya darasa', 'Class books', 'books'),
    // security
    torch: c('Tochi', 'Torch', 'security', { personal: true }),
    whistle: c('Filimbi', 'Whistle', 'security', { personal: true }),
    baton: c('Rungu', 'Baton', 'security', { personal: true }),
    bow: c('Upinde na mishale (kama umepewa)', 'Bow & arrows (if issued)', 'security', { personal: true }),
    uniform: c('Sare', 'Uniform', 'security', { personal: true }),
    cap: c('Kofia / helmeti', 'Cap / helmet', 'security', { personal: true }),
    raincoat: c('Koti la mvua', 'Raincoat', 'security', { personal: true }),
    boots: c('Buti', 'Boots', 'security', { personal: true, unit: 'pairs' }),
    gate_keys: c('Funguo za geti', 'Gate keys', 'security'),
    padlock: c('Makufuli', 'Padlocks', 'security'),
    visitor_log: c('Daftari la wageni', "Visitors' logbook", 'security'),
    phone_radio: c('Simu / redio ya mawasiliano', 'Phone / radio', 'security'),
    gate: k('Geti', 'Gate condition', 'security'),
    fence: k('Uzio', 'Fence', 'security'),
    compound_lights: k('Taa za uwanja', 'Compound lights', 'security'),
    cctv: k('CCTV (kama ipo)', 'CCTV (if present)', 'security'),
    // kitchen
    sufuria_large: c('Sufuria kubwa', 'Large sufuria', 'kitchen'),
    sufuria_medium: c('Sufuria za kati', 'Medium sufuria', 'kitchen'),
    sufuria_small: c('Sufuria ndogo', 'Small sufuria', 'kitchen'),
    cooking_pot: c('Vyungu vya kupikia', 'Cooking pots', 'kitchen'),
    plate: c('Sahani', 'Plates', 'kitchen'),
    cup: c('Vikombe', 'Cups', 'kitchen'),
    spoon: c('Vijiko', 'Spoons', 'kitchen'),
    ladle: c('Miko', 'Ladles', 'kitchen'),
    knife: c('Visu', 'Knives', 'kitchen'),
    serving_bucket: c('Ndoo za kugawia chakula', 'Serving buckets', 'kitchen'),
    water_container: c('Madumu ya maji', 'Water containers', 'kitchen'),
    stove_gas: k('Jiko / mtungi wa gesi', 'Stove / gas cylinder', 'kitchen'),
    firewood: s('Kuni / mkaa', 'Firewood / charcoal', 'kitchen', 'bundles'),
    apron: c('Aproni', 'Aprons', 'kitchen', { personal: true }),
    food_storage: k('Hali ya stoo ya chakula', 'Food storage condition', 'kitchen'),
    kitchen_clean: k('Jiko safi', 'Kitchen cleanliness', 'kitchen'),
    // cleaning
    broom: c('Mafagio', 'Brooms', 'cleaning'),
    mop: c('Mopu', 'Mops', 'cleaning'),
    bucket: c('Ndoo', 'Buckets', 'cleaning'),
    detergent: s('Sabuni / dawa ya usafi', 'Detergent', 'cleaning', 'litres'),
    toilet_brush: c('Brashi za choo', 'Toilet brushes', 'cleaning'),
    toilets: k('Hali ya vyoo', 'Toilets condition', 'cleaning'),
    taps: k('Mabomba', 'Taps', 'cleaning'),
    compound_clean: k('Uwanja safi', 'Compound cleanliness', 'cleaning'),
    store_clean: k('Stoo safi na salama', 'Store clean and secure', 'cleaning'),
    // vehicles (one docket per vehicle; docket area = plate number)
    vehicle: c('Gari', 'Vehicle', 'vehicles', { required: 1 }),
    mileage: { type: 'num', sw: 'Kilomita (odometer)', en: 'Mileage (km)', cat: 'vehicles', unit: 'km' },
    fuel_level: { type: 'level', sw: 'Kiwango cha mafuta', en: 'Fuel level', cat: 'vehicles' },
    tyres: k('Matairi', 'Tyres', 'vehicles'),
    spare_tyre: k('Tairi la akiba', 'Spare tyre', 'vehicles'),
    extinguisher: k('Kizima moto', 'Fire extinguisher', 'vehicles'),
    first_aid: k('Sanduku la huduma ya kwanza', 'First aid kit', 'vehicles'),
    vehicle_clean: k('Gari safi ndani na nje', 'Vehicle clean', 'vehicles'),
    insurance_exp: { type: 'date', sw: 'Bima inaisha', en: 'Insurance expiry', cat: 'vehicles' },
    inspection_exp: { type: 'date', sw: 'Ukaguzi (inspection) unaisha', en: 'Inspection expiry', cat: 'vehicles' },
    // ICT & books & office
    computer: c('Kompyuta', 'Computers', 'ict'),
    printer: c('Printa', 'Printers', 'ict'),
    projector: c('Projekta', 'Projectors', 'ict'),
    toner: s('Toner / wino', 'Toner / ink', 'office', 'pcs'),
    paper: s('Karatasi (rimu)', 'Paper (reams)', 'office', 'reams'),
    files: c('Mafaili', 'Files', 'office'),
    stamp: c('Mihuri', 'Stamps', 'office'),
    phone: c('Simu za ofisi', 'Office phones', 'office'),
    books_text: c('Vitabu vya kiada', 'Textbooks', 'books'),
    books_ref: c('Vitabu vya rejea', 'Reference books', 'books'),
    books_story: c('Vitabu vya hadithi', 'Story books', 'books'),
    borrowed_out: { type: 'num', sw: 'Vitabu vilivyokopwa bado havijarudi', en: 'Borrowed, not returned', cat: 'books', unit: 'books' },
    scale: c('Mizani', 'Weighing scale', 'office'),
  };

  // Roles map to these template keys (see SomapInventory.templateRoleKey).
  const TEMPLATES = {
    teacher: ['desk', 'chair', 'table', 'shelf', 'board', 'chalk', 'duster', 'door', 'window', 'wall_clean', 'floor', 'bulb', 'socket', 'charts', 'class_books', 'dustbin', 'keys'],
    guard: ['torch', 'whistle', 'baton', 'bow', 'uniform', 'cap', 'raincoat', 'boots', 'gate_keys', 'padlock', 'visitor_log', 'phone_radio', 'gate', 'fence', 'compound_lights', 'cctv'],
    cook: ['sufuria_large', 'sufuria_medium', 'sufuria_small', 'cooking_pot', 'plate', 'cup', 'spoon', 'ladle', 'knife', 'serving_bucket', 'water_container', 'stove_gas', 'firewood', 'apron', 'food_storage', 'kitchen_clean'],
    cleaner: ['broom', 'mop', 'bucket', 'detergent', 'toilet_brush', 'dustbin', 'toilets', 'taps', 'compound_clean'],
    driver: ['vehicle', 'mileage', 'fuel_level', 'tyres', 'spare_tyre', 'extinguisher', 'first_aid', 'vehicle_clean', 'insurance_exp', 'inspection_exp'],
    librarian: ['books_text', 'books_ref', 'books_story', 'shelf', 'computer', 'borrowed_out'],
    secretary: ['computer', 'printer', 'toner', 'paper', 'files', 'stamp', 'phone', 'office_chair', 'office_table', 'cabinet'],
    headteacher: ['computer', 'printer', 'office_chair', 'office_table', 'cabinet', 'files', 'stamp', 'keys', 'door', 'window'],
    storekeeper: ['shelf', 'scale', 'padlock', 'keys', 'store_clean'],
  };

  const ROLE_LABELS = {
    teacher: { sw: 'Mwalimu', en: 'Teacher', plural: 'walimu' },
    guard: { sw: 'Mlinzi', en: 'Guard', plural: 'walinzi' },
    cook: { sw: 'Mpishi', en: 'Cook', plural: 'wapishi' },
    cleaner: { sw: 'Msafi', en: 'Cleaner', plural: 'wasafi' },
    driver: { sw: 'Dereva', en: 'Driver', plural: 'madereva' },
    librarian: { sw: 'Mkutubi', en: 'Librarian', plural: 'wakutubi' },
    secretary: { sw: 'Katibu', en: 'Secretary', plural: 'makatibu' },
    headteacher: { sw: 'Mwalimu Mkuu', en: 'Head Teacher', plural: 'walimu wakuu' },
    storekeeper: { sw: 'Mtunza stoo', en: 'Storekeeper', plural: 'watunza stoo' },
    accountant: { sw: 'Mhasibu', en: 'Accountant', plural: 'wahasibu' },
    manager: { sw: 'Msimamizi', en: 'Manager', plural: 'wasimamizi' },
  };

  // Default docket area when nothing was assigned at admission.
  const DEFAULT_AREAS = {
    guard: 'Geti kuu · Main gate',
    cook: 'Jikoni · Kitchen',
    cleaner: 'Uwanja na vyoo · Compound & toilets',
    secretary: 'Ofisi · Office',
    headteacher: 'Ofisi ya Mwalimu Mkuu · Head office',
    librarian: 'Maktaba · Library',
    storekeeper: 'Stoo · Store',
  };

  // Where each role's hub lives (used for the workers dashboard badge).
  const HUB_PAGES = {
    guard: 'workersmlinzi.html',
    cook: 'workerscooks.html',
    cleaner: 'workersmsafi.html',
    storekeeper: 'workersstorekeeper.html',
    teacher: 'workertasks.html',
    headteacher: 'workertasks.html',
    secretary: 'secretaryhub.html',
    driver: 'transporthub.html',
  };

  global.SomapInventoryTemplates = { CATEGORIES, CATALOG, TEMPLATES, ROLE_LABELS, DEFAULT_AREAS, HUB_PAGES };
})(window);
