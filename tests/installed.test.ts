import test from "node:test";
import { exerciseHost } from "./runtime.ts";

for (const module of ["snapshot","memory","firewall"] as const) {
  test("DSH 在独立 profile 中安装并调用 "+module,async()=>{
    if (!process.env.MINDER_TEST_REGISTRY) throw new Error("MINDER_TEST_REGISTRY must point to the release registry.");
    await exerciseHost(process.env.MINDER_TEST_REGISTRY,module);
  });
}

test("DSH 安装三个 npm 发行包并执行真实工具", async () => {
  if (!process.env.MINDER_TEST_REGISTRY) throw new Error("MINDER_TEST_REGISTRY must point to the release registry.");
  await exerciseHost(process.env.MINDER_TEST_REGISTRY);
});
