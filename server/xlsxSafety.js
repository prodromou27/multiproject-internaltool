// Guards an ExcelJS cell value against CSV/formula injection: a leading =, +, - or @ (or tab/CR/LF)
// is interpreted as the start of a formula by Excel/LibreOffice/Google Sheets on open.
function safeCell(value) {
  if (value == null) return '';
  return typeof value === 'string' && /^\s*[=+\-@]|^[\t\r\n]/.test(value) ? `'${value}` : value;
}
module.exports = { safeCell };
