/**
 * Basarbøker – eget regneark som henter gevinster fra hovedarket og lager utskrift.
 * Limes inn via Utvidelser → Apps Script i BOK-arket (ikke hovedarket). Se apps-script/bokark/OPPSETT.md.
 *
 * Meny «Basarbøker»:
 *  - Lag / oppdater faner: én utskriftsklar fane per bok (Girji #1 …) + «Oversikt». Trygt å kjøre igjen.
 *  - Lag PDF-er (A5): én PDF per bok i en ny mappe i Google Drive, klar til utskrift.
 *
 * Bare gevinster med status «bekreftet» eller «mottatt» kommer med i bøkene.
 * «Oversikt» viser hvor mange som fortsatt bare er registrert, så ingenting glemmes.
 */

var SOURCE = 'https://docs.google.com/spreadsheets/d/1EEfugP3ZegFr2-jPaaXH6zyhn5tIp5kE_T0J98nDCZk';

// Bok i appen → fanenavn og overskrift på utskriften
var BOOKS = [];
for (var i = 1; i <= 12; i++) BOOKS.push({ book: 'Basarbok ' + i, tab: 'Girji ' + i, title: 'Girji #' + i });
// «Årer» skrives ikke ut. Gevinster der vises bare i Oversikt.

// Kolonner i hovedarkets Gevinster-fane: Col3 Sponsor, Col6 Gevinst, Col8 Verdi/stk, Col10 Status, Col12 Bok
// setFormula bruker alltid engelsk syntaks (komma mellom argumenter), uansett språk i arket.
var SRC = 'IMPORTRANGE("' + SOURCE + '", "Gevinster!A:L")';
var OK = "(Col10 = 'bekreftet' or Col10 = 'mottatt')";

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Basarbøker')
    .addItem('Lag / oppdater faner', 'setupBooks')
    .addItem('Lag PDF-er (A5)', 'exportPdfs')
    .addToUi();
}

/** Gevinstene i boka, høyeste verdi først, med sumrad nederst. */
function bookFormula_(book) {
  var where = "Col12 = '" + book + "' and " + OK;
  var list = 'QUERY(' + SRC + ', "select Col6, Col3, Col8 where ' + where +
    " order by Col8 desc, Col3 label Col6 'Vuoitu', Col3 'Gii lea skeŋken', Col8 'Árvu'\", 1)";
  var sum = 'IFERROR(SUM(QUERY(' + SRC + ', "select Col8 where ' + where + '", 0)), 0)';
  // Tom bok: QUERY gir feil uten treff, så vi viser bare overskriftene
  var safe = 'IFERROR(' + list + ', {"Vuoitu", "Gii lea skeŋken", "Árvu"})';
  return '={' + safe + '; {"", "Sum:", ' + sum + '}}';
}

/** Per bok: antall per status. Viser hva som mangler bekreftelse før trykking. */
function statusFormula_() {
  return '=QUERY(' + SRC + ", \"select Col12, count(Col1) where Col12 <> '' and Col10 <> 'avvist' group by Col12 pivot Col10 label Col12 'Bok'\", 1)";
}

/** Per bok: antall og sum som kommer på trykk. */
function printFormula_() {
  return '=QUERY(' + SRC + ", \"select Col12, count(Col1), sum(Col8) where Col12 <> '' and " + OK +
    " group by Col12 label Col12 'Bok', count(Col1) 'På trykk', sum(Col8) 'Sum på trykk'\", 1)";
}

function setupBooks() {
  var ss = SpreadsheetApp.getActive();
  var over = ss.getSheetByName('Oversikt') || ss.insertSheet('Oversikt', 0);
  over.getRange('A1').setValue('Kommer på trykk (bekreftet og mottatt)').setFontWeight('bold');
  over.getRange('A2').setFormula(printFormula_());
  over.getRange('E1').setValue('Alle gevinster per status (ikke avvist)').setFontWeight('bold');
  over.getRange('E2').setFormula(statusFormula_());
  over.getRange('2:2').setFontWeight('bold');

  BOOKS.forEach(function (b) { formatBookTab_(ss, b); });
  ss.setActiveSheet(over);
  SpreadsheetApp.getUi().alert('Fanene er klare.\n\nStår det #REF! i fanen Oversikt: klikk på cellen A2 og velg «Tillat tilgang». Det trengs bare én gang.');
}

