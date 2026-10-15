import { Fragment, useEffect, useRef, useState } from 'react';
import { Bot, Copy, Send } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../components/Toast';
import { Toggle } from './shared';

/* Settings → Activity bot: engineers log service activities by
   messaging a Webex or Teams bot in plain words. */

// The bot answers in a small Markdown subset: **bold**, *italic* and line breaks. Rendered as text, never as HTML.
function BotText({ text }) {
  return String(text).split('\n').map((line, index) => (
    <Fragment key={index}>{index > 0 && <br />}{line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, i) =>
      part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part.startsWith('*') && part.length > 2 ? <em key={i}>{part.slice(1, -1)}</em> : part)}</Fragment>
  ));
}

function CopyField({ label, value }) {
  const toast = useToast();
  if (!value) return null;
  return <div className="bot-copy"><span>{label}</span><code>{value}</code>
    <button type="button" className="btn btn-ghost btn-sm" aria-label={`Copy ${label}`} onClick={() => navigator.clipboard?.writeText(value).then(() => toast.success('Copied'))}><Copy size={12} /></button></div>;
}

function TryIt() {
  const [lines, setLines] = useState([]), [text, setText] = useState(''), [busy, setBusy] = useState(false);
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'nearest' }); }, [lines]);
  async function send(event) {
    event.preventDefault();
    const message = text.trim();
    if (!message) return;
    setText(''); setBusy(true);
    setLines(current => [...current, { from: 'you', text: message }]);
    try { const { reply } = await api.tryActivityBot(message); setLines(current => [...current, { from: 'bot', text: reply }]); }
    catch (failure) { setLines(current => [...current, { from: 'bot', text: `⚠️ ${failure.message}` }]); }
    finally { setBusy(false); }
  }
  return <div className="bot-try">
    <h4>Try it</h4>
    <p className="text-sm text-muted">Talk to the bot here as yourself, exactly as an engineer would on Webex or Teams. Saying <strong>yes</strong> really saves the activity, under your name.</p>
    <div className="bot-try-log" aria-live="polite">
      {!lines.length && <p className="text-muted text-sm">For example: <em>1h on Northwind, upgraded NW-FW-01 to 7.6.0, ticket 4521</em></p>}
      {lines.map((line, index) => <div key={index} className={`bot-line is-${line.from}`}><BotText text={line.text} /></div>)}
      <div ref={end} />
    </div>
    <form className="bot-try-input" onSubmit={send}>
      <input value={text} onChange={event => setText(event.target.value)} maxLength={4000} placeholder="Describe some work…" aria-label="Message to the activity bot" disabled={busy} />
      <button className="btn btn-primary btn-sm" disabled={busy || !text.trim()}><Send size={13} /> Send</button>
    </form>
  </div>;
}

