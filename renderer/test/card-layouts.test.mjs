import test from 'node:test';
import assert from 'node:assert/strict';
import { markup } from '../src/template.mjs';
import { layouts, foregroundViewBox } from '../src/card-layouts.mjs';
test('foreground crop preserves tight pixel bounds and falls back for other mask geometries', () => {
  assert.equal(foregroundViewBox({width:384,height:400,path:'M30 40h100v1h-100zM20 41h120v1h-120z'}),'20 40 120 2');
  assert.equal(foregroundViewBox({width:384,height:400,path:'M0 0h384v400H0Z'}),'0 0 384 400');
});
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