function formatBookTab_(ss, b) {
  var old = ss.getSheetByName(b.book); // fane fra forrige versjon («Basarbok 1») får nytt navn
  var sh = ss.getSheetByName(b.tab) || (old && old.getName() !== b.tab ? old.setName(b.tab) : null) || ss.insertSheet(b.tab);
  sh.clear();
  sh.clearConditionalFormatRules();
  sh.setHiddenGridlines(true);

  var all = sh.getRange('A1:C80');
  all.setFontFamily('Noto Sans').setFontSize(10).setVerticalAlignment('top').setWrap(true);
  sh.setColumnWidth(1, 260);
  sh.setColumnWidth(2, 230);
  sh.setColumnWidth(3, 90);
  sh.setRowHeight(1, 44);

  sh.getRange('A1').setValue(b.title).setFontSize(20).setFontWeight('bold').setVerticalAlignment('middle');
  sh.getRange('A3').setFormula(bookFormula_(b.book));
  sh.getRange('A3:C3').setFontWeight('bold').setBorder(null, null, true, null, null, null, '#999999', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange('C3:C80').setHorizontalAlignment('right').setNumberFormat('#,##0');

  // Annenhver rad lys grå, sumraden fet med strek over (som i fjorårets bøker)
  var data = sh.getRange('A4:C80');
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$B4="Sum:"')
      .setBold(true).setRanges([data]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND(ISEVEN(ROW()), $A4<>"")')
      .setBackground('#f5f5f5').setRanges([data]).build(),
  ]);
  return sh;
}

/** Én A5-PDF per bok i en ny mappe i Drive. Tomme bøker hoppes over. */
function exportPdfs() {
  var ss = SpreadsheetApp.getActive();
  SpreadsheetApp.flush();
  var folder = DriveApp.createFolder('Basarbøker ' + Utilities.formatDate(new Date(), 'Europe/Oslo', 'yyyy-MM-dd HH.mm'));
  var token = ScriptApp.getOAuthToken();
  var made = [], empty = [];
  BOOKS.forEach(function (b) {
    var sh = ss.getSheetByName(b.tab);
    if (!sh || sh.getLastRow() <= 4) { empty.push(b.title); return; }
    var url = ss.getUrl().replace(/\/edit.*$/, '') + '/export?' + exportParams_(sh.getSheetId(), sh.getLastRow());
    var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('PDF for ' + b.title + ' feilet (' + res.getResponseCode() + ')');
    folder.createFile(res.getBlob().setName(b.tab.replace(' ', '_') + '.pdf'));
    made.push(b.title);
    Utilities.sleep(1500); // Google begrenser hvor fort det kan eksporteres
  });
  var msg = made.length + ' PDF-er lagret i mappen «' + folder.getName() + '» i Google Drive.';
  if (empty.length) msg += '\n\nTomme bøker (ingen PDF): ' + empty.join(', ');
  SpreadsheetApp.getUi().alert(msg + '\n\n' + folder.getUrl());
}

function exportParams_(gid, lastRow) {
  return [
    'format=pdf', 'gid=' + gid, 'range=A1:C' + lastRow,
    'size=A5', 'portrait=true', 'fitw=true', 'gridlines=false',
    'printtitle=false', 'sheetnames=false', 'pagenum=UNDEFINED', 'fzr=false',
    'top_margin=0.5', 'bottom_margin=0.5', 'left_margin=0.4', 'right_margin=0.4',
  ].join('&');
}

if (typeof module !== 'undefined') {
  module.exports = { bookFormula_: bookFormula_, statusFormula_: statusFormula_, printFormula_: printFormula_, exportParams_: exportParams_, BOOKS: BOOKS };
}