export function ActivityBotSettings({ sectionStyle }) {
  const toast = useToast();
  const [view, setView] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const [teams, setTeams] = useState({ app_id: '', app_password: '', tenant_id: '' });
  useEffect(() => {
    api.activityBotSettings().then(result => { setView(result); setTeams({ app_id: result.teams.app_id, app_password: '', tenant_id: result.teams.tenant_id }); }).catch(failure => setError(failure.message));
  }, []);
  async function save(change, message) {
    setBusy('save');
    try { const result = await api.saveActivityBot(change); setView(result); setTeams(current => ({ ...current, app_password: '' })); if (message) toast.success(message); }
    catch (failure) { toast.error(failure.message); } finally { setBusy(''); }
  }
  async function register() {
    setBusy('register');
    try { const result = await api.registerWebexBot(); setView(result); toast.success(result.message); }
    catch (failure) { toast.error(failure.message); } finally { setBusy(''); }
  }
  if (error) return <div style={sectionStyle}><div className="error-msg" role="alert">{error}</div></div>;
  if (!view) return <div style={sectionStyle}><p className="text-muted">Loading the activity bot…</p></div>;
  const teamsChanged = teams.app_id !== view.teams.app_id || teams.tenant_id !== view.teams.tenant_id || !!teams.app_password;
  return <section style={sectionStyle} className="bot-settings" aria-label="Activity bot">
    <div className="bot-settings-head"><Bot size={18} aria-hidden="true" /><div>
      <strong>Activity bot</strong>
      <p className="text-sm text-muted">Engineers message the bot in plain words (<em>“45m support for Contoso, ticket 4521”</em>). It drafts the service activity, asks for anything missing, and saves it when they reply <strong>yes</strong>, under their own account and permissions. It understands messages with built-in rules on this server; nothing is sent to an AI service. People are matched by their Webex or Teams email address, which must be their TeamHub email.</p>
    </div></div>
    {!view.public_url_https && <div className="alert alert-warning"><span>Webex and Teams deliver messages to this app over the internet, so it needs a public <code>https://</code> address set as <code>APP_URL</code> on the server{view.public_url ? ` (currently ${view.public_url})` : ''}.</span></div>}

    <div className="bot-channel">
      <div className="bot-channel-head"><strong>Webex</strong><Toggle checked={view.webex.enabled} disabled={!!busy} onChange={value => save({ webex: { enabled: value } }, value ? 'Webex bot turned on' : 'Webex bot turned off')} label={view.webex.enabled ? 'On' : 'Off'} /></div>
      <ol className="text-sm">
        <li>{view.webex.bot_token_set ? 'The bot token from Webex notifications above is used.' : <>Add the Webex <strong>bot token</strong> under Webex notifications above.</>}</li>
        <li>Register the webhook so Webex sends direct messages to the bot here. {view.webex.webhook_registered ? <span className="bot-ok">Registered</span> : <span className="text-muted">Not registered</span>}
          <div><button type="button" className="btn btn-ghost btn-sm" disabled={!!busy || !view.webex.bot_token_set || !view.public_url_https} onClick={register}>{busy === 'register' ? 'Registering…' : view.webex.webhook_registered ? 'Register again' : 'Register webhook'}</button></div></li>
        <li>Engineers open a one-to-one chat with the bot in Webex and say <em>help</em>.</li>
      </ol>
      <CopyField label="Webhook address" value={view.webex.target_url} />
    </div>

    <div className="bot-channel">
      <div className="bot-channel-head"><strong>Microsoft Teams</strong><Toggle checked={view.teams.enabled} disabled={!!busy || !view.teams.app_id || !view.teams.app_password_set} onChange={value => save({ teams: { enabled: value } }, value ? 'Teams bot turned on' : 'Teams bot turned off')} label={view.teams.enabled ? 'On' : 'Off'} /></div>
      <ol className="text-sm">
        <li>In Azure, create an <strong>Azure Bot</strong> (single tenant is fine), enable the <strong>Microsoft Teams</strong> channel, and set its messaging endpoint to the address below.</li>
        <li>Enter the bot's Microsoft App ID, a client secret (password) and, for a single-tenant bot, your tenant ID.</li>
        <li>Add the bot to Teams for your engineers (a Teams app package or the Azure "Open in Teams" link).</li>
      </ol>
      <CopyField label="Messaging endpoint" value={view.teams.messaging_endpoint} />
      <div className="form-row">
        <div className="form-group"><label htmlFor="bot-teams-app">Microsoft App ID</label><input id="bot-teams-app" value={teams.app_id} onChange={event => setTeams(current => ({ ...current, app_id: event.target.value.trim() }))} placeholder="00000000-0000-0000-0000-000000000000" /></div>
        <div className="form-group"><label htmlFor="bot-teams-tenant">Tenant ID (single-tenant bots)</label><input id="bot-teams-tenant" value={teams.tenant_id} onChange={event => setTeams(current => ({ ...current, tenant_id: event.target.value.trim() }))} placeholder="Optional" /></div>
      </div>
      <div className="form-group"><label htmlFor="bot-teams-secret">App password (client secret)</label><input id="bot-teams-secret" type="password" autoComplete="new-password" value={teams.app_password} onChange={event => setTeams(current => ({ ...current, app_password: event.target.value }))} placeholder={view.teams.app_password_set ? 'Saved — type a new one to replace it' : 'Paste the client secret'} /></div>
      <button type="button" className="btn btn-primary btn-sm" disabled={!!busy || !teamsChanged} onClick={() => save({ teams: { app_id: teams.app_id, tenant_id: teams.tenant_id, ...(teams.app_password ? { app_password: teams.app_password } : {}) } }, 'Teams bot details saved')}>Save Teams details</button>
    </div>

    <TryIt />
  </section>;
}
