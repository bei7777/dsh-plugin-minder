import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-tools";

export const name = "minder-standalone-test";
export const inject = ["agents","tools"];

const queries = {
  snapshot: { name:"minder_files", args:{label:"Independent snapshot", operations:[{kind:"write",path:"review.txt",content:"Independent snapshot.\n"}]}, expected:"Independent snapshot.\n" },
  memory: { name:"minder_memory_search", args:{query:"standalone release search"}, expected:"[]" },
  firewall: { name:"minder_firewall_inbox", args:{}, expected:"[]" },
};

export function apply(ctx: Context) {
  async function exercise() {
    const capability = process.env.MINDER_TEST_CAPABILITY as keyof typeof queries;
    assert.ok(Object.hasOwn(queries,capability));
    const workspace = process.env.MINDER_TEST_WORKSPACE!;
    const query = queries[capability];
    for (let attempt=0; attempt<200 && !ctx.tools.get(query.name); attempt++) await delay(50);
    for (const [key,{name}] of Object.entries(queries)) {
      assert.equal(Boolean(ctx.tools.get(name)),key===capability,name);
    }
    const sessionId = randomUUID() as Parameters<typeof ctx.agents.create>[0]["sessionId"];
    const handle = await ctx.agents.create({sessionId,meta:{cwd:workspace}});
    try {
      const {results} = await ctx.tools.execute({agent:handle.agent,signal:AbortSignal.timeout(30000),calls:[{
        type:"tool-call",id:randomUUID() as never,name:query.name,arguments:JSON.stringify(query.args)
      }]});
      const result = results[0].result;
      assert.equal(result.isError,false,JSON.stringify(result));
      if (capability==="snapshot") {
        assert.equal(JSON.parse(String(result.value)).status,"committed");
        assert.equal(await readFile(join(workspace,"review.txt"),"utf8"),query.expected);
      } else assert.equal(result.value,query.expected);
    } finally { await handle.dispose(); }
    return "MINDER_STANDALONE_OK dsh-plugin-minder-"+capability;
  }
  setImmediate(()=>{ void exercise().then(
    result=>process.stdout.write(result+"\n",()=>process.exit(0)),
    error=>process.stderr.write(String(error?.stack ?? error)+"\n",()=>process.exit(1))
  ); });
}
