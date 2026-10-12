// Parsing stays in the browser. Evidence offsets refer to the edited preview.
export const MAX_FILE_BYTES = 1_048_576;
export const MAX_TRANSCRIPT = 100_000;

export function decodeTranscript(bytes) {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('Choose a file smaller than 1 MiB.');
  const raw = new Uint8Array(bytes);
  const encoding = raw[0] === 0xff && raw[1] === 0xfe ? 'utf-16le' : raw[0] === 0xfe && raw[1] === 0xff ? 'utf-16be' : 'utf-8';
  let text;
  try { text = new TextDecoder(encoding, {fatal:true}).decode(raw); }
  catch { throw new Error('Save the transcript as UTF-8 or UTF-16 with a byte order mark.'); }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) throw new Error('The file contains unsupported control characters.');
  return text.replace(/^\uFEFF/u, '').replace(/\r\n?/g, '\n');
}

function entities(text) {
  const named = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',lrm:'',rlm:''};
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|lrm|rlm);/gi, (entity,key) => {
    if (key[0] !== '#') return named[key.toLowerCase()];
    const value = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2),16) : Number(key.slice(1));
    return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : entity;
  });
}
function caption(text) {
  // Decode entities after stripping tags, so escaped literal text stays literal.
  return entities(text.replace(/<v(?:\.[^\s>]+)*\s+([^>]+)>/gi, (_,speaker) => '\n' + speaker.trim() + ': ')
    .replace(/<[^>]*>/g, '')).split('\n').map(line=>line.trim()).filter(Boolean).join('\n');
}
function time(value) {
  const match = /^(?:(\d{2,}):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(value);
  if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) throw new Error('A caption has an invalid timestamp.');
  return ((Number(match[1] || 0)*60 + Number(match[2]))*60 + Number(match[3]))*1000 + Number(match[4]);
}
export function parseTranscript(filename, text) {
  const format = filename.split('.').at(-1).toLowerCase();
  if (!['txt','vtt','srt'].includes(format)) throw new Error('Choose a .txt, .vtt, or .srt transcript.');
  text = text.replace(/^\uFEFF/u,'').replace(/\r\n?/g,'\n');
  let transcript = text.trim(), cues = 0;
  if (format !== 'txt') {
    const blocks = text.trim().split(/\n[ \t]*\n+/);
    if (format === 'vtt') {
      if (!/^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(blocks[0])) throw new Error('The VTT file is missing its WEBVTT header.');
      blocks.shift();
    }
    const passages = [];
    for (const block of blocks) {
      if (format === 'vtt' && /^(?:NOTE(?:[ \t]|$)|STYLE(?:\n|$)|REGION(?:\n|$))/.test(block)) continue;
      const lines = block.split('\n');
      const index = lines[0].includes('-->') ? 0 : 1;
      const match = /^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/.exec(lines[index] || '');
      if (!match || time(match[2]) <= time(match[1])) throw new Error('A caption is missing a valid start and end time.');
      if (format === 'srt' && (!/^\d{2,}:\d{2}:\d{2},\d{3}$/.test(match[1]) || !/^\d{2,}:\d{2}:\d{2},\d{3}$/.test(match[2]))) throw new Error('SRT timestamps must use hours and millisecond commas.');
      const passage = caption(lines.slice(index+1).join('\n'));
      if (passage) passages.push(passage);
      cues++;
    }
    transcript = passages.join('\n');
  }
  if (!transcript) throw new Error('The file contains no transcript text.');
  if (transcript.length > MAX_TRANSCRIPT) throw new Error('The transcript exceeds 100,000 characters. Split it into smaller meetings.');
  return {format, transcript, cues};
}
