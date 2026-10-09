import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const h = React.createElement;
export function validate(payload) {
  if (!payload || payload.template !== 'minimal-v1' || !['PNG', 'WEBP'].includes(payload.format)
      || typeof payload.title !== 'string' || payload.title.length > 200
      || typeof payload.style_tag !== 'string' || payload.style_tag.length > 1000
      || !Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > 6) throw Error('invalid');
  for (const item of payload.items) {
    if (!item || typeof item.slot !== 'string' || item.slot.length > 30
        || (item.image !== null && (typeof item.image !== 'string'
        || item.image.length > 14_000_000
        || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(item.image)))) throw Error('invalid');
  }
  for (const name of ['date', 'weather_label']) {
    if (payload[name] != null && (typeof payload[name] !== 'string' || payload[name].length > 200)) throw Error('invalid');
  }
  return payload;
}

export function markup(payload) {
  validate(payload);
  return '<!doctype html>' + renderToStaticMarkup(h('html', null,
    h('head', null,
      h('meta', {httpEquiv: 'Content-Security-Policy', content: "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; script-src 'none'"}),
      h('style', null, `
        *{box-sizing:border-box}
        body{margin:0;width:1080px;height:1350px;background:#f4f1eb;color:#172a32;
          font-family:Arial,"WenQuanYi Zen Hei",sans-serif;padding:64px;display:flex;flex-direction:column;gap:20px}
        header{height:250px;flex-shrink:0;overflow:hidden}
        h1{font-size:52px;line-height:1.2;margin:12px 0;overflow-wrap:anywhere;max-height:125px;overflow:hidden}
        .brand{font-size:20px;letter-spacing:4px}.meta{font-size:20px;margin:12px 0;max-height:48px;overflow:hidden}
        .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:20px;flex:1;min-height:0}
        .item{min-height:0;overflow:hidden;background:#fff;border-radius:18px;padding:16px;
          display:flex;flex-direction:column;align-items:center;justify-content:center}
        .item img{height:calc(100% - 38px);max-height:600px;max-width:100%;object-fit:contain}
        .slot{font-size:20px;margin:8px;flex-shrink:0}.placeholder{font-size:22px;color:#58636b;text-align:center}
        .footer{font-size:18px;flex-shrink:0}
      `)),
    h('body', null, h('header', null, h('div', {className:'brand'}, 'SMART WARDROBE'), h('h1', null, payload.title),
      h('div', {className:'meta'}, [payload.style_tag, payload.date, payload.weather_label].filter(Boolean).join(' · '))),
      h('div', {className:'grid',style:{gridTemplateRows:`repeat(${Math.ceil(payload.items.length/2)},minmax(0,1fr))`}}, payload.items.map((item,i) => h('div', {className:'item',key:i},
        item.image ? h('img',{src:item.image,alt:item.slot}) : h('div',{className:'placeholder'}, 'Image unavailable'),
        h('div',{className:'slot'}, item.slot)))), h('div',{className:'footer'}, 'Outfit card · minimal-v1'))));
}
