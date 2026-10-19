from pathlib import Path
from PIL import Image
import json,sys,re
file=Path(sys.argv[1]);cases=json.loads(file.read_text(encoding='utf-8'));result=[]
for case in cases:
 ui=Image.open(case['ui']).convert('RGB');background=Image.open(case['background']).convert('RGB');samples=[]
 for sample in case['samples']:
  point=(sample['x'],sample['y']);a=ui.getpixel(point);b=background.getpixel(point);delta=max(abs(x-y) for x,y in zip(a,b));samples.append({**sample,'ui':a,'background':b,'max_channel_delta':delta})
 def luminance(rgb):
  linear=[v/255/12.92 if v/255<=.04045 else ((v/255+.055)/1.055)**2.4 for v in rgb]
  return .2126*linear[0]+.7152*linear[1]+.0722*linear[2]
 contrast=[]
 for text in case.get('contrastSamples',[]):
  fg=tuple(int(n) for n in re.findall(r'[0-9]+',text['color'])[:3]);ratios=[]
  for point in text['points']:
   bg=background.getpixel((point['x'],point['y']));a=luminance(fg);b=luminance(bg);ratios.append(round((max(a,b)+.05)/(min(a,b)+.05),2))
  contrast.append({**text,'sample_contrast':ratios,'minimum':min(ratios)})
 result.append({'name':case['name'],'sample_count':len(samples),'max_channel_delta':max(s['max_channel_delta'] for s in samples),'samples':samples,'raw_background_text_contrast':contrast})
contrast_minimum=min(t['minimum'] for r in result for t in r['raw_background_text_contrast'])
report={'status':'PASS' if all(r['max_channel_delta']==0 for r in result) and contrast_minimum>=4.5 else 'FAIL','sampled_text_minimum_contrast':contrast_minimum,'text_contrast_scope':'Three raw-reflection samples per visible label in the isolated panel fixture, without crediting glyph shadows. This is not a full accessibility certification or production layout coverage.','tolerance':0,'comparison':'Same viewport, frozen clock, static background. Only development fixture UI visibility changed. Sampled blank padding excludes content/selected/focus edge pixels.','results':result}
(file.parent/'blank-pixel-comparison.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'status':report['status'],'sample_count':sum(r['sample_count'] for r in result),'max_channel_delta':max(r['max_channel_delta'] for r in result),'cases':len(result),'contrast_below_4_5':[{"case":r['name'],"text":t['text'],"color":t['color'],"minimum":t['minimum']} for r in result for t in r['raw_background_text_contrast'] if t['minimum']<4.5]}))
assert report['status']=='PASS',[(r['name'],r['max_channel_delta']) for r in result if r['max_channel_delta']]
