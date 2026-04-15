import React, { useState, useEffect, useRef } from 'react';

const C = {
  bg:'#060810', bg2:'#0a0e16', bg3:'#0f1520', bg4:'#141e2a',
  border:'#1a2535', active:'#00e5ff', success:'#69ff47',
  warn:'#ffd600', error:'#ff4569', purple:'#b388ff',
  text:'#b0c8e0', muted:'#3a5060',
};

// ── Detect payload type ────────────────────────────────────────────────────
function detectPayload(raw) {
  if (raw === null || raw === undefined) return { kind:'empty' };
  if (raw?.type === 'Buffer' && Array.isArray(raw.data)) {
    return { kind:'buffer', bytes: new Uint8Array(raw.data) };
  }
  if (typeof raw === 'string') {
    if (/^data:([a-z]+\/[a-z0-9.+-]+);base64,/.test(raw)) {
      const mime = raw.match(/data:([^;]+)/)[1];
      return { kind:'dataurl', mime, src: raw };
    }
    return { kind:'text', value: raw };
  }
  if (Array.isArray(raw)) {
    if (raw.length > 0 && typeof raw[0] === 'object' && raw[0] !== null)
      return { kind:'table', rows: raw };
    return { kind:'array', items: raw };
  }
  if (typeof raw === 'object') return { kind:'object', data: raw };
  return { kind:'primitive', value: String(raw) };
}

// ── Pretty print ──────────────────────────────────────────────────────────
function prettyText(val, depth) {
  if (depth === undefined) depth = 0;
  if (depth > 5) return '…';
  if (val === null || val === undefined) return '—';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) {
    if (val.length === 0) return '(empty list)';
    if (val.every(function(v) { return typeof v !== 'object' || v === null; }) && val.length <= 20)
      return val.join(', ');
    return val.map(function(v, i) { return '  ' + (i+1) + '. ' + prettyText(v, depth+1); }).join('\n');
  }
  var keys = Object.keys(val);
  if (keys.length === 0) return '(empty)';
  return keys.map(function(k) {
    var v = val[k];
    var pad = new Array(depth * 2 + 1).join(' ');
    if (typeof v === 'object' && v !== null) {
      var nested = prettyText(v, depth + 1);
      if (nested.indexOf('\n') !== -1)
        return pad + k + ':\n' + nested.split('\n').map(function(l) { return '  ' + l; }).join('\n');
      return pad + k + ': ' + nested;
    }
    return pad + k + ': ' + prettyText(v, depth+1);
  }).join('\n');
}

// ── Buffer helpers ────────────────────────────────────────────────────────
function bufferMime(bytes) {
  if (!bytes || bytes.length < 4) return 'application/octet-stream';
  if (bytes[0]===0x50 && bytes[1]===0x4B) return 'application/zip';
  if (bytes[0]===0xFF && bytes[1]===0xD8) return 'image/jpeg';
  if (bytes[0]===0x89 && bytes[1]===0x50) return 'image/png';
  if (bytes[0]===0x47 && bytes[1]===0x49) return 'image/gif';
  try {
    var head = new TextDecoder().decode(bytes.slice(0, 200));
    if (head.trim().startsWith('{') || head.trim().startsWith('[')) return 'application/json';
    if (head.trim().startsWith('<')) return 'text/html';
  } catch(_) {}
  return 'application/octet-stream';
}
function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n/1024).toFixed(1) + ' KB';
  return (n/1048576).toFixed(1) + ' MB';
}

