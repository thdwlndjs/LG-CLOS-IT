"""Offline regression tests; no database, no API, no browser execution."""
import copy
import sys
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from pack_logic import load_pack, validate, garment_summary, unique_events, calendar_events, home_input, replace_top, dt

class DataContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.p=load_pack(ROOT)
    def summary(self,g,owner='PHW',p=None):return garment_summary(p or self.p,owner,g,'2026-10-09T07:40:00+09:00')
    def test_01_relations(self): self.assertEqual(validate(self.p),[])
    def test_02_two_independent_profiles(self):
        self.assertEqual([x['allowed_profile_refs'] for x in self.p['profiles']],[['PSU'],['PHW']])
    def test_03_inventory_counts(self):
        self.assertEqual(len(self.p['garments']),32)
        self.assertEqual(sum(g['owner_ref']=='PSU' for g in self.p['garments']),16)
    def test_04_sujin_after_wash(self):
        s=self.summary('S01','PSU');self.assertEqual(s['recorded_wears_after_last_wash'],3);self.assertEqual(s['recorded_days_after_last_wash'],3)
    def test_05_hwi_white_after_wash(self):
        s=self.summary('H01');self.assertEqual(s['recorded_wears_after_last_wash'],3)
    def test_06_same_day_two_episodes(self):
        s=self.summary('H02');self.assertEqual((s['recorded_wears_after_last_wash'],s['recorded_days_after_last_wash']),(2,1))
    def test_07_ironing_does_not_reset_wash(self):
        s=self.summary('S01','PSU');self.assertTrue(s['last_wash_at'].startswith('2026-10-04'));self.assertEqual(s['recorded_wears_after_last_wash'],3)
    def test_08_no_history_is_unknown_not_never_worn(self):
        s=self.summary('S13','PSU');self.assertEqual(s['display'],'확인된 착용 기록이 없어요.');self.assertIsNone(s['recorded_wears_after_last_wash'])
    def test_09_plan_does_not_add_wear(self):
        p=copy.deepcopy(self.p);p['activity_events']=[x for x in p['activity_events'] if x['kind']!='outfit_planned']
        self.assertEqual(self.summary('H02')['recorded_wear_events_total'],self.summary('H02',p=p)['recorded_wear_events_total'])
    def test_10_identical_event_retry_dedupes(self):
        e=self.p['activity_events'][0];self.assertEqual(len(unique_events([e,copy.deepcopy(e)])),1)
    def test_11_conflicting_event_key_rejected(self):
        a=copy.deepcopy(self.p['activity_events'][0]);b=copy.deepcopy(a);b['details']={'different':True}
        with self.assertRaises(ValueError):unique_events([a,b])
    def test_12_cross_profile_read_rejected(self):
        with self.assertRaises(PermissionError):self.summary('S01')
    def test_13_wash_not_dry(self):self.assertEqual(self.summary('H05')['availability'],'drying_unconfirmed')
    def test_14_user_observation_not_generic_count_rule(self):
        self.assertEqual(self.summary('H03')['availability'],'user_marked_laundry_pending')
        self.assertEqual(self.summary('H01')['availability'],'no_recorded_block_not_cleanliness_confirmation')
    def test_15_unknown_not_global_exclusion(self):
        i=home_input(self.p,'CTX-HW-RAIN');self.assertNotIn('H07',i['today_suggestion_blocked_refs'])
    def test_16_home_profile_isolation(self):
        i=home_input(self.p,'CTX-HW-RAIN');self.assertTrue(all(g['ref'].startswith('H') for g in i['wardrobe']));self.assertTrue(all(p['profile_ref']=='PHW' for p in i['preferences']))
    def test_17_weather_scenarios_are_not_real_observation(self):
        for c in self.p['contexts']:self.assertFalse(c['weather']['real_weather_fetched'])
    def test_18_plan_calendar_uses_scheduled_date(self):
        e=next(x for x in calendar_events(self.p,'PHW','2026-10-09T07:40:00+09:00') if x['event_ref']=='HW-PLAN-09');self.assertEqual(e['date'],'2026-10-09')
    def test_19_top_only_revision(self):
        l=copy.deepcopy(next(x for x in self.p['outfits'] if x['ref']=='LH01'));before=copy.deepcopy(l);after=replace_top(l,'H02',self.p)
        self.assertEqual(l,before);self.assertEqual([i for i in after['items'] if i['slot']!='top'],[i for i in before['items'] if i['slot']!='top']);self.assertIsNone(after['fitting_result_ref'])
    def test_20_external_not_owned_or_led(self):
        self.assertTrue(all(x['ownership']=='external_candidate' and x['led_anchor_ref'] is None for x in self.p['external_items']))
    def test_21_product_same_real_item_not_assumed(self):
        a=next(x for x in self.p['garments'] if x['ref']=='H01');b=next(x for x in self.p['garments'] if x['ref']=='S02');self.assertEqual(a['product_ref'],b['product_ref']);self.assertNotEqual(a['ref'],b['ref']);self.assertNotEqual(a['owner_ref'],b['owner_ref'])
    def test_22_conflicting_composition_is_unresolved(self):
        p=next(x for x in self.p['products'] if x['ref']=='P10');self.assertIsNone(p['composition']);self.assertEqual(p['field_conflicts'][0]['resolution'],'UNRESOLVED')
    def test_23_cool_not_converted_to_temperature(self):
        p=next(x for x in self.p['products'] if x['ref']=='P02');self.assertIsNone(p['care_structured']['wash']['temperature_c'])
    def test_24_no_physical_label_fabrication(self):
        self.assertTrue(all(g['physical_label_asset_ref'] is None for g in self.p['garments']));self.assertTrue(all(e['evidence_kind']=='official_product_page' for e in self.p['evidence_bindings']))
    def test_25_date_without_timezone_rejected(self):
        with self.assertRaises(ValueError):dt('2026-10-09T00:00:00')
    def test_26_future_observation_excluded(self):
        p=copy.deepcopy(self.p);e=copy.deepcopy(next(x for x in p['activity_events'] if x['ref']=='HW-WEAR-BLUE-AM'));e['ref']='FUTURE';e['source_event_key']='FUTURE';e['occurred_at']='2026-10-10T10:00:00+09:00';p['activity_events'].append(e)
        self.assertEqual(self.summary('H02')['recorded_wear_events_total'],self.summary('H02',p=p)['recorded_wear_events_total'])
    def test_27_corrupted_cross_owner_outfit_fails(self):
        p=copy.deepcopy(self.p);p['outfits'][0]['items'][0]['ref']='H01';self.assertTrue(validate(p))
    def test_28_no_unverified_cleanliness(self):
        for g in self.p['garments']:self.assertFalse(garment_summary(self.p,g['owner_ref'],g['ref'],'2026-10-10T14:00:00+09:00')['cleanliness_confirmed'])

if __name__=='__main__':unittest.main(verbosity=2)
