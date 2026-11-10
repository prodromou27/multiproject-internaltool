/* Edit versions (review I04): customers, projects and maintenance visits carry
   edit_version, raised by every save. An edit form sends the version it opened
   (`version`); if the record was saved by someone else meanwhile, the save is
   refused with 409 EDIT_CONFLICT and the current record, so the form can keep the
   person's input and show what changed. Saves without `version` (quick changes
   such as a status menu) work as before and still raise the version. */

/** The version an editor sent: { value } (or {} when none was sent), or { error }. */
function sentVersion(body) {
  if (body?.version === undefined || body.version === null || body.version === '') return {};
  const value = Number(body.version);
  if (!Number.isSafeInteger(value) || value < 1) return { error: 'version must be the edit version the form was opened with' };
  return { value };
}

function conflict(res, label, current) {
  return res.status(409).json({
    error: `${label} was changed by someone else after you opened it. Your changes are still in the form.`,
    code: 'EDIT_CONFLICT',
    current,
  });
}

module.exports = { sentVersion, conflict };
