/**
 * KIL basar – synk fra Firestore til Google Sheets.
 * Limes inn i regnearket via Utvidelser → Apps Script. Se apps-script/OPPSETT.md.
 *
 * Regler (spesifikasjonen «Google Sheets»):
 *  - Appen eier bare fanene i TABS + «Synkstatus». Andre faner røres aldri.
 *  - Rader identifiseres med ID i kolonne A. Ny ID → ny rad nederst, kjent ID → samme rad oppdateres.
 *  - Rader slettes aldri. Kolonner legges bare til helt til høyre.
 */

var PROJECT_ID = 'basar-ba738';
var BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents';
var STATUS_TAB = 'Synkstatus';
var MAX_FAILS_BEFORE_MAIL = 3;

var DAY_NAMES = { opprigg: 'Opprigg', d1: 'Basardag 1', d2: 'Basardag 2' };
var PREF_NAMES = { hele: 'Når som helst', for18: 'Før 18', etter18: 'Etter 18' };
var DRAW_HEADER = ['Lodd nr', 'Navn', 'Telefon (siste 3)', 'Gjelder', 'Detaljer'];

var TABS = {
  Vakter: {
    collection: 'signups',
    header: ['ID', 'Dag', 'Dato', 'Stasjon', 'Start', 'Slutt', 'Navn', 'Telefon', 'E-post', 'Tidsvalg', 'Status', 'Møtt', 'Kilde', 'Registrert', 'Offentlig navn'],
    toRow: signupToRow_,
  },
  Kaker: {
    collection: 'cakes',
    header: ['ID', 'Registrering', 'Navn', 'Telefon', 'Type', 'Variant', 'Glutenfri', 'Laktosefri', 'Allergener', 'Leveringsdag', 'Levert', 'Kilde', 'Registrert'],
    toRow: cakeToRow_,
  },
  Gevinster: {
    collection: 'prizes',
    header: ['ID', 'Registrering', 'Sponsor', 'Kontakt', 'Telefon', 'Gevinst', 'Antall', 'Verdi/stk', 'Sum', 'Status', 'Registrert', 'Bok'],
    toRow: prizeToRow_,
  },
};

// ---------- Meny og oppsett ----------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Basar')
    .addItem('Synk nå', 'syncNow')
    .addItem('Lag trekningsliste', 'makeDrawList')
    .addItem('Oppdater Basarbok-fanen (formel og farger)', 'setupBasarbok')
    .addSeparator()
    .addItem('Oppsett (kjør én gang)', 'setup')
    .addToUi();
}

/** Lager faner og en synk hvert 5. minutt. Trygt å kjøre flere ganger. */
function setup() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'syncScheduled'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncScheduled').timeBased().everyMinutes(5).create();
  syncNow();
}

function syncNow() { runSync_(true); }
function syncScheduled() { runSync_(false); }

// ---------- Synk ----------

function runSync_(interactive) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return; // en annen synk kjører allerede
  var props = PropertiesService.getScriptProperties();
  var started = new Date();
  try {
    var config = fetchDoc_('config/main');
    var summary = [];
    Object.keys(TABS).forEach(function (name) {
      var spec = TABS[name];
      var docs = fetchCollection_(spec.collection);
      var rows = docs.map(function (d) { return spec.toRow(d, config); });
      var res = upsertTab_(name, spec.header, rows);
      summary.push(name + ': ' + res.updated + ' oppdatert, ' + res.added + ' nye');
    });
    props.setProperty('fails', '0');
    writeStatus_(started, 'OK', summary.join(' · '));
    if (interactive) SpreadsheetApp.getActive().toast('Synk ferdig: ' + summary.join(' · '));
  } catch (e) {
    var fails = Number(props.getProperty('fails') || 0) + 1;
    props.setProperty('fails', String(fails));
    writeStatus_(started, 'FEIL (' + fails + ' på rad)', String(e && e.message || e));
    if (fails === MAX_FAILS_BEFORE_MAIL) {
      MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Basar: synk til Google Sheets feiler',
        'Synken har feilet ' + fails + ' ganger på rad.\n\nSiste feil: ' + e + '\n\n' + SpreadsheetApp.getActive().getUrl());
    }
    if (interactive) throw e;
  } finally {
    lock.releaseLock();
  }
}

