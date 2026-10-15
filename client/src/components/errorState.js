// Turns a render error into what the error page tells the person.
// A lazy-loaded page that fails to download usually means the app was updated
// while this tab stayed open, and a reload fixes it, so that case says so.

const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk [\w-]+ failed/i;

export function isChunkLoadError(error) {
  return CHUNK_ERROR.test(String((error && (error.message || error)) || ''));
}

export function describeError(error) {
  if (isChunkLoadError(error)) {
    return {
      title: 'This page needs a refresh',
      description: 'The app was updated since you opened this tab. Reload to get the latest version.',
      action: 'reload',
    };
  }
  return {
    title: 'Something went wrong on this page',
    description: 'The rest of the app still works. You can try again, or go back to the dashboard. If it keeps happening, tell your administrator what you were doing.',
    action: 'retry',
  };
}
