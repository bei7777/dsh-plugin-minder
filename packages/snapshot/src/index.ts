import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-commands";
import type {} from "@deepseek-ai/dsh-sandbox-policy";
import type {} from "@deepseek-ai/dsh-user-questions";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { openSnapshot, SnapshotError, type ApprovalDetails, type SnapshotManager, type SnapshotOptions, type SnapshotTransaction } from "@minder/core-snapshot";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const name = "minder-snapshot";
export const inject = ["tools", "sandboxPolicy"];
export interface Config extends Pick<SnapshotOptions, "maxFileBytes" | "maxBytes" | "retentionMs"> {
  additionalReadOnlyTools?: string[];
}

const permitted = new Set(["read", "grep", "glob", "read_image", "ask_user_question", "minder_files", "minder_file_read",
  "minder_memory_search", "minder_memory_propose", "minder_firewall_inbox"]);

export function apply(ctx: Context, config: Config = {}) {
  const home = resolve(process.env.MINDER_HOME || join(homedir(), ".minder"));
  const stateDir = join(home, "snapshot");
  const protectedPaths = [home, process.env.DSH_HOME || join(homedir(), ".dsh")];
  const additional = new Set(config.additionalReadOnlyTools ?? []);
  const turns = new Map<string,{number:number; manager?:SnapshotManager; tx?:SnapshotTransaction; failed?:boolean}>();
  const settling = new Map<string,Promise<unknown>>();
  const errors = new Map<string,unknown>();
  ctx.on("session/event",(session,event) => {
    if (session.header.origin === "subagent") return;
    if (event.type === "turn/start") {
      turns.set(session.id,{number:event.data.turn});
      return;
    }
    if (event.type !== "turn/end") return;
    const entry = turns.get(session.id);
    if (!entry || entry.number !== event.data.turn) return;
    turns.delete(session.id);
    if (!entry.tx || !entry.manager) return;
    const {manager,tx} = entry;
    const result = event.data.reason.kind === "completed" && !entry.failed ? tx.commit() : tx.abort();
    const work = result.catch(error=>{errors.set(session.id,error);}).finally(()=>{
      manager.close();
      if (settling.get(session.id) === work) settling.delete(session.id);
    });
    settling.set(session.id,work);
  });
  ctx.on("session/flush",async session => {
    await settling.get(session.id);
    if (errors.has(session.id)) {
      const failure = errors.get(session.id);
      errors.delete(session.id);
      throw failure;
    }
  });
  ctx.on("session/disposed",session => {
    turns.get(session.id)?.manager?.close();
    turns.delete(session.id);
  });
  ctx.on("tools/result",(exec,result) => {
    const turn = exec.agent && turns.get(exec.agent.session.id);
    if (turn?.tx && result.isError && exec.name === "minder_files") turn.failed = true;
  });
  ctx.effect(()=>async()=>{
    for (const turn of turns.values()) turn.manager?.close();
    await Promise.all(settling.values());
  });
  ctx.tools.guard(call => {
    if (call.agent && turns.get(call.agent.session.id)?.tx && ["read","grep","glob","read_image"].includes(call.name)) {
      return "Use minder_file_read to read the current staged filesystem.";
    }
    return permitted.has(call.name) || additional.has(call.name) ? undefined : "Use minder_files for managed writes. Additional read-only tools may be admitted by the owner.";
  });
  ctx.tools.register(defineTool({
    name:"minder_file_read",description:"Read UTF-8 text from the open task transaction, including its staged changes.",
    parameters:{path:{type:"string",required:true}},
    output:{schema:{type:"string"},render:(_,text)=>[{type:"text",text}]},
    async execute({path},{agent}) {
      const tx = agent && turns.get(agent.session.id)?.tx;
      if (!tx) throw new Error("No active file transaction; use read.");
      const bytes = await tx.read(path);
      return new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);
    }
  }));

  ctx.tools.register(defineTool({
    name: "minder_files",
    description: "Stage writes, edits, moves or deletes for this task. Repeated calls in the same turn share one transaction. A successful turn commits all changes. Returns the transaction ID and File Diff.",
    parameters: {
      label: { type: "string", required: true },
      operations: { type: "array", required: true, items: { type: "object", additionalProperties: false, properties: {
        kind: { type: "string", required: true, enum: ["write", "edit", "remove", "move"] },
        path: { type: "string", required: true }, content: { type: "string" },
        oldText: { type: "string" }, destination: { type: "string" }
      } } }
    },
    output: { schema: { type: "string" }, render: (_, text) => [{ type: "text", text }] },
    async execute({label, operations}, exec) {
      if (!exec.agent || exec.agent.session.header.origin === "subagent") throw new Error("Owner session required.");
      const policy = ctx.sandboxPolicy.resolve({session: exec.agent.session});
      if (policy.mode === "read-only") throw new Error("DSH session is read-only.");
      if (!operations.length) throw new Error("At least one file operation is required.");
      const root = policy.workspaceRoot;
      const pathInRoot = (path: string) => {
        const target = resolve(root, path);
        const inside = relative(root, target);
        if (!inside || isAbsolute(inside) || inside === ".." || inside.startsWith(".." + sep)) throw new Error("Outside the session workspace.");
        for (const protectedDir of protectedPaths) {
          const rel = relative(resolve(protectedDir), target);
          if (!rel || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep))) throw new Error("Protected application state.");
        }
        return target;
      };
      const sessionId = exec.agent.session.id;
      await settling.get(sessionId);
      const turn = turns.get(sessionId);
      if (turn?.failed) throw new Error("A file operation failed; this turn cannot publish any changes.");
      const manager = turn?.manager ?? await openSnapshot({...config, roots: [root], stateDir,
        protectedPaths});
      const reused = Boolean(turn?.tx);
      try {
        const tx = turn?.tx ?? await manager.begin(label);
        if (turn) {turn.tx = tx; turn.manager = manager;}
        try {
        for (const op of operations) {
          exec.signal.throwIfAborted();
          const target = pathInRoot(op.path);
          if (op.kind === "write" && typeof op.content === "string") await tx.write(target, op.content);
          else if (op.kind === "remove") await tx.remove(target);
          else if (op.kind === "move" && op.destination) await tx.move(target, pathInRoot(op.destination));
          else if (op.kind === "edit" && op.oldText && typeof op.content === "string") {
            const buffer = await tx.read(target);
            const before = new TextDecoder("utf-8", {fatal:true, ignoreBOM:true}).decode(buffer);
            const first = before.indexOf(op.oldText);
            if (first < 0 || first !== before.lastIndexOf(op.oldText)) throw new Error("Edit requires one exact text match.");
            await tx.write(target, before.slice(0,first) + op.content + before.slice(first+op.oldText.length));
          } else throw new Error("Missing fields for file operation: " + op.kind);
        }
        exec.signal.throwIfAborted();
        } catch (error) {
          await tx.abort();
          if (turn) {turn.failed = true; turn.tx = undefined; turn.manager = undefined;}
          const first = operations[0];
          if (reused || !(error instanceof SnapshotError) || error.code !== "LARGE_FILE" || operations.length !== 1 ||
            (first.kind !== "remove" && first.kind !== "write")) throw error;
          const confirm = async (details: Readonly<ApprovalDetails>) => {
            const ui = ctx.get("userQuestions");
            if (!ui) return false;
            const approve = "Proceed once", reject = "Cancel", id = "irreversible";
            const question = "This operation exceeds the snapshot limit and cannot be undone.";
            const answer = await ui.ask({agent:exec.agent,signal:exec.signal,questions:[{
              id,question,detail:JSON.stringify(details,null,2),options:[{label:reject},{label:approve}],
              intent:{kind:"approval",approve,reject}
            }]});
            return answer.answers.length === 1 && answer.answers[0].id === id &&
              answer.answers[0].selected.length === 1 && answer.answers[0].selected[0] === approve;
          };
          if (first.kind === "remove") await manager.irreversibleRemove(pathInRoot(first.path),confirm);
          else await manager.irreversibleWrite(pathInRoot(first.path),first.content!,confirm);
          return JSON.stringify({status:"irreversible",path:first.path});
        }
        return JSON.stringify(turn ? await manager.diff(tx.id) : await tx.commit(), null, 2);
      } finally { if (turn?.manager !== manager) manager.close(); }
    }
  }));
  ctx.inject(["commands"], scoped => scoped.commands.register({
    name: "minder-files", description: "List file transactions, view their diffs or undo a transaction.",
    input: {hint: "list | diff ID | undo ID"},
    async handler({rawInput, agent}) {
      const [verb = "list", id, ...rest] = rawInput.trim().split(/\s+/).filter(Boolean);
      const policy = ctx.sandboxPolicy.resolve({session: agent.session});
      if (agent.session.header.origin === "subagent") throw new Error("Owner session required.");
      if (verb === "undo" && policy.mode === "read-only") throw new Error("DSH session is read-only.");
      await settling.get(agent.session.id);
      const mgr = await openSnapshot({...config, roots:[policy.workspaceRoot], stateDir, protectedPaths});
      try {
        if (rest.length || (verb === "list" ? id : !id)) throw new Error("Use list, diff ID or undo ID.");
        const value = verb === "list" ? await mgr.list() : verb === "diff" ? await mgr.diff(id!) :
          verb === "undo" ? await mgr.undo(id!) : undefined;
        if (!value) throw new Error("Unknown file command.");
        return {kind:"success", text:JSON.stringify(value,null,2)};
      } finally { mgr.close(); }
    }
  }));
}
