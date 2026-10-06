const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { SignedXml } = require('xml-crypto');
const fixture = require('./lib/activityFixture');
const { test, assert, api, db, ids, bcrypt } = fixture;
const saml = require('../sso/saml');

// A throwaway identity provider standing in for Entra: a key and self-signed certificate made for this run.
const os = require('os');
const { execFileSync } = require('child_process');
const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'saml-idp-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-keyout', path.join(keyDir, 'idp.key'), '-out', path.join(keyDir, 'idp.crt'), '-subj', '/CN=Test identity provider'],
  { stdio: 'ignore', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
const IDP_KEY = fs.readFileSync(path.join(keyDir, 'idp.key'), 'utf8');
const IDP_CERT = fs.readFileSync(path.join(keyDir, 'idp.crt'), 'utf8');
fs.rmSync(keyDir, { recursive: true, force: true });
const IDP_ISSUER = 'https://sts.windows.net/00000000-0000-0000-0000-000000000000/';
const APP = 'https://teamhub.example.com';

function samlResponse({ inResponseTo, email, audience = APP, notOnOrAfter = new Date(Date.now() + 5 * 60000), tamper = null }) {
  const now = new Date().toISOString(), until = notOnOrAfter.toISOString(), id = `_${crypto.randomUUID()}`;
  const assertion = `<Assertion xmlns="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" IssueInstant="${now}" Version="2.0"><Issuer>${IDP_ISSUER}</Issuer>`
    + `<Subject><NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${email}</NameID><SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><SubjectConfirmationData ${inResponseTo ? `InResponseTo="${inResponseTo}" ` : ''}NotOnOrAfter="${until}" Recipient="${APP}/api/auth/saml/acs"/></SubjectConfirmation></Subject>`
    + `<Conditions NotBefore="${new Date(Date.now() - 60000).toISOString()}" NotOnOrAfter="${until}"><AudienceRestriction><Audience>${audience}</Audience></AudienceRestriction></Conditions>`
    + `<AttributeStatement><Attribute Name="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"><AttributeValue>${email}</AttributeValue></Attribute></AttributeStatement>`
    + `<AuthnStatement AuthnInstant="${now}"><AuthnContext><AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</AuthnContextClassRef></AuthnContext></AuthnStatement></Assertion>`;
  const response = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_${crypto.randomUUID()}" Version="2.0" IssueInstant="${now}" Destination="${APP}/api/auth/saml/acs"${inResponseTo ? ` InResponseTo="${inResponseTo}"` : ''}>`
    + `<Issuer xmlns="urn:oasis:names:tc:SAML:2.0:assertion">${IDP_ISSUER}</Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${assertion}</samlp:Response>`;
  const signer = new SignedXml({ privateKey: IDP_KEY, publicCert: IDP_CERT, signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256', canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#' });
  signer.addReference({ xpath: "//*[local-name(.)='Assertion']", digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256', transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'] });
  signer.computeSignature(response, { location: { reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: 'after' } });
  let signed = signer.getSignedXml();
  if (tamper) signed = tamper(signed);
  return Buffer.from(signed).toString('base64');
}

