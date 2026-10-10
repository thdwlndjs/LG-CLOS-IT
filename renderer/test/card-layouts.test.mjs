import test from 'node:test';
import assert from 'node:assert/strict';
import { markup } from '../src/template.mjs';
import { layouts } from '../src/card-layouts.mjs';
test('four independent geometries render safely without claiming reference approval', () => {
  assert.equal(new Set(Object.values(layouts).map(x => JSON.stringify(x.poses))).size,4);
  for (const template of Object.keys(layouts)) {
    const html = markup({template,format:'PNG',title:'<script>',style_tag:'',items:[{slot:'TOP',image:null}]});
    assert.ok(html.includes(`data-template="${template}"`));
    assert.ok(html.includes('manual-review-required'));
    assert.ok(html.includes('Image unavailable'));
    assert.ok(!html.includes('<script>'));
  }
});
