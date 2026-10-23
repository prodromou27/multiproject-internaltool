const test=require('node:test');
const assert=require('node:assert/strict');
const { safe }=require('../managedCustomerExcelRenderer');

test('managed customer Excel cells neutralize spreadsheet formulas',() => {
  for (const value of ['=2+2','+SUM(A1:A2)','-1+2','@cmd']) assert.equal(safe(value),`'${value}`);
  assert.equal(safe('Normal customer text'),'Normal customer text');
  assert.equal(safe(42),42);
});
