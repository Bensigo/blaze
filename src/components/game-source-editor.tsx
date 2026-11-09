'use client';
import {useRef,useState} from 'react';
import type {Game} from '@/lib/types';
export default function GameSourceEditor({game,onSaved}:{game:Game;onSaved:()=>void}) {
  const [editing,setEditing]=useState(false),[url,setUrl]=useState(game.url),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');const lock=useRef(false);
  const save=async()=>{
    if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try{
      // Legacy records use the same SHA-256 URL revision as the server.
      const bytes=new TextEncoder().encode(game.url);const digest=await crypto.subtle.digest('SHA-256',bytes);
      const expectedRevision=game.sourceUrlRevision||Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
      const r=await fetch(`/api/games/${encodeURIComponent(game.id)}/source`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:url.trim(),expectedRevision})});const b=await r.json();if(!r.ok)throw Error(b.error||'Unable to save source URL.');
      setEditing(false);setNotice('Source URL saved. Review capture settings before collecting new footage.');onSaved();
    }catch(e){setError(e instanceof Error?e.message:'Unable to save source URL.');}finally{lock.current=false;setBusy(false);}
  };
  return <div className="game-source-editor">{editing?<div role="group" aria-label={`Edit source URL for ${game.title}`}>
    <label>Main source URL<input aria-label={`Main source URL for ${game.title}`} type="url" maxLength={2000} value={url} disabled={busy} onChange={e=>{setUrl(e.target.value);setError('');}}/></label>
    <p>Saving changes the game’s public source URL.</p><details><summary>Source and capture permissions</summary><p>Blaze validates the public HTTPS URL, then clears reviewed capture hosts. Historical evidence and existing SDK origins are retained; new origins require review.</p></details>
    <button type="button" className="button" disabled={busy||url.trim()===game.url} onClick={()=>void save()}>{busy?'Validating…':'Save source URL'}</button>{' '}
    <button type="button" className="button" disabled={busy} onClick={()=>{setUrl(game.url);setEditing(false);setError('');}}>Cancel</button>
  </div>:<button type="button" className="button" onClick={()=>{setUrl(game.url);setEditing(true);setError('');setNotice('');}}>Edit main source URL</button>}
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}</div>;
}