/** Oppdaterer rader med kjent ID på plass og legger nye nederst. Sletter aldri. */
function upsertTab_(name, header, rows) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var width = header.length;

  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, width).setValues([header]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else {
    var current = sh.getRange(1, 1, 1, width).getValues()[0];
    var plan = headerPlan_(current, header);
    if (plan.error) throw new Error('Fanen «' + name + '»: ' + plan.error);
    if (plan.append.length) sh.getRange(1, plan.from, 1, plan.append.length).setValues([plan.append]).setFontWeight('bold');
  }

  // Telefonnummer (+47…) skal være tekst, ellers gjør Sheets dem om til tall
  var phoneCol = header.indexOf('Telefon') + 1;
  if (phoneCol > 0) sh.getRange(2, phoneCol, sh.getMaxRows() - 1, 1).setNumberFormat('@');

  var last = sh.getLastRow();
  var ids = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
  var p = planUpsert_(ids, rows);
  p.updates.forEach(function (u) { sh.getRange(u.row, 1, 1, width).setValues([u.values]); });
  if (p.appends.length) sh.getRange(last + 1, 1, p.appends.length, width).setValues(p.appends);
  return { updated: p.updates.length, added: p.appends.length };
}

// ---------- Rene hjelpefunksjoner (testes i Node) ----------

/** Overskriftene kan bare utvides til høyre. Noe annet stopper synken. */
function headerPlan_(current, wanted) {
  for (var i = 0; i < wanted.length; i++) {
    var c = String(current[i] || '');
    if (c === '') return { append: wanted.slice(i), from: i + 1 };
    if (c !== wanted[i]) return { error: 'kolonne ' + (i + 1) + ' heter «' + c + '», ventet «' + wanted[i] + '». Kolonner i appens faner kan ikke flyttes eller gis nytt navn.' };
  }
  return { append: [], from: wanted.length + 1 };
}

/** Planlegger oppdateringer (radnummer i arket) og nye rader. */
function planUpsert_(existingIds, rows) {
  var index = {};
  existingIds.forEach(function (id, i) { if (id) index[id] = i + 2; });
  var updates = [], appends = [];
  rows.forEach(function (r) {
    var at = index[String(r[0])];
    if (at) updates.push({ row: at, values: r }); else appends.push(r);
  });
  return { updates: updates, appends: appends };
}

/**
 * Verdi 0 betyr «ikke bekreftet», ikke gratis: cellen står da TOM (ikke tekst),
 * fordi QUERY i Sheets dropper tekst i en tallkolonne.
 */
function prizeToRow_(d) {
  var f = d.fields;
  var qty = Number(f.qty || 0), value = Number(f.value || 0);
  return [
    d.id,
    f.regId || '',
    f.sponsor || '',
    f.contact || '',
    f.phone || '',
    f.gift || '',
    qty,
    value > 0 ? value : '',
    value > 0 ? qty * value : '',
    f.status || '',
    f.createdAt ? formatTime_(f.createdAt) : '',
    f.book || '',
  ];
}

function cakeToRow_(d, config) {
  var f = d.fields;
  var type = (config.cakeTypes || []).filter(function (t) { return t.id === f.type; })[0];
  return [
    d.id,
    f.regId || '',
    f.name || '',
    f.phone || '',
    type ? type.name : (f.type || ''),
    f.variant || '',
    f.glutenFree ? 'JA' : 'NEI',
    f.lactoseFree ? 'JA' : 'NEI',
    f.allergens || '',
    DAY_NAMES[f.deliveryDay] || f.deliveryDay || '',
    f.delivered ? 'JA' : 'NEI',
    f.source || '',
    f.createdAt ? formatTime_(f.createdAt) : '',
  ];
}

/**
 * Lodd: én per vaktskift med Møtt = JA (status aktiv) og én per bakverk med Levert = JA.
 * Regel B: hver rad er ett lodd. Trekkes samme person flere ganger, vinner hun flere gevinster.
 */
