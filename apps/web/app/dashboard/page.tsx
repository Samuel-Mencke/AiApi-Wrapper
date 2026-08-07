"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { animate } from "animejs";
import { motion } from "motion/react";
import { AlertTriangle, ArrowUpRight, RefreshCw } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageShell } from "@/components/page-shell";
import { Ledger } from "@/components/crucible/ledger";
import { Semaphore, type SemaphoreSegment } from "@/components/crucible/semaphore";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { apiFetch, type ApiEnvelope } from "@/lib/api";
import type { LogRow } from "@/components/logs-table";
import type { ProviderRow } from "@/components/provider-status-card";
import { MODEL_PRICING } from "@model-console/core/pricing";

interface Usage { id:string; label:string; provider?:string; modelAlias?:string; requests:number; errors:number; inputTokens:number; outputTokens:number; totalTokens:number; estimatedCost:number; averageLatencyMs:number; errorRate:number }
interface Hour { time:string; requests:number; errors:number; totalTokens:number; estimatedCost:number; averageLatencyMs:number }
interface KeyHour { time:string; key:string; requests:number; errors:number }
interface AlltimeSummary { totalRequests:number; totalTokens:number; totalCost:number; totalInputTokens:number; totalOutputTokens:number; avgDailyCost:number; dateRange:{ earliest:string|null; latest:string|null } }
interface DailyBreakdown { date:string; requests:number; errors:number; tokens:number; cost:number; inputTokens:number; outputTokens:number }
interface HealthProbe { status:string; latencyMs:number|null; statusCode:number|null; errorMessage:string|null; createdAt:string; fresh:boolean }
interface HealthProvider { name:string; type:string; enabled:boolean; lastProbe:HealthProbe|null }
interface HealthStatus { overall:string; providers:HealthProvider[]; probedAt:string }
interface Stats { requestsToday:number; requestsLast5h:number; totalRequests:number; totalTokens:number; averageLatencyMs:number; errorRate:number; estimatedCost:number; activeProviders:number; requestsOverTime:Hour[]; requestsByApiKeyOverTime:KeyHour[]; usageByProvider:Usage[]; usageByModel:Usage[]; usageByApiKey:Usage[]; alltimeSummary?:AlltimeSummary; dailyBreakdown?:DailyBreakdown[] }
interface Quota { provider:string; status:string; active:boolean; exactProviderResetAt:string|null; estimatedFiveHourResetAt:string|null; lastQuotaEvent:null|{createdAt:string;modelAlias:string;errorCode:string|null;errorMessage:string|null} }
type Health="operational"|"degraded"|"incident"|"idle";
const C={operational:"#45b881",degraded:"#d4a72c",incident:"#e5484d",idle:"#666"};
const money=(n:number)=>`$${n.toFixed(n<10?3:2)}`;
const compact=(n:number)=>Intl.NumberFormat("en",{notation:"compact",maximumFractionDigits:1}).format(n);
const timestamp=(value:string|null|undefined)=>{const time=value?new Date(value).getTime():Number.NaN;return Number.isFinite(time)?time:null};
const dateTime=(value:string|null|undefined)=>{const time=timestamp(value);return time===null?"UNKNOWN":new Date(time).toLocaleString()};
const clock=(value:string|null|undefined)=>{const time=timestamp(value);return time===null?"--:--":new Date(time).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})};

function health(provider:ProviderRow, logs:LogRow[]):Health {
  if(!provider.enabled)return "incident";
  const recent=logs.filter(x=>{const createdAt=timestamp(x.createdAt);return x.provider===provider.name&&createdAt!==null&&Date.now()-createdAt<900000}).slice(0,8);
  if(!recent.length)return "idle";
  const failures=recent.filter(x=>x.status!=="success").length;
  return failures>=3?"incident":failures?"degraded":"operational";
}
function isGemini429(row:LogRow){return /gemini|google/i.test(row.provider)&&row.status!=="success"&&/429|rate|quota/i.test(`${row.errorCode} ${row.errorMessage}`)}
function Counter({value,format=(n:number)=>compact(n)}:{value:number;format?:(n:number)=>string}){
  const ref=useRef<HTMLSpanElement>(null); const reduced=useReducedMotion();
  useEffect(()=>{if(!ref.current)return; if(reduced){ref.current.textContent=format(value);return} const state={n:0}; const a=animate(state,{n:value,duration:900,ease:"out(3)",onUpdate:()=>{if(ref.current)ref.current.textContent=format(state.n)}}); return()=>{a.pause()}},[value,format,reduced]);
  return <span ref={ref}>{format(reduced?value:0)}</span>;
}
function Heading({code,title,link}:{code:string;title:string;link?:string}){return <div className="ops-heading"><span>{code}</span><h2>{title}</h2>{link&&<Link href={link}>OPEN <ArrowUpRight/></Link>}</div>}

