import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headingIds, mapFragment } from './locale-fragments.mjs';

test('heading ids are read in order', () => {
	assert.deepEqual(headingIds('<h2 id="a">A</h2><p id="x"></p><h3 class="c" id="b">B</h3>'), ['a', 'b']);
});

test('an English fragment maps to the heading at the same position', () => {
	assert.equal(mapFragment('b', ['a', 'b'], ['甲', '乙']), '乙');
	assert.equal(mapFragment('甲', ['a', 'b'], ['甲', '乙']), '甲');
	assert.equal(mapFragment('b', ['a', 'b'], ['甲']), undefined);
	assert.equal(mapFragment('z', ['a', 'b'], ['甲', '乙']), undefined);
});
