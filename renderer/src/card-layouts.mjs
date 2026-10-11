import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';

const h = React.createElement;
export const cardTemplates = ['T1-v1', 'T2-v1', 'T3-v1', 'T4-v1'];
// Manually traced against the four reference pixels (1440x1800 -> 1080x1350).
// Hidden folds cannot be recovered by affine replacement: final human visual review remains required.
export const layouts = {
  'T1-v1': { background: '#aaa9a2', poses: [[300,0,760,780,15,3],[-220,510,760,1050,24,1],[0,50,570,580,-16,4],[50,620,270,290,-24,5],[400,10,650,750,15,2],[250,30,620,1180,15,2]] },
  'T2-v1': { background: '#aaa9a2', poses: [[290,20,750,800,7,3],[405,250,400,850,8,2],[-70,680,780,900,30,1],[-50,40,420,600,-8,4],[45,530,350,360,-15,5],[300,50,680,1150,7,2]] },
  'T3-v1': { background: '#93968e', poses: [[255,0,750,750,0,3],[170,710,630,870,25,1],[65,260,390,440,-18,2],[420,170,340,550,0,2],[760,750,260,320,-12,4],[250,40,650,1170,0,2]] },
  'T4-v1': { background: '#b2b4ac', poses: [[100,-80,800,850,-12,2],[370,640,690,850,-23,1],[270,225,400,440,-18,4],[730,650,300,300,-25,5],[20,200,500,750,-12,1],[200,10,730,1190,-12,2]] },
};
const backgrounds = Object.fromEntries(cardTemplates.map((id) => [id,
  'data:image/png;base64,' + readFileSync(new URL(`../assets/${id.slice(0,2)}-background.png`, import.meta.url)).toString('base64')]));

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
      h('style', null, '*{box-sizing:border-box}body{margin:0;width:1080px;height:1350px;overflow:hidden}.layer{position:absolute;filter:drop-shadow(4px 9px 5px #0005)}.layer img,.layer svg{width:100%;height:100%;object-fit:contain}.missing{border:1px dashed #777;color:#444;padding:16px;font:20px sans-serif}')),
    h('body', {'data-template':payload.template,'data-quality':'manual-review-required', style:{background:layout.background}},
      h('img', {src:backgrounds[payload.template],alt:'',style:{position:'absolute',inset:0,width:'100%',height:'100%'}}),
      items.map((item,index) => {
        const rank = order.indexOf(item.slot);
        const [left,top,width,height,rotation,zIndex] = layout.poses[rank<0 ? index : rank];
        return h('div', {key:index,className:'layer','data-slot':item.slot,
          style:{left,top,width,height,zIndex,transform:`rotate(${rotation}deg)`}},
          item.image ? (item.display_mask ? h('svg',{viewBox:`0 0 ${item.display_mask.width} ${item.display_mask.height}`},
            h('defs',null,h('clipPath',{id:`clip-${index}`},h('path',{d:item.display_mask.path}))),
            h('image',{href:item.image,width:item.display_mask.width,height:item.display_mask.height,clipPath:`url(#clip-${index})`})) :
            h('img',{src:item.image,alt:item.slot})) : h('div',{className:'missing'},`${item.slot}: Image unavailable`));
      }))));
}
