# Minder Memory for DeepSeek Harness

Keep accepted memories in local Markdown, review changes proposed by the assistant, and search current notes using SQLite. Active context requires an expiration date. Requires Node.js 24.9 or later and DSH 0.2.2-rc.5.

```sh
dsh plugin --profile web add dsh-plugin-minder-memory
```

Ask the assistant to propose a memory. Use `/minder-memory diff` to read the proposal, then `/minder-memory accept KEY` or `/minder-memory discard KEY`. Use `/minder-memory history` to find a revision and `/minder-memory revert ID` to undo it. Set `MINDER_HOME` to choose the private data directory.
