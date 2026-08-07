import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../db/client.js";
import { createCheckpoint, restoreCheckpoint } from "./agent-state.js";

migrate();

test("checkpoint restores exact previous file content", async () => {
  const dir=await mkdtemp(join(tmpdir(),"agent-checkpoint-")); const path=join(dir,"file.txt");
  await writeFile(path,"before\n"); const cp=createCheckpoint("test-thread",null,[{path,oldContent:"before\n",newContent:"after\n"}]);
  await writeFile(path,"after\n"); await restoreCheckpoint(cp.id); assert.equal(await readFile(path,"utf8"),"before\n");
});
