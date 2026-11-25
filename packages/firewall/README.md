# Minder Attention Firewall for DeepSeek Harness

Watch configured directories and RSS or Atom subscriptions, archive ordinary events, and review action cards for high-priority events. Rules cover digests, quiet hours, deduplication and cooldowns. Requires Node.js 24.9 or later and DSH 0.2.2-rc.5.

```sh
dsh plugin --profile web add dsh-plugin-minder-firewall
```

Configure `directories` or `feeds` on the `minder-firewall` Cordis entry in your profile. Use `/minder-firewall settings` to inspect rules, `/minder-firewall cards` to review pending items, and `/minder-firewall accept ID REVISION` to accept a local action draft. The repository README includes a working Cordis configuration example.
