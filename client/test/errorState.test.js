import test from 'node:test';
import assert from 'node:assert/strict';
import { describeError, isChunkLoadError } from '../src/components/errorState.js';

test('a failed page download is treated as a stale app and offers a reload', () => {
  for (const message of [
    'Failed to fetch dynamically imported module: https://x/assets/Tasks-abc.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
    'Loading chunk 12 failed.',
  ]) {
    assert.equal(isChunkLoadError(new Error(message)), true, message);
    assert.equal(describeError(new Error(message)).action, 'reload');
  }
});

test('any other render error offers a retry and does not blame the person', () => {
  const result = describeError(new TypeError("Cannot read properties of undefined (reading 'length')"));
  assert.equal(result.action, 'retry');
  assert.match(result.title, /Something went wrong/);
  assert.doesNotMatch(result.description, /length|undefined/);
});

test('missing or odd errors do not throw', () => {
  assert.equal(describeError(undefined).action, 'retry');
  assert.equal(describeError('Loading chunk 3 failed').action, 'reload');
});
