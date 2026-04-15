import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';

const NR_DEFAULT = process.env.REACT_APP_NR_URL || 'http://localhost:1880';

const TYPE_LABEL = {
  'http in':'INPUT','inject':'INPUT','mqtt in':'INPUT','tcp in':'INPUT',
  'http response':'OUTPUT','mqtt out':'OUTPUT','debug':'OUTPUT','tcp out':'OUTPUT',
  'function':'FUNC','change':'FUNC','switch':'FUNC','template':'FUNC','delay':'FUNC',
  'json':'FUNC','csv':'FUNC','html':'FUNC','split':'FUNC','join':'FUNC',
  'http request':'HTTP','file':'FILE','file in':'FILE',
};
const typeColor = {
  INPUT:'#00e5ff', OUTPUT:'#69ff47', FUNC:'#b388ff', HTTP:'#ffd600', FILE:'#ff9100',
};
const cat = t => TYPE_LABEL[t] || 'FUNC';

// ── Topo sort nodes by wires ───────────────────────────────────────────────
function parseFlows(raw) {
  if (!Array.isArray(raw)) return [];
  const filtered = raw.filter(n =>
    n.type && n.type !== 'tab' && n.type !== 'subflow'
    && n.type !== 'group' && n.type !== 'junction'
    && !n.type.startsWith('ui_') && n.id
  );
  const wiresMap = {};
  filtered.forEach(n => { wiresMap[n.id] = (n.wires||[]).flat().filter(Boolean); });
  const byTab = {};
  filtered.forEach(n => { const t=n.z||'__none__'; if(!byTab[t]) byTab[t]=[]; byTab[t].push(n); });
  const sorted = [];
  Object.values(byTab).forEach(tab => {
    const ids=new Set(tab.map(n=>n.id));
    const ind={};
    tab.forEach(n=>{ ind[n.id]=0; });
    tab.forEach(n=>{ wiresMap[n.id].forEach(t=>{ if(ids.has(t)) ind[t]=(ind[t]||0)+1; }); });
    const q=tab.filter(n=>ind[n.id]===0).sort((a,b)=>(a.x||0)-(b.x||0));
    const vis=new Set(); const out=[];
    while(q.length){
      q.sort((a,b)=>(a.x||0)-(b.x||0));
      const n=q.shift(); if(vis.has(n.id)) continue;
      vis.add(n.id); out.push(n);
      wiresMap[n.id].forEach(tid=>{
        const tgt=tab.find(n=>n.id===tid);
        if(tgt&&!vis.has(tid)){ind[tid]--; if(ind[tid]<=0) q.push(tgt);}
      });
    }
    tab.filter(n=>!vis.has(n.id)).sort((a,b)=>(a.x||0)-(b.x||0)).forEach(n=>out.push(n));
    out.forEach(n=>sorted.push(n));
  });
  return sorted.map(n=>({
    id:n.id, name:n.name||n.type, type:n.type,
    category:cat(n.type), color:typeColor[cat(n.type)]||'#888',
    tabId:n.z, wires:wiresMap[n.id]||[],
    x:n.x||0, y:n.y||100,
    status:'idle', statusText:'', time:null, runs:0, lastMsg:null, execHistory:[],
  }));
}
function parseTabs(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(n=>n.type==='tab').map(t=>({id:t.id,label:t.label||'Flow'}));
}

// ── Parse raw frames from Node-RED /comms WebSocket ──────────────────────
// Node-RED sends frames as JSON arrays of event objects:
//   [{topic:"hb", data:...}, {topic:"debug", data:{...}}, ...]
//   [{topic:"status/nodeId", data:{fill,text,shape}}, ...]
// Multiple events can arrive in one frame.
// The debug msg field is a JSON-stringified object that must be parsed.
function parseSIOFrames(raw) {
  if (typeof raw !== 'string' || !raw) return [];
  // Strip any leading socket.io numeric prefix (e.g. "42", "0", "40")
  const stripped = raw.replace(/^\d+/, '').trim();
  if (!stripped) return [];
  try {
    const parsed = JSON.parse(stripped);
    // Format: [{topic, data}, ...]
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0] && typeof parsed[0] === 'object' && 'topic' in parsed[0]) {
      return parsed;
    }
    // Older socket.io format: ["eventName", data]
    if (Array.isArray(parsed) && parsed.length >= 2 && typeof parsed[0] === 'string') {
      return [{ topic: parsed[0], data: parsed[1] }];
    }
  } catch(_) {}
  return [];
}

