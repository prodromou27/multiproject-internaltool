const test = require('node:test');
const assert = require('node:assert/strict');
const {
  capabilitiesFor,
  canEdit,
  validateRecommendation,
  validateTaskConversion,
  validDate,
} = require('../services/customerRecommendations');

test('recommendation capabilities and authorship rules remain role scoped', () => {
  assert.deepEqual(capabilitiesFor('manager'), { can_create:true,can_convert_project:true,can_convert_task:true });
  assert.deepEqual(capabilitiesFor('planner'), { can_create:true,can_convert_project:false,can_convert_task:true });
  assert.deepEqual(capabilitiesFor('pm'), { can_create:false,can_convert_project:false,can_convert_task:false });
  assert.equal(canEdit({ id:7,role:'engineer' },{ created_by:7 }),true);
  assert.equal(canEdit({ id:8,role:'engineer' },{ created_by:7 }),false);
  assert.equal(canEdit({ id:8,role:'manager' },{ created_by:7 }),true);
});

test('recommendation validation normalizes bounded input and rejects invalid transitions', () => {
  const valid=validateRecommendation({ finding:'  Finding  ',recommendation:'  Action  ',owner_id:'4',source_visit_id:'5',due_date:'2028-02-29' });
  assert.deepEqual(valid.value,{ finding:'Finding',recommendation:'Action',risk_level:'medium',owner_id:4,source_visit_id:5,due_date:'2028-02-29',status:'open',follow_up_notes:null });
  assert.equal(validateRecommendation({ finding:'x',recommendation:'y',due_date:'2027-02-29' }).error,'Invalid due date');
  assert.equal(validateRecommendation({ finding:'x',recommendation:'y',status:'converted_to_project' }).error,'Use Convert to project to record a conversion');
  assert.equal(validateRecommendation({ finding:'x'.repeat(10001),recommendation:'y' }).error,'finding must contain 1 to 10000 characters');
});

test('task conversion validation returns typed values and strict calendar dates', () => {
  const valid=validateTaskConversion({ version:'3',project_id:'4',assigned_to:'5',title:'  Remediate  ',deadline:'2028-02-29' },'2');
  assert.deepEqual(valid.value,{ recommendation_id:2,version:3,project_id:4,assigned_to:5,title:'Remediate',priority:'medium',deadline:'2028-02-29' });
  assert.equal(validateTaskConversion({ version:3,project_id:4,assigned_to:5,title:'x',deadline:'2027-02-29' },2).error,'Invalid task deadline');
  assert.equal(validateTaskConversion({ version:3,project_id:4,assigned_to:5,title:'x',priority:'critical' },2).error,'Invalid task priority');
  assert.equal(validDate('9999-01-01'),false);
});
