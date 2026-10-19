import {localToday} from './reviewTools.js';

export function calendarDate(value){
 const [year,month,day]=value.split('-').map(Number),date=new Date(0);
 date.setUTCFullYear(year,month-1,day);date.setUTCHours(12,0,0,0);return date;
}
export const dateLabel=(value,options={dateStyle:'full'})=>new Intl.DateTimeFormat(undefined,{...options,timeZone:'UTC'}).format(calendarDate(value));
export function monthDates(month){
 const first=calendarDate(month+'-01'),next=calendarDate(month+'-01');next.setUTCMonth(next.getUTCMonth()+1);next.setUTCDate(0);
 return {offset:(first.getUTCDay()+6)%7,dates:Array.from({length:next.getUTCDate()},(_,i)=>`${month}-${String(i+1).padStart(2,'0')}`)};
}
export function shiftMonth(day,offset){
 const date=calendarDate(day),number=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+offset);
 const year=date.getUTCFullYear();if(year<1||year>9999)return day;
 const month=`${String(year).padStart(4,'0')}-${String(date.getUTCMonth()+1).padStart(2,'0')}`;
 return `${month}-${String(Math.min(number,monthDates(month).dates.length)).padStart(2,'0')}`;
}
export const initialCalendar=()=>({day:localToday(),kind:'all',status:'open',page:0,unscheduled_page:0,view:'month'});
