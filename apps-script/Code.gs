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
var LOG_TAB = 'Trekningslogg';
var LOG_HEADER = ['Tidspunkt', 'Vinner', 'Telefon (siste 3)', 'Personens lodd', 'Lodd totalt', 'Telefon (intern)'];

var TABS = {
  Vakter: {
    collection: 'signups',
    header: ['ID', 'Dag', 'Dato', 'Stasjon', 'Start', 'Slutt', 'Navn', 'Telefon', 'E-post', 'Tidsvalg', 'Status', 'Møtt', 'Kilde', 'Registrert'],
    toRow: signupToRow_,
  },
  Kaker: {
    collection: 'cakes',
    header: ['ID', 'Registrering', 'Navn', 'Telefon', 'Type', 'Variant', 'Glutenfri', 'Laktosefri', 'Allergener', 'Leveringsdag', 'Levert', 'Kilde', 'Registrert'],
    toRow: cakeToRow_,
  },
};

// ---------- Meny og oppsett ----------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Basar')
    .addItem('Synk nå', 'syncNow')
    .addItem('Trekk vinner', 'drawWinner')
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
 * Personnøkkel er telefonnummeret. Tidligere vinnere er utelukket (én gevinst per person).
 */
function buildTickets_(vakter, kaker, excludedPhones) {
  var ex = {};
  excludedPhones.forEach(function (p) { ex[String(p)] = true; });
  var tickets = [];
  function add(rows, okCol) {
    if (!rows.length) return;
    var h = rows[0];
    var iName = h.indexOf('Navn'), iPhone = h.indexOf('Telefon'), iOk = h.indexOf(okCol), iStatus = h.indexOf('Status');
    rows.slice(1).forEach(function (r) {
      var phone = String(r[iPhone] || '');
      if (!phone || ex[phone] || r[iOk] !== 'JA') return;
      if (iStatus >= 0 && r[iStatus] !== 'aktiv') return;
      tickets.push({ name: String(r[iName]), phone: phone });
    });
  }
  add(vakter, 'Møtt');
  add(kaker, 'Levert');
  return tickets;
}

function pickWinner_(tickets, rnd) {
  if (!tickets.length) return null;
  var w = tickets[Math.floor(rnd() * tickets.length)];
  var own = tickets.filter(function (t) { return t.phone === w.phone; }).length;
  return { name: w.name, phone: w.phone, own: own, total: tickets.length };
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

function drawWinner() {
  var ui = SpreadsheetApp.getUi();
  runSync_(false); // ferskeste oppmøte og leveranser
  var ss = SpreadsheetApp.getActive();
  var read = function (name) { var sh = ss.getSheetByName(name); return sh && sh.getLastRow() > 0 ? sh.getDataRange().getValues() : []; };
  var log = ss.getSheetByName(LOG_TAB) || ss.insertSheet(LOG_TAB);
  if (log.getLastRow() === 0) { log.getRange(1, 1, 1, LOG_HEADER.length).setValues([LOG_HEADER]).setFontWeight('bold'); log.setFrozenRows(1); }
  var winners = log.getLastRow() > 1 ? log.getRange(2, 6, log.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];

  var tickets = buildTickets_(read('Vakter'), read('Kaker'), winners);
  if (!tickets.length) { ui.alert('Ingen lodd igjen å trekke blant.'); return; }
  var people = {}; tickets.forEach(function (t) { people[t.phone] = true; });
  var ok = ui.alert('Trekk vinner', tickets.length + ' lodd fordelt på ' + Object.keys(people).length +
    ' personer. Tidligere vinnere er ikke med.\n\nTrekke nå?', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  var w = pickWinner_(tickets, Math.random);
  log.appendRow([Utilities.formatDate(new Date(), 'Europe/Oslo', 'yyyy-MM-dd HH:mm:ss'), w.name, '…' + w.phone.slice(-3), w.own, w.total, w.phone]);
  ui.alert('Vinner: ' + w.name + ' (tlf. …' + w.phone.slice(-3) + ')\n\n' + w.own + ' av ' + w.total + ' lodd. Skrevet i ' + LOG_TAB + '.');
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
  module.exports = { headerPlan_: headerPlan_, planUpsert_: planUpsert_, signupToRow_: signupToRow_, cakeToRow_: cakeToRow_,
    buildTickets_: buildTickets_, pickWinner_: pickWinner_, decodeDoc_: decodeDoc_, TABS: TABS };
}
