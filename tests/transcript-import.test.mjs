import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeTranscript,parseTranscript,MAX_FILE_BYTES} from '../web/src/transcriptImport.js';

test('text decoding preserves names, Unicode and literal text, normalizing newlines',()=>{
  const text=decodeTranscript(new TextEncoder().encode('\uFEFFMaya: I’ll send 📝 tomorrow.\r\nJon: <literal>.'));
  assert.equal(parseTranscript('meeting.TXT',text).transcript,'Maya: I’ll send 📝 tomorrow.\nJon: <literal>.');
  assert.equal(decodeTranscript(Buffer.from([255,254,65,0,13,0,10,0])),'A\n');
  assert.equal(decodeTranscript(Buffer.from([254,255,0,65])),'A');
});
test('VTT strips header, metadata, styles, timestamps and preserves voices/entities',()=>{
  const value=parseTranscript('meeting.vtt','WEBVTT\nKind: captions\n\nNOTE source\nignore this\n\nSTYLE\n::cue {color: red}\n\nREGION\nid:one\n\ncue-one\n00:01.000 --> 00:03.000 align:start\n<v Maya><b>I’ll send</b> the report &amp; invoice tomorrow.</v>\n<v Jon>Thanks &#x1F44D; &lt;literal&gt;</v>\n\n00:04.000 --> 00:06.000\nMaya: Actually, make that Monday.');
  assert.equal(value.cues,2);assert.equal(value.transcript,'Maya: I’ll send the report & invoice tomorrow.\nJon: Thanks 👍 <literal>\nMaya: Actually, make that Monday.');
});
test('SRT preserves caption order and repeated text for extraction to interpret',()=>{
  const value=parseTranscript('captions.srt','1\r\n00:00:01,000 --> 00:00:02,000\r\nMaya will send the report.\r\n\r\n2\r\n00:00:02,000 --> 00:00:04,000\r\nMaya will send the report.');
  assert.equal(value.cues,2);assert.equal(value.transcript,'Maya will send the report.\nMaya will send the report.');
});
test('invalid encodings, unsupported formats, malformed and empty captions fail clearly',()=>{
  for(const bytes of [Buffer.from([0xff]),Buffer.from([65,0]),Buffer.alloc(MAX_FILE_BYTES+1)])assert.throws(()=>decodeTranscript(bytes));
  for(const [name,text] of [['m.pdf','text'],['m.txt','  '],['m.vtt','no header'],['m.vtt','WEBVTT\n\n00:70.000 --> 00:71.000\ntext'],['m.srt','1\n00:00:02,000 --> 00:00:01,000\ntext'],['m.vtt','WEBVTT\n\n00:01.000 --> 00:02.000\n<b></b>'],['m.txt','a'.repeat(100001)]])assert.throws(()=>parseTranscript(name,text));
});
