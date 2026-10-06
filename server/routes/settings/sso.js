/** Settings → Sign-in: Microsoft 365 (Entra ID) single sign-on over SAML (managers). */
const router = require('express').Router();
const { requireManager } = require('../../middleware/auth');
const { logSettingsChange } = require('./shared');
const saml = require('../../sso/saml');

const ALLOWED = ['enabled', 'metadata_url', 'entry_point', 'idp_issuer', 'certificate', 'sp_entity_id', 'button_label'];
const bad = (res, message) => res.status(400).json({ error: message });

router.get('/sso', requireManager, async (req, res) => res.json(saml.publicView(await saml.stored())));

router.put('/sso', requireManager, async (req, res) => {
  const body = req.body || {};
  if (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !ALLOWED.includes(key))) return bad(res, 'Invalid sign-in settings');
  const current = await saml.stored(), next = { ...current };
  if (body.enabled !== undefined) { if (typeof body.enabled !== 'boolean') return bad(res, 'Enabled must be true or false'); next.enabled = body.enabled; }
  if (body.button_label !== undefined) { const label = String(body.button_label).trim(); if (!label || label.length > 60) return bad(res, 'The button text must be 1 to 60 characters'); next.button_label = label; }
  if (body.sp_entity_id !== undefined) {
    const id = String(body.sp_entity_id).trim();
    if (id && (id.length > 300 || !/^(https?:\/\/|urn:|api:\/\/)\S+$/.test(id))) return bad(res, 'The identifier must be a URL or URN, as entered in Entra (Identifier / Entity ID)');
    next.sp_entity_id = id;
  }
  try {
    if (body.metadata_url !== undefined && String(body.metadata_url).trim() !== (current.metadata_url || '')) {
      const url = String(body.metadata_url).trim();
      next.metadata_url = url;
      if (url) Object.assign(next, await saml.fetchMetadata(url), { metadata_fetched_at: new Date().toISOString() });
    }
  } catch (error) { return res.status(error.status && error.status < 500 ? error.status : 502).json({ error: error.message }); }
  // Entered by hand instead of a metadata URL (Entra's Login URL, Microsoft Entra Identifier, Certificate (Base64)).
  if (body.entry_point !== undefined) {
    const url = String(body.entry_point).trim();
    if (url && !/^https:\/\/\S+$/.test(url)) return bad(res, 'The Login URL must be an https address');
    next.entry_point = url;
  }
  if (body.idp_issuer !== undefined) next.idp_issuer = String(body.idp_issuer).trim().slice(0, 300);
  if (body.certificate !== undefined && String(body.certificate).trim()) {
    const cert = saml.cleanCert(body.certificate);
    if (!cert) return bad(res, 'That is not a valid certificate. Paste Entra\'s Certificate (Base64), including or without the BEGIN/END lines.');
    next.idp_certs = [cert];
  }
  if (next.enabled && !(next.entry_point && next.idp_certs?.length)) return bad(res, 'Add the Entra metadata URL (or the Login URL and certificate) before turning Microsoft sign-in on');
  if (next.enabled && !process.env.APP_URL) return bad(res, 'Set APP_URL on the server to the address people use for this app; Entra sends sign-ins back to it');
  await saml.save(next);
  await logSettingsChange(req, 'sso_saml', `enabled=${next.enabled}; metadata=${next.metadata_url ? 'url' : next.entry_point ? 'manual' : 'none'}; certificates=${(next.idp_certs || []).length}`);
  res.json(saml.publicView(next));
});

router.post('/sso/refresh-metadata', requireManager, async (req, res) => {
  const current = await saml.stored();
  if (!current.metadata_url) return bad(res, 'No metadata URL is set');
  try {
    const next = { ...current, ...(await saml.fetchMetadata(current.metadata_url)), metadata_fetched_at: new Date().toISOString() };
    await saml.save(next);
    res.json(saml.publicView(next));
  } catch (error) { res.status(error.status && error.status < 500 ? error.status : 502).json({ error: error.message }); }
});

module.exports = router;
