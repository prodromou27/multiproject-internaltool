/**
 * Sign in with Microsoft 365 (Entra ID) over SAML 2.0, alongside the app's own
 * passwords. Entra signs each assertion; @node-saml/node-saml checks the
 * signature against Entra's certificate, the audience, the time window, and
 * that the response answers a request this server made (InResponseTo).
 *
 * Settings → Sign-in holds the Entra details: usually just the "App Federation
 * Metadata Url", from which the login URL, identifier and signing certificates
 * are read (and re-read daily, so Entra's certificate rollover is followed).
 */
const crypto = require('crypto');
const { DOMParser } = require('@xmldom/xmldom');
const { SAML } = require('@node-saml/node-saml');
const { InMemoryCacheProvider } = require('@node-saml/node-saml/lib/in-memory-cache-provider');
const db = require('../db');

const KEY = 'sso_saml';
const DEFAULTS = Object.freeze({ enabled: false, metadata_url: '', entry_point: '', idp_issuer: '', idp_certs: [], sp_entity_id: '', button_label: 'Sign in with Microsoft', metadata_fetched_at: null });
// Requests we sent, so a response must answer one of them (and only once).
const requestCache = new InMemoryCacheProvider({ keyExpirationPeriodMs: 10 * 60 * 1000 });

const appUrl = () => String(process.env.APP_URL || '').replace(/\/+$/, '');
const acsUrl = () => `${appUrl()}/api/auth/saml/acs`;
const defaultEntityId = () => appUrl() || 'urn:teamhub';

async function stored(store = db) {
  const row = await store.prepare('SELECT value FROM settings WHERE key = ?').get(KEY);
  try { return { ...DEFAULTS, ...JSON.parse(row?.value || '{}') }; } catch { return { ...DEFAULTS }; }
}
async function save(value, store = db) {
  await store.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value').run(KEY, JSON.stringify(value));
}

/** A certificate as one base64 line, whether pasted as PEM or bare. */
function cleanCert(value) {
  const body = String(value || '').replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
  if (!body || !/^[A-Za-z0-9+/]+=*$/.test(body)) return null;
  try { new crypto.X509Certificate(`-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----`); } catch { return null; }
  return body;
}
function certExpiry(body) {
  try { return new crypto.X509Certificate(`-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----`).validTo; } catch { return null; }
}

/** Reads Entra's federation metadata XML: entity ID, SAML sign-in URL and signing certificates. */
function parseMetadata(xml) {
  const doc = new DOMParser({ onError: () => {} }).parseFromString(String(xml || ''), 'text/xml');
  const all = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));
  const entity = all(doc, 'EntityDescriptor')[0];
  const idp = entity && all(entity, 'IDPSSODescriptor')[0];
  if (!idp) throw Object.assign(new Error('That is not SAML identity provider metadata (no IDPSSODescriptor found)'), { status: 400 });
  const sso = all(idp, 'SingleSignOnService');
  const redirect = sso.find(node => /HTTP-Redirect$/.test(node.getAttribute('Binding'))) || sso[0];
  const certs = all(idp, 'KeyDescriptor').filter(node => !node.getAttribute('use') || node.getAttribute('use') === 'signing')
    .flatMap(node => all(node, 'X509Certificate').map(cert => cleanCert(cert.textContent))).filter(Boolean);
  if (!redirect?.getAttribute('Location') || !certs.length) throw Object.assign(new Error('The metadata has no sign-in URL or signing certificate'), { status: 400 });
  return { idp_issuer: entity.getAttribute('entityID') || '', entry_point: redirect.getAttribute('Location'), idp_certs: [...new Set(certs)] };
}

