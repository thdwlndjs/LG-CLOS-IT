import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarMonth, moveCalendarMonth } from '../src/calendar';

test('calendar month follows selected date and leap-year length',()=>{
  assert.deepEqual(calendarMonth('2026-11-02'), {year:2026,month:11,prefix:'2026-11',firstWeekday:0,days:30,canPrevious:true,canNext:true});
  assert.equal(calendarMonth('2028-02-29').days,29);
  assert.equal(calendarMonth('2027-02-28').days,28);
});
test('month navigation clamps end dates and crosses year boundaries',()=>{
  assert.equal(moveCalendarMonth('2026-01-31',1),'2026-02-28');
  assert.equal(moveCalendarMonth('2028-01-31',1),'2028-02-29');
  assert.equal(moveCalendarMonth('2026-12-31',1),'2027-01-31');
  assert.equal(moveCalendarMonth('2027-01-31',-1),'2026-12-31');
  assert.equal(moveCalendarMonth('9999-12-31',1),'9999-12-31');
  assert.equal(moveCalendarMonth('0000-01-01',-1),'0000-01-01');
});
