create or replace function app_private.booking_validate_intervals(p_weekly jsonb,p_exceptions jsonb) returns void language plpgsql immutable set search_path='' as $$
declare item jsonb;entry jsonb;day text;intervals jsonb;previous_end text;begin
 if jsonb_typeof(p_weekly) is distinct from 'array' or jsonb_typeof(p_exceptions) is distinct from 'array' or jsonb_array_length(p_weekly)>70 or jsonb_array_length(p_exceptions)>366 then raise exception 'VALIDATION_ERROR';end if;
 for item in select value from jsonb_array_elements(p_weekly) loop
  if jsonb_typeof(item)<>'object' or (item-array['weekday','start_local','end_local'])<>'{}'::jsonb or not(item?'weekday' and item?'start_local' and item?'end_local') or jsonb_typeof(item->'weekday')<>'number' or (item->>'weekday')::numeric not in (1,2,3,4,5,6,7) then raise exception 'VALIDATION_ERROR';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_exceptions) e group by e->>'local_date' having count(*)>1) then raise exception 'VALIDATION_ERROR';end if;
 for item in select value from jsonb_array_elements(p_exceptions) loop
  if jsonb_typeof(item)<>'object' or (item-array['local_date','intervals'])<>'{}'::jsonb or not(item?'local_date' and item?'intervals') or coalesce(item->>'local_date','')!~'^\d{4}-\d{2}-\d{2}$' or jsonb_typeof(item->'intervals') is distinct from 'array' or jsonb_array_length(item->'intervals')>10 then raise exception 'VALIDATION_ERROR';end if;
  if exists(select 1 from jsonb_array_elements(item->'intervals') e where jsonb_typeof(e)<>'object' or(e-array['start_local','end_local'])<>'{}'::jsonb) then raise exception 'VALIDATION_ERROR';end if;
  day:=((item->>'local_date')::date)::text;if day<>item->>'local_date' then raise exception 'VALIDATION_ERROR';end if;
 end loop;
 for intervals in select jsonb_agg(value order by value->>'start_local') from jsonb_array_elements(p_weekly) group by value->>'weekday'
 union all select value->'intervals' from jsonb_array_elements(p_exceptions) loop
  previous_end:=null;
  for entry in select value from jsonb_array_elements(intervals) order by value->>'start_local' loop
   if jsonb_typeof(entry)<>'object' or (entry-array['weekday','start_local','end_local'])<>'{}'::jsonb or jsonb_typeof(entry->'start_local') is distinct from 'string' or jsonb_typeof(entry->'end_local') is distinct from 'string' or entry->>'start_local'!~'^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' or entry->>'end_local'!~'^((0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]|24:00)$' or entry->>'start_local'>=entry->>'end_local' or (previous_end is not null and entry->>'start_local'<previous_end) then raise exception 'VALIDATION_ERROR';end if;
   previous_end:=entry->>'end_local';
  end loop;
 end loop;
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then raise exception 'VALIDATION_ERROR';end $$;

-- Intervals are local to one date. Only continuous coverage across both dates permits an overnight session.
create or replace function app_private.booking_schedule_covered(p_weekly jsonb,p_exceptions jsonb,p_start timestamptz,p_end timestamptz)
returns boolean language plpgsql stable set search_path='' as $$
declare
  point timestamptz;
  wall timestamp;
  previous_day date;
  intervals jsonb;
begin
  if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
     or p_end <= p_start or p_end - p_start > interval '25 hours' then return false; end if;
  for point in
    select p_start
    union all select generate_series(date_trunc('minute', p_start) + interval '1 minute', p_end - interval '1 microsecond', interval '1 minute')
    order by 1
  loop
    wall := point at time zone 'Africa/Cairo';
    if wall::date is distinct from previous_day then
      previous_day := wall::date;
      select value->'intervals' into intervals from jsonb_array_elements(p_exceptions) where (value->>'local_date')::date = previous_day;
      if intervals is null then
        select coalesce(jsonb_agg(value),'[]') into intervals from jsonb_array_elements(p_weekly) where (value->>'weekday')::int = extract(isodow from previous_day);
      end if;
    end if;
    if not exists (select 1 from jsonb_array_elements(intervals) where wall::time >= (value->>'start_local')::time and wall::time < (value->>'end_local')::time) then return false; end if;
  end loop;
  return true;
end $$;
