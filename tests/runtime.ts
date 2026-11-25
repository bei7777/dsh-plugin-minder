import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { parse } from "yaml";

export async function exerciseHost(registry?: string, standalone?: "snapshot" | "memory" | "firewall") {
  const artifacts = resolve(".minder-dev","tests");
  await mkdir(artifacts,{recursive:true});
  const run = await mkdtemp(join(artifacts,"host-"));
  const workspace = join(run,"workspace");
  await mkdir(workspace);
  const watch = join(run,"inbox-source");
  await mkdir(watch);
  const host = dirname(createRequire(import.meta.url).resolve("@deepseek-ai/dsh/package.json"));
  const env = {...process.env,MINDER_HOME:join(run,"state"),DSH_HOME:join(run,"dsh"),MINDER_TEST_WORKSPACE:workspace,
    DSH_PERMISSION_MODE:"workspace-write",MINDER_TEST_WATCH:watch,MINDER_TEST_CAPABILITY:standalone,
    TMPDIR:run,TMP:run,TEMP:run};
  if (registry) Object.assign(env,{NPM_CONFIG_REGISTRY:registry,npm_config_registry:registry,
    npm_config_auto_install_peers:"false",npm_config_store_dir:join(artifacts,"store")});
  async function dsh(args: string[], timeout: number) {
    const child = spawn(process.execPath,[join(host,"lib","bin.js"),...args],{
      env,stdio:["pipe","pipe","pipe"],timeout
    });
    let output = "";
    child.stdout.on("data",chunk=>{ output += chunk; });
    child.stderr.on("data",chunk=>{ output += chunk; });
    const [code] = await once(child,"close");
    assert.equal(code,0,output);
    return output;
  }
  if (registry) {
    await dsh(["--profile","minder-ci","--from-default-profile","sdk","--dump-config"],30000);
    const modules = standalone ? [standalone] : ["snapshot","memory","firewall"];
    const packages = await Promise.all(modules.map(async module => {
      const manifest = JSON.parse(await readFile(resolve("packages",module,"package.json"),"utf8"));
      return manifest.name+"@"+manifest.version;
    }));
    await dsh(["plugin","--profile","minder-ci","add",...packages],300000);
    const config = await dsh(["--profile","minder-ci","--dump-config"],30000);
    for (const pkg of packages) assert.ok(config.includes(pkg.split("@")[0]),pkg);
    if (standalone) {
      const profile = join(env.DSH_HOME,"profiles","minder-ci");
      const installed = JSON.parse(await readFile(join(profile,"package.json"),"utf8"));
      const bundle = "dsh-plugin-minder-"+standalone;
      assert.deepEqual(installed.dsh.profile.bundles.filter((name: string)=>name.startsWith("dsh-plugin-minder-")),[bundle]);
      const lock = parse(await readFile(join(profile,"pnpm-lock.yaml"),"utf8"));
      const response = await fetch(new URL(bundle,registry),{signal:AbortSignal.timeout(30000)});
      assert.ok(response.ok,bundle+" registry response "+response.status);
      const {versions} = await response.json();
      const version = packages[0].slice(bundle.length+1);
      const {dist} = versions[version];
      assert.equal(new URL(dist.tarball).origin,new URL(registry).origin);
      assert.equal(lock.packages[packages[0]].resolution.integrity,dist.integrity);
      const probe = await dsh(["--profile","minder-ci","--patch",resolve("tests/standalone.patch.yml")],90000);
      assert.ok(probe.includes("MINDER_STANDALONE_OK "+bundle),probe);
      return;
    }
  }
  const result = await dsh(["--profile",registry ? "minder-ci" : "sdk","--patch",
    resolve(registry ? "tests/installed.patch.yml" : "tests/host.patch.yml")],90000);
  assert.match(result,/MINDER_HOST_OK/);
}
