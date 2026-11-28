import { z } from 'zod';

const instantSchema=z.iso.datetime({offset:true});
const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',calendar:'iso8601',numberingSystem:'latn',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',weekday:'short',hourCycle:'h23'});
const weekdays:Record<string,1|2|3|4|5|6|7>={Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6,Sun:7};
function invalid():never{throw new Error('INVALID_TIME');}
function validDate(value:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000'))return false;
  const date=new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function formatCairoInstant(instant:string):{local_date:string;local_time:string;weekday:1|2|3|4|5|6|7;offset_minutes:number}{
  if(!instantSchema.safeParse(instant).success)return invalid();
  const date=new Date(instant);if(!Number.isFinite(date.getTime()))return invalid();
  const parts=Object.fromEntries(formatter.formatToParts(date).map(part=>[part.type,part.value]));
  const local_date=`${parts.year.padStart(4,'0')}-${parts.month}-${parts.day}`;
  const local_time=`${parts.hour}:${parts.minute}`;
  const localMillis=Date.parse(`${local_date}T${local_time}:${parts.second}.000Z`);
  return {local_date,local_time,weekday:weekdays[parts.weekday],offset_minutes:(localMillis-Math.floor(date.getTime()/1000)*1000)/60000};
}
/** Explicit candidates, never machine-zone parsing or silent DST disambiguation. */
export function resolveCairoLocalTime(localDateTime:string):{instant:string;offset_minutes:number}[]{
  if(!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(localDateTime)||!validDate(localDateTime.slice(0,10)))return invalid();
  const wallMillis=Date.parse(`${localDateTime}:00.000Z`);
  const offsets=new Set<number>();
  // Sample either side of the date to discover the runtime's actual Cairo offsets.
  for(let hours=-48;hours<=48;hours+=6)offsets.add(formatCairoInstant(new Date(wallMillis+hours*3600000).toISOString()).offset_minutes);
  return [...offsets].flatMap(offset_minutes=>{
    const instant=new Date(wallMillis-offset_minutes*60000).toISOString();const local=formatCairoInstant(instant);
    return `${local.local_date}T${local.local_time}`===localDateTime?[{instant,offset_minutes}]:[];
  }).sort((a,b)=>a.instant.localeCompare(b.instant));
}
/** The enrollment query uses an inclusive start and an exclusive end instant. */
export function cairoBookingPeriod(from: string, through: string) {
  if (!validDate(from) || !validDate(through) || from > through) return invalid();
  const following = new Date(`${through}T00:00:00Z`);
  following.setUTCDate(following.getUTCDate() + 1);
  function startOfDay(date: string) {
    // Cairo's spring transition can skip local midnight.
    const first = resolveCairoLocalTime(`${date}T00:00`)[0] ?? resolveCairoLocalTime(`${date}T01:00`)[0];
    return first?.instant ?? invalid();
  }
  return { from: startOfDay(from), to: startOfDay(following.toISOString().slice(0, 10)) };
}
export function validateScheduledInterval(start:string,end:string,durationMinutes:number):void{
  if(!instantSchema.safeParse(start).success||!instantSchema.safeParse(end).success||!Number.isSafeInteger(durationMinutes)||durationMinutes<=0)return invalid();
  const elapsed=Date.parse(end)-Date.parse(start);
  if(!Number.isFinite(elapsed)||elapsed<=0||elapsed!==durationMinutes*60000)return invalid();
}
const clock=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const endClock=z.union([clock,z.literal('24:00')]);
export const localIntervalSchema=z.object({start_local:clock,end_local:endClock}).strict().refine(row=>row.start_local<row.end_local,{message:'INVALID_TIME'});
export const weeklyIntervalSchema=z.object({weekday:z.number().int().min(1).max(7),start_local:clock,end_local:endClock}).strict().refine(row=>row.start_local<row.end_local,{message:'INVALID_TIME'});
const intervalSort=(a:{start_local:string;end_local:string},b:{start_local:string;end_local:string})=>a.start_local.localeCompare(b.start_local)||a.end_local.localeCompare(b.end_local);
const overlaps=(rows:{start_local:string;end_local:string}[])=>rows.some((row,index)=>index>0&&rows[index-1].end_local>row.start_local);
export const datedExceptionSchema=z.object({local_date:z.string().refine(validDate),intervals:z.array(localIntervalSchema).max(10)}).strict();
export const availabilityInputSchema=z.object({weekly_intervals:z.array(weeklyIntervalSchema).max(70),dated_exceptions:z.array(datedExceptionSchema).max(366)}).strict()
  .transform(value=>({weekly_intervals:[...value.weekly_intervals].sort((a,b)=>a.weekday-b.weekday||intervalSort(a,b)),dated_exceptions:value.dated_exceptions.map(row=>({...row,intervals:[...row.intervals].sort(intervalSort)})).sort((a,b)=>a.local_date.localeCompare(b.local_date))}))
  .superRefine((value,context)=>{
    for(let day=1;day<=7;day++)if(overlaps(value.weekly_intervals.filter(row=>row.weekday===day)))context.addIssue({code:'custom',message:'SCHEDULE_CONFLICT',path:['weekly_intervals']});
    if(new Set(value.dated_exceptions.map(row=>row.local_date)).size!==value.dated_exceptions.length)context.addIssue({code:'custom',message:'Duplicate exception date',path:['dated_exceptions']});
    if(value.dated_exceptions.some(row=>overlaps(row.intervals)))context.addIssue({code:'custom',message:'SCHEDULE_CONFLICT',path:['dated_exceptions']});
  });
