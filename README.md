# Minder for DeepSeek Harness

这三个 Cordis 插件把 Minder 的文件事务、可审阅记忆和事件收件箱接入 DSH。每个插件只依赖对应的核心包。数据默认写入 `~/.minder`，设置 `MINDER_HOME` 可以指定位置。插件用于所有者独占的本地 DSH profile。

## 安装与启动

开发和验证使用 Node.js 24.9.0 或更高版本、pnpm 10.15.0、DSH 0.2.2-rc.5。使用已经发布到当前注册表的包时，在现有 Web profile 中按需安装。

```sh
dsh plugin --profile web add dsh-plugin-minder-snapshot@0.1.1
dsh plugin --profile web add dsh-plugin-minder-memory@0.1.1
dsh plugin --profile web add dsh-plugin-minder-firewall@0.1.1
dsh --profile web --dump-config
dsh web
```

将上述包名替换成本地 `.tgz` 路径也可以安装。插件及其核心依赖都需要能从该 profile 使用的注册表或本地包路径解析。npm 归档包含 ESM、类型声明、许可证和 Cordis 配置。选择具有原生工具执行器的 DSH 预设使用文件保护。

## 文件事务

在会话里让助手调用 `minder_files` 写入、替换、删除或移动普通文件。同一轮中的多次工具调用共享事务，`minder_file_read` 可以读取暂存内容。文字替换必须恰好匹配一处。每次调用都会返回当前事务编号和逐文件补丁。DSH 确认本轮正常结束后，插件提交全部修改。取消、工具写入失败或会话意外中断会放弃暂存。直接使用 DSH SDK 在会话轮次外调用该工具时，每份操作清单独立提交。

| 直接输入的命令 | 作用 |
| --- | --- |
| `/minder-files list` | 查看保存在此 Minder 数据目录的事务编号 |
| `/minder-files diff ID` | 显示一项事务的文件变化 |
| `/minder-files undo ID` | 按当前工作区权限检查并撤销整项事务 |

保护范围是当前会话的工作目录。只读会话会拒绝写入。独占 profile 允许 DSH 的读取、检索、提问和 Minder 工具。原生 Shell、任意程序执行和其他写入工具会被拒绝。所有者可以在 `minder-snapshot` 的 Cordis 配置中用 `additionalReadOnlyTools` 登记已经核实的第三方只读工具名称。事务开始暂存后，模型使用 `minder_file_read` 读取工作区文本。第三方只读工具如果直接读取磁盘，将看到提交前的内容。DSH 插件和工作区外运行的程序仍有其原有系统权限。

单个大文件的覆盖或删除会要求所有者通过 DSH 确认卡批准，只有元信息会被记录。批量事务和移动操作遇到大文件会中止。多文件 Undo 提供预检和可恢复的逐文件变更，其他进程在执行期间可能看到部分文件已经恢复。外部改动冲突会阻止覆盖。

## 记忆审阅

`minder_memory_propose` 根据当前会话工具调用保存带来源的待审提议。临时状态需要含时区的到期时间。首层会话完成一轮时，插件根据近期可见的用户发言和助手回答生成当天的摘要提议。用 `minder_memory_search` 检索已接受的 Markdown。

| 直接输入的命令 | 作用 |
| --- | --- |
| `/minder-memory diff` | 查看本次会话的新旧内容 |
| `/minder-memory accept KEY` | 仅接受指定项目；省略 KEY 接受当前提议 |
| `/minder-memory discard KEY` | 丢弃指定提议；省略 KEY 丢弃当前会话全部提议 |
| `/minder-memory history`、`/minder-memory revert ID` | 查看历史或撤销一次记忆提交 |
| `/minder-memory reindex` | 编辑 Markdown 后重建搜索索引 |

## 事件与收件箱

在个人 profile 的 `cordis.patch.yml` 中配置需要观察的资料目录或 RSS 地址。目录填写绝对路径。没有配置来源时，插件可以读取相同 `MINDER_HOME` 中已有的事件收件箱。可选的 `ollamaModel` 使用本地 Ollama 提供的模型。

```yaml
- id: minder-firewall
  config:
    directories: []
    feeds: []
    pollSeconds: 60
```

使用 `/minder-firewall settings` 读取规则。例如，输入 `/minder-firewall configure {"quietStart":"22:00","quietEnd":"07:00","timezone":"Asia/Shanghai"}` 设置免打扰时段。用 `/minder-firewall cards` 阅读已分派的卡片或摘要，用 `/minder-firewall accept ID REVISION` 接受该版本的草稿。来源出错可以通过 `/minder-firewall diagnostics` 查看。模型可以读取已分派卡片，修改规则和接受草稿必须使用人类命令。

## 开发与真实宿主验收

把本仓库和 `pi-minder` 放在同一父目录。先构建核心包，开发 workspace 的 overrides 会连接这三个本地包。发行包中的 dependencies 使用精确的 npm 版本。

```sh
pnpm -C ../pi-minder install --frozen-lockfile
pnpm -C ../pi-minder --filter "@minder/core-*" build
pnpm install --frozen-lockfile
pnpm test
pnpm --filter "./packages/*" pack --pack-destination .minder-dev/packs
```

`pnpm test` 使用独立的 DSH home 启动真实 SDK 宿主，在真实会话内测试两次工具调用共享事务、读取暂存内容、拒绝旁路写入、正常提交、取消、失败与撤销。记忆验收检查会话摘要和人工批准。防火墙验收向观察目录写入文件，再确认生成的行动卡。临时数据保存在本仓库忽略的 `.minder-dev/tests`。工具执行器直接接受测试输入，此验收无需调用模型。

将三个 DSH 包和三个核心包发布到本地测试注册表并设置 `MINDER_TEST_REGISTRY` 后，执行 `pnpm run test:installed`。该命令初始化独立的 SDK profile，使用 `dsh plugin add` 安装三个精确版本，校验最终配置，再对安装产物执行相同的宿主测试。

## 发布

分别构建和检查三个 tarball。公开仓库发布时给 GitHub 仓库添加 `dsh-plugin` topic，并在每个包的 repository 元数据中填写真实仓库地址与包的子目录。DSH Plugin Hub 支持 npm 自动发现；发布验收应核对三个包各自的展示页面、版本和安装结果。[DSH 官方打包规范](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish) · [社区 Plugin Hub 说明](https://dshpluginhub.ai/en/docs/first-plugin)

## 许可证

三个 Minder 插件及各自直接依赖的 `@minder/core-snapshot`、`@minder/core-memory`、`@minder/core-firewall` 0.1.1 均采用 MIT 许可证，许可证随包保存在 `LICENSE`。已核实 npm 发行物中 `@deepseek-ai/cordis@4.1.0/LICENSE` 署名 Shigma，DSH 0.2.2-rc.5 的 CLI、tools、commands、sandbox-policy 和 user-questions 包各自的 `LICENSE` 署名 DeepSeek，均采用 MIT 许可证。插件通过 peer dependencies 使用这些宿主组件。再次分发这些组件的源码或编译产物时，保留各包的版权声明与完整许可证。
