import React from 'react';
import ContextHelp from './ContextHelp.jsx';

export default function ResearchHelp({mode}){
 const comparing=mode==='comparison';
 return <ContextHelp className="research-explainer" title={comparing?'How does a comparison work?':'What does labeling an example mean?'}>
  <p>Start with this invented conversation, dated <strong>14 May 2026</strong>.</p>
  <blockquote className="research-example-transcript"><p><strong>Nia:</strong> I’ll send the workshop map tomorrow.</p><p><strong>Eli:</strong> Please check the visitor list.</p></blockquote>
  <p>The expected answers describe what the conversation should produce:</p>
  <div className="research-example-tasks"><article><h3>Send the workshop map</h3><dl><div><dt>Owner</dt><dd>Nia</dd></div><div><dt>Deadline</dt><dd>15 May 2026</dd></div></dl></article><article><h3>Check the visitor list</h3><dl><div><dt>Owner</dt><dd>Unknown</dd></div><div><dt>Deadline</dt><dd>Unknown</dd></div></dl></article></div>
  <p>“Tomorrow” uses the meeting date. Eli asks for a task but does not identify who will do it or when, so those details stay Unknown.</p>
  {comparing?<><p>Imagine a method suggests only the workshop-map task. Its comparison would show:</p><div className="research-example-counts" role="group" aria-label="Worked comparison counts"><p><strong>1 of 2</strong> expected tasks found</p><p><strong>1</strong> expected task missed</p><p><strong>0</strong> extra suggestions</p></div><p>An extra suggestion did not match an expected task. Check the original words before judging it; expected answers can also miss work.</p><dl className="research-terms"><dt>Method</dt><dd>The approach that finds tasks, such as written rules or a language model.</dd><dt>Instructions version (prompt)</dt><dd>The instructions given to a language model. Different instructions can produce different suggestions.</dd><dt>Example set (dataset or corpus)</dt><dd>The conversations and expected answers used for a comparison. Practice examples help improve a method; reserved test examples check it afterwards.</dd></dl></>:<><p><strong>Labeling means writing these expected answers</strong> and selecting the exact words that support each task. A supporting passage is the original text, not a reviewer’s rewrite.</p><dl className="research-terms"><dt>Independent review</dt><dd>A separate person writes answers without looking at another review first. Compare answers after both people submit; changing your reviewer name does not make a second review independent.</dd><dt>Resolve a disagreement</dt><dd>Read the conversation together, record the agreed answer, and explain the choice.</dd><dt>Lock an example set</dt><dd>Save an uneditable copy of agreed answers for comparison. It does not create meeting tasks or schedule work.</dd></dl></>}
  <p className="field-hint">This is a worked example, not a saved result. Opening this explanation does not run a method or add records.</p>
 </ContextHelp>;
}
