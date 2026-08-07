import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { nanoid } from "nanoid";
import { sqlite } from "../db/client.js";

export type AgentMode = "agent" | "ask" | "plan";
export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";
export interface AgentPlan { id: string; threadId: string; name: string; overview: string; steps: string[]; todos: Array<{id:string;content:string;status:TodoStatus}>; status: string; createdAt: string; updatedAt: string }
export interface AgentEvent { id:string; threadId:string; runId:string|null; type:string; payload:unknown; createdAt:string }

const now = () => new Date().toISOString();
const parse = <T>(value:string, fallback:T):T => { try { return JSON.parse(value) as T; } catch { return fallback; } };

export function appendAgentEvent(threadId:string, runId:string|null, type:string, payload:unknown): AgentEvent {
  const event = { id:nanoid(), threadId, runId, type, payload, createdAt:now() };
  sqlite.prepare("INSERT INTO chat_agent_events (id,thread_id,run_id,type,payload_json,created_at) VALUES (?,?,?,?,?,?)")
    .run(event.id, threadId, runId, type, JSON.stringify(payload ?? {}), event.createdAt);
  return event;
}
export function listAgentEvents(threadId:string):AgentEvent[] {
  return (sqlite.prepare("SELECT * FROM chat_agent_events WHERE thread_id=? ORDER BY created_at,id").all(threadId) as any[])
    .map(r => ({id:r.id,threadId:r.thread_id,runId:r.run_id,type:r.type,payload:parse(r.payload_json,{}),createdAt:r.created_at}));
}
export function savePlan(plan:AgentPlan):AgentPlan {
  sqlite.prepare(`INSERT INTO chat_plans (id,thread_id,name,overview,steps_json,todos_json,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,overview=excluded.overview,steps_json=excluded.steps_json,todos_json=excluded.todos_json,status=excluded.status,updated_at=excluded.updated_at`)
    .run(plan.id,plan.threadId,plan.name,plan.overview,JSON.stringify(plan.steps),JSON.stringify(plan.todos),plan.status,plan.createdAt,plan.updatedAt);
  return plan;
}
export function getActivePlan(threadId:string):AgentPlan|null {
  const r=sqlite.prepare("SELECT * FROM chat_plans WHERE thread_id=? ORDER BY updated_at DESC LIMIT 1").get(threadId) as any;
  return r ? {id:r.id,threadId:r.thread_id,name:r.name,overview:r.overview,steps:parse(r.steps_json,[]),todos:parse(r.todos_json,[]),status:r.status,createdAt:r.created_at,updatedAt:r.updated_at}:null;
}
export function createCheckpoint(threadId:string,runId:string|null,files:Array<{path:string;oldContent:string|null;newContent:string}>){
  const cp={id:nanoid(),threadId,runId,files,createdAt:now()};
  sqlite.prepare("INSERT INTO chat_checkpoints (id,thread_id,run_id,files_json,created_at) VALUES (?,?,?,?,?)").run(cp.id,threadId,runId,JSON.stringify(files),cp.createdAt);
  return cp;
}
export function listCheckpoints(threadId:string){ return (sqlite.prepare("SELECT * FROM chat_checkpoints WHERE thread_id=? ORDER BY created_at DESC").all(threadId) as any[]).map(r=>({id:r.id,threadId:r.thread_id,runId:r.run_id,files:parse(r.files_json,[]),createdAt:r.created_at})); }
export async function restoreCheckpoint(id:string){
  const r=sqlite.prepare("SELECT * FROM chat_checkpoints WHERE id=?").get(id) as any;
  if(!r) throw new Error("Checkpoint not found");
  const files=parse<Array<{path:string;oldContent:string|null}>>(r.files_json,[]);
  for(const f of files){ if(f.oldContent===null) continue; await mkdir(dirname(f.path),{recursive:true}); await writeFile(f.path,f.oldContent,"utf8"); }
  return {id,threadId:r.thread_id,files:files.map(f=>f.path)};
}
export function createQuestion(threadId:string,runId:string,question:string,options:string[]){ const q={id:nanoid(),threadId,runId,question,options,status:"pending",answer:null,createdAt:now()}; sqlite.prepare("INSERT INTO chat_questions (id,thread_id,run_id,question,options_json,status,answer,created_at) VALUES (?,?,?,?,?,?,?,?)").run(q.id,threadId,runId,question,JSON.stringify(options),q.status,null,q.createdAt); return q; }
export function answerQuestion(id:string,answer:string){ sqlite.prepare("UPDATE chat_questions SET status='answered',answer=?,answered_at=? WHERE id=?").run(answer,now(),id); return sqlite.prepare("SELECT * FROM chat_questions WHERE id=?").get(id); }
export function listQuestions(threadId:string){return sqlite.prepare("SELECT * FROM chat_questions WHERE thread_id=? ORDER BY created_at").all(threadId);}
export function createSubagent(input:{threadId:string;parentRunId:string;name:string;task:string;model:string;background:boolean;childThreadId:string}){const r={id:nanoid(),...input,status:"pending",result:null,error:null,createdAt:now()};sqlite.prepare("INSERT INTO chat_subagent_runs (id,thread_id,parent_run_id,child_thread_id,agent_name,task,status,model_alias,background,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(r.id,r.threadId,r.parentRunId,r.childThreadId,r.name,r.task,r.status,r.model,r.background?1:0,r.createdAt);return r;}
export function updateSubagent(id:string,status:string,result?:string,error?:string){sqlite.prepare("UPDATE chat_subagent_runs SET status=?,result_summary=COALESCE(?,result_summary),error=COALESCE(?,error),started_at=CASE WHEN ?='running' THEN ? ELSE started_at END,completed_at=CASE WHEN ? IN ('completed','failed') THEN ? ELSE completed_at END WHERE id=?").run(status,result??null,error??null,status,now(),status,now(),id);return sqlite.prepare("SELECT * FROM chat_subagent_runs WHERE id=?").get(id);}
export function listSubagents(threadId:string){return sqlite.prepare("SELECT * FROM chat_subagent_runs WHERE thread_id=? ORDER BY created_at").all(threadId);}

export async function waitForQuestion(id:string, timeoutMs=30*60_000):Promise<string>{const started=Date.now();while(Date.now()-started<timeoutMs){const r=sqlite.prepare("SELECT status,answer FROM chat_questions WHERE id=?").get(id) as {status:string;answer:string|null}|undefined;if(r?.status==="answered"&&r.answer)return r.answer;await new Promise(resolve=>setTimeout(resolve,500));}throw new Error("Timed out waiting for question answer");}
