import { Fragment } from 'react';
import './HelpTopic.css';

/* A help topic's text (help/helpContent.js), on the Help page and in the ? dialog. */

/** **bold** and *italic* in help text. */
export function HelpText({ text }) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  return parts.map((part, index) => part.startsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong>
    : part.startsWith('*') && part.length > 2 ? <em key={index}>{part.slice(1, -1)}</em> : <Fragment key={index}>{part}</Fragment>);
}

/** One topic's text (also shown in the ? dialog). */
export function HelpTopic({ topic }) {
  return <>
    <p className="help-summary">{topic.summary}</p>
    {topic.sections.map(section => <section key={section.heading} className="help-section">
      <h3>{section.heading}</h3>
      <ul>{section.items.map(item => <li key={item}><HelpText text={item} /></li>)}</ul>
    </section>)}
  </>;
}
