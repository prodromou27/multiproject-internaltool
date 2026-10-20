import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { HelpCircle } from 'lucide-react';
import { Modal } from './Shared';
import { HELP_TOPICS, topicForPath } from '../help/helpContent';
import { HelpTopic } from '../pages/HelpCenter';

/**
 * The ? button: help for the page you are on (help/helpContent.js), with a way to the
 * Help page and every topic. Pages without a topic of their own get "Getting started".
 */
export default function HelpMenu({ role }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const topic = topicForPath(pathname, role) || HELP_TOPICS[0];
  return (
    <>
      <button type="button" className="topbar-action" onClick={() => setOpen(true)} aria-label="Help">
        <HelpCircle size={18} />
      </button>
      {open && (
        <Modal title={`Help: ${topic.title}`} onClose={() => setOpen(false)} wide>
          <HelpTopic topic={topic} />
          <p className="help-more">
            <Link to="/help" onClick={() => setOpen(false)}>All help topics</Link>, including the chat bot commands.
            Press <kbd>Ctrl</kbd> <kbd>K</kbd> anywhere to jump to a page or record by name.
          </p>
        </Modal>
      )}
    </>
  );
}
