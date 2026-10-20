/**
 * Deleting for good (managers): a task, project, maintenance visit, service activity or
 * customer, with everything under it, so the information is no longer kept. Each runs
 * inside the caller's transaction and returns the stored file names (attachments, report
 * files) to remove once it has committed (removeFiles). Records that only point at what
 * is deleted (a recommendation's related task or project, a visit a recommendation came
 * from) are kept and lose the link. The audit log keeps that the deletion happened.
 */
const { removeStored } = require('./taskFiles');

const marks = ids => ids.map(() => '?').join(',');
const numbers = ids => [...new Set(ids.map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];

async function storedNames(tx, table, column, ids) {
  if (!ids.length) return [];
  return (await tx.prepare(`SELECT stored_name FROM ${table} WHERE ${column} IN (${marks(ids)}) AND stored_name IS NOT NULL`).all(...ids)).map(row => row.stored_name);
}

async function deleteTasks(tx, taskIds) {
  const ids = numbers(taskIds);
  if (!ids.length) return [];
  const files = await storedNames(tx, 'attachments', 'task_id', ids);
  await tx.prepare(`UPDATE customer_recommendations SET related_task_id = NULL WHERE related_task_id IN (${marks(ids)})`).run(...ids);
  await tx.prepare(`DELETE FROM tasks WHERE id IN (${marks(ids)})`).run(...ids);
  return files;
}

async function deleteProject(tx, projectId) {
  const tasks = (await tx.prepare('SELECT id FROM tasks WHERE project_id = ?').all(projectId)).map(row => row.id);
  const files = [...await storedNames(tx, 'attachments', 'project_id', [projectId]), ...await deleteTasks(tx, tasks)];
  await tx.prepare('UPDATE customer_recommendations SET related_project_id = NULL WHERE related_project_id = ?').run(projectId);
  await tx.prepare('DELETE FROM kpi_definitions WHERE project_id = ?').run(projectId);
  await tx.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
  return files;
}

async function deleteVisits(tx, visitIds) {
  const ids = numbers(visitIds);
  if (!ids.length) return [];
  await tx.prepare(`UPDATE customer_recommendations SET source_visit_id = NULL WHERE source_visit_id IN (${marks(ids)})`).run(...ids);
  await tx.prepare(`DELETE FROM maintenance_visits WHERE id IN (${marks(ids)})`).run(...ids);
  return [];
}

async function deleteActivities(tx, activityIds) {
  const ids = numbers(activityIds);
  if (!ids.length) return [];
  const files = await storedNames(tx, 'attachments', 'service_activity_id', ids);
  await tx.prepare(`DELETE FROM service_activities WHERE id IN (${marks(ids)})`).run(...ids);
  return files;
}

/** A customer with its activities, assets, contracts, licences, visits, recommendations,
    customer tasks, KPIs and customer reports. Its projects are kept, without the customer. */
async function deleteCustomer(tx, customerId) {
  const idsOf = async sql => (await tx.prepare(sql).all(customerId)).map(row => row.id);
  const activities = await idsOf('SELECT id FROM service_activities WHERE customer_id = ?');
  const tasks = await idsOf('SELECT id FROM tasks WHERE customer_id = ?');
  const assets = await idsOf('SELECT id FROM customer_assets WHERE customer_id = ?');
  const files = [...await storedNames(tx, 'attachments', 'customer_asset_id', assets),
    ...(await tx.prepare('SELECT stored_name FROM managed_report_history WHERE customer_id = ? AND stored_name IS NOT NULL').all(customerId)).map(row => row.stored_name)];
  await tx.prepare('DELETE FROM customer_recommendations WHERE customer_id = ?').run(customerId);
  files.push(...await deleteActivities(tx, activities), ...await deleteTasks(tx, tasks));
  await tx.prepare('DELETE FROM maintenance_visits WHERE customer_id = ?').run(customerId);
  await tx.prepare('DELETE FROM customer_asset_history WHERE customer_id = ?').run(customerId);
  await tx.prepare('DELETE FROM customer_assets WHERE customer_id = ?').run(customerId);
  await tx.prepare('DELETE FROM kpi_definitions WHERE customer_id = ?').run(customerId);
  await tx.prepare('DELETE FROM managed_report_history WHERE customer_id = ?').run(customerId);
  await tx.prepare('DELETE FROM customers WHERE id = ?').run(customerId);
  return files;
}

const removeFiles = files => removeStored(files);

module.exports = { deleteTasks, deleteProject, deleteVisits, deleteActivities, deleteCustomer, removeFiles };
