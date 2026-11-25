import test from "node:test";
import { exerciseHost } from "./runtime.ts";

test("本地 DSH 宿主读写文件、审阅记忆和配置注意力规则", () => exerciseHost());
