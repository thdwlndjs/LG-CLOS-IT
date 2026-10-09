import test from 'node:test';
import assert from 'node:assert/strict';
import { markup, validate } from '../src/template.mjs';
const base = {template:'minimal-v1',format:'PNG',title:'<script>secret</script>',style_tag:'CASUAL',items:[{slot:'DRESS',image:null}]};
test('React escapes user text and explicit placeholder without context', () => {
  const html = markup(base);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('Image unavailable'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('undefined'));
});
test('reject URL fetching and malformed input', () => {
  assert.throws(() => validate({...base,items:[{slot:'TOP',image:'http://postgres:5432'}]}));
  assert.throws(() => validate({...base,template:'untrusted'}));
  assert.throws(() => validate({...base,items:[]}));
});
