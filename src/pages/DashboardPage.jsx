import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNodeRed } from '../hooks/useNodeRed';
import DebugViewer from '../components/DebugViewer';
import Logo from '../components/Logo';

const C = {
  bg:'#060810', bg2:'#0a0e16', bg3:'#0f1520', bg4:'#141e2a',
  border:'#1a2535', active:'#00e5ff', success:'#69ff47',
  warn:'#ffd600', error:'#ff4569', purple:'#b388ff', orange:'#ff6b35',
  text:'#b0c8e0', muted:'#3a5060', dimmed:'#2a3a4a',
};
const statusCol = { idle:C.muted, running:C.active, done:C.success, warn:C.warn, error:C.error };
const levelCol  = { debug:C.purple, info:C.active, warn:C.warn, error:C.error };

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Clash+Display:wght@400;500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#060810}
::-webkit-scrollbar{width:3px;height:3px}
::-webkit-scrollbar-track{background:#060810}
::-webkit-scrollbar-thumb{background:#1a2535;border-radius:2px}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.25}}
@keyframes flowDash{to{stroke-dashoffset:-16}}
@keyframes nodePulse{0%,100%{box-shadow:0 0 10px rgba(0,229,255,.2)}50%{box-shadow:0 0 24px rgba(0,229,255,.55)}}
@keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes slideIn{from{opacity:0;transform:translateX(8px)}to{opacity:1;transform:none}}
@keyframes spin{to{transform:rotate(360deg)}}
.nr-node.running{animation:nodePulse 1.1s ease-in-out infinite}
.nr-node{transition:all .2s}
.nr-node:hover{transform:translateY(-2px)}
.log-row{animation:slideIn .18s ease}
.log-row:hover{background:rgba(255,255,255,.025)!important;cursor:pointer}
.pill-btn:hover{opacity:.75}
.icon-spin{animation:spin 1s linear infinite}
input.nr-inp:focus{border-color:rgba(0,229,255,.5)!important;outline:none}
button.act:hover{opacity:.82;transform:translateY(-1px)}
button.act:active{transform:none}
.tab:hover{color:#c0d8e0!important}
.event-flash{animation:fadeUp .3s ease}
`;

/* ── Sparkline ──────────────────────────────────────────────── */
function Spark({ data, color = C.active, h = 36 }) {
  const ref = useRef();
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d');
    c.width  = c.offsetWidth  * window.devicePixelRatio;
    c.height = h * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    ctx.clearRect(0, 0, c.offsetWidth, h);
    if (data.length < 2) return;
    const W = c.offsetWidth, H = h - 4;
    const mx = Math.max(...data) || 1;
    const step = W / (data.length - 1);
    ctx.beginPath();
    data.forEach((v, i) => { const x = i*step, y = H-(v/mx)*H+2; i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.lineTo(W, H+2); ctx.lineTo(0, H+2); ctx.closePath();
    ctx.fillStyle = color + '18'; ctx.fill();
  }, [data, color, h]);
  return <canvas ref={ref} style={{ width:'100%', height:h, display:'block' }}/>;
}

/* ── Inline SVG flow canvas ─────────────────────────────────── */
function FlowCanvas({ nodes, onSelect, selected, activeEdges }) {
  if (!nodes.length) return (
    <div style={{ textAlign:'center', padding:'40px', color:C.muted, fontSize:'12px', lineHeight:2 }}>
      No nodes loaded.<br/>
      Connect to Node-RED and deploy a flow — nodes will appear here automatically.
    </div>
  );

  // Build lookup
  const nodeMap = {};
  nodes.forEach(n => { nodeMap[n.id] = n; });

  // Build edge list from actual wires (not array position)
  const edges = [];
  nodes.forEach(src => {
    (src.wires || []).forEach(tgtId => {
      const tgt = nodeMap[tgtId];
      if (!tgt) return;
      const key    = `${src.id}->${tgtId}`;
      const active = activeEdges && activeEdges.has(key);
      edges.push({ src, tgt, key, active });
    });
  });

  // BFS layout: assign column by wire depth, row by order within column
  const col = {}, row = {};
  const inDeg = {};
  nodes.forEach(n => { inDeg[n.id] = 0; });
  nodes.forEach(n => { (n.wires||[]).forEach(t => { if(nodeMap[t]) inDeg[t]=(inDeg[t]||0)+1; }); });

  const queue = nodes.filter(n => inDeg[n.id] === 0);
  queue.forEach(n => { col[n.id] = 0; });
  const visited = new Set();
  let head = 0;
  while (head < queue.length) {
    const n = queue[head++];
    if (visited.has(n.id)) continue;
    visited.add(n.id);
    (n.wires||[]).forEach(tid => {
      const tgt = nodeMap[tid];
      if (!tgt) return;
      col[tgt.id] = Math.max(col[tgt.id]||0, (col[n.id]||0)+1);
      if (!visited.has(tid)) queue.push(tgt);
    });
  }
  nodes.filter(n => !visited.has(n.id)).forEach(n => { col[n.id] = col[n.id]||0; });

  // Assign row within each column, sorted by original x position
  const colBuckets = {};
  nodes.forEach(n => { const c = col[n.id]||0; if(!colBuckets[c]) colBuckets[c]=[]; colBuckets[c].push(n); });
  Object.values(colBuckets).forEach(bucket => {
    bucket.sort((a,b)=>(a.x||0)-(b.x||0)).forEach((n,i) => { row[n.id]=i; });
  });

  const NW = 134, NH = 58, HGAP = 56, VGAP = 18;
  const maxCol = Math.max(0, ...nodes.map(n => col[n.id]||0));
  const maxRow = Math.max(0, ...nodes.map(n => row[n.id]||0));
  const SVG_W  = Math.max(680, (maxCol+1)*(NW+HGAP)+40);
  const SVG_H  = Math.max(120, (maxRow+1)*(NH+VGAP)+40);

  const px = n => 20 + (col[n.id]||0)*(NW+HGAP);
  const py = n => 20 + (row[n.id]||0)*(NH+VGAP);

  return (
    <svg width="100%" viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      style={{ overflow:'visible', display:'block', minHeight: SVG_H }}>
      <defs>
        <marker id="m-idle"    viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M2 2L8 5L2 8" fill="none" stroke={C.border} strokeWidth="1.5" strokeLinecap="round"/>
        </marker>
        <marker id="m-active"  viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M2 2L8 5L2 8" fill="none" stroke={C.active} strokeWidth="1.8" strokeLinecap="round"/>
        </marker>
        <marker id="m-done"    viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M2 2L8 5L2 8" fill="none" stroke={C.success} strokeWidth="1.5" strokeLinecap="round"/>
        </marker>
        <marker id="m-error"   viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M2 2L8 5L2 8" fill="none" stroke={C.error} strokeWidth="1.5" strokeLinecap="round"/>
        </marker>
      </defs>

      {/* ── Edges drawn UNDER nodes ── */}
      {edges.map((e, i) => {
        const x1 = px(e.src) + NW;
        const y1 = py(e.src) + NH / 2;
        const x2 = px(e.tgt);
        const y2 = py(e.tgt) + NH / 2;

        const srcSt  = e.src.status;
        const tgtSt  = e.tgt.status;

        // Edge colour priority:
        // 1. active (message in transit right now)  → cyan animated
        // 2. src is running, tgt is idle            → cyan (about to activate)
        // 3. src done, tgt done                     → green (completed path)
        // 4. src or tgt errored                     → red
        // 5. idle                                   → dim border
        const isActive  = e.active;
        const isError   = srcSt === 'error' || tgtSt === 'error';
        const isDone    = !isActive && srcSt === 'done';
        const isPending = !isActive && srcSt === 'running';

        const stroke  = isActive  ? C.active
                      : isError   ? C.error
                      : isDone    ? C.success
                      : isPending ? C.active
                      : C.border;
        const sw      = isActive || isPending ? 2 : isDone ? 1.2 : 0.7;
        const dash    = isActive ? '6 3' : isPending ? '3 3' : 'none';
        const opacity = isActive || isDone || isPending || isError ? 1 : 0.35;
        const markId  = isError ? 'm-error' : isActive || isPending ? 'm-active' : isDone ? 'm-done' : 'm-idle';

        // Bezier handles — horizontal curve
        const cpx1 = x1 + Math.max(30, (x2-x1)*0.45);
        const cpx2 = x2 - Math.max(30, (x2-x1)*0.45);
        const d = `M ${x1} ${y1} C ${cpx1} ${y1}, ${cpx2} ${y2}, ${x2} ${y2}`;

        return (
          <g key={e.key}>
            <path d={d} fill="none"
              stroke={stroke} strokeWidth={sw}
              strokeDasharray={dash}
              markerEnd={`url(#${markId})`}
              opacity={opacity}
              style={isActive ? { animation:'flowDash .5s linear infinite' } : {}}
            />
            {/* Travelling dot on active edges */}
            {isActive && (
              <circle r="3.5" fill={C.active} opacity="0.95"
                style={{ filter:'drop-shadow(0 0 4px #00e5ff)' }}>
                <animateMotion dur="0.6s" repeatCount="indefinite">
                  <mpath href={`#ep${i}`}/>
                </animateMotion>
              </circle>
            )}
            {/* Hidden path for animateMotion (needs id) */}
            {isActive && <path id={`ep${i}`} d={d} fill="none" stroke="none"/>}
          </g>
        );
      })}

      {/* ── Nodes drawn ON TOP of edges ── */}
      {nodes.map(node => {
        const x    = px(node);
        const y    = py(node);
        const col2 = statusCol[node.status] || C.muted;
        const isSel = selected === node.id;
        const isRun = node.status === 'running';
        const isDone = node.status === 'done';
        const isErr  = node.status === 'error';
        const isWarn = node.status === 'warn';
        const isIdle = node.status === 'idle';

        return (
          <g key={node.id} className={`nr-node ${node.status}`}
            onClick={() => onSelect(node.id)} style={{ cursor:'pointer' }}>

            {/* Outer glow ring for running nodes */}
            {isRun && (
              <rect x={x-5} y={y-5} width={NW+10} height={NH+10} rx="12"
                fill="none" stroke={C.active} strokeWidth="1.5" opacity="0.25"
                style={{ animation:'nodePulse 1s ease-in-out infinite' }}/>
            )}

            {/* Main box */}
            <rect x={x} y={y} width={NW} height={NH} rx="8"
              fill={C.bg4}
              stroke={isSel ? C.active : col2}
              strokeWidth={isSel ? 2 : isRun ? 1.5 : 0.8}
              opacity={isIdle && !isSel ? 0.75 : 1}
            />

            {/* Left category bar */}
            <rect x={x} y={y+2} width={4} height={NH-4} rx="2"
              fill={node.color || col2} opacity={isIdle ? 0.4 : 0.9}/>

            {/* Bottom status strip */}
            <rect x={x+1} y={y+NH-4} width={NW-2} height={3} rx="1.5"
              fill={col2} opacity={isIdle ? 0.2 : 0.75}/>

            {/* Category label top-right */}
            <text x={x+NW-8} y={y+14} textAnchor="end"
              fill={node.color || col2} fontSize="8" fontFamily="DM Mono"
              opacity={isIdle ? 0.4 : 0.7} style={{letterSpacing:'0.06em'}}>
              {node.category}
            </text>

            {/* Node name */}
            <text x={x+NW/2} y={y+33} textAnchor="middle"
              fill={isIdle ? '#4a6878' : '#e8f4ff'}
              fontSize="11" fontFamily="DM Mono" fontWeight="500">
              {node.name.length > 14 ? node.name.slice(0,13)+'…' : node.name}
            </text>

            {/* Status / exec text */}
            <text x={x+NW/2} y={y+48} textAnchor="middle"
              fill={col2} fontSize="8.5" fontFamily="DM Mono" opacity={isIdle ? 0.4 : 1}>
              {node.statusText
                ? (node.statusText.length > 18 ? node.statusText.slice(0,17)+'…' : node.statusText)
                : (isIdle ? 'idle' : node.status)}
              {node.time != null ? ` · ${node.time}ms` : ''}
            </text>

            {/* Status indicator top-right corner */}
            {isRun  && <circle cx={x+NW-9} cy={y+12} r="4" fill={C.active}
              style={{ animation:'blink .65s ease-in-out infinite' }}/>}
            {isDone && <text x={x+NW-9} y={y+16} textAnchor="middle"
              fill={C.success} fontSize="11">✓</text>}
            {isErr  && <text x={x+NW-9} y={y+16} textAnchor="middle"
              fill={C.error}   fontSize="11">✕</text>}
            {isWarn && <text x={x+NW-9} y={y+16} textAnchor="middle"
              fill={C.warn}    fontSize="11">!</text>}
          </g>
        );
      })}
    </svg>
  );
}


