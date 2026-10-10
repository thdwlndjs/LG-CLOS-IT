import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const h = React.createElement;
export const cardTemplates = ['T1-v1', 'T2-v1', 'T3-v1', 'T4-v1'];
// Independent layouts, not a claim of pixel-exact reference restoration.
// Hidden reference pixels, source rights and Gate A visual approval remain required.
export const layouts = {
  'T1-v1': { background: '#d4c2b4', poses: [[540,100,470,690,8,3],[50,210,460,1000,-19,2],[70,60,280,300,-8,4],[120,1020,360,250,-17,5],[650,960,240,260,6,6],[20,670,230,240,5,1]] },
  'T2-v1': { background: '#b8b1a7', poses: [[325,90,670,1030,0,5],[60,430,350,780,-6,2],[45,100,300,410,-14,3],[620,1000,390,290,11,6],[50,1050,280,230,-7,7],[740,90,260,290,0,1]] },
  'T3-v1': { background: '#a7a498', poses: [[265,40,730,750,5,4],[320,610,500,680,-8,2],[30,400,330,480,-12,3],[65,60,270,270,16,5],[780,710,260,360,-20,6],[80,1050,300,240,-9,7]] },
  'T4-v1': { background: '#c4c8c5', poses: [[120,30,850,750,-3,2],[300,640,490,680,4,1],[300,360,480,510,0,5],[800,950,260,320,-12,6],[25,420,250,280,18,4],[30,1050,270,200,3,3]] },
};

export function collageMarkup(payload) {
  const layout = layouts[payload.template];
  if (!layout) throw Error('unknown template');
  const orders = {
    'T1-v1': ['TOP','BOTTOM','ACCESSORY','SHOES','OUTER','DRESS'],
    'T2-v1': ['OUTER','TOP','BOTTOM','ACCESSORY','SHOES','DRESS'],
    'T3-v1': ['OUTER','BOTTOM','ACCESSORY','TOP','SHOES','DRESS'],
    'T4-v1': ['TOP','BOTTOM','ACCESSORY','SHOES','OUTER','DRESS'],
  };
  const order = orders[payload.template];
  const items = [...payload.items].sort((a,b) => {
    const rank = x => order.includes(x.slot) ? order.indexOf(x.slot) : order.length;
    return rank(a)-rank(b);
  });
  return '<!doctype html>' + renderToStaticMarkup(h('html', null,
    h('head', null, h('meta', {httpEquiv:'Content-Security-Policy', content:"default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'"}),
      h('style', null, '*{box-sizing:border-box}body{margin:0;width:1080px;height:1350px;overflow:hidden}.layer{position:absolute}.layer img{width:100%;height:100%;object-fit:contain}.missing{border:1px dashed #777;color:#444;padding:16px;font:20px sans-serif}')),
    h('body', {'data-template':payload.template,'data-quality':'manual-review-required', style:{background:layout.background}},
      items.map((item,index) => {
        const [left,top,width,height,rotation,zIndex] = layout.poses[index];
        return h('div', {key:index,className:'layer','data-slot':item.slot,
          style:{left,top,width,height,zIndex,transform:`rotate(${rotation}deg)`}},
          item.image ? h('img',{src:item.image,alt:item.slot}) : h('div',{className:'missing'},`${item.slot}: Image unavailable`));
      }))));
}
