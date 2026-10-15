// Textarea offsets use UTF-16; move by whole Unicode code points.
export function movePassageSelection(text,start,end,direction,key,extend){
 const boundaries=[0];for(const char of text)boundaries.push(boundaries.at(-1)+char.length);
 const anchor=direction==='backward'?end:start,focus=direction==='backward'?start:end;
 const right=key==='ArrowRight';
 if(!extend&&start!==end){const edge=right?end:start;return {start:edge,end:edge,direction:'forward'};}
 const next=right?(boundaries.find(n=>n>focus)??text.length):(boundaries.findLast(n=>n<focus)??0);
 if(!extend)return {start:next,end:next,direction:'forward'};
 return {start:Math.min(anchor,next),end:Math.max(anchor,next),direction:next<anchor?'backward':'forward'};
}
