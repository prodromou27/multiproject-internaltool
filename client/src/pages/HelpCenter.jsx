import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useAuth } from '../App';
import { PageHeader } from '../components/PageLayout';
import { searchTopics, topicsFor } from '../help/helpContent';
import { HelpTopic } from '../components/HelpTopic';
import './HelpCenter.css';

/* The Help page: every topic for the person's role, searchable, one open at a time. */
export default function HelpCenter() {
  const { user } = useAuth();
  const { topic: topicId } = useParams();
  const [query, setQuery] = useState('');
  const topics = useMemo(() => topicsFor(user.role), [user.role]);
  const found = useMemo(() => searchTopics(topics, query), [topics, query]);
  const current = topics.find(topic => topic.id === topicId) || (query ? found[0] : topics[0]);
  const groups = [...new Set(found.map(topic => topic.group))];

  return <div className="help-center">
    <PageHeader title="Help" meta="How to use the app: pick a topic or search. The ? button at the top opens the topic for the page you are on." />
    <div className="help-layout">
      <nav className="help-topics" aria-label="Help topics">
        <label className="help-search">
          <Search size={14} aria-hidden="true" />
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search help…" aria-label="Search help" />
        </label>
        {!found.length && <p className="text-muted text-sm">Nothing matches "{query}".</p>}
        {groups.map(group => <div key={group} className="help-group">
          <h2>{group}</h2>
          <ul>{found.filter(topic => topic.group === group).map(topic => <li key={topic.id}>
            <Link to={`/help/${topic.id}`} aria-current={current?.id === topic.id ? 'page' : undefined}>{topic.title}</Link>
          </li>)}</ul>
        </div>)}
      </nav>
      {current && <article className="help-article card" aria-labelledby="help-title">
        <h2 id="help-title">{current.title}</h2>
        <HelpTopic topic={current} />
      </article>}
    </div>
  </div>;
}
