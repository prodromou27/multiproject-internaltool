import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, RotateCw } from 'lucide-react';
import { PageState } from './PageLayout';
import { describeError } from './errorState';

// Catches errors thrown while rendering a page, so one broken page shows a message
// and a way forward instead of a blank screen. Give it a `resetKey` (the route path)
// and it clears itself when the person navigates elsewhere.
export default class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) { return { error }; }

  componentDidCatch(error, info) {
    console.error('[page error]', error, info && info.componentStack);
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { title, description, action } = describeError(error);
    return <PageState title={title} description={description}>
      <div className="operations-page-state-actions">
        {action === 'reload'
          ? <button className="btn btn-primary" onClick={() => window.location.reload()}><RotateCw size={16} /> Reload</button>
          : <button className="btn btn-primary" onClick={() => this.setState({ error: null })}><RotateCw size={16} /> Try again</button>}
        <Link to="/" className="btn btn-ghost"><ArrowLeft size={16} /> Back to dashboard</Link>
      </div>
    </PageState>;
  }
}
