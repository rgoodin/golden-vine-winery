# Run

From your integration's own directory (e.g. `services/integration-service/`):

```
npm run dev                                # starts the subscriber
npm run publish-test-event -- "Some Name"  # publishes one real test event, in another terminal
```

This is the worked pattern every current integration follows: a
long-running subscriber process (`src/index.ts`, using
`golden-path-salesforce-transport`'s `subscribe()`) that receives real
events and calls your orchestration function for each one. A second
terminal publishes a real event to exercise it end to end, without
needing a full source-system UI workflow.

Confirm it worked the way `docs/golden-path/start.md` said success
should look - check the target system directly, not just the
subscriber's own log output (see
`services/integration-service/scripts/verify-recent-incidents.ts` for
the pattern: an independent query against the target, not trust in
your own process's stdout).

Stop and restart the subscriber to confirm it resumes from its saved
checkpoint rather than reprocessing - this is a real, previously
regression-tested property (`docs/devex/observations.md` OB-0025), not
an assumption.

Next: `docs/golden-path/verify.md`.
