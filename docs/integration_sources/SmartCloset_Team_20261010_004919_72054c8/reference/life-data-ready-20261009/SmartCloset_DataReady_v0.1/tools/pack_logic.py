"""Offline reference logic for a STAGING data pack, not an application DB adapter.
Python 3.10+; standard library only. Never makes network requests or changes a DB.
"""
from __future__ import annotations
import copy
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any
KST = timezone(timedelta(hours=9))

def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding='utf-8'))

def load_pack(root: Path) -> dict[str, Any]:
    names=['profiles','products','garments','external_items','evidence_bindings','outfits','preferences','activity_events','contexts','asset_intake']
    return {**{n:read_json(root/'data'/f'{n}.json') for n in names}, 'manifest':read_json(root/'manifest.json')}

def dt(value: str) -> datetime:
    value_dt=datetime.fromisoformat(value.replace('Z','+00:00'))
    if value_dt.tzinfo is None:
        raise ValueError('Timezone required; do not silently apply local PC timezone')
    return value_dt

def unique_events(events: list[dict[str,Any]]) -> list[dict[str,Any]]:
    """Same source key + identical input dedupes; conflicting input fails closed."""
    seen={}
    for event in events:
        key=event['source_event_key']
        if key in seen and seen[key] != event:
            raise ValueError(f'Conflicting source_event_key: {key}')
        seen.setdefault(key,event)
    return [v for v in seen.values() if not v.get('voided',False)]

def events_for(pack: dict[str,Any], profile_ref:str, as_of:str) -> list[dict[str,Any]]:
    if profile_ref not in {x['ref'] for x in pack['profiles']}:
        raise ValueError('Unknown profile')
    return sorted([e for e in unique_events(pack['activity_events']) if e['owner_ref']==profile_ref and dt(e['occurred_at'])<=dt(as_of)],key=lambda e:(e['occurred_at'],e['ref']))

def garment_summary(pack:dict[str,Any], profile_ref:str, garment_ref:str, as_of:str) -> dict[str,Any]:
    g=next((x for x in pack['garments'] if x['ref']==garment_ref),None)
    if not g or g['owner_ref']!=profile_ref:
        raise PermissionError('Garment is outside the requested profile scope')
    events=[e for e in events_for(pack,profile_ref,as_of) if garment_ref in e['garment_refs']]
    wears=[e for e in events if e['kind']=='wear_confirmed']
    washes=[e for e in events if e['kind']=='wash_completed']
    last_wash=washes[-1] if washes else None
    after=[e for e in wears if last_wash and dt(e['occurred_at'])>dt(last_wash['occurred_at'])]
    all_dates=sorted({dt(e['occurred_at']).astimezone(KST).date().isoformat() for e in wears})
    after_dates=sorted({dt(e['occurred_at']).astimezone(KST).date().isoformat() for e in after})
    location=[e for e in events if e['kind']=='movement_confirmed']
    drys=[e for e in events if e['kind']=='dry_completed']
    dry_pending=bool(last_wash and not any(dt(e['occurred_at'])>dt(last_wash['occurred_at']) for e in drys))
    observations=[e for e in events if e['kind']=='user_observation' and (not last_wash or dt(e['occurred_at'])>dt(last_wash['occurred_at']))]
    laundry_requested=any(e['details'].get('laundry_review_requested',False) for e in observations)
    if dry_pending: availability='drying_unconfirmed'
    elif laundry_requested:availability='user_marked_laundry_pending'
    else:availability='no_recorded_block_not_cleanliness_confirmation'
    if not wears:display='확인된 착용 기록이 없어요.'
    elif last_wash:display=f"마지막 세탁 뒤 기록된 착용 {len(after)}회 · {len(after_dates)}일"
    else:display=f"기록된 착용 {len(wears)}회 · 마지막 세탁 기록은 없어요."
    return {'garment_ref':garment_ref,'profile_ref':profile_ref,'as_of':as_of,'recorded_wear_events_total':len(wears),'recorded_wear_days_total':len(all_dates),'last_wear_at':wears[-1]['occurred_at'] if wears else None,'last_wash_at':last_wash['occurred_at'] if last_wash else None,'recorded_wears_after_last_wash':len(after) if last_wash else None,'recorded_days_after_last_wash':len(after_dates) if last_wash else None,'wear_dates_after_last_wash':after_dates if last_wash else [],'last_location_event_ref':location[-1]['ref'] if location else None,'last_location_description':location[-1]['details'].get('zone_description') if location else None,'availability':availability,'cleanliness_confirmed':False,'display':display,'evidence_event_refs':[e['ref'] for e in events],'input_source':'scenario_fixture'}

