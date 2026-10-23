/* Is this page older than the server? The server sends the build it serves
   (X-App-Build: its entry script, e.g. index-AbC123.js); this page knows the
   entry script it was loaded from. When they differ, the server was updated
   while the page stayed open, so a bar offers to reload. */

// The entry script in the index.html this page was loaded from (production builds only).
const OWN_BUILD = (() => {
  try { return (document.querySelector('script[type="module"][src*="/assets/index-"]')?.getAttribute('src')?.match(/(index-[\w-]+\.js)$/) || [])[1] || null; }
  catch { return null; }
})();

let serverBuild = null, shown = false;

export const pageOutdated = () => !!(OWN_BUILD && serverBuild && serverBuild !== OWN_BUILD);

function showBar() {
  if (shown || typeof document === 'undefined') return;
  shown = true;
  const bar = document.createElement('div');
  bar.className = 'app-update-bar';
  bar.setAttribute('role', 'status');
  bar.innerHTML = '<span>TeamHub has been updated. Reload to use the new version.</span>';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-primary btn-sm';
  button.textContent = 'Reload';
  button.addEventListener('click', () => window.location.reload());
  bar.appendChild(button);
  document.body.appendChild(bar);
}

export function noteServerBuild(build) {
  if (!build) return;
  serverBuild = build;
  if (pageOutdated()) showBar();
}
