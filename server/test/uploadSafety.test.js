const test = require('node:test');
const assert = require('node:assert/strict');
const PizZip = require('pizzip');
const ExcelJS = require('exceljs');
const { assertSafeSpreadsheet } = require('../uploadUtils');

test('spreadsheet imports refuse files that unpack to far more than a real workbook', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Customers').addRow(['name']);
  const real = Buffer.from(await workbook.xlsx.writeBuffer());
  assert.doesNotThrow(() => assertSafeSpreadsheet(real));
  const zip = new PizZip(real);
  zip.file('xl/padding.bin', Buffer.alloc(80 * 1024 * 1024));
  const bomb = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  assert.throws(() => assertSafeSpreadsheet(bomb, { maxUnpackedBytes: 50 * 1024 * 1024 }), error => error.status === 400 && /too large once unpacked/.test(error.message));
  assert.throws(() => assertSafeSpreadsheet(Buffer.from('not a zip')), error => error.status === 400);
});
