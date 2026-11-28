import { describe, expect, test } from 'vitest';
import { cairoBookingPeriod, availabilityInputSchema, formatCairoInstant, resolveCairoLocalTime, validateScheduledInterval } from '../../src/modules/booking/scheduling';

describe('T04 Cairo scheduling boundaries', () => {
  test('formats Cairo date boundaries independently of the machine timezone', () => {
    expect(formatCairoInstant('2026-11-11T22:30:00Z')).toEqual({ local_date:'2026-11-12',local_time:'00:30',weekday:4,offset_minutes:120 });
    expect(resolveCairoLocalTime('2026-11-12T00:30')).toEqual([{instant:'2026-11-11T22:30:00.000Z',offset_minutes:120}]);
  });
  test('skipped Cairo wall time has no candidate and repeated wall time requires an explicit choice', () => {
    expect(resolveCairoLocalTime('2026-04-24T00:30')).toEqual([]);
    expect(resolveCairoLocalTime('2026-10-29T23:30')).toEqual([
      {instant:'2026-10-29T20:30:00.000Z',offset_minutes:180},
      {instant:'2026-10-29T21:30:00.000Z',offset_minutes:120},
    ]);
  });
  test.each(['2026-02-30T10:00','2026-11-12T24:00','2026-11-12 10:00','2026-11-12T10:00Z'])('rejects invalid local input %s', value => {
    expect(()=>resolveCairoLocalTime(value)).toThrow('INVALID_TIME');
  });
  test('UTC elapsed duration is explicit, positive and integer', () => {
    expect(()=>validateScheduledInterval('2026-11-11T10:00:00Z','2026-11-11T11:00:00Z',60)).not.toThrow();
    for(const [end,duration] of [['2026-11-11T09:00:00Z',60],['2026-11-11T11:00:00Z',90],['2026-11-11T11:00:00Z',60.5]] as const)
      expect(()=>validateScheduledInterval('2026-11-11T10:00:00Z',end,duration)).toThrow('INVALID_TIME');
    expect(()=>validateScheduledInterval('2026-11-11T10:00:00','2026-11-11T11:00:00Z',60)).toThrow('INVALID_TIME');
  });
  test('availability canonicalizes adjacent intervals and dated time off without allowing overlaps', () => {
    const source={weekly_intervals:[{weekday:2,start_local:'11:00',end_local:'12:00'},{weekday:2,start_local:'10:00',end_local:'11:00'}],dated_exceptions:[{local_date:'2026-11-11',intervals:[]}]};
    const result=availabilityInputSchema.parse(source);
    expect(result.weekly_intervals[0].start_local).toBe('10:00');
    expect(result.dated_exceptions[0].intervals).toEqual([]);
    expect(availabilityInputSchema.safeParse({...source,weekly_intervals:[...source.weekly_intervals,{weekday:2,start_local:'10:30',end_local:'11:30'}]}).success).toBe(false);
    expect(availabilityInputSchema.safeParse({...source,dated_exceptions:[source.dated_exceptions[0],source.dated_exceptions[0]]}).success).toBe(false);
    expect(availabilityInputSchema.safeParse({...source,dated_exceptions:[{local_date:'2026-02-30',intervals:[]}]}).success).toBe(false);
  });
});

test('Cairo through-date includes a spring-forward day and an autumn repeated hour', () => {
  expect(cairoBookingPeriod('2026-04-24', '2026-04-24')).toEqual({ from: '2026-04-23T22:00:00.000Z', to: '2026-04-24T21:00:00.000Z' });
  expect(cairoBookingPeriod('2026-10-29', '2026-10-29')).toEqual({ from: '2026-10-28T21:00:00.000Z', to: '2026-10-29T22:00:00.000Z' });
});