/** Downloads metadata from Entra's App Federation Metadata Url. */
async function fetchMetadata(url, { fetchImpl = global.fetch } = {}) {
  let parsed;
  try { parsed = new URL(url); } catch { throw Object.assign(new Error('The metadata URL is not a valid URL'), { status: 400 }); }
  if (parsed.protocol !== 'https:') throw Object.assign(new Error('The metadata URL must use https'), { status: 400 });
  let response;
  try { response = await fetchImpl(parsed, { headers: { Accept: 'application/xml, text/xml' }, redirect: 'follow', signal: AbortSignal.timeout(20000) }); }
  catch (error) { throw Object.assign(new Error(`Could not download the metadata (${error?.cause?.code || error.name})`), { status: 502 }); }
  if (!response.ok) throw Object.assign(new Error(`Downloading the metadata returned HTTP ${response.status}`), { status: 502 });
  return parseMetadata(await response.text());
}

/** Whether Microsoft sign-in can be offered: on, and fully configured. */
const ready = settings => !!(settings.enabled && settings.entry_point && settings.idp_certs?.length && appUrl());

function client(settings) {
  return new SAML({
    callbackUrl: acsUrl(),
    entryPoint: settings.entry_point,
    issuer: settings.sp_entity_id || defaultEntityId(),
    audience: settings.sp_entity_id || defaultEntityId(),
    idpIssuer: settings.idp_issuer || undefined,
    idpCert: settings.idp_certs,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false, // Entra signs the assertion by default
    signatureAlgorithm: 'sha256',
    identifierFormat: null, // let Entra send its configured name ID (normally the UPN/email)
    disableRequestedAuthnContext: true, // allow any Entra sign-in method, including passwordless and MFA
    acceptedClockSkewMs: 3 * 60 * 1000,
    validateInResponseTo: 'always',
    requestIdExpirationPeriodMs: 10 * 60 * 1000,
    cacheProvider: requestCache,
  });
}

/** The email the assertion identifies, from the usual Entra claims, else the name ID if it looks like one. */
function emailOf(profile = {}) {
  const candidates = [
    profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'],
    profile.email, profile.mail,
    profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'],
    profile.nameID,
  ].flat().filter(value => typeof value === 'string');
  return (candidates.find(value => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) || '').trim().toLowerCase();
}

/** Where to go after sign-in: a path on this app only. */
function safeNext(value) {
  const next = String(value || '/');
  return /^\/(?![/\\])[^\s]*$/.test(next) && !next.startsWith('/api/') ? next.slice(0, 500) : '/';
}

/** Re-reads Entra's metadata once a day when a URL is set (certificate rollover). */
async function refreshIfStale(settings, { fetchImpl } = {}) {
  if (!settings.metadata_url) return settings;
  const age = settings.metadata_fetched_at ? Date.now() - Date.parse(settings.metadata_fetched_at) : Infinity;
  if (age < 24 * 60 * 60 * 1000) return settings;
  try {
    const next = { ...settings, ...(await fetchMetadata(settings.metadata_url, { fetchImpl })), metadata_fetched_at: new Date().toISOString() };
    await save(next);
    return next;
  } catch (error) {
    console.error('[sso] metadata refresh failed:', error.message);
    return settings; // keep signing in with the certificates we have
  }
}

/** What the settings page shows (certificates summarised, never secrets — there are none). */
function publicView(settings) {
  return {
    enabled: !!settings.enabled, ready: ready(settings), metadata_url: settings.metadata_url || '', entry_point: settings.entry_point || '', idp_issuer: settings.idp_issuer || '',
    certificates: (settings.idp_certs || []).map(cert => ({ fingerprint: crypto.createHash('sha1').update(Buffer.from(cert, 'base64')).digest('hex').toUpperCase().match(/.{2}/g).join(':'), expires: certExpiry(cert) })),
    sp_entity_id: settings.sp_entity_id || defaultEntityId(), acs_url: acsUrl(), metadata_url_sp: `${appUrl()}/api/auth/saml/metadata`, app_url_set: !!appUrl(),
    button_label: settings.button_label || DEFAULTS.button_label, metadata_fetched_at: settings.metadata_fetched_at || null,
  };
}

module.exports = { KEY, DEFAULTS, stored, save, cleanCert, parseMetadata, fetchMetadata, ready, client, emailOf, safeNext, refreshIfStale, publicView, acsUrl, defaultEntityId };
