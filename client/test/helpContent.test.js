import test from 'node:test';
import assert from 'node:assert/strict';
import { HELP_TOPICS, searchTopics, topicForPath, topicsFor } from '../src/help/helpContent.js';

test('every help topic has an id, a title, a summary and sections with text', () => {
  const ids = new Set();
  for (const topic of HELP_TOPICS) {
    assert.ok(topic.id && !ids.has(topic.id), `unique id: ${topic.id}`);
    ids.add(topic.id);
    assert.ok(topic.title && topic.summary && topic.group, topic.id);
    assert.ok(topic.sections.length, topic.id);
    for (const section of topic.sections) assert.ok(section.heading && section.items.length && section.items.every(item => typeof item === 'string' && item.trim()), `${topic.id}: ${section.heading}`);
  }
});

test('topics follow the role and the page; search narrows them', () => {
  assert.ok(topicsFor('manager').some(topic => topic.id === 'settings'));
  assert.ok(!topicsFor('engineer').some(topic => topic.id === 'settings'));
  assert.equal(topicForPath('/tasks', 'engineer')?.id, 'tasks');
  assert.equal(topicForPath('/customers/12/service-profile', 'manager')?.id, 'customers');
  assert.deepEqual(searchTopics(topicsFor('engineer'), 'waiting licence').map(topic => topic.id), ['bot']);
});
