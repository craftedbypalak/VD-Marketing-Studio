// The checker's editable lists: rules.emojiOk, capsOk, hinglish, companySuffixes, notNames.
// Each one replaces its code default when present, and the default applies when absent.
//   node --test server/rules.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { check, listOf, suffixRe, CHECKER_LIST_DEFAULTS, DEFAULT_COMPANY_SUFFIXES } from './rules.mjs';

const run = (text, rules = {}) => check({ pis: { problem: text } }, rules, [], { solutions: [] }).violations;
const hits = (text, rules, n) => run(text, rules).filter((v) => v.check === n);

test('listOf falls back to the default only when the key is absent', () => {
  assert.deepEqual(listOf({}, 'capsOk'), CHECKER_LIST_DEFAULTS.capsOk);
  assert.deepEqual(listOf({ capsOk: [' ACME ', ''] }, 'capsOk'), ['ACME']);
  assert.deepEqual(listOf({ capsOk: [] }, 'capsOk'), []);
});

test('allowed emoji: default keeps the copyright sign, a set list replaces it', () => {
  assert.equal(hits('Studio © 2026.', {}, 3).length, 0);
  assert.equal(hits('Studio © 2026.', { emojiOk: [] }, 3).length, 1);
  assert.equal(hits('Good work 🙂.', {}, 3).length, 1);
  assert.equal(hits('Good work 🙂.', { emojiOk: ['🙂'] }, 3).length, 0);
});

test('allowed capitals: default allows MSME, a set list replaces it', () => {
  assert.equal(hits('Every MSME owner.', {}, 3).length, 0);
  assert.equal(hits('Every MSME owner.', { capsOk: [] }, 3).length, 1);
  assert.equal(hits('The ACME way.', {}, 3).length, 1);
  assert.equal(hits('The ACME way.', { capsOk: ['ACME'] }, 3).length, 0);
});

test('Hinglish words: default catches two tags, a set list replaces it', () => {
  assert.equal(hits('Kya hai this.', {}, 9).length, 1);
  assert.equal(hits('Kya hai this.', { hinglish: [] }, 9).length, 0);
  assert.equal(hits('Arre bas this.', {}, 9).length, 0);
  assert.equal(hits('Arre bas this.', { hinglish: ['arre', 'bas'] }, 9).length, 1);
});

test('words that are not names: default allows festivals, a set list replaces it', () => {
  assert.equal(hits('Wishing you a calm Raksha Bandhan.', {}, 8).length, 0);
  assert.equal(hits('Wishing you a calm Raksha Bandhan.', { notNames: [] }, 8).length, 1);
  assert.equal(hits('See you at Monsoon Fair.', {}, 8).length, 1);
  assert.equal(hits('See you at Monsoon Fair.', { notNames: ['Monsoon Fair'] }, 8).length, 0);
});

test('company suffixes: default list, a set list, and an empty list', () => {
  assert.equal(hits('We met acme gmbh today.', {}, 8).length, 0);
  assert.equal(hits('We met Acme gmbh today.', {}, 8).length, 0);
  assert.equal(hits('We met Acme gmbh today.', { companySuffixes: ['gmbh'] }, 8).length, 1);
  assert.equal(hits('We met Acme gmbh today.', { companySuffixes: [] }, 8).length, 0);
  const re = suffixRe(DEFAULT_COMPANY_SUFFIXES);
  for (const t of ['Acme Pvt Ltd', 'Acme Pvt. Ltd.', 'Acme PvtLtd', 'Acme Private Limited', 'Acme Inc']) {
    assert.ok(new RegExp(re.source, 'u').test(t), t);
  }
});
