import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, PackageCheck, RefreshCw, Settings2 } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../App';
import { PageHeader } from '../components/PageLayout';
import { Surface, ToneBadge } from '../components/EnterpriseUI';
import { fmtDate, fmtDateTime } from '../components/Shared';
import { useToast } from '../components/Toast';
import { useLiveVersion } from '../live';
import { localDateISO } from '../utils/dates';
import SoftwareAdmin from './SoftwareAdmin';
import './SoftwareVersions.css';

/* Software versions: the latest (and recommended) version of each product we
   support, per version line, with support and end-of-life dates; what was
   released recently; and news from vendor feeds. Server: routes/software.js. */

const SOURCE = { endoflife: 'endoflife.date', fortinet: 'Fortinet documentation', checkpoint: 'Check Point Jumbo documentation', manual: 'Entered by hand' };

function lifecycle(release, today) {
  const soon = date => date && date >= today && date <= localDateISO(new Date(Date.now() + 182 * 86400000));
  if (release.eol && release.eol < today) return { tone: 'danger', text: 'End of life' };
  if (release.support_end && release.support_end < today) return { tone: 'warning', text: 'Security fixes only' };
  if (soon(release.support_end) || soon(release.eol)) return { tone: 'warning', text: 'Support ending' };
  if (release.maintained === 0) return { tone: 'neutral', text: 'Not maintained' };
  return { tone: 'success', text: 'Supported' };
}

function Product({ product, today }) {
  return <Surface title={product.name} description={`${product.vendor ? `${product.vendor} · ` : ''}${SOURCE[product.source] || product.source}${product.last_checked_at ? ` · checked ${fmtDateTime(product.last_checked_at)}` : ''}`}>
    {product.last_error && <p className="error-msg sv-error" role="alert">The last check failed: {product.last_error}</p>}
    {!product.releases.length ? <p className="text-muted">{product.source === 'manual' ? 'No versions entered yet.' : 'Not read yet. It is checked every morning, or use Check now.'}</p> :
      <div className="table-wrap"><table className="sv-table">
        <thead><tr><th scope="col">Version line</th><th scope="col">Latest</th><th scope="col">Recommended</th><th scope="col">Support ends</th><th scope="col">End of life</th><th scope="col">Status</th></tr></thead>
        <tbody>{product.releases.map(release => {
          const state = lifecycle(release, today);
          return <tr key={release.branch}>
            <th scope="row">{release.branch}</th>
            <td>{release.latest_version ? <>{release.link ? <a href={release.link} target="_blank" rel="noreferrer">{release.latest_version} <ExternalLink size={11} aria-hidden="true" /></a> : release.latest_version}
              {release.latest_date && <small className="sv-sub">{fmtDate(release.latest_date)}</small>}</> : <span className="text-muted">—</span>}</td>
            <td>{release.recommended_version ? <>{release.recommended_version}{release.recommended_date && <small className="sv-sub">since {fmtDate(release.recommended_date)}</small>}</> : <span className="text-muted">—</span>}</td>
            <td>{release.support_end ? fmtDate(release.support_end) : <span className="text-muted">—</span>}</td>
            <td>{release.eol ? fmtDate(release.eol) : <span className="text-muted">—</span>}</td>
            <td><ToneBadge tone={state.tone}>{state.text}</ToneBadge>{release.note && <small className="sv-sub">{release.note}</small>}</td>
          </tr>;
        })}</tbody>
      </table></div>}
  </Surface>;
}

export default function SoftwareVersions() {
  const { user } = useAuth();
  const toast = useToast();
  const manager = user?.role === 'manager';
  const [data, setData] = useState(null), [error, setError] = useState(''), [managing, setManaging] = useState(false), [checking, setChecking] = useState(false);
  const live = useLiveVersion();
  const load = useCallback(async () => {
    try { setData(await api.softwareVersions()); setError(''); } catch (failure) { setError(failure.message); }
  }, []);
  useEffect(() => { load(); }, [load, live]);
  async function checkNow() {
    setChecking(true);
    try {
      await api.syncSoftwareVersions();
      toast.success('Checking every product and feed. This takes a minute.');
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const next = await api.softwareVersions(); setData(next);
        if (!next.last_sync?.running) break;
      }
    } catch (failure) { toast.error(failure.message); } finally { setChecking(false); }
  }
  const today = localDateISO(new Date());
  return <div className="page sv-page">
    <PageHeader title="Software versions"
      meta={data?.last_sync?.at ? `The latest versions of the products we support, checked every morning. Last checked ${fmtDateTime(data.last_sync.at)}.` : 'The latest versions of the products we support, checked every morning.'}
      actions={manager && <>
        <button type="button" className="btn btn-ghost btn-sm" disabled={checking || data?.last_sync?.running} onClick={checkNow}><RefreshCw size={14} className={checking ? 'spin' : ''} /> {checking ? 'Checking…' : 'Check now'}</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setManaging(value => !value)}><Settings2 size={14} /> {managing ? 'Close settings' : 'Products and feeds'}</button>
      </>} />
    {managing && <SoftwareAdmin onChanged={load} />}
    {error ? <div className="error-msg" role="alert">{error}</div> : !data ? <p className="text-muted">Loading…</p> : <div className="sv-layout">
      <div className="sv-main">
        {!data.products.length && <p className="text-muted">No products are followed yet.{manager ? ' Add them under Products and feeds.' : ''}</p>}
        {data.products.map(product => <Product key={product.id} product={product} today={today} />)}
      </div>
      <aside className="sv-side">
        <Surface title="Recently released">
          {!data.events.length ? <p className="text-muted text-sm">Nothing new since products were first checked.</p> :
            <ul className="sv-events">{data.events.map(event => <li key={event.id}>
              <PackageCheck size={14} aria-hidden="true" />
              <div><strong>{event.product_name} {event.branch}: {event.version}</strong>
                <span>{event.kind === 'recommended' ? 'now recommended' : 'released'}{event.previous ? `, was ${event.previous}` : ''} · {fmtDate(event.detected_at)}</span></div>
            </li>)}</ul>}
        </Surface>
        <Surface title="News">
          {!data.news.length ? <p className="text-muted text-sm">{data.feeds ? 'No news matching the feeds’ keywords yet.' : 'No feeds yet.'}{manager && !data.feeds ? ' Add vendor RSS feeds under Products and feeds.' : ''}</p> :
            <ul className="sv-news">{data.news.map(item => <li key={item.id}>
              {item.link ? <a href={item.link} target="_blank" rel="noreferrer">{item.title}</a> : <strong>{item.title}</strong>}
              <span>{item.feed_name}{item.published_at ? ` · ${fmtDate(item.published_at)}` : ''}</span>
              {item.summary && <p>{item.summary}</p>}
            </li>)}</ul>}
        </Surface>
      </aside>
    </div>}
  </div>;
}