def calendar_events(pack:dict[str,Any],profile_ref:str,as_of:str) -> list[dict[str,Any]]:
    result=[]
    for e in events_for(pack,profile_ref,as_of):
        if e['kind'] not in ['wear_confirmed','outfit_planned','wash_completed','dry_completed','iron_completed']:continue
        if e['kind']=='outfit_planned':date=dt(e['details']['scheduled_at']).astimezone(KST).date().isoformat()
        else:date=dt(e['occurred_at']).astimezone(KST).date().isoformat()
        result.append({'event_ref':e['ref'],'date':date,'kind':e['kind'],'outfit_ref':e['outfit_ref'],'garment_refs':e['garment_refs'],'input_source':'scenario_fixture'})
    return result

def home_input(pack:dict[str,Any],context_ref:str) -> dict[str,Any]:
    c=next(x for x in pack['contexts'] if x['ref']==context_ref)
    p=next(x for x in pack['profiles'] if x['ref']==c['profile_ref'])
    gs=[g for g in pack['garments'] if g['owner_ref']==p['ref']]
    summaries=[garment_summary(pack,p['ref'],g['ref'],c['as_of']) for g in gs]
    byid={s['garment_ref']:s for s in summaries}
    return {'status':'INPUT_PREPARED_NOT_SUBMITTED','logical_ids_not_runtime_ids':True,'profile_ref':p['ref'],'display_name':p['display_name'],'context_ref':c['ref'],'as_of':c['as_of'],'purpose':c['purpose'],'weather':c['weather'],'preferences':[v for v in pack['preferences'] if v['profile_ref']==p['ref']],'wardrobe':[{'ref':g['ref'],'name':g['name'],'category':g['category'],'colour':g['colour'],'product_ref':g['product_ref'],'availability':byid[g['ref']]['availability'],'catalog_media_ready':False,'tryon_ready':False} for g in gs],'today_suggestion_blocked_refs':[s['garment_ref'] for s in summaries if s['availability'] in ['drying_unconfirmed','user_marked_laundry_pending']],'rules':['owned_only_home_suggestions','no_unverified_weather_or_preference_claim','include_evidence_refs_for_claims','unknown_status_is_not_automatic_global_exclusion','manual_mixing_and_card_save_remain_possible','do_not_change_records','do_not_reuse_fixed_answers_as_live_output'],'live_response':None}

def replace_top(outfit:dict[str,Any],new_top_ref:str,pack:dict[str,Any]) -> dict[str,Any]:
    g=next((g for g in pack['garments'] if g['ref']==new_top_ref),None)
    if not g or g['owner_ref']!=outfit['owner_ref'] or g['category']!='top':raise ValueError('Invalid top for this profile')
    n=copy.deepcopy(outfit)
    if any(i['slot']=='dress' for i in n['items']):raise ValueError('Explicit dress replacement policy required')
    n['items']=[i for i in n['items'] if i['slot']!='top']+[{'slot':'top','kind':'owned','ref':new_top_ref}]
    n['ref']='DRAFT-DERIVED';n['fitting_result_ref']=None
    return n

