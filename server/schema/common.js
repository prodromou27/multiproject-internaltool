/**
 * Shared schema constants.
 * (Extracted verbatim from db.js — see db.js for the connection layer.)
 */
const NOW = "to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24:MI:SS')";

module.exports = { NOW };
