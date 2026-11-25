import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-tools";
import type {} from "@deepseek-ai/dsh-commands";

export const name = "minder-host-probe";
export const inject = ["agents","sessions","tools","commands"];

export function apply(ctx: Context) {
  async function exercise() {
    const workspace = process.env.MINDER_TEST_WORKSPACE!;
    const names = ["minder_files","minder_memory_propose","minder_firewall_inbox"];
    for (let attempt = 0; attempt < 200 && !names.every(n=>ctx.tools.get(n)); attempt++) await delay(50);
    assert.ok(names.every(n=>ctx.tools.get(n)), "Missing Minder tools");
    const sessionId = randomUUID() as Parameters<typeof ctx.agents.create>[0]["sessionId"];
    const handle = await ctx.agents.create({sessionId,meta:{cwd:workspace}});
    const {agent} = handle;
    const signal = AbortSignal.timeout(80000);
    async function run(name: string, args: unknown) {
      const result = await ctx.tools.execute({agent,signal,calls:[{
        type:"tool-call",name,arguments:JSON.stringify(args),id:randomUUID() as never
      }]});
      return result.results[0].result;
    }
    async function command(line: string) {
      const reply = await ctx.commands.execute(agent,line,[],signal);
      assert.ok(reply, line); assert.equal(reply.result.kind,"success",JSON.stringify(reply.result));
      return JSON.parse(reply.result.text!);
    }
    try {
      const file = join(workspace,"notes.md");
      await writeFile(file,"alpha\n");
      agent.session.append("turn/start",{turn:1});
      const edit = await run("minder_files",{label:"Two edits",operations:[
        {kind:"edit",path:"notes.md",oldText:"alpha",content:"beta"}
      ]});
      assert.equal(edit.isError,false,JSON.stringify(edit));
      const staged = await run("minder_file_read",{path:"notes.md"});
      assert.equal(staged.isError,false,JSON.stringify(staged));
      assert.equal(staged.value,"beta\n");
      assert.equal(await readFile(file,"utf8"),"alpha\n");
      const write = await run("minder_files",{label:"Add agenda",operations:[
        {kind:"write",path:"agenda.md",content:"Review the results."}
      ]});
      assert.equal(write.isError,false,JSON.stringify(write));
      const diff = JSON.parse(String(write.value));
      assert.equal(JSON.parse(String(edit.value)).id,diff.id);
      assert.equal(diff.files.length,2);
      await assert.rejects(readFile(join(workspace,"agenda.md")),{code:"ENOENT"});
      agent.session.append("turn/end",{turn:1,reason:{kind:"completed"}});
      await ctx.sessions.flush(agent.session);
      assert.equal(await readFile(file,"utf8"),"beta\n");
      assert.equal((await command("/minder-files undo "+diff.id)).status,"undone");
      assert.equal(await readFile(file,"utf8"),"alpha\n");
      await assert.rejects(readFile(join(workspace,"agenda.md")),{code:"ENOENT"});
      for (const turn of [2,3]) {
        agent.session.append("turn/start",{turn});
        const pending = await run("minder_files",{label:"Unfinished",operations:[
          {kind:"write",path:"notes.md",content:"requires successful completion"}
        ]});
        assert.equal(pending.isError,false,JSON.stringify(pending));
        if (turn === 3) {
          const failed = await run("minder_files",{label:"Unavailable match",operations:[
            {kind:"edit",path:"notes.md",oldText:"missing",content:"invalid"}
          ]});
          assert.equal(failed.isError,true);
        }
        agent.session.append("turn/end",{turn,reason:turn===2?{kind:"aborted",reason:{kind:"user"}}:{kind:"completed"}});
        await ctx.sessions.flush(agent.session);
        assert.equal(await readFile(file,"utf8"),"alpha\n");
      }
      const blocked = await run("write",{file_path:file,content:"discard"});
      assert.equal(blocked.isError,true);
      assert.equal(await readFile(file,"utf8"),"alpha\n");
      const draft = await run("minder_memory_propose",{layer:"episodic",key:"test-review",text:"Reviewed Ada notebooks."});
      assert.equal(draft.isError,false,JSON.stringify(draft));
      const review = await command("/minder-memory diff"); assert.equal(review.length,1);
      await command("/minder-memory accept");
      const hits = await run("minder_memory_search",{query:"notebooks"});
      assert.equal(hits.isError,false,JSON.stringify(hits)); assert.equal(JSON.parse(String(hits.value)).length,1);
      agent.session.append("turn/start",{turn:4});
      agent.session.append("user/message",{
        role:"user",id:randomUUID() as never,source:{kind:"user"},
        content:[{type:"text",text:"Review the Ada design notes today."}]
      },{surfaceOp:"append"});
      agent.session.append("turn/end",{turn:4,reason:{kind:"completed"}});
      await ctx.sessions.flush(agent.session);
      const [episode] = await command("/minder-memory diff");
      assert.match(episode.key,/^episode\//);
      assert.match(episode.after,/Ada design notes/);
      await command("/minder-memory accept "+episode.key);
      const cards = await run("minder_firewall_inbox",{}); assert.equal(cards.isError,false,JSON.stringify(cards));
      assert.deepEqual(JSON.parse(String(cards.value)),[]);
      const watch = await realpath(process.env.MINDER_TEST_WATCH!);
      const rules = {cooldownMinutes:73,rules:[{sourceId:"dir:"+watch,score:5,bypassQuiet:true}]};
      assert.equal((await command("/minder-firewall configure "+JSON.stringify(rules))).cooldownMinutes,73);
      await writeFile(join(watch,"schedule.md"),"Review at 15:00.");
      for (let i=0; i<135; i++) {
        const pending = await run("minder_firewall_inbox",{});
        assert.equal(pending.isError,false,JSON.stringify(pending));
        if (JSON.parse(String(pending.value)).length) break;
        await delay(500);
      }
      const inbox = await command("/minder-firewall cards");
      assert.equal(inbox.length,1);
      const [event] = inbox[0].events;
      assert.equal(event.title,"schedule.md"); assert.equal(event.score,5);
      const receipt = await command("/minder-firewall accept "+event.id+" "+event.revision);
      assert.ok(receipt.text);
      assert.deepEqual(await command("/minder-firewall cards"),[]);
    } finally { await handle.dispose(); }
  }
  setImmediate(() => { void exercise().then(
    () => process.stdout.write("MINDER_HOST_OK\n",()=>process.exit(0)),
    error => process.stderr.write(String(error?.stack ?? error)+"\n",()=>process.exit(1))
  ); });
}