def validate(pack:dict[str,Any]) -> list[str]:
    errors=[]
    profiles={x['ref']:x for x in pack['profiles']};gs={x['ref']:x for x in pack['garments']};xs={x['ref']:x for x in pack['external_items']};ps={x['ref']:x for x in pack['products']};ls={x['ref']:x for x in pack['outfits']}
    for name,arr in pack.items():
        if isinstance(arr,list) and arr and isinstance(arr[0],dict) and 'ref' in arr[0]:
            if len({x['ref'] for x in arr})!=len(arr):errors.append('Duplicate ref in '+name)
    for g in gs.values():
        if g['owner_ref'] not in profiles:errors.append('Unknown garment owner: '+g['ref'])
        if g['product_ref'] and g['product_ref'] not in ps:errors.append('Unknown product: '+g['ref'])
        if g['provenance']['kind']!='demo_owned_item':errors.append('Unexpected real ownership')
    for x in xs.values():
        if x['owner_ref'] not in profiles or x['product_ref'] not in ps:errors.append('External ref invalid '+x['ref'])
        if x['ownership']!='external_candidate' or x['led_anchor_ref'] is not None:errors.append('External ownership/LED violation')
    for l in ls.values():
        slots=[i['slot'] for i in l['items']]
        if len(slots)!=len(set(slots)):errors.append('Duplicate outfit slot: '+l['ref'])
        if 'dress' in slots and ('top'in slots or 'bottom'in slots):errors.append('Unresolved dress collision')
        for i in l['items']:
            target=(gs if i['kind']=='owned' else xs).get(i['ref'])
            if not target or target['owner_ref']!=l['owner_ref']:errors.append('Outfit ownership mismatch '+l['ref'])
    try:unique_events(pack['activity_events'])
    except ValueError as e:errors.append(str(e))
    wear_start={}
    for e in pack['activity_events']:
        if e['owner_ref'] not in profiles:errors.append('Unknown event owner')
        try:dt(e['occurred_at'])
        except ValueError:errors.append('Naive/invalid event time '+e['ref'])
        if e['input_source']!='scenario_fixture':errors.append('Synthetic event not labelled')
        if e['outfit_ref'] and e['outfit_ref'] not in ls:errors.append('Unknown outfit')
        if len(e['garment_refs'])!=len(set(e['garment_refs'])):errors.append('Duplicate garment in event')
        for g in e['garment_refs']:
            if g not in gs or gs[g]['owner_ref']!=e['owner_ref']:errors.append('Event ownership mismatch '+e['ref'])
        if e['kind']=='wear_confirmed':
            key=(e['owner_ref'],e['occurred_at'])
            if key in wear_start:errors.append('Conflicting same-time wear episodes '+e['ref'])
            wear_start[key]=e['ref']
        if e['kind']=='outfit_planned' and 'scheduled_at' not in e['details']:errors.append('Missing planned date')
    for ev in pack['evidence_bindings']:
        g=gs.get(ev['garment_ref']);p=ps.get(ev['product_ref'])
        if not g or not p or g['owner_ref']!=ev['owner_ref'] or g['product_ref']!=p['ref']:errors.append('Evidence target mismatch')
        if ev['physical_label_asset_ref'] is not None:errors.append('Unexpected invented physical label')
    return errors

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1])
    parser.add_argument('--report',type=Path)
    args=parser.parse_args();p=load_pack(args.root);errors=validate(p)
    result={'kind':'OFFLINE_DATA_LOGIC_ONLY','status':'PASS' if not errors else 'FAIL','errors':errors,'db_import_executed':False,'app_test_executed':False,'provider_execution_count':0,'data_blockers':['all garment/catalog media not bound','physical label photos not supplied','profile/auth mapping not confirmed','LED scene mapping not confirmed','person video and transfer scopes missing','runtime database schema not inspected']}
    text=json.dumps(result,ensure_ascii=False,indent=2)
    if args.report:args.report.write_text(text+'\n',encoding='utf-8')
    print(text)
    raise SystemExit(1 if errors else 0)
