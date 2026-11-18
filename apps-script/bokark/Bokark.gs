/**
 * Basarbøker – eget regneark som henter gevinster fra hovedarket.
 * Limes inn via Utvidelser → Apps Script i BOK-arket (ikke hovedarket). Se apps-script/bokark/OPPSETT.md.
 * Kjør «Basarbøker → Lag faner» én gang. Fanene oppdaterer seg selv etterpå (IMPORTRANGE).
 */

var SOURCE = 'https://docs.google.com/spreadsheets/d/1EEfugP3ZegFr2-jPaaXH6zyhn5tIp5kE_T0J98nDCZk';
var BOOKS = ['Basarbok 1', 'Basarbok 2', 'Basarbok 3', 'Basarbok 4', 'Basarbok 5', 'Basarbok 6',
  'Basarbok 7', 'Basarbok 8', 'Basarbok 9', 'Basarbok 10', 'Basarbok 11', 'Basarbok 12', 'Årer'];
var STATUS_COLORS = { mottatt: '#d9ead3', bekreftet: '#cfe2f3', registrert: '#fce5cd', avvist: '#f4cccc' };
// Kolonner i hovedarkets Gevinster-fane: Col3 Sponsor, Col6 Gevinst, Col8 Verdi/stk, Col10 Status, Col12 Bok
// setFormula bruker alltid engelsk syntaks (komma), uansett språk i arket
var SRC = 'IMPORTRANGE("' + SOURCE + '", "Gevinster!A:L")';

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Basarbøker').addItem('Lag faner', 'setupBooks').addToUi();
}

function bookFormula_(book) {
  return '=QUERY(' + SRC + ', "select Col3, Col6, Col8, Col10 where Col12 = \'' + book +
    '\' and Col10 <> \'avvist\' order by Col3, Col6 label Col3 \'Sponsor\', Col6 \'Gevinst\', Col8 \'Verdi/stk\', Col10 \'Status\'", 1)';
}

function summaryFormula_() {
  return '=QUERY(' + SRC + ', "select Col12, count(Col1), sum(Col8) where Col12 <> \'\' and Col10 <> \'avvist\' group by Col12 ' +
    'label Col12 \'Bok\', count(Col1) \'Gevinster\', sum(Col8) \'Verdi (kjent)\'", 1)';
}

/** Lager én fane per bok + «Oversikt». Trygt å kjøre igjen: skriver bare formelen i A1 og fargene. */
function setupBooks() {
  var ss = SpreadsheetApp.getActive();
  var over = ss.getSheetByName('Oversikt') || ss.insertSheet('Oversikt', 0);
  over.getRange('A1').setFormula(summaryFormula_());
  over.getRange('1:1').setFontWeight('bold');

  BOOKS.forEach(function (book) {
    var sh = ss.getSheetByName(book) || ss.insertSheet(book);
    sh.getRange('A1').setFormula(bookFormula_(book));
    sh.getRange('1:1').setFontWeight('bold');
    sh.setFrozenRows(1);
    var range = sh.getRange('A2:D');
    sh.setConditionalFormatRules(Object.keys(STATUS_COLORS).map(function (s) {
      return SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$D2="' + s + '"')
        .setBackground(STATUS_COLORS[s]).setRanges([range]).build();
    }));
  });
  ss.setActiveSheet(over);
  SpreadsheetApp.getUi().alert('Fanene er laget.\n\nStår det #REF! i fanen Oversikt: klikk på cellen A1 og velg «Tillat tilgang». Det trengs bare én gang.');
}

if (typeof module !== 'undefined') module.exports = { bookFormula_: bookFormula_, summaryFormula_: summaryFormula_, BOOKS: BOOKS };
