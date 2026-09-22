/**
 * Mounts the settings/ sub-routers under /api/settings. Each file below owns
 * one settings domain (was previously one 564-line file); see routes/settings/
 * shared.js for the small set of helpers they have in common.
 */
const router = require('express').Router();

router.use(require('./settings/integrations'));
router.use(require('./settings/localization'));
router.use(require('./settings/alerts'));
router.use(require('./settings/logging'));
router.use(require('./settings/system'));
router.use(require('./settings/security'));

module.exports = router;
