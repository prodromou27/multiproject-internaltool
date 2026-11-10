import { ToneBadge } from './EnterpriseUI';

/* How a customer asset's software compares with the Software versions page
   (server/softwareCompliance.js). */
export function softwareStatusText(s) {
  if (!s) return null;
  if (s.status === 'current') return 'Up to date';
  if (s.status === 'end_of_life') return `${s.line} is end of life`;
  if (s.status === 'unknown_line') return `${s.line} is not followed`;
  if (s.status === 'unreadable') return 'Version not recognised';
  const gap = s.behind ? `${s.behind} ${s.behind_unit === 'take' ? 'take' : 'patch'}${s.behind === 1 ? '' : s.behind_unit === 'take' ? 's' : 'es'} behind` : 'Behind';
  return `${gap} · latest ${s.latest}`;
}

const TONE = { current: 'success', behind: 'warning', end_of_life: 'danger', unknown_line: 'neutral', unreadable: 'neutral' };

export default function SoftwareStatusBadge({ status }) {
  if (!status) return null;
  return <ToneBadge tone={TONE[status.status] || 'neutral'}>{softwareStatusText(status)}</ToneBadge>;
}