// ═══════════════════════════════════════════════════════════════════════════
export function useNodeRed() {
  const [connected,   setConnected]   = useState(false);
  const [nrVersion,   setNrVersion]   = useState(null);
  const [nrUrl,       setNrUrl]       = useState(NR_DEFAULT);
  const [tabs,        setTabs]        = useState([]);
  const [activeTab,   setActiveTab]   = useState(null);
  const [nodes,       setNodes]       = useState([]);
  const [activeEdges, setActiveEdges] = useState(new Set());
  const [logs,        setLogs]        = useState([]);
  const [stats,       setStats]       = useState({ messages:0, errors:0, warnings:0, avgMs:0, totalMs:0, count:0 });
  const [execTimes,   setExecTimes]   = useState([]);
  const [lastEvent,   setLastEvent]   = useState(null);
  const [wsStatus,    setWsStatus]    = useState('disconnected');
  const [bridgeReady, setBridgeReady] = useState(false);

  const urlRef      = useRef(nrUrl);
  const nodesRef    = useRef(nodes);
  const wsRef       = useRef(null);
  const pingRef     = useRef(null);
  const retryRef    = useRef(0);
  const retryTimer  = useRef(null);
  const flowPollRef = useRef(null);
  const lastRevRef  = useRef(null);
  const edgeTimers     = useRef({});
  const nodeTimers     = useRef({});
  const nodeStartTimes = useRef({});  // nodeId → Date.now() when status→running

  urlRef.current   = nrUrl;
  nodesRef.current = nodes;

  // ── Helpers ───────────────────────────────────────────────────────────────
  const addLog = useCallback((level, node, msg, execMs, payload) => {
    setLogs(prev => [{
      id:`${Date.now()}-${Math.random()}`,
      level, node:String(node||''), msg:String(msg||''),
      execMs:execMs??null, payload:payload??null, ts:new Date(),
    }, ...prev].slice(0, 500));
    setStats(prev => {
      const c=prev.count+(execMs!=null?1:0), t=prev.totalMs+(execMs??0);
      return { messages:prev.messages+1,
        errors:level==='error'?prev.errors+1:prev.errors,
        warnings:level==='warn'?prev.warnings+1:prev.warnings,
        totalMs:t, count:c, avgMs:c>0?Math.round(t/c):0 };
    });
    if (execMs!=null) setExecTimes(p=>[...p,{ms:execMs,node:String(node||''),ts:Date.now()}].slice(-80));
  }, []);

  const updateNode = useCallback((id, patch) => {
    setNodes(prev => prev.map(n => {
      if (n.id!==id) return n;
      const execHistory=patch.time!=null?[...(n.execHistory||[]),patch.time].slice(-20):n.execHistory;
      const runs=(patch.status==='done'||patch.status==='error')?(n.runs||0)+1:n.runs;
      return {...n,...patch,execHistory,runs};
    }));
  }, []);

  const activateEdge = useCallback((srcId, tgtId, ttl=1400) => {
    const key=`${srcId}->${tgtId}`;
    if (edgeTimers.current[key]) clearTimeout(edgeTimers.current[key]);
    setActiveEdges(prev=>new Set([...prev,key]));
    edgeTimers.current[key]=setTimeout(()=>{
      setActiveEdges(prev=>{const s=new Set(prev);s.delete(key);return s;});
      delete edgeTimers.current[key];
    }, ttl);
  }, []);

  const scheduleIdle = useCallback((id, ttl=86400000) => {
    if (nodeTimers.current[id]) clearTimeout(nodeTimers.current[id]);
    nodeTimers.current[id]=setTimeout(()=>{
      setNodes(prev=>prev.map(n=>n.id!==id||n.status!=='running'?n:{...n,status:'idle',statusText:''}));
      delete nodeTimers.current[id];
    }, ttl);
  }, []);

  // ── Handle every event arriving on /comms ─────────────────────────────────
  const handleCommsEvent = useCallback((event, data) => {
    if (!event) return;
    setLastEvent({topic:event, ts:new Date()});

    // ── debug node output ───────────────────────────────────────────────────
    // Format: { id, name, property, msg: "<JSON string>", format, z, path }
    // data.z = tab/flow ID — use to scope which nodes to walk
    // data.msg is a JSON-stringified payload string
    if (event === 'debug') {
      const debugId  = String(data?.id   || '');
      const debugName= String(data?.name || 'debug');
      const tabId    = String(data?.z    || '');

      // Parse the msg payload (it is JSON-stringified)
      let msgObj = data?.msg;
      if (typeof msgObj === 'string') {
        try { msgObj = JSON.parse(msgObj); } catch(_) {}
      }
      // Pretty-format: flatten object to readable key: value lines, no JSON brackets
      function prettyFormat(val, depth) {
        if (depth > 4) return String(val);
        if (val === null || val === undefined) return 'null';
        if (typeof val !== 'object') return String(val);
        if (Array.isArray(val)) {
          if (val.length === 0) return '(empty list)';
          return val.map((v,i) => `  ${i+1}. ${prettyFormat(v, depth+1)}`).join('\n');
        }
        const keys = Object.keys(val);
        if (keys.length === 0) return '(empty)';
        return keys.map(k => {
          const v = val[k];
          if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
            return `${k}:\n${Object.keys(v).map(k2=>`    ${k2}: ${prettyFormat(v[k2], depth+2)}`).join('\n')}`;
          }
          return `${k}: ${prettyFormat(v, depth+1)}`;
        }).join('\n');
      }
      const payloadStr = typeof msgObj === 'object' && msgObj !== null
        ? prettyFormat(msgObj, 0)
        : String(msgObj ?? '');

      // ── Walk the FULL upstream chain from this debug node ──────────────
      // Build reverse-wire map for the tab this debug node belongs to
      const tabNodes = nodesRef.current.filter(n => !tabId || n.tabId === tabId);
      // reverseWires[nodeId] = [nodesThatWireToIt]
      const reverseWires = {};
      tabNodes.forEach(n => {
        (n.wires||[]).forEach(tid => {
          if (!reverseWires[tid]) reverseWires[tid] = [];
          reverseWires[tid].push(n.id);
        });
      });

      // BFS backwards from debug node to find full execution chain
      const chain = [];
      const visited = new Set();
      const queue = [debugId];
      while (queue.length > 0) {
        const cur = queue.shift();
        if (visited.has(cur)) continue;
        visited.add(cur);
        chain.push(cur);
        (reverseWires[cur] || []).forEach(srcId => { if (!visited.has(srcId)) queue.push(srcId); });
      }

      // Compute execution time from when the first node in chain started
      const chainStart = Math.min(...chain.map(id => nodeStartTimes.current[id] || Date.now()));
      const execMs = Date.now() - chainStart;
      // Clear start times for this chain
      chain.forEach(id => { delete nodeStartTimes.current[id]; });

      // Log the debug output with execution time
      addLog('debug', debugName, payloadStr, execMs, msgObj);

      // ── Update every node in the chain ────────────────────────────────
      const timeStr = execMs < 2000 ? `${execMs}ms` : `${(execMs/1000).toFixed(1)}s`;

      chain.forEach((id, idx) => {
        const isDebugNode = id === debugId;
        updateNode(id, {
          status: 'done',
          statusText: isDebugNode ? 'output' : `done ${timeStr}`,
          time: isDebugNode ? null : execMs,
          lastMsg: payloadStr.slice(0, 80),
        });
        if (nodeTimers.current[id]) clearTimeout(nodeTimers.current[id]);
        nodeTimers.current[id] = setTimeout(()=>updateNode(id,{status:'idle',statusText:''}), 86400000);
      });

      // ── Animate edges along the chain (in order, with small delay each) ─
      // chain is in reverse order (debug node first), so reverse for animation
      const forward = [...chain].reverse();
      forward.forEach((id, idx) => {
        const nextId = forward[idx + 1];
        if (nextId) {
          setTimeout(() => activateEdge(id, nextId, 1200), idx * 80);
        }
      });

      return;
    }

    // ── node status update ──────────────────────────────────────────────────
    // Fired when any node calls node.status({fill, shape, text})
    // event = "status/<nodeId>"
    if (event.startsWith('status/')) {
      const nodeId = event.slice(7).split('/')[0];
      if (!nodeId) return;

      const fill   = String(data?.fill  || '');
      const text   = String(data?.text  || '');
      const source = data?.source || {};

      // Empty data object means node cleared its status — reset to idle
      if (!fill && !text && Object.keys(data||{}).length === 0) {
        updateNode(nodeId, {status:'idle', statusText:''});
        if (nodeTimers.current[nodeId]) { clearTimeout(nodeTimers.current[nodeId]); delete nodeTimers.current[nodeId]; }
        return;
      }

      // Map fill colour → status
      let status = 'idle';
      if (fill==='red')    status='error';
      if (fill==='yellow') status='warn';
      if (fill==='green')  status='done';
      if (fill==='blue')   status='running';
      const tl = text.toLowerCase();
      if (['sending','processing','requesting','working','loading'].some(h=>tl.includes(h))) status='running';
      if (['done','complete','sent','ok','success'].some(h=>tl.includes(h))&&fill!=='red') status='done';

      const msM  = text.match(/(\d+)\s*ms/i);
      const execMs = msM ? parseInt(msM[1]) : null;

      updateNode(nodeId, {status, statusText:text, ...(execMs?{time:execMs}:{})});

      const node = nodesRef.current.find(n=>n.id===nodeId);
      const name = String(node?.name || source?.name || nodeId);

      if (status==='running') {
        // Record start time for execution timing
        nodeStartTimes.current[nodeId] = Date.now();
        // Message arriving at this node — animate incoming edges
        nodesRef.current.forEach(src=>{
          if ((src.wires||[]).includes(nodeId)) activateEdge(src.id, nodeId, 2000);
        });
        scheduleIdle(nodeId, 86400000);
      }
      if (status==='done'||status==='warn') {
        // Compute execution time if we recorded a start time
        if (!execMs && nodeStartTimes.current[nodeId]) {
          const elapsed = Date.now() - nodeStartTimes.current[nodeId];
          delete nodeStartTimes.current[nodeId];
          if (elapsed > 0 && elapsed < 60000) {
            updateNode(nodeId, { time: elapsed });
            setExecTimes(p => [...p, {ms:elapsed, node:name, ts:Date.now()}].slice(-80));
          }
        }
        // Message leaving this node — animate outgoing edges
        if (node) (node.wires||[]).forEach(t=>activateEdge(nodeId, t, 1400));
        if (nodeTimers.current[nodeId]) { clearTimeout(nodeTimers.current[nodeId]); delete nodeTimers.current[nodeId]; }
      }
      if (status==='error') {
        if (nodeTimers.current[nodeId]) { clearTimeout(nodeTimers.current[nodeId]); delete nodeTimers.current[nodeId]; }
      }

      if (text) addLog(
        status==='error'?'error':status==='warn'?'warn':'info',
        name, text, execMs, data
      );
      return;
    }

    // ── flow deployed ───────────────────────────────────────────────────────
    if (event==='notification/deploy') {
      addLog('info','Runtime',`Flow deployed [${String(data?.type||'full')}] — reloading`,null,null);
      setActiveEdges(new Set());
      setTimeout(()=>fetchFlows(),1200);
      return;
    }

    // ── runtime started ─────────────────────────────────────────────────────
    if (event==='notification/runtime-state') {
      if (data?.state==='start') { addLog('info','Runtime','Flows started',null,null); fetchFlows(); }
      else if (data?.state==='stop') { addLog('warn','Runtime','Flows stopped',null,null); setActiveEdges(new Set()); }
      return;
    }

    // ── inject triggered ────────────────────────────────────────────────────
    if (event.startsWith('inject/')) {
      const nodeId = event.slice(7);
      const node   = nodesRef.current.find(n=>n.id===nodeId);
      updateNode(nodeId, {status:'running', statusText:'triggered'});
      if (node) (node.wires||[]).forEach(t=>activateEdge(nodeId, t, 2000));
      addLog('info', String(node?.name||nodeId), 'Inject triggered', null, null);
      scheduleIdle(nodeId, 86400000);
      return;
    }

    // ── node error ──────────────────────────────────────────────────────────
    if (event==='error'||(event==='comms'&&data?.type==='error')) {
      const nodeId = String(data?.id||data?.source?.id||'');
      const name   = String(data?.name||data?.source?.name||'node');
      const errMsg = String(data?.error?.message||data?.message||JSON.stringify(data||''));
      addLog('error', name, errMsg, null, data);
      if (nodeId) {
        updateNode(nodeId, {status:'error', statusText:errMsg.slice(0,50)});
        if (nodeTimers.current[nodeId]) { clearTimeout(nodeTimers.current[nodeId]); delete nodeTimers.current[nodeId]; }
      }
      return;
    }

    if (['auth','ping','pong'].includes(event)) return;

    // hb = heartbeat from Node-RED — confirms /comms is alive, no action needed
    if (event === 'hb') return;

    // catch-all — log unknown events at debug level so user can see raw data
    const dataStr = typeof data==='object' ? JSON.stringify(data||{}).slice(0,200) : String(data||'');
    if (dataStr) addLog('debug','Node-RED',`[${event}] ${dataStr}`,null,data);
  }, [addLog, updateNode, activateEdge, scheduleIdle]); // fetchFlows added via ref to avoid circular dep

  // ── Fetch flows via REST ──────────────────────────────────────────────────
  const fetchFlows = useCallback(async (url) => {
    const base=(url||urlRef.current).replace(/\/$/,'');
    try {
      try { const i=await axios.get(`${base}/`,{timeout:8000}); setNrVersion(i.data?.version||'connected'); } catch(_){}
      const res=await axios.get(`${base}/flows`,{
        timeout:15000,
        headers:{'Node-RED-API-Version':'v2',Accept:'application/json'},
      });
      const raw=Array.isArray(res.data)?res.data:(res.data?.flows??[]);
      const rev=res.headers?.etag||String(raw.length);
      if (rev!==lastRevRef.current) {
        if (lastRevRef.current!==null) { addLog('info','Runtime','Flow changed',null,null); setActiveEdges(new Set()); }
        lastRevRef.current=rev;
      }
      const newTabs=parseTabs(raw);
      const newNodes=parseFlows(raw);
      setTabs(newTabs);
      setNodes(prev=>{
        const pm={};prev.forEach(n=>{pm[n.id]=n;});
        return newNodes.map(n=>{
          const ex=pm[n.id];
          return ex&&ex.status!=='idle'?{...n,status:ex.status,statusText:ex.statusText,time:ex.time,runs:ex.runs,execHistory:ex.execHistory,lastMsg:ex.lastMsg}:n;
        });
      });
      if (newTabs.length>0) setActiveTab(t=>t||newTabs[0].id);
      addLog('info','Dashboard',`Loaded ${newNodes.length} nodes across ${newTabs.length} tab(s)`,null,null);
      return {ok:true};
    } catch(e) {
      addLog('warn','Dashboard',`Cannot reach Node-RED: ${e.response?`HTTP ${e.response.status}`:e.message}`,null,null);
      return {ok:false};
    }
  }, [addLog]);

  // ── Connect WebSocket to Node-RED /comms ──────────────────────────────────
  const connectWs = useCallback((base) => {
    if (wsRef.current) { try { wsRef.current.onclose=null; wsRef.current.close(); } catch(_){} }
    if (pingRef.current) clearInterval(pingRef.current);
    if (retryTimer.current) clearTimeout(retryTimer.current);

    const wsUrl = base.replace(/^http/,'ws') + '/comms';
    setWsStatus('connecting');
    addLog('info','Connection',`Connecting WebSocket to ${wsUrl}`,null,null);

    let ws;
    try { ws = new WebSocket(wsUrl); }
    catch(e) { addLog('error','Connection','WebSocket init failed: '+e.message,null,null); scheduleRetry(base); return; }
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setWsStatus('connected');
      setBridgeReady(true);
      retryRef.current = 0;
      addLog('info','Connection',`WebSocket connected to ${wsUrl}`,null,null);

      // socket.io CONNECT packet
      try { ws.send('40'); } catch(_) {}

      // Subscribe to all event topics after a short delay
      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        try {
          ws.send('42["subscribe",{"topic":"debug"}]');
          ws.send('42["subscribe",{"topic":"status"}]');
          ws.send('42["subscribe",{"topic":"notification"}]');
          ws.send('42["subscribe",{"topic":"inject"}]');
          ws.send('42["subscribe",{"topic":"error"}]');
        } catch(_) {}
      }, 400);

      // Heartbeat ping every 25s
      pingRef.current = setInterval(()=>{
        if (ws.readyState===WebSocket.OPEN) try { ws.send('2'); } catch(_){}
      }, 25000);
    };

    ws.onmessage = (evt) => {
      const raw = evt.data;
      if (!raw || raw === '3' || raw === '40' || raw === '41' || raw === '2' || raw === '6') return;
      const frames = parseSIOFrames(raw);
      frames.forEach(f => {
        if (f && typeof f.topic === 'string') handleCommsEvent(f.topic, f.data);
      });
    };

    ws.onclose = (e) => {
      setConnected(false);
      setBridgeReady(false);
      if (pingRef.current) clearInterval(pingRef.current);
      if (e.code !== 1000) {
        setWsStatus('disconnected');
        addLog('warn','Connection',`WebSocket closed (${e.code}) — reconnecting`,null,null);
        scheduleRetry(base);
      }
    };

    ws.onerror = () => {
      setWsStatus('error');
      addLog('error','Connection',
        `Cannot connect to ${wsUrl} — ensure httpAdminCors is set in settings.js`,null,null);
    };

    function scheduleRetry(b) {
      if (wsRef.current===ws) {
        const delay=Math.min(3000*Math.pow(2,retryRef.current),30000);
        retryRef.current++;
        addLog('warn','Connection',`Retry in ${Math.round(delay/1000)}s`,null,null);
        retryTimer.current=setTimeout(()=>connectWs(b), delay);
      }
    }
  }, [addLog, handleCommsEvent]);

  // ── Poll /flows every 5s for deploy detection ─────────────────────────────
  const startFlowPoll = useCallback((base) => {
    if (flowPollRef.current) clearInterval(flowPollRef.current);
    flowPollRef.current = setInterval(async()=>{
      try {
        const res=await axios.get(`${base}/flows`,{timeout:5000,headers:{'Node-RED-API-Version':'v2',Accept:'application/json'}});
        const raw=Array.isArray(res.data)?res.data:(res.data?.flows??[]);
        const rev=res.headers?.etag||String(raw.length);
        if (rev!==lastRevRef.current&&lastRevRef.current!==null) {
          lastRevRef.current=rev;
          addLog('info','Runtime','Flow change detected',null,null);
          setActiveEdges(new Set());
          fetchFlows(base);
        }
      } catch(_){}
    }, 5000);
  }, [fetchFlows, addLog]);

  // ── Main connect ──────────────────────────────────────────────────────────
  const connect = useCallback(async (url) => {
    const base=(url||urlRef.current).replace(/\/$/,'');
    // 1. Load flows via REST
    const res = await fetchFlows(base);
    if (!res.ok) {
      setWsStatus('error');
      const delay=Math.min(3000*Math.pow(2,retryRef.current),30000);
      retryRef.current++;
      addLog('warn','Connection',`Retry in ${Math.round(delay/1000)}s`,null,null);
      retryTimer.current=setTimeout(()=>connect(base), delay);
      return;
    }
    // 2. Open /comms WebSocket
    connectWs(base);
    // 3. Poll for deploy changes
    startFlowPoll(base);
  }, [fetchFlows, connectWs, startFlowPoll, addLog]);

  const reconnect = useCallback((url) => {
    const target=(url||nrUrl).replace(/\/$/,'');
    setNrUrl(target); urlRef.current=target;
    retryRef.current=0; lastRevRef.current=null;
    setNodes([]); setTabs([]); setActiveTab(null); setActiveEdges(new Set()); setBridgeReady(false);
    if (wsRef.current) try { wsRef.current.onclose=null; wsRef.current.close(); } catch(_){}
    if (pingRef.current) clearInterval(pingRef.current);
    if (flowPollRef.current) clearInterval(flowPollRef.current);
    if (retryTimer.current) clearTimeout(retryTimer.current);
    addLog('info','Dashboard',`Connecting to ${target}…`,null,null);
    connect(target);
  }, [nrUrl, connect, addLog]);

  const triggerInject = useCallback(async (nodeId) => {
    const base=urlRef.current;
    const node=nodesRef.current.find(n=>n.id===nodeId);
    try {
      addLog('info',String(node?.name||nodeId),'Triggering…',null,null);
      await axios.post(`${base}/inject/${nodeId}`,{},{timeout:12000,headers:{'Node-RED-API-Version':'v2'}});
      updateNode(nodeId,{status:'running',statusText:'triggered'});
      if (node) (node.wires||[]).forEach(t=>activateEdge(nodeId,t,2000));
      scheduleIdle(nodeId, 86400000);
    } catch(e) {
      addLog('error','Dashboard',`Inject failed: ${e.message}`,null,null);
      updateNode(nodeId,{status:'error',statusText:e.message.slice(0,40)});
    }
  }, [addLog, updateNode, activateEdge, scheduleIdle]);

  useEffect(()=>{
    connect();
    return ()=>{
      if (wsRef.current) try { wsRef.current.onclose=null; wsRef.current.close(); } catch(_){}
      if (pingRef.current) clearInterval(pingRef.current);
      if (flowPollRef.current) clearInterval(flowPollRef.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      Object.values(edgeTimers.current).forEach(clearTimeout);
      Object.values(nodeTimers.current).forEach(clearTimeout);
    };
  }, []); // mount only

  const resetAll = useCallback(()=>{
    setNodes(prev=>prev.map(n=>({...n,status:'idle',statusText:'',time:null,runs:0,lastMsg:null,execHistory:[]})));
    setActiveEdges(new Set()); setLogs([]);
    setStats({messages:0,errors:0,warnings:0,avgMs:0,totalMs:0,count:0}); setExecTimes([]);
  }, []);

  const visibleNodes = activeTab ? nodes.filter(n=>n.tabId===activeTab) : nodes;
  return {
    connected, wsStatus, nrVersion, nrUrl,
    tabs, activeTab, setActiveTab,
    nodes:visibleNodes, allNodes:nodes, activeEdges,
    bridgeReady,
    logs, stats, execTimes, lastEvent,
    addLog, updateNode, fetchFlows, reconnect, triggerInject, resetAll,
  };
}