function buildTickets_(vakter, kaker) {
  var tickets = [];
  function col(h, name) { return h.indexOf(name); }
  if (vakter.length) {
    var h = vakter[0];
    vakter.slice(1).forEach(function (r) {
      if (r[col(h, 'Møtt')] !== 'JA' || r[col(h, 'Status')] !== 'aktiv') return;
      var what = r[col(h, 'Dag')] + ' · ' + r[col(h, 'Stasjon')] + (r[col(h, 'Start')] ? ' ' + r[col(h, 'Start')] + '–' + r[col(h, 'Slutt')] : '');
      tickets.push({ name: String(r[col(h, 'Navn')]), phone: String(r[col(h, 'Telefon')]), kind: 'Vakt', what: what });
    });
  }
  if (kaker.length) {
    var k = kaker[0];
    kaker.slice(1).forEach(function (r) {
      if (r[col(k, 'Levert')] !== 'JA') return;
      var what = r[col(k, 'Type')] + (r[col(k, 'Variant')] ? ': ' + r[col(k, 'Variant')] : '') + ' · ' + r[col(k, 'Leveringsdag')];
      tickets.push({ name: String(r[col(k, 'Navn')]), phone: String(r[col(k, 'Telefon')]), kind: 'Kake', what: what });
    });
  }
  return tickets;
}

function drawRows_(tickets) {
  return tickets.map(function (t, i) { return [i + 1, t.name, '…' + t.phone.slice(-3), t.kind, t.what]; });
}

function signupToRow_(d, config) {
  var f = d.fields;
  var shift = (config.shifts || []).filter(function (s) { return s.id === f.shiftId; })[0];
  var day = (config.days || []).filter(function (x) { return x.id === f.day; })[0];
  return [
    d.id,
    DAY_NAMES[f.day] || f.day || '',
    day ? day.date : '',
    shift ? shift.station : '',
    shift ? shift.start : '',
    shift ? shift.end : '',
    f.name || '',
    f.phone || '',
    f.email || '',
    PREF_NAMES[f.timePref] || f.timePref || '',
    f.status || '',
    f.attended ? 'JA' : 'NEI',
    f.source || '',
    f.createdAt ? formatTime_(f.createdAt) : '',
    f.publicName ? 'JA' : 'NEI',
  ];
}

/** Firestore REST-verdi → vanlig JS-verdi. */
function decode_(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode_);
  if ('mapValue' in v) return decodeFields_(v.mapValue.fields || {});
  return null;
}
function decodeFields_(fields) {
  var out = {};
  Object.keys(fields).forEach(function (k) { out[k] = decode_(fields[k]); });
  return out;
}
function decodeDoc_(doc) {
  return { id: doc.name.split('/').pop(), fields: decodeFields_(doc.fields || {}) };
}

// ---------- Trekning ----------

/**
 * Lager en NY fane med fast trekningsliste (verdier, ingen formler). Fanen endres aldri senere,
 * så lodd nr peker alltid på samme person. Trekk et tilfeldig tall mellom 1 og antall lodd.
 */
function makeDrawList() {
  var ui = SpreadsheetApp.getUi();
  runSync_(false); // ferskeste oppmøte og leveranser
  var ss = SpreadsheetApp.getActive();
  var read = function (name) { var sh = ss.getSheetByName(name); return sh && sh.getLastRow() > 0 ? sh.getDataRange().getValues() : []; };
  var tickets = buildTickets_(read('Vakter'), read('Kaker'));
  if (!tickets.length) { ui.alert('Ingen lodd ennå: ingen vakter er krysset av som møtt og ingen kaker som levert.'); return; }

  var name = 'Trekningsliste ' + Utilities.formatDate(new Date(), 'Europe/Oslo', 'dd.MM HH:mm');
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  sh.getRange(1, 1, 1, DRAW_HEADER.length).setValues([DRAW_HEADER]).setFontWeight('bold');
  sh.getRange(2, 1, tickets.length, DRAW_HEADER.length).setValues(drawRows_(tickets));
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, DRAW_HEADER.length);
  sh.protect().setDescription('Fast trekningsliste – skal ikke endres').setWarningOnly(true);
  ss.setActiveSheet(sh);
  var people = {}; tickets.forEach(function (t) { people[t.phone] = true; });
  ui.alert('Trekningsliste laget: ' + tickets.length + ' lodd fordelt på ' + Object.keys(people).length +
    ' personer.\n\nTrekk et tilfeldig tall mellom 1 og ' + tickets.length + ', og finn det i kolonnen «Lodd nr».');
}