/** Starts a sign-in like a browser: returns the request ID Entra must answer, the RelayState and the state cookie. */
async function startSignIn(next = '/tasks') {
  const res = await fetch(`${fixture.baseUrl}/api/auth/saml/login?next=${encodeURIComponent(next)}`, { redirect: 'manual' });
  assert.equal(res.status, 303);
  const location = new URL(res.headers.get('location'));
  const request = zlib.inflateRawSync(Buffer.from(location.searchParams.get('SAMLRequest'), 'base64')).toString('utf8');
  const cookie = (res.headers.get('set-cookie') || '').match(/th_saml_state=([^;]+)/)[1];
  return { location, requestId: request.match(/ID="([^"]+)"/)[1], relay: location.searchParams.get('RelayState'), cookie };
}
async function finish({ SAMLResponse, RelayState, cookie }) {
  const res = await fetch(`${fixture.baseUrl}/api/auth/saml/acs`, { method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://login.microsoftonline.com', ...(cookie ? { Cookie: `th_saml_state=${cookie}` } : {}) },
    body: new URLSearchParams({ SAMLResponse, RelayState }).toString() });
  const html = await res.text();
  return { status: res.status, target: (html.match(/url=([^"]+)"/) || [])[1]?.replace(/&amp;/g, '&'), session: (res.headers.get('set-cookie') || '').match(/solutionshub_session=([^;]+)/)?.[1] };
}

test.before(() => { process.env.APP_URL = APP; });

test('managers set up Microsoft sign-in from Entra details, and the login page offers it', async () => {
  assert.equal((await api('/api/auth/saml/status')).data.enabled, false);
  assert.equal((await api('/api/settings/sso', { method: 'PUT', token: ids.tokenEnabled, body: { enabled: true } })).status, 403);
  assert.equal((await api('/api/settings/sso', { method: 'PUT', token: ids.tokenManager, body: { enabled: true } })).status, 400, 'not without Entra details');
  assert.equal((await api('/api/settings/sso', { method: 'PUT', token: ids.tokenManager, body: { certificate: 'not a certificate' } })).status, 400);
  const saved = await api('/api/settings/sso', { method: 'PUT', token: ids.tokenManager, body: { entry_point: 'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/saml2', idp_issuer: IDP_ISSUER, certificate: IDP_CERT, enabled: true } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.ready, true);
  assert.equal(saved.data.acs_url, `${APP}/api/auth/saml/acs`, 'the Reply URL to enter in Entra');
  assert.equal(saved.data.sp_entity_id, APP, 'the Identifier to enter in Entra');
  assert.match(saved.data.certificates[0].fingerprint, /^([0-9A-F]{2}:){19}[0-9A-F]{2}$/);
  assert.deepEqual((await api('/api/auth/saml/status')).data, { enabled: true, label: 'Sign in with Microsoft' });
  const metadata = await fetch(`${fixture.baseUrl}/api/auth/saml/metadata`);
  assert.match(await metadata.text(), /AssertionConsumerService[^>]+https:\/\/teamhub\.example\.com\/api\/auth\/saml\/acs/);
});

test('a signed Entra response for an active account signs in and goes where the person was heading', async () => {
  await db.prepare('INSERT INTO users (name, email, password, role, must_change_password) VALUES (?, ?, ?, ?, 1)').run('Sso User', 'sso.user@test.local', bcrypt.hashSync('temporary', 4), 'engineer');
  const start = await startSignIn('/tasks?filter=open');
  assert.equal(start.location.origin + start.location.pathname, 'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/saml2');
  const done = await finish({ SAMLResponse: samlResponse({ inResponseTo: start.requestId, email: 'SSO.User@test.local' }), RelayState: start.relay, cookie: start.cookie });
  assert.equal(done.status, 200);
  assert.equal(done.target, '/tasks?filter=open');
  assert.ok(done.session, 'a session cookie is set');
  const me = await fetch(`${fixture.baseUrl}/api/auth/me`, { headers: { Cookie: `solutionshub_session=${done.session}` } });
  assert.equal(me.status, 200, 'not asked to change a password first');
  assert.equal((await me.json()).email, 'sso.user@test.local');
  const user = await db.prepare('SELECT password, must_change_password FROM users WHERE email = ?').get('sso.user@test.local');
  assert.equal(Number(user.must_change_password), 0);
  assert.equal(bcrypt.compareSync('temporary', user.password), false, 'the unchanged temporary password no longer works');
  assert.equal((await api('/api/auth/login', { method: 'POST', body: { email: 'manager one@test.local', password: 'pw' } })).status, 200, 'app passwords keep working for everyone else');

  // The same response again (a replay) is refused: its request was already answered.
  const replay = await finish({ SAMLResponse: samlResponse({ inResponseTo: start.requestId, email: 'sso.user@test.local' }), RelayState: start.relay, cookie: start.cookie });
  assert.equal(replay.target, '/login?sso_error=invalid');
  assert.equal(replay.session, undefined);
});

test('responses that are forged, altered, unsolicited, for someone else\'s browser, or for unknown people are refused', async () => {
  const cases = [];
  { const s = await startSignIn(); cases.push(['altered after signing', { SAMLResponse: samlResponse({ inResponseTo: s.requestId, email: 'sso.user@test.local', tamper: xml => xml.replace(/sso\.user@test\.local/g, 'manager.one@test.local') }), RelayState: s.relay, cookie: s.cookie }, 'invalid']); }
  { const s = await startSignIn(); cases.push(['for another audience', { SAMLResponse: samlResponse({ inResponseTo: s.requestId, email: 'sso.user@test.local', audience: 'https://other.example' }), RelayState: s.relay, cookie: s.cookie }, 'invalid']); }
  { const s = await startSignIn(); cases.push(['expired', { SAMLResponse: samlResponse({ inResponseTo: s.requestId, email: 'sso.user@test.local', notOnOrAfter: new Date(Date.now() - 10 * 60000) }), RelayState: s.relay, cookie: s.cookie }, 'invalid']); }
  { const s = await startSignIn(); cases.push(['not asked for', { SAMLResponse: samlResponse({ inResponseTo: null, email: 'sso.user@test.local' }), RelayState: s.relay, cookie: s.cookie }, 'invalid']); }
  { const s = await startSignIn(); cases.push(['finished in a different browser', { SAMLResponse: samlResponse({ inResponseTo: s.requestId, email: 'sso.user@test.local' }), RelayState: s.relay, cookie: 'someone-else' }, 'expired']); }
  { const s = await startSignIn(); cases.push(['no account', { SAMLResponse: samlResponse({ inResponseTo: s.requestId, email: 'stranger@test.local' }), RelayState: s.relay, cookie: s.cookie }, 'no_account']); }
  { const forger = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const s = await startSignIn();
    const unsigned = Buffer.from(samlResponse({ inResponseTo: s.requestId, email: 'sso.user@test.local' }), 'base64').toString('utf8')
      .replace(/<SignatureValue>[^<]+<\/SignatureValue>/, `<SignatureValue>${crypto.sign('sha256', Buffer.from('x'), forger.privateKey).toString('base64')}</SignatureValue>`);
    cases.push(['signed with another key', { SAMLResponse: Buffer.from(unsigned).toString('base64'), RelayState: s.relay, cookie: s.cookie }, 'invalid']); }
  for (const [name, input, code] of cases) {
    const result = await finish(input);
    assert.equal(result.target, `/login?sso_error=${code}`, name);
    assert.equal(result.session, undefined, name);
  }
  await db.prepare('UPDATE users SET active = 0 WHERE email = ?').run('sso.user@test.local');
  const s = await startSignIn();
  assert.equal((await finish({ SAMLResponse: samlResponse({ inResponseTo: s.requestId, email: 'sso.user@test.local' }), RelayState: s.relay, cookie: s.cookie })).target, '/login?sso_error=inactive');
});

test('sign-in only ever returns to a page of this app', () => {
  for (const [input, want] of [['/tasks', '/tasks'], ['//evil.example', '/'], ['https://evil.example', '/'], ['/\\evil', '/'], ['/api/auth/me', '/'], [undefined, '/']]) assert.equal(saml.safeNext(input), want, String(input));
  assert.equal(saml.emailOf({ nameID: 'x', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress': 'A.B@Example.com' }), 'a.b@example.com');
  assert.equal(saml.emailOf({ nameID: 'not-an-email' }), '');
});

test("Entra's federation metadata gives the sign-in URL, identifier and signing certificates", () => {
  const cert = saml.cleanCert(IDP_CERT);
  const xml = `<?xml version="1.0"?><EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${IDP_ISSUER}">`
    + `<RoleDescriptor xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="fed:SecurityTokenServiceType"><KeyDescriptor use="signing"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>ignored-not-the-idp-section</X509Certificate></X509Data></KeyInfo></KeyDescriptor></RoleDescriptor>`
    + `<IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"><KeyDescriptor use="signing"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>${cert}</X509Certificate></X509Data></KeyInfo></KeyDescriptor>`
    + `<SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://login.microsoftonline.com/t/saml2-post"/><SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://login.microsoftonline.com/t/saml2"/></IDPSSODescriptor></EntityDescriptor>`;
  assert.deepEqual(saml.parseMetadata(xml), { idp_issuer: IDP_ISSUER, entry_point: 'https://login.microsoftonline.com/t/saml2', idp_certs: [cert] });
  assert.throws(() => saml.parseMetadata('<html>not metadata</html>'), /not SAML identity provider metadata/);
  assert.equal(saml.cleanCert('garbage'), null);
});
