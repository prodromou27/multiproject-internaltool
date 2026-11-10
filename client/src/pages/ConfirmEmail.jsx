import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';

/* Opened from the link emailed to a new address: makes it the account's email. */
export default function ConfirmEmail() {
  const [params] = useSearchParams();
  const [state, setState] = useState({ status: 'working', text: 'Confirming your email address…' });
  useEffect(() => {
    const token = params.get('token') || '';
    api.confirmEmail(token)
      .then(result => setState({ status: 'done', text: `Your email address is now ${result.email}. Use it the next time you sign in.` }))
      .catch(error => setState({ status: 'error', text: error.message || 'This confirmation link is not valid.' }));
  }, [params]);
  return <div className="login-wrap">
    <div className="login-card" role="status">
      <h1>Confirm email</h1>
      <p className={state.status === 'error' ? 'error-msg' : undefined}>{state.text}</p>
      {state.status !== 'working' && <Link className="btn btn-primary" to="/">Continue</Link>}
    </div>
  </div>;
}