// ---------- Basarbok-fanen ----------

var STATUS_COLORS = { mottatt: '#d9ead3', bekreftet: '#cfe2f3', registrert: '#fce5cd', avvist: '#f4cccc' };
// setFormula bruker alltid engelsk syntaks (komma), uansett språk i arket
var BASARBOK_FORMULA = '=QUERY(Gevinster!A:L, "select C, F, H, J, L where A is not null order by C, F", 1)';

/** Fargeregler: hele raden får cellefarge etter status i kolonne `statusCol` (bokstav). */
function statusColorRules_(sh, statusCol, lastCol) {
  var range = sh.getRange('A2:' + lastCol);
  return Object.keys(STATUS_COLORS).map(function (s) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$' + statusCol + '2="' + s + '"')
      .setBackground(STATUS_COLORS[s])
      .setRanges([range])
      .build();
  });
}

/** Skriver formelen i A1 på fanen «Basarbok» og legger på statusfarger. Kolonner: Sponsor, Gevinst, Verdi/stk, Status, Bok. */
function setupBasarbok() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('Basarbok') || ss.insertSheet('Basarbok');
  sh.getRange('A1').setFormula(BASARBOK_FORMULA);
  sh.setConditionalFormatRules(statusColorRules_(sh, 'D', 'E'));
  sh.setFrozenRows(1);
  sh.getRange('1:1').setFontWeight('bold');
  SpreadsheetApp.getActive().toast('Basarbok-fanen er oppdatert.');
}

// ---------- Firestore REST ----------

function request_(url) {
  var res = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Goog-User-Project': PROJECT_ID },
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code !== 200) throw new Error('Firestore svarte ' + code + ': ' + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText());
}
function fetchDoc_(path) { return decodeDoc_(request_(BASE + '/' + path)).fields; }
function fetchCollection_(name) {
  var out = [], token = '';
  do {
    var json = request_(BASE + '/' + name + '?pageSize=300' + (token ? '&pageToken=' + encodeURIComponent(token) : ''));
    (json.documents || []).forEach(function (d) { out.push(decodeDoc_(d)); });
    token = json.nextPageToken || '';
  } while (token);
  // Stabil rekkefølge for nye rader: eldste først
  out.sort(function (a, b) { return String(a.fields.createdAt || '').localeCompare(String(b.fields.createdAt || '')); });
  return out;
}

function formatTime_(iso) {
  return Utilities.formatDate(new Date(iso), 'Europe/Oslo', 'yyyy-MM-dd HH:mm');
}

function writeStatus_(started, result, details) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(STATUS_TAB) || ss.insertSheet(STATUS_TAB);
  sh.getRange(1, 1, 4, 2).setValues([
    ['Siste kjøring', Utilities.formatDate(started, 'Europe/Oslo', 'yyyy-MM-dd HH:mm:ss')],
    ['Resultat', result],
    ['Detaljer', details],
    ['Merk', 'Denne fanen og fanene Vakter/Kaker/Gevinster skrives av appen. Bygg egne faner som leser fra dem.'],
  ]);
  sh.getRange(1, 1, 4, 1).setFontWeight('bold');
}

// Eksport for Node-tester (ignoreres i Apps Script)
if (typeof module !== 'undefined') {
  module.exports = { headerPlan_: headerPlan_, planUpsert_: planUpsert_, signupToRow_: signupToRow_, cakeToRow_: cakeToRow_, prizeToRow_: prizeToRow_,
    buildTickets_: buildTickets_, drawRows_: drawRows_, decodeDoc_: decodeDoc_, TABS: TABS };
}