// ── Download helpers ──────────────────────────────────────────────────────
function dlBlob(blob, name) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}
function dlText(text, name) { dlBlob(new Blob([text], { type:'text/plain' }), name); }
function dlBytes(bytes, name) { dlBlob(new Blob([bytes]), name); }
function dlDataUrl(src, name) {
  var a = document.createElement('a'); a.href = src; a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

// ── JSON syntax highlight ─────────────────────────────────────────────────
function JsonHL({ text }) {
  var html = text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"([^"\\]*(\\.[^"\\]*)*)"\s*:/g, '<span style="color:#82aaff">"$1"</span>:')
    .replace(/:\s*"([^"\\]*(\\.[^"\\]*)*)"/g, ': <span style="color:#c3e88d">"$1"</span>')
    .replace(/:\s*(-?\d+\.?\d*([eE][+-]?\d+)?)/g, ': <span style="color:#f78c6c">$1</span>')
    .replace(/:\s*(true|false)/g, ': <span style="color:#ffd600">$1</span>')
    .replace(/:\s*(null)/g, ': <span style="color:#888">$1</span>');
  return React.createElement('span', { dangerouslySetInnerHTML: { __html: html } });
}

// ── Table viewer ──────────────────────────────────────────────────────────
function TableView({ rows }) {
  if (!rows || !rows.length) return null;
  var cols = Array.from(new Set(rows.flatMap(function(r) { return Object.keys(r || {}); })));
  return (
    <div style={{ overflow:'auto', maxHeight:'300px', borderRadius:'6px', border:'1px solid '+C.border }}>
      <table style={{ borderCollapse:'collapse', fontSize:'10px', fontFamily:"'DM Mono',monospace", minWidth:'100%' }}>
        <thead>
          <tr style={{ background:C.bg3, position:'sticky', top:0, zIndex:1 }}>
            {cols.map(function(col) {
              return <th key={col} style={{ padding:'5px 10px', borderBottom:'1px solid '+C.border, color:C.active, textAlign:'left', fontWeight:500, whiteSpace:'nowrap' }}>{col}</th>;
            })}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0,500).map(function(row, i) {
            return (
              <tr key={i} style={{ background: i%2===0 ? C.bg4 : C.bg3 }}>
                {cols.map(function(col) {
                  var v = row && row[col];
                  return <td key={col} style={{ padding:'4px 10px', borderBottom:'1px solid '+C.border+'22', color:C.text, maxWidth:'200px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {v == null ? '' : String(v).slice(0,120)}
                  </td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > 500 && <div style={{ color:C.muted, fontSize:'10px', padding:'6px 10px' }}>Showing 500 of {rows.length} rows</div>}
    </div>
  );
}

// ── File row ──────────────────────────────────────────────────────────────
function FileRow({ label, sub, canView, onView, onDownload }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'10px', padding:'8px 12px', background:C.bg4, border:'1px solid '+C.border, borderRadius:'6px', marginBottom:'8px' }}>
      <span style={{ fontSize:'18px', flexShrink:0 }}>📎</span>
      <div style={{ flex:1, overflow:'hidden' }}>
        <div style={{ color:'#e0f0ff', fontWeight:500, fontSize:'11px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{label}</div>
        {sub && <div style={{ color:C.muted, fontSize:'10px', marginTop:'2px' }}>{sub}</div>}
      </div>
      {canView && (
        <button onClick={onView} style={{ background:'rgba(0,229,255,.1)', border:'1px solid rgba(0,229,255,.3)', color:C.active, fontFamily:"'DM Mono',monospace", fontSize:'10px', padding:'4px 10px', borderRadius:'4px', cursor:'pointer' }}>
          VIEW
        </button>
      )}
      <button onClick={onDownload} style={{ background:'rgba(105,255,71,.08)', border:'1px solid rgba(105,255,71,.3)', color:C.success, fontFamily:"'DM Mono',monospace", fontSize:'10px', padding:'4px 10px', borderRadius:'4px', cursor:'pointer' }}>
        ↓ SAVE
      </button>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
export default function DebugViewer({ logs, entry: forcedEntry }) {
  var [mode, setMode]         = useState('pretty'); // pretty | raw | table
  var [imgSrc, setImgSrc]     = useState(null);
  var scrollRef               = useRef(null);

  var entry = forcedEntry || (logs && logs.find(function(l) { return l.level==='debug'; })) || (logs && logs[0]) || null;

  useEffect(function() {
    setImgSrc(null);
    setMode('pretty');
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [entry && entry.id]);

  if (!entry) return (
    <div style={{ padding:'28px 20px', color:C.muted, fontSize:'11px', textAlign:'center', lineHeight:2.2 }}>
      No debug messages yet.<br/>
      Wire a <strong style={{color:C.text}}>Debug node</strong> to any output in Node-RED<br/>and trigger your flow.
    </div>
  );

  var raw      = entry.payload;
  var det      = detectPayload(raw);
  var ts       = entry.ts instanceof Date ? entry.ts : new Date(entry.ts);
  var timeStr  = ts.toLocaleTimeString('en-GB',{hour12:false}) + '.' + String(ts.getMilliseconds()).padStart(3,'0');
  var canTable = det.kind==='table' || (det.kind==='array' && typeof raw[0]==='object');
  var tabs     = [['pretty','¶ Pretty'],['raw','{ } Raw']].concat(canTable ? [['table','⊞ Table']] : []);

  // ── Scroll container style ───────────────────────────────────────────
  var scrollStyle = {
    overflow: 'auto',
    maxHeight: '420px',
    background: C.bg4,
    border: '1px solid ' + C.border,
    borderRadius: '6px',
    padding: '12px 14px',
    fontFamily: "'DM Mono',monospace",
    fontSize: '11px',
    lineHeight: '1.75',
    whiteSpace: 'pre',
    wordBreak: 'normal',
    overflowWrap: 'normal',
    color: C.text,
    position: 'relative',
  };

  // ── Render mode content ──────────────────────────────────────────────
  function renderBody() {
    // Image overlay
    if (imgSrc) return (
      <div>
        <button onClick={function(){setImgSrc(null);}} style={{ background:'transparent', border:'none', color:C.muted, fontFamily:"'DM Mono',monospace", fontSize:'10px', cursor:'pointer', marginBottom:'8px' }}>← back</button>
        <div style={{ textAlign:'center' }}>
          <img src={imgSrc.src} alt={imgSrc.name} style={{ maxWidth:'100%', maxHeight:'280px', borderRadius:'6px', border:'1px solid '+C.border, objectFit:'contain' }}/>
          <div style={{ color:C.muted, fontSize:'10px', marginTop:'6px' }}>{imgSrc.name}</div>
        </div>
      </div>
    );

    // Buffer / binary
    if (det.kind === 'buffer') {
      var { bytes } = det;
      var mime = bufferMime(bytes);
      var isImg  = mime.startsWith('image/');
      var isZip  = mime === 'application/zip';
      var isText = mime.startsWith('text/') || mime.includes('json');
      var ext    = isZip ? '.zip' : isImg ? '.bin' : '.bin';
      var dataUrl = null;
      if (isImg) {
        var b64 = btoa(String.fromCharCode.apply(null, Array.from(bytes).slice(0,100000)));
        dataUrl = 'data:' + mime + ';base64,' + b64;
      }
      var textContent = null;
      if (isText) try { textContent = new TextDecoder().decode(bytes); } catch(_) {}
      return (
        <div>
          <FileRow
            label={entry.node + ext}
            sub={mime + ' · ' + fmtSize(bytes.length) + (isZip ? ' — ZIP archive' : '')}
            canView={isImg || !!textContent}
            onView={function() { if (isImg && dataUrl) setImgSrc({src:dataUrl,name:entry.node}); else setMode('raw'); }}
            onDownload={function() { dlBytes(bytes, entry.node + ext); }}
          />
          {isImg && dataUrl && !imgSrc && (
            <div style={{ textAlign:'center', marginTop:'8px' }}>
              <img src={dataUrl} alt={entry.node} style={{ maxWidth:'100%', maxHeight:'200px', borderRadius:'6px', border:'1px solid '+C.border, objectFit:'contain' }}/>
            </div>
          )}
          {textContent && mode !== 'raw' && (
            <div ref={scrollRef} style={scrollStyle}>
              {mime.includes('json') ? <JsonHL text={textContent}/> : textContent}
            </div>
          )}
        </div>
      );
    }

    // Data URL
    if (det.kind === 'dataurl') {
      var { mime: dm, src: dsrc } = det;
      var isImg2  = dm.startsWith('image/');
      var ext2    = dm.split('/')[1] || 'bin';
      return (
        <div>
          <FileRow
            label={entry.node + '.' + ext2} sub={dm}
            canView={isImg2}
            onView={function() { if (isImg2) setImgSrc({src:dsrc,name:entry.node}); else window.open(dsrc,'_blank'); }}
            onDownload={function() { dlDataUrl(dsrc, entry.node+'.'+ext2); }}
          />
          {isImg2 && !imgSrc && (
            <div style={{textAlign:'center',marginTop:'8px'}}>
              <img src={dsrc} alt={entry.node} style={{maxWidth:'100%',maxHeight:'200px',borderRadius:'6px',border:'1px solid '+C.border,objectFit:'contain'}}/>
            </div>
          )}
        </div>
      );
    }

    // Table mode
    if (mode === 'table' && canTable) {
      var rows = Array.isArray(raw) ? raw : [raw];
      return (
        <div>
          <div style={{textAlign:'right',marginBottom:'6px'}}>
            <button onClick={function(){dlText(JSON.stringify(raw,null,2),entry.node+'.json');}} style={{background:'transparent',border:'1px solid '+C.border,color:C.muted,fontFamily:"'DM Mono',monospace",fontSize:'10px',padding:'3px 10px',borderRadius:'4px',cursor:'pointer'}}>↓ JSON</button>
          </div>
          <TableView rows={rows}/>
        </div>
      );
    }

    // Raw JSON mode
    if (mode === 'raw') {
      var jsonStr = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
      return (
        <div style={{position:'relative'}}>
          <button onClick={function(){dlText(jsonStr,entry.node+'.json');}} style={{position:'absolute',top:8,right:8,zIndex:2,background:C.bg3,border:'1px solid '+C.border,color:C.muted,fontFamily:"'DM Mono',monospace",fontSize:'10px',padding:'3px 10px',borderRadius:'4px',cursor:'pointer'}}>↓ SAVE</button>
          <div ref={scrollRef} style={scrollStyle}>
            <JsonHL text={jsonStr}/>
          </div>
        </div>
      );
    }

    // Pretty mode (default)
    var prettyStr = entry.msg && entry.msg !== '[object Object]' && entry.msg.trim()
      ? entry.msg
      : prettyText(raw, 0);

    return (
      <div style={{position:'relative'}}>
        <button onClick={function(){dlText(prettyStr,entry.node+'.txt');}} style={{position:'absolute',top:8,right:8,zIndex:2,background:C.bg3,border:'1px solid '+C.border,color:C.muted,fontFamily:"'DM Mono',monospace",fontSize:'10px',padding:'3px 10px',borderRadius:'4px',cursor:'pointer'}}>↓ SAVE</button>
        <div ref={scrollRef} style={scrollStyle}>
          {prettyStr || '(empty)'}
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily:"'DM Mono',monospace", height:'100%', display:'flex', flexDirection:'column' }}>
      {/* Header row */}
      <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'10px', flexShrink:0 }}>
        <div style={{ flex:1, overflow:'hidden' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
            <span style={{ fontSize:'11px', fontWeight:500, color:'#e0f0ff', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {entry.node}
            </span>
            {entry.execMs != null && (
              <span style={{ fontSize:'10px', color:C.active, flexShrink:0 }}>{entry.execMs}ms</span>
            )}
          </div>
          <div style={{ fontSize:'10px', color:C.muted, marginTop:'2px' }}>{timeStr}</div>
        </div>
        {/* Mode selector */}
        <div style={{ display:'flex', border:'1px solid '+C.border, borderRadius:'5px', overflow:'hidden', flexShrink:0 }}>
          {tabs.map(function(t) {
            return (
              <button key={t[0]} onClick={function(){setMode(t[0]);}} style={{
                background: mode===t[0] ? C.bg3 : 'transparent',
                border:'none', borderRight:'1px solid '+C.border,
                color: mode===t[0] ? C.active : C.muted,
                fontFamily:"'DM Mono',monospace", fontSize:'10px',
                padding:'4px 10px', cursor:'pointer',
              }}>{t[1]}</button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex:1, overflow:'hidden', minHeight:0 }}>
        {renderBody()}
      </div>
    </div>
  );
}
