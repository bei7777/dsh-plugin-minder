# Minder Snapshot for DeepSeek Harness

The `minder_files` tool stages ordinary file changes under the session workspace and commits them when the task completes. Inspect or undo a committed task from the same DSH profile. Requires Node.js 24.9 or later and DSH 0.2.2-rc.5.

```sh
dsh plugin --profile web add dsh-plugin-minder-snapshot
```

Use `/minder-files list`, `/minder-files diff ID` and `/minder-files undo ID`. Undo checks for subsequent changes before restoring files. Each path is replaced individually and a journal resumes interrupted transactions. The plugin controls the tools available to the model in this profile. See the repository README for access rules, large-file confirmation, and backup retention.