/* ── Log row ────────────────────────────────────────────────── */
function LogRow({ entry, selected, onClick }) {
  const t = entry.ts;
  const ts = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}.${String(t.getMilliseconds()).padStart(3,'0')}`;
  const col = levelCol[entry.level] || C.text;
  return (
    <div className="log-row" onClick={onClick}
      style={{
        display:'grid', gridTemplateColumns:'92px 52px 120px 1fr 58px',
        padding:'5px 14px',
        borderLeft: selected ? `2px solid ${C.active}` : `2px solid ${col}44`,
        borderBottom:`1px solid ${C.border}55`,
        background: selected ? 'rgba(0,229,255,.05)' : entry.level==='error' ? 'rgba(255,69,105,.03)' : 'transparent',
        fontSize:'11px', fontFamily:"'DM Mono',monospace", alignItems:'start',
      }}>
      <span style={{color:C.muted, fontSize:'10px', paddingTop:'1px'}}>{ts}</span>
      <span style={{color:col, fontWeight:'600', fontSize:'9px', letterSpacing:'.1em', paddingTop:'2px'}}>{entry.level.toUpperCase()}</span>
      <span style={{color:C.muted, fontSize:'10px', paddingTop:'2px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', paddingRight:'6px'}}>{entry.node}</span>
      <span style={{color: entry.level==='error'?'#ff8099':entry.level==='warn'?'#ffe566':C.text, lineHeight:'1.5', wordBreak:'break-all'}}>{entry.msg}</span>
      {entry.execMs != null
        ? <span style={{textAlign:'right', fontSize:'10px', paddingTop:'2px', color: entry.execMs<30?C.success:entry.execMs<80?C.active:entry.execMs<150?C.warn:C.error}}>{entry.execMs}ms</span>
        : <span/>}
    </div>
  );
}

/* ── Connection status badge ────────────────────────────────── */
function WsBadge({ wsStatus, version }) {
  const cfg = {
    connected:    { col:C.success, label:`LIVE${version ? ' · v'+version : ''}`, blink:true },
    connecting:   { col:C.warn,    label:'CONNECTING…', blink:true },
    disconnected: { col:C.muted,   label:'DISCONNECTED', blink:false },
    error:        { col:C.error,   label:'ERROR', blink:false },
  }[wsStatus] || { col:C.muted, label:'UNKNOWN', blink:false };
  return (
    <div style={{display:'flex', alignItems:'center', gap:'6px', fontSize:'10px', color:cfg.col, letterSpacing:'.1em'}}>
      <div style={{width:'7px', height:'7px', borderRadius:'50%', background:cfg.col,
        animation: cfg.blink ? 'blink 1.4s infinite' : 'none'}}/>
      {cfg.label}
    </div>
  );
}

/* ── Main Dashboard ─────────────────────────────────────────── */
export default function DashboardPage() {
  const { user, logout } = useAuth();
  const {
    connected, wsStatus, nrVersion, nrUrl,
    tabs, activeTab, setActiveTab,
    nodes, logs, stats, execTimes, lastEvent, activeEdges,
    bridgeReady,
    fetchFlows, reconnect, triggerInject, resetAll,
  } = useNodeRed();

  const [tab,         setTab]         = useState('flow');
  const [selNode,     setSelNode]     = useState(null);
  const [selLog,      setSelLog]      = useState(null);
  const [logFilter,   setLogFilter]   = useState('all');
  const [logSearch,   setLogSearch]   = useState('');
  const [urlInput,    setUrlInput]    = useState(nrUrl);
  const [showConnect, setShowConnect] = useState(false);
  const logEndRef = useRef();

  const selNodeObj = nodes.find(n => n.id === selNode);
  // Last debug message for the DebugViewer panel
  const lastDebugEntry = logs.find(l => l.level === 'debug') || null;
  const allExecMs  = execTimes.map(e => e.ms);
  const selExecMs  = execTimes.filter(e => e.node === selNodeObj?.name).map(e => e.ms);

  const filteredLogs = logs.filter(l =>
    (logFilter === 'all' || l.level === logFilter) &&
    (!logSearch || l.msg.toLowerCase().includes(logSearch.toLowerCase()) || l.node.toLowerCase().includes(logSearch.toLowerCase()))
  );

  // Auto-scroll logs
  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior:'smooth' });
  }, [filteredLogs.length]);

  const Btn = ({ children, onClick, style = {}, className = '' }) => (
    <button className={`act ${className}`} onClick={onClick}
      style={{ background:C.bg3, border:`1px solid ${C.border}`, color:C.muted,
        fontFamily:"'DM Mono',monospace", fontSize:'10px', padding:'5px 12px',
        borderRadius:'5px', cursor:'pointer', transition:'all .18s', letterSpacing:'.05em',
        ...style }}>
      {children}
    </button>
  );

  return (
    <>
      <style>{CSS}</style>
      <div style={{ minHeight:'100vh', background:C.bg, fontFamily:"'DM Mono',monospace", display:'flex', flexDirection:'column', fontSize:'12px' }}>

        {/* ── Header ── */}
        <header style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 20px', borderBottom:`1px solid ${C.border}`, background:C.bg2, flexShrink:0, gap:'12px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
            <Logo size={30}/>
            <span style={{ fontFamily:"'Clash Display',sans-serif", fontWeight:'700', fontSize:'16px', color:'#fff', letterSpacing:'-.02em' }}>Ether<span style={{color:C.active}}>.</span></span>
          </div>

          {/* Connection info */}
          <div style={{ display:'flex', alignItems:'center', gap:'14px', flex:1, justifyContent:'center' }}>
            <WsBadge wsStatus={wsStatus} version={nrVersion}/>
            <span style={{ color:C.dimmed, fontSize:'10px' }}>{nrUrl}</span>
            {lastEvent && (
              <span className="event-flash" style={{ fontSize:'9px', color:C.purple, letterSpacing:'.06em' }}>
                ↳ {typeof lastEvent.topic === 'string' ? lastEvent.topic : JSON.stringify(lastEvent.topic)}
              </span>
            )}
          </div>

          {/* Right controls */}
          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
            <Btn onClick={() => setShowConnect(v => !v)} style={{ borderColor: showConnect ? C.active : C.border, color: showConnect ? C.active : C.muted }}>
              ⚙ CONNECT
            </Btn>
            <Btn onClick={() => fetchFlows()} style={{ color:C.active, borderColor:'rgba(0,229,255,.3)' }}>
              ↻ REFRESH
            </Btn>
            <div style={{ display:'flex', alignItems:'center', gap:'8px', background:C.bg3, border:`1px solid ${C.border}`, borderRadius:'18px', padding:'4px 10px 4px 4px' }}>
              <img src={user?.avatar || `https://ui-avatars.com/api/?name=${user?.name}&background=00e5ff&color=060810`}
                alt="" style={{ width:'22px', height:'22px', borderRadius:'50%', objectFit:'cover' }}/>
              <span style={{ fontSize:'11px', color:C.text }}>{user?.name}</span>
              <span style={{ fontSize:'9px', color:C.muted }}>· {user?.provider || 'local'}</span>
            </div>
            <Btn onClick={logout} style={{ color:C.error, borderColor:'rgba(255,69,105,.3)' }}>SIGN OUT</Btn>
          </div>
        </header>

        {/* ── Connection panel (collapsible) ── */}
        {showConnect && (
          <div style={{ background:C.bg2, borderBottom:`1px solid ${C.border}`, padding:'12px 20px', display:'flex', alignItems:'center', gap:'10px', flexShrink:0 }}>
            <span style={{ color:C.muted, fontSize:'11px', flexShrink:0 }}>Node-RED URL:</span>
            <input className="nr-inp" value={urlInput} onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => e.key==='Enter' && reconnect(urlInput)}
              style={{ background:C.bg3, border:`1px solid ${C.border}`, color:C.text, fontFamily:"'DM Mono',monospace", fontSize:'11px', padding:'6px 10px', borderRadius:'5px', width:'260px', transition:'border-color .2s' }}
              placeholder="http://localhost:1880"/>
            <Btn onClick={() => reconnect(urlInput)} style={{ background:'rgba(0,229,255,.1)', borderColor:C.active, color:C.active }}>CONNECT</Btn>
            <div style={{ marginLeft:'auto', fontSize:'10px', color:C.muted, lineHeight:1.8 }}>
              <div>Node-RED must have <strong style={{color:C.text}}>httpNodeAuth disabled</strong> or CORS enabled</div>
              <div>Dashboard listens on <strong style={{color:C.active}}>/comms</strong> (WebSocket) and <strong style={{color:C.active}}>/flows</strong> (REST)</div>
            </div>
          </div>
        )}

        {/* ── Stats bar ── */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
          {[
            { label:'Nodes Loaded',  value: nodes.length,       col:'#fff' },
            { label:'Messages',      value: stats.messages,     col:'#fff' },
            { label:'Avg Exec',      value: stats.avgMs ? stats.avgMs+'ms' : '—', col:C.active },
            { label:'Warnings',      value: stats.warnings,     col:C.warn },
            { label:'Errors',        value: stats.errors,       col:C.error },
          ].map((s, i) => (
            <div key={i} style={{ padding:'12px 20px', borderRight:`1px solid ${C.border}` }}>
              <div style={{ fontSize:'9px', color:C.muted, letterSpacing:'.14em', textTransform:'uppercase', marginBottom:'4px' }}>{s.label}</div>
              <div style={{ fontFamily:"'Clash Display',sans-serif", fontSize:'22px', fontWeight:'700', color:s.col }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* ── Connection status banner ── */}
        {connected && bridgeReady && (
          <div style={{ background:'rgba(105,255,71,.04)', borderBottom:`1px solid rgba(105,255,71,.15)`, padding:'6px 20px', display:'flex', alignItems:'center', gap:'10px', fontSize:'10px', color:C.success, flexShrink:0 }}>
            <span>✓ Live — receiving events from {nrUrl}/comms</span>
            <span style={{color:C.muted, marginLeft:'auto'}}>Debug nodes push output here automatically · node.status() updates node colours</span>
          </div>
        )}
        {connected && !bridgeReady && (
          <div style={{ background:'rgba(255,214,0,.04)', borderBottom:`1px solid rgba(255,214,0,.2)`, padding:'6px 20px', fontSize:'10px', color:C.warn, flexShrink:0 }}>
            Connecting to /comms…
          </div>
        )}
        {/* ── Tab bar ── */}
        <div style={{ display:'flex', alignItems:'center', borderBottom:`1px solid ${C.border}`, background:C.bg2, paddingLeft:'20px', flexShrink:0 }}>
          {['flow','logs','config'].map(t => (
            <button key={t} className="tab" onClick={() => setTab(t)} style={{
              background:'none', border:'none', cursor:'pointer',
              fontFamily:"'DM Mono',monospace", fontSize:'10px', letterSpacing:'.1em', textTransform:'uppercase',
              color: tab===t ? C.active : C.muted,
              padding:'9px 16px',
              borderBottom: tab===t ? `2px solid ${C.active}` : '2px solid transparent',
              transition:'all .15s',
            }}>
              {t === 'flow' ? '▶ FLOW' : t === 'logs' ? '📋 LOGS' : '⚙ CONFIG'}
            </button>
          ))}
          {/* Flow tabs from NR */}
          {tabs.length > 0 && tab === 'flow' && (
            <div style={{ display:'flex', alignItems:'center', gap:'2px', marginLeft:'16px', paddingLeft:'16px', borderLeft:`1px solid ${C.border}` }}>
              {tabs.map(t => (
                <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
                  background: activeTab===t.id ? 'rgba(0,229,255,.1)' : 'none',
                  border:`1px solid ${activeTab===t.id ? C.active : 'transparent'}`,
                  borderRadius:'4px', color: activeTab===t.id ? C.active : C.muted,
                  fontFamily:"'DM Mono',monospace", fontSize:'10px', padding:'3px 10px', cursor:'pointer',
                }}>
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <div style={{ marginLeft:'auto', display:'flex', gap:'6px', paddingRight:'20px' }}>
<Btn onClick={resetAll}>RESET</Btn>
          </div>
        </div>

        {/* ── Content ── */}
        <div style={{ flex:1, overflow:'hidden', display:'flex' }}>

          {/* ══ FLOW TAB ══ */}
          {tab === 'flow' && (
            <div style={{ flex:1, display:'grid', gridTemplateColumns:'1fr 220px', overflow:'hidden' }}>
              {/* Canvas + charts */}
              <div style={{ padding:'20px', overflowY:'auto', borderRight:`1px solid ${C.border}` }}>
                <div style={{ fontSize:'9px', color:C.muted, letterSpacing:'.18em', textTransform:'uppercase', marginBottom:'14px', display:'flex', alignItems:'center', gap:'8px' }}>
                  FLOW CANVAS
                  <span style={{ color:C.dimmed }}>— click a node to inspect</span>
                  {!connected && <span style={{ color:C.warn, marginLeft:'auto' }}>⚠ not connected — showing demo</span>}
                </div>

                <div style={{ background:C.bg2, border:`1px solid ${C.border}`, borderRadius:'10px', padding:'16px 10px', marginBottom:'20px' }}>
                  <FlowCanvas nodes={nodes} onSelect={setSelNode} selected={selNode} activeEdges={activeEdges}/>
                </div>

                {/* Inject buttons for real inject nodes */}
                {nodes.filter(n => n.type === 'inject').length > 0 && (
                  <div style={{ marginBottom:'16px' }}>
                    <div style={{ fontSize:'9px', color:C.muted, letterSpacing:'.15em', textTransform:'uppercase', marginBottom:'8px' }}>TRIGGER INJECT NODES</div>
                    <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
                      {nodes.filter(n => n.type === 'inject').map(n => (
                        <button key={n.id} onClick={() => triggerInject(n.id)}
                          className="act pill-btn"
                          style={{ background:'rgba(0,229,255,.08)', border:`1px solid rgba(0,229,255,.25)`,
                            color:C.active, fontFamily:"'DM Mono',monospace", fontSize:'10px',
                            padding:'4px 12px', borderRadius:'14px', cursor:'pointer', transition:'all .15s' }}>
                          ▶ {n.name || 'inject'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Last Debug Message — full width ── */}
                <div style={{ marginBottom:'20px' }}>
                  <div style={{ fontSize:'9px', color:C.muted, letterSpacing:'.15em', textTransform:'uppercase', marginBottom:'10px', display:'flex', alignItems:'center', gap:'8px' }}>
                    LAST DEBUG MESSAGE
                    {lastDebugEntry && <span style={{color:C.active}}>— {lastDebugEntry.node}</span>}
                    {lastDebugEntry?.execMs != null && <span style={{color:C.success, marginLeft:'auto'}}>{lastDebugEntry.execMs}ms</span>}
                  </div>
                  <div style={{ background:C.bg2, border:`1px solid ${C.border}`, borderRadius:'10px', padding:'16px', minHeight:'180px' }}>
                    <DebugViewer logs={logs} entry={lastDebugEntry}/>
                  </div>
                </div>

                {/* ── Execution timeline + per-node bars side by side ── */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px', marginBottom:'4px' }}>
                  <div>
                    <div style={{ fontSize:'9px', color:C.muted, letterSpacing:'.15em', textTransform:'uppercase', marginBottom:'8px' }}>EXECUTION TIMELINE</div>
                    <div style={{ background:C.bg3, border:`1px solid ${C.border}`, borderRadius:'8px', padding:'10px' }}>
                      {allExecMs.length > 1
                        ? <Spark data={allExecMs}/>
                        : <div style={{color:C.muted, fontSize:'10px', textAlign:'center', padding:'8px'}}>No data yet</div>}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize:'9px', color:C.muted, letterSpacing:'.15em', textTransform:'uppercase', marginBottom:'8px' }}>PER-NODE EXEC TIME</div>
                    {nodes.filter(n => n.time != null).length === 0 && (
                      <div style={{color:C.muted, fontSize:'10px', padding:'8px 0'}}>No timing data yet</div>
                    )}
                    {nodes.filter(n => n.time != null).map(n => {
                      const mx = Math.max(...nodes.filter(x=>x.time!=null).map(x=>x.time),1);
                      const col2 = n.time<30?C.success:n.time<80?C.active:n.time<150?C.warn:C.error;
                      return (
                        <div key={n.id} style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'7px', fontSize:'10px' }}>
                          <span style={{ width:'90px', color:C.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flexShrink:0 }}>{n.name}</span>
                          <div style={{ flex:1, height:'5px', background:C.bg4, borderRadius:'3px', overflow:'hidden' }}>
                            <div style={{ width:`${(n.time/mx)*100}%`, height:'100%', background:col2, borderRadius:'3px', transition:'width .6s' }}/>
                          </div>
                          <span style={{ color:col2, width:'40px', textAlign:'right', flexShrink:0 }}>{n.time}ms</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Node inspector panel */}
              <div style={{ padding:'16px', overflowY:'auto' }}>
                <div style={{ fontSize:'9px', color:C.muted, letterSpacing:'.18em', textTransform:'uppercase', marginBottom:'12px' }}>NODE INSPECTOR</div>

                {selNodeObj ? (
                  <>
                    <div style={{ background:C.bg3, border:`1px solid ${C.border}`, borderRadius:'8px', padding:'12px', marginBottom:'12px' }}>
                      {[
                        ['Name',    selNodeObj.name],
                        ['Type',    selNodeObj.type],
                        ['Status',  selNodeObj.status.toUpperCase()],
                        ['Exec',    selNodeObj.time != null ? selNodeObj.time+'ms' : '—'],
                        ['Runs',    selNodeObj.runs],
                        ['Status text', selNodeObj.statusText || '—'],
                        ['Last msg', selNodeObj.lastMsg ? selNodeObj.lastMsg.slice(0,45) : '—'],
                      ].map(([k,v]) => (
                        <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', borderBottom:`1px solid ${C.border}`, fontSize:'10px' }}>
                          <span style={{color:C.muted}}>{k}</span>
                          <span style={{ color: k==='Status'?statusCol[selNodeObj.status]:k==='Exec'?C.active:'#e0f0ff', fontWeight:'500', maxWidth:'120px', overflow:'hidden', textOverflow:'ellipsis', textAlign:'right' }}>{String(v)}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize:'9px', color:C.muted, letterSpacing:'.1em', textTransform:'uppercase', marginBottom:'6px' }}>EXEC HISTORY</div>
                    <div style={{ background:C.bg3, border:`1px solid ${C.border}`, borderRadius:'7px', padding:'8px' }}>
                      <Spark data={selExecMs} color={statusCol[selNodeObj.status] || C.active} h={32}/>
                    </div>
                    {selNodeObj.type === 'inject' && (
                      <button className="act" onClick={() => triggerInject(selNodeObj.id)}
                        style={{ marginTop:'10px', width:'100%', background:'rgba(0,229,255,.08)', border:`1px solid rgba(0,229,255,.3)`, color:C.active, fontFamily:"'DM Mono',monospace", fontSize:'10px', padding:'7px', borderRadius:'6px', cursor:'pointer', transition:'all .15s' }}>
                        ▶ TRIGGER THIS NODE
                      </button>
                    )}
                  </>
                ) : (
                  <div style={{color:C.muted, fontSize:'10px', padding:'8px 0'}}>Click a node to inspect</div>
                )}

                {/* All nodes list */}
                <div style={{ marginTop:'18px' }}>
                  <div style={{ fontSize:'9px', color:C.muted, letterSpacing:'.15em', textTransform:'uppercase', marginBottom:'8px' }}>ALL NODES ({nodes.length})</div>
                  {nodes.length === 0 && <div style={{color:C.muted, fontSize:'10px'}}>No nodes loaded</div>}
                  {nodes.map(n => (
                    <div key={n.id} onClick={() => setSelNode(n.id)}
                      style={{ display:'flex', alignItems:'center', gap:'7px', padding:'6px 0', borderBottom:`1px solid ${C.border}`, cursor:'pointer', fontSize:'10px' }}>
                      <div style={{ width:'5px', height:'5px', borderRadius:'50%', background:statusCol[n.status]||C.muted, flexShrink:0,
                        animation: n.status==='running'?'blink .8s infinite':'none' }}/>
                      <div style={{ width:'4px', height:'14px', borderRadius:'1px', background:n.color||C.muted, flexShrink:0, opacity:.7 }}/>
                      <span style={{ flex:1, color:C.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{n.name}</span>
                      <span style={{ color:statusCol[n.status]||C.muted, fontSize:'9px', flexShrink:0 }}>{n.status}</span>
                      {n.time != null && <span style={{ color:C.active, fontSize:'9px', flexShrink:0 }}>{n.time}ms</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ══ LOGS TAB ══ */}
          {tab === 'logs' && (
            <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
              {/* Log toolbar */}
              <div style={{ display:'flex', alignItems:'center', gap:'6px', padding:'8px 14px', borderBottom:`1px solid ${C.border}`, background:C.bg2, flexShrink:0, flexWrap:'wrap' }}>
                {['all','debug','info','warn','error'].map(l => {
                  const col2 = levelCol[l] || '#fff';
                  const cnt  = l === 'all' ? logs.length : logs.filter(lg => lg.level === l).length;
                  return (
                    <button key={l} onClick={() => setLogFilter(l)} style={{
                      background: logFilter===l ? col2+'22' : 'transparent',
                      border:`1px solid ${logFilter===l ? col2 : C.border}`,
                      color: logFilter===l ? col2 : C.muted,
                      fontFamily:"'DM Mono',monospace", fontSize:'9px', padding:'3px 10px',
                      borderRadius:'12px', cursor:'pointer', letterSpacing:'.08em',
                      fontWeight: logFilter===l?'600':'400', transition:'all .15s',
                    }}>
                      {l.toUpperCase()} <span style={{opacity:.7}}>({cnt})</span>
                    </button>
                  );
                })}
                <input className="nr-inp" value={logSearch} onChange={e => setLogSearch(e.target.value)}
                  placeholder="Search…" style={{ marginLeft:'auto', background:C.bg3, border:`1px solid ${C.border}`,
                    color:C.text, fontFamily:"'DM Mono',monospace", fontSize:'10px',
                    padding:'4px 10px', borderRadius:'4px', width:'180px', transition:'border-color .2s' }}/>
                <Btn onClick={() => { /* clear is in parent */ }}>CLEAR</Btn>
              </div>
              {/* Header row */}
              <div style={{ display:'grid', gridTemplateColumns:'92px 52px 120px 1fr 58px', padding:'5px 14px', fontSize:'8.5px', color:C.muted, letterSpacing:'.14em', textTransform:'uppercase', background:C.bg2, borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
                <span>TIME</span><span>LEVEL</span><span>NODE</span><span>MESSAGE</span><span style={{textAlign:'right'}}>EXEC</span>
              </div>
              {/* Entries */}
              <div style={{ flex:1, overflowY:'auto' }}>
                {filteredLogs.length === 0 && (
                  <div style={{ color:C.muted, textAlign:'center', padding:'40px', fontSize:'11px', lineHeight:2 }}>
                    No logs yet — connect to Node-RED, then trigger a flow or inject node.
                  </div>
                )}
                {filteredLogs.map(l => (
                  <LogRow key={l.id} entry={l} selected={selLog?.id === l.id} onClick={() => setSelLog(l)}/>
                ))}
                <div ref={logEndRef}/>
              </div>
              {/* Debug message viewer */}
              <div style={{ borderTop:`1px solid ${C.border}`, padding:'14px 16px', background:C.bg2, flexShrink:0, minHeight:'200px', maxHeight:'420px' }}>
                <div style={{ fontSize:'8.5px', color:C.muted, letterSpacing:'.14em', textTransform:'uppercase', marginBottom:'10px', display:'flex', alignItems:'center', gap:'8px' }}>
                  LAST DEBUG MESSAGE
                  {selLog && selLog.level === 'debug' && <span style={{color:C.active}}>— {selLog.node}</span>}
                </div>
                <DebugViewer logs={logs} entry={selLog?.level === 'debug' ? selLog : null}/>
              </div>
            </div>
          )}

          {/* ══ CONFIG TAB ══ */}
          {tab === 'config' && (
            <div style={{ flex:1, padding:'24px', overflowY:'auto' }}>
              <div style={{ maxWidth:'560px' }}>
                {/* Node-RED connection */}
                <div style={{ fontSize:'9px', color:C.muted, letterSpacing:'.18em', textTransform:'uppercase', marginBottom:'14px' }}>NODE-RED CONNECTION</div>
                <div style={{ background:C.bg3, border:`1px solid ${C.border}`, borderRadius:'10px', padding:'18px', marginBottom:'20px' }}>
                  <div style={{ marginBottom:'12px' }}>
                    <label style={{ display:'block', fontSize:'9px', color:C.muted, letterSpacing:'.12em', textTransform:'uppercase', marginBottom:'6px' }}>URL</label>
                    <input className="nr-inp" value={urlInput} onChange={e => setUrlInput(e.target.value)}
                      style={{ width:'100%', padding:'9px 12px', background:C.bg, border:`1px solid ${C.border}`,
                        color:C.text, fontFamily:"'DM Mono',monospace", fontSize:'12px',
                        borderRadius:'6px', transition:'border-color .2s' }}/>
                  </div>
                  <button className="act" onClick={() => reconnect(urlInput)}
                    style={{ background:'rgba(0,229,255,.1)', border:`1px solid ${C.active}`, color:C.active,
                      fontFamily:"'DM Mono',monospace", fontSize:'11px', padding:'8px 18px',
                      borderRadius:'6px', cursor:'pointer', transition:'all .15s', letterSpacing:'.05em' }}>
                    RECONNECT
                  </button>
                  <div style={{ marginTop:'14px', fontSize:'10px', color:C.muted, lineHeight:1.9 }}>
                    <div>Realtime: <span style={{color:C.active}}>{nrUrl}/comms</span> <span style={{color:C.muted}}>(WebSocket · socket.io)</span></div>
                    <div>Flows API: <span style={{color:C.active}}>{nrUrl}/flows</span></div>
                    <div>Status: <WsBadge wsStatus={wsStatus} version={nrVersion}/></div>
                  </div>
                </div>

                {/* How real-time works */}
                <div style={{ fontSize:'9px', color:C.muted, letterSpacing:'.18em', textTransform:'uppercase', marginBottom:'14px' }}>HOW LIVE MONITORING WORKS</div>
                <div style={{ background:C.bg3, border:`1px solid ${C.border}`, borderRadius:'10px', padding:'16px', fontSize:'11px', color:C.muted, lineHeight:2, marginBottom:'20px' }}>
                  {[
                    ['Flow canvas',   'Fetched via GET /flows — auto-reloads when you deploy'],
                    ['Node status',   'Polled via GET /nodeflow-dashboard/status every 2s (import monitor flow)'],
                    ['Inject trigger','Click ▶ on inject nodes — fires via POST /inject/:id'],
                    ['Deploy detect', 'Flow ETag checked on every poll — canvas reloads automatically'],
                    ['Realtime events', '/comms WebSocket receives debug output and node status instantly'],
                  ].map(([k,v]) => (
                    <div key={k} style={{ display:'flex', gap:'10px', marginBottom:'4px' }}>
                      <span style={{color:C.active, flexShrink:0, width:'120px'}}>{k}</span>
                      <span>{v}</span>
                    </div>
                  ))}
                </div>

                {/* Node-RED setup to enable status reporting */}
                <div style={{ fontSize:'9px', color:C.muted, letterSpacing:'.18em', textTransform:'uppercase', marginBottom:'14px' }}>ENABLE STATUS IN YOUR NODES</div>
                <div style={{ background:C.bg3, border:`1px solid ${C.border}`, borderRadius:'10px', padding:'16px', fontSize:'11px' }}>
                  <div style={{ color:C.text, marginBottom:'8px' }}>Add to your function nodes to see live status:</div>
                  <pre style={{ fontFamily:"'DM Mono',monospace", background:C.bg, borderRadius:'6px', padding:'12px', color:C.active, fontSize:'10.5px', lineHeight:'1.8', overflow:'auto' }}>{`node.status({fill:"blue", shape:"dot", text:"processing"});
// ... do work ...
node.status({fill:"green", shape:"dot", text:"done 45ms"});

// On error:
node.status({fill:"red", shape:"ring", text:err.message});`}</pre>
                  <div style={{ color:C.text, margin:'12px 0 6px' }}>To see debug output in the Logs tab:</div>
                  <pre style={{ fontFamily:"'DM Mono',monospace", background:C.bg, borderRadius:'6px', padding:'12px', color:C.purple, fontSize:'10.5px', lineHeight:'1.8', overflow:'auto' }}>{`// Wire a Debug node to any output
// Set to "msg.payload" or "complete msg object"
// It will appear live in the LOGS tab`}</pre>
                  <div style={{ color:C.text, margin:'12px 0 6px' }}>Required in ~/.node-red/settings.js:</div>
                  <pre style={{ fontFamily:"'DM Mono',monospace", background:C.bg, borderRadius:'6px', padding:'12px', color:C.warn, fontSize:'10.5px', lineHeight:'1.8', overflow:'auto' }}>{`// Add httpAdminCors (BEFORE httpNodeCors):
httpAdminCors: {
  origin: "*",
  methods: "GET,PUT,POST,DELETE,OPTIONS",
  allowedHeaders: "Content-Type,Authorization,Node-RED-API-Version"
},
// Your existing httpNodeCors stays as-is`}</pre>
                  <div style={{ color:C.text, margin:'12px 0 6px' }}>Add to function nodes for live status via MQTT:</div>
                  <pre style={{ fontFamily:"'DM Mono',monospace", background:C.bg, borderRadius:'6px', padding:'12px', color:C.purple, fontSize:'10.5px', lineHeight:'1.8', overflow:'auto' }}>{`// Add to any function node — no extra setup needed:
const _t = Date.now();
node.status({fill:'blue', shape:'dot', text:'processing'});

// ... your code ...

node.status({fill:'green', shape:'dot', text:'done ' + (Date.now()-_t) + 'ms'});
return msg;

// On error:
// node.status({fill:'red', shape:'ring', text: e.message});`}</pre>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
