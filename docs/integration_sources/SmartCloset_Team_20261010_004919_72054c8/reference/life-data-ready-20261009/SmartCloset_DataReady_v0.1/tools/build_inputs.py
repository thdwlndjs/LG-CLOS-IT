"""Recompute offline summaries and provider-neutral input briefs after editing staging JSON.
Never submits data to an API or writes to a database. Static HTML is the original review snapshot.
"""
from pathlib import Path
import argparse
import json
from pack_logic import load_pack, validate, garment_summary, calendar_events, home_input

def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1])
    args=parser.parse_args();root=args.root;pack=load_pack(root)
    errors=validate(pack)
    if errors:raise SystemExit('\n'.join(errors))
    contexts={c['ref']:c for c in pack['contexts']}
    clocks={'PSU':contexts['CTX-SU-CARE']['as_of'],'PHW':contexts['CTX-HW-RAIN']['as_of']}
    def write(rel,obj):
        path=root/rel;path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    ss=[garment_summary(pack,g['owner_ref'],g['ref'],clocks[g['owner_ref']]) for g in pack['garments']]
    write('review/derived_garment_summaries.json',ss)
    write('review/derived_calendar.json',[{'profile_ref':p['ref'],'events':calendar_events(pack,p['ref'],clocks[p['ref']])} for p in pack['profiles']])
    for ref in ['CTX-HW-RAIN','CTX-HW-DRY','CTX-HW-UNKNOWN']:
        write('api_inputs/'+ref+'.json',home_input(pack,ref))
    for ref in ['S01','S02','H03']:
        g=next(g for g in pack['garments'] if g['ref']==ref)
        ev=next((e for e in pack['evidence_bindings'] if e['garment_ref']==ref),None)
        product=next((p for p in pack['products'] if ev and p['ref']==ev['product_ref']),None)
        write('api_inputs/CARE-'+ref+'.json',{'status':'INPUT_PREPARED_NOT_SUBMITTED','logical_ids_not_runtime_ids':True,'profile_ref':g['owner_ref'],'garment_ref':ref,'summary':next(s for s in ss if s['garment_ref']==ref),'care_evidence':ev,'product_facts':product,'rules':['use_only_attached_target_evidence','do_not_generate_missing_wash_temperature','do_not_treat_product_page_as_physical_label','do_not_infer_dirt_from_wear_count','no_record_mutation','return_missing_information_when_needed'],'live_response':None})
    print('Offline input briefs regenerated; API calls=0, DB writes=0. Recheck provenance after any manual edit.')
if __name__=='__main__':main()
