---
name: ship-pr
description: How changes ship in the Mahjong repo — branch, local checks, commit, PR, wait for CI, merge, sync main. Use this whenever a change in this repo is ready to commit, push, open a PR or merge, and whenever the user says 提交 / 开 PR / 合并 / 上线 / 做完这条, even if they don't mention the workflow. Also covers verifying web-client changes in the browser and validating AI-strength changes with the self-play benchmark.
---

# Shipping a change in Mahjong

The owner reviews work through merged PRs, not local branches, and works in Chinese. Every change goes through the same loop, one PR per item, so each can be understood and reverted on its own.

## 1. Branch from fresh main

```bash
git fetch -q && git checkout -b <short-kebab-name> origin/main
```

Branch from `origin/main`, not the local branch you happen to be on. Earlier PRs may have been merged since, and stacking on an unmerged branch drags its commits into the new PR.

## 2. Make the change and verify it

Run the same checks CI runs (`.github/workflows`), so CI is a formality rather than a discovery:

```bash
pnpm typecheck
pnpm lint
pnpm test                 # or npx vitest run <path> while iterating
pnpm admin:build          # only if apps/admin or admin API types changed
```

When reporting the result, look at the exit status, not just the tail of the output. `pnpm lint | tail` hides lint's exit code.

**Web client changes** (anything under `apps/mobile` that renders): check them in the browser pane at http://localhost:8081. The Expo dev server's file watcher often misses edits in this repo, so the bundle silently stays stale. Restart Expo before looking (stop the old background task, then start it again with `CI=1 pnpm --dir apps/mobile exec expo start --web --port 8081 --offline --clear`). If the change isn't there, fetch the bundle and grep it for a new identifier to tell "not rebuilt" from "doesn't work".

**AI strength changes** (`packages/ai-play/src/policy.ts`): judge them by the benchmark, not by a few hands.

```bash
pnpm ai:bench 4000 expert:intermediate
```

A few hundred games is noise: an 800-game "+1.35" once turned out to be luck. Use at least 4000 games (about ±0.15 base per game), and compare against the old policy run with the same seed. Self-play changes can also expose server timing bugs. Run the server suite a few times (`npx vitest run apps/server`) before concluding a new failure is flaky.

## 3. Commit, push, open the PR

- Commit messages are in English: a summary line, then the why.
- Pull request descriptions are in Chinese. Say what changed, why, and how it was verified, including what could not be verified (for example, needs a real device).
- End commits and PR bodies with the attribution lines given in the current session's instructions (the Co-Authored-By trailer, and the "Generated with Claude Code" line for the PR).

```bash
git commit -m "..." && git push -u origin <branch>
gh pr create --fill-first --body "<中文说明>"
```

If the work came from a numbered review item, say which one (for example, 审查第 9 条).

## 4. Merge only after CI passes

`gh pr merge` does not wait for checks. Merging while CI is pending has already happened here once, and the run was cancelled by the next merge. So:

1. Check once with `gh pr checks <n>`. Don't poll it in a loop, with `sleep`, or with Monitor. While it runs, start the next item on its own branch and check again later.

   Don't turn on GitHub auto-merge (`gh pr merge --auto`) to wait for you either. `main` has no required checks, so a PR already counts as mergeable before CI has run, and auto-merge has nothing to wait for.
2. When it shows `pass`, merge. Don't ask the owner first; they have asked for merging to happen without them:

   ```bash
   gh pr merge <n> --merge
   ```

   If CI failed, fix it on the same branch and push again.
3. If the merge itself is blocked by a permission prompt or classifier, tell the user and give them the exact command instead of retrying.

## 5. Sync main and clean up

```bash
git checkout main && git pull --ff-only
git branch --merged main | grep -vE '^\*|main$' | xargs -r git branch -d
```

## Reporting back

Finish the whole loop (fix, verify, PR, CI, merge, sync) and any follow-ups it turns up before reporting. Don't stop halfway to ask whether to merge or carry on. Stop early only for a CI failure you can't fix, or for a decision that really is the owner's (legal, product trade-offs, real-device tests).

Summarize in Chinese. List each PR as a link (`https://github.com/gangzhao2021/Mahjong/pull/<n>`) with one line on what it did. Say plainly what was verified, what wasn't, and anything that needs a human (a legal decision, a real-device test, a yearly config update).