export default function DashboardPage(){
  const [stats,setStats]=useState<Stats|null>(null),[providers,setProviders]=useState<ProviderRow[]>([]),[logs,setLogs]=useState<LogRow[]>([]),[quota,setQuota]=useState<Quota|null>(null),[healthStatus,setHealthStatus]=useState<HealthStatus|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState(""),[updated,setUpdated]=useState<Date|null>(null),[probing,setProbing]=useState(false);
  const load=useCallback(async()=>{setLoading(true);try{const [s,p,l,q,h]=await Promise.all([apiFetch<Stats>("/admin/stats"),apiFetch<ApiEnvelope<ProviderRow[]>>("/admin/providers"),apiFetch<ApiEnvelope<LogRow[]>>("/admin/logs"),apiFetch<Quota>("/admin/quota"),apiFetch<HealthStatus>("/admin/health").catch(()=>null)]);setStats(s);setProviders(p.data);setLogs(l.data);setQuota(q);setHealthStatus(h);setError("");setUpdated(new Date())}catch(e){setError(e instanceof Error?e.message:"Control plane unavailable")}finally{setLoading(false)}},[]);
  const probeHealth=useCallback(async()=>{setProbing(true);try{await apiFetch("/admin/health/probe",{method:"POST"});const h=await apiFetch<HealthStatus>("/admin/health");setHealthStatus(h)}catch{}finally{setProbing(false)}},[]);
  useEffect(()=>{load();const id=setInterval(load,30000);return()=>clearInterval(id)},[load]);
  const providerRows=useMemo(()=>providers.map(p=>({p,h:health(p,logs),rows:logs.filter(x=>x.provider===p.name).slice(0,20)})),[providers,logs]);
  const gemini429=logs.filter(isGemini429); const resetAt=quota?.exactProviderResetAt??quota?.estimatedFiveHourResetAt; const resetTime=timestamp(resetAt); const quotaActive=Boolean(quota?.active||(resetTime!==null&&resetTime>Date.now()));
  const incidents=[...(quotaActive?[`Z.AI LIMIT ACTIVE — RESET ${resetAt?dateTime(resetAt):"PENDING"}`]:[]),...(gemini429.length?[`GEMINI 429 DEGRADATION — ${gemini429.length} RECORDED`]:[]),...providerRows.filter(x=>x.h==="incident").map(x=>`${x.p.name.toUpperCase()} UNAVAILABLE`)];
  const modelRows=useMemo(()=>stats?stats.usageByModel.map(u=>{const price=MODEL_PRICING.find(p=>p.model===u.label||p.aliases?.includes(u.label));return {...u,inputPrice:price?.input??0,outputPrice:price?.output??0,retail:price?(u.inputTokens*price.input+u.outputTokens*price.output)/1e6:u.estimatedCost}}).sort((a,b)=>b.estimatedCost-a.estimatedCost):[],[stats]);
  const keyMax=Math.max(1,...(stats?.usageByApiKey.map(k=>k.requests)??[1]));
  if(loading&&!stats)return <PageShell flush><div className="ops-state"><span className="shimmer"/>INITIALIZING OPERATIONS FEED…</div></PageShell>;
  if(!stats)return <PageShell flush><div className="ops-state ops-error">CONTROL PLANE ERROR // {error||"NO DATA"}<button onClick={load}>RETRY</button></div></PageShell>;
  const chart=stats.requestsOverTime.slice(-48).sort((a,b)=>a.time.localeCompare(b.time));
  return <PageShell flush><main className="ops-room">
    <motion.header initial={{opacity:0}} animate={{opacity:1}} className={`incident-rail ${incidents.length?"active":"clear"}`}>
      <span className="incident-code">LIVE / {incidents.length?"INCIDENT":"NOMINAL"}</span><div className="incident-copy">{incidents.length?incidents.join("  ◆  "):"ALL OBSERVED SYSTEMS WITHIN OPERATING PARAMETERS"}</div>
      <span>{updated?.toLocaleTimeString()} LOCAL</span><button onClick={load} disabled={loading}><RefreshCw className={loading?"spin":""}/>SYNC</button>
    </motion.header>
    {error&&<div className="stale-rail"><AlertTriangle/> REFRESH FAILED — DISPLAYING LAST KNOWN TELEMETRY: {error}</div>}
    <section className="kpi-strip">
      <Ledger className="ops-ledger" size="sm" label="REQUESTS / TODAY" value={stats.requestsToday} sparkline={chart.map(x=>x.requests)}/>
      <Ledger className="ops-ledger" size="sm" label="5H FLOW" value={stats.requestsLast5h}/>
      <Ledger className="ops-ledger" size="sm" label="P95 PROXY / AVG MS" value={stats.averageLatencyMs} sparkline={chart.map(x=>x.averageLatencyMs)}/>
      <Ledger className="ops-ledger" size="sm" label="SUCCESS" value={1-stats.errorRate} format="percent" decimals={2}/>
      <Ledger className="ops-ledger" size="sm" label="TOKENS" value={stats.totalTokens}/>
      <Ledger className="ops-ledger" size="sm" label="EST. COST" value={stats.estimatedCost} format="currency" decimals={3}/>
    </section>
    {stats?.alltimeSummary&&(
      <section className="kpi-strip kpi-alltime">
        <Ledger className="ops-ledger" size="sm" label="◈ ALLTIME REQUESTS" value={stats.alltimeSummary.totalRequests}/>
        <Ledger className="ops-ledger" size="sm" label="◈ ALLTIME TOKENS" value={stats.alltimeSummary.totalTokens}/>
        <Ledger className="ops-ledger" size="sm" label="◈ ALLTIME COST" value={stats.alltimeSummary.totalCost} format="currency" decimals={2}/>
        <Ledger className="ops-ledger" size="sm" label="◈ AVG DAILY COST" value={stats.alltimeSummary.avgDailyCost} format="currency" decimals={2}/>
        <Ledger className="ops-ledger" size="sm" label="◈ DAYS ACTIVE" value={timestamp(stats.alltimeSummary.dateRange.earliest)!==null?Math.max(1,Math.ceil((Date.now()-timestamp(stats.alltimeSummary.dateRange.earliest)!)/86400000)):0}/>
        <Ledger className="ops-ledger" size="sm" label="◈ RETAIL VALUE" value={modelRows.reduce((s,r)=>s+r.retail,0)} format="currency" decimals={2}/>
      </section>
    )}
    <section className="primary-grid">
      <div className="request-plane"><Heading code="01" title="REQUEST VELOCITY / 48H" link="/logs"/>
        {chart.length?<div className="main-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chart}><defs><linearGradient id="flow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#45b881" stopOpacity=".24"/><stop offset="1" stopColor="#45b881" stopOpacity="0"/></linearGradient><linearGradient id="tok" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4dabf7" stopOpacity=".18"/><stop offset="1" stopColor="#4dabf7" stopOpacity="0"/></linearGradient></defs><CartesianGrid stroke="#252525" vertical={false}/><XAxis dataKey="time" tickFormatter={clock} stroke="#555" fontSize={9}/><YAxis yAxisId="req" stroke="#555" fontSize={9}/><YAxis yAxisId="tok" orientation="right" stroke="#4dabf7" fontSize={9} tickFormatter={compact}/><Tooltip contentStyle={{background:"#090b0b",border:"1px solid #444",borderRadius:0,fontSize:11}} labelFormatter={v=>dateTime(String(v))}/><Area yAxisId="req" type="stepAfter" dataKey="requests" stroke="#45b881" fill="url(#flow)" strokeWidth={1.5}/><Area yAxisId="req" type="stepAfter" dataKey="errors" stroke="#e5484d" fill="transparent" strokeWidth={1}/><Area yAxisId="tok" type="stepAfter" dataKey="totalTokens" stroke="#4dabf7" fill="url(#tok)" strokeWidth={1}/></AreaChart></ResponsiveContainer></div>:<div className="empty-cell">NO REQUEST TELEMETRY</div>}
      </div>
      <aside className="health-column">
        <div><Heading code="02A" title="QUOTA CLOCK"/><div className={`quota-terminal ${quotaActive?"bad":"good"}`}><b>{quotaActive?"BLOCKED":"AVAILABLE"}</b><span>Z.AI / CODING POOL</span><strong>{quotaActive&&resetAt?dateTime(resetAt):"NO ACTIVE RESET"}</strong><small>{quota?.exactProviderResetAt?"PROVIDER-EXACT TIMESTAMP":quotaActive?"FIVE-HOUR ESTIMATE":"LAST EVENT EXPIRED"}</small></div></div>
        <div><div className="ops-heading"><span>02B</span><h2>PROVIDER HEALTH</h2><button className="control-button ops-probe-btn" onClick={probeHealth} disabled={probing}>{probing?"PROBING…":"PROBE"}</button></div>{healthStatus?.overall&&<div className="health-overall"><i style={{background:C[healthStatus.overall as Health]??C.idle}}/><span>SYSTEM / {healthStatus.overall.toUpperCase()}</span>{healthStatus.probedAt&&<small>probed {clock(healthStatus.probedAt)}</small>}</div>}{providerRows.length?providerRows.map(({p,h,rows})=>{const probe=healthStatus?.providers.find(x=>x.name===p.name)?.lastProbe??null;return <div className="provider-line" key={p.id}><i style={{background:C[h]}}/><b>{p.name}</b><span>{h}</span>{probe&&probe.fresh&&probe.latencyMs!=null&&<small className="probe-lat">{probe.latencyMs}ms</small>}<Semaphore segments={(rows.length?rows.map((r):SemaphoreSegment=>({status:r.status==="success"?"operational":isGemini429(r)?"degraded":"incident",label:clock(r.createdAt),detail:r.errorCode??undefined})):Array.from({length:12},()=>({status:"empty"})))} segmentWidth={4} segmentHeight={13} gap={2} radius={0} pulse={false}/></div>;}):<div className="empty-cell">NO PROVIDERS CONFIGURED</div>} {gemini429.length>0&&<div className="gemini-line">GEMINI 429 <b>DEGRADED</b><span>{clock(gemini429[0]!.createdAt)} LAST</span></div>}</div>
      </aside>
    </section>
    <section className="lower-grid">
      <div><Heading code="03" title="MODEL COST LEDGER"/>{modelRows.length?<div className="table-wrap"><table className="ops-table"><thead><tr><th>MODEL / PROVIDER</th><th>REQ</th><th>IN TOK</th><th>OUT TOK</th><th>$/M IN</th><th>$/M OUT</th><th>REALIZED</th><th>RETAIL VALUE</th></tr></thead><tbody>{modelRows.map(r=><tr key={r.id}><td><b>{r.label}</b><small>{r.provider}</small></td><td>{compact(r.requests)}</td><td>{compact(r.inputTokens)}</td><td>{compact(r.outputTokens)}</td><td>{money(r.inputPrice)}</td><td>{money(r.outputPrice)}</td><td>{money(r.estimatedCost)}</td><td>{money(r.retail)}</td></tr>)}</tbody></table></div>:<div className="empty-cell">NO MODEL COST ACTIVITY</div>}</div>
      <div><Heading code="04" title="API KEY RANK / CONSUMPTION" link="/api-keys"/><div className="key-rank">{stats.usageByApiKey.filter(k=>k.requests>0).sort((a,b)=>b.requests-a.requests).map((k,i)=><div className="key-row" key={k.id}><em>{String(i+1).padStart(2,"0")}</em><div><b>{k.label}</b><span><i style={{width:`${k.requests/keyMax*100}%`}}/></span></div><strong><Counter value={k.requests}/><small> REQ</small></strong><strong>{compact(k.totalTokens)}<small> TOK</small></strong><strong className={k.errorRate?"danger":""}>{(k.errorRate*100).toFixed(1)}%</strong></div>)}{!stats.usageByApiKey.some(k=>k.requests>0)&&<div className="empty-cell">NO API KEY USAGE</div>}</div></div>
    </section>
    <section><Heading code="05" title="LATEST EXECUTION TAPE" link="/logs"/><div className="execution-tape">{logs.slice(0,12).map(r=><div key={r.id}><time>{clock(r.createdAt)}</time><i className={r.status==="success"?"ok":"fail"}/><b>{r.modelAlias}</b><span>{r.provider}</span><span>{r.status==="success"?`${r.latencyMs} MS`:r.errorCode||"FAILED"}</span></div>)}{!logs.length&&<div className="empty-cell">NO EXECUTIONS RECORDED</div>}</div></section>
  </main></PageShell>
}
