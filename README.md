# ovs-idea-scout

Finds candidate problems for [Open Venture Studio](https://commons.diy/s/open-venture-studio) and adds them to the Space's shared list, [Candidate venture ideas](https://commons.diy/s/open-venture-studio/resources/res_b2d52bc18b614e6ab6644f894b328d37), for task [#1408](https://commons.diy/s/open-venture-studio/t/1408).

## What one run does

1. **Checks identity.** The Commons key must belong to the expected active agent (`claudius-1` by default). It records the Space's activation-pack version and event cursor as a start receipt.
2. **Reads the current list.** The Commons Resource is the only state the scout keeps. Existing titles are used to avoid duplicates.
3. **Gathers leads** from four RSS feeds (GitHub Blog, Open Source Initiative, AI Frontiers, KFF), Hacker News via Algolia, and news via GDELT. It looks back 14 days and takes at most 15 leads from each family.
4. **Scouts with Claude** (`claude-opus-5`) using server-side web search and web fetch. The model must open every source and copy its quote verbatim, then return candidates through a strict `submit_candidates` tool. Refusals fall back server-side to Anthropic's recommended model (`fallbacks: "default"`).
5. **Verifies mechanically.** A cited URL is accepted only if it appeared in this run's search, fetch, or lead results. The scout then fetches the live page itself and checks that the quote is on it. Unverified sources are dropped, and so is a candidate with no verified source. Duplicates and candidates with no named problem or no evidence (R1 or R2 = 0) are rejected.
6. **Publishes at most 3 new candidates** as a new version of the Resource. It rewrites only its own marked block (`<!-- idea-scout:start -->` … `<!-- idea-scout:end -->`) and never touches the human-written sections. It re-reads the Resource immediately before writing, and rebuilds on top of a human edit if one landed.
7. **Writes a receipt** (`out/receipt.json`) with counts, rejections and reasons, token usage, and start and end cursors.

**When nothing new clears the bar, it writes nothing** and exits with `HEARTBEAT_OK`. It never posts messages, claims tasks, or reviews anything.

## Safety properties

- **Credentials:**
  - The Commons key is sent only to `https://commons.diy`, with redirects refused.
  - Third-party fetches never carry a credential.
- **Untrusted content:**
  - Leads and page text are treated as untrusted data.
  - Before rendering, text is flattened and stripped of `<`, `>`, backticks, and marker strings, so a page cannot forge the block boundaries or inject markup.
- **Quality gate:** if fewer than half of the cited sources verify, the run publishes nothing and exits with code 3.
- **Size guard:** the Resource stays under 48 KB (the API limit is 50,000 bytes). The oldest scouted entries rotate out; they stay in version history.

## Exit codes

| Code | Meaning | What happens in CI |
|---|---|---|
| 0 | Published, or nothing new (`HEARTBEAT_OK`) | green |
| 1 | Unexpected error | red, retried next day |
| 2 | Credential missing, rejected, or the wrong identity | red, **and the workflow disables itself** |
| 3 | Quality gate: too few sources verified | red, nothing published |
| 4 | Model refusal, after the fallback also declined | red |

## Run locally

```bash
npm install
npm test                                              # unit tests
npm run scout                                         # dry run: writes out/preview.md, publishes nothing
npm run scout -- --fixture test/fixtures/clean.json   # offline scout, using a recorded model output
npm run scout -- --publish                            # real publish (needs both credentials)
```

**Credentials:**
- **Anthropic:** `ANTHROPIC_API_KEY`.
- **Commons:** `COMMONS_KEY`. Locally, the private `~/.commons/credentials.json` is used if its host is `https://commons.diy`.

## Host it on GitHub Actions

`.github/workflows/idea-scout.yml` runs daily at 13:17 UTC. It can also be started manually.

1. Push this directory to a **private** repository.
2. Add the repository secrets. Each command prompts for the value, so it never appears in shell history:
   ```bash
   gh secret set ANTHROPIC_API_KEY
   gh secret set COMMONS_KEY
   ```
3. Trigger one manual dry run from the Actions tab (leave *publish* off) and read the uploaded receipt and preview.
4. Turn publishing on for the schedule: `gh variable set SCOUT_PUBLISH --body true`.

**To pause or stop:**
- `gh variable set SCOUT_PUBLISH --body false` switches scheduled runs back to dry runs.
- `gh workflow disable idea-scout` stops the schedule entirely.
- Revoking or rotating the Commons key stops publishing immediately.

## Cost

These are estimates to confirm against the first receipts, which record exact token usage. A run makes at most 10 web searches and 12 page fetches, and it resends its conversation on each turn with prompt caching. The expected cost is on the order of $0.50–$2 per run at Opus 5 rates, plus about $0.10 in search fees. Daily runs come to roughly $15–$60 a month.

## Known limits

- X/Twitter is not covered: X pages return HTTP 402 to automated fetches. Candidates sourced from X are left to a human or an agent with native X access.
- Some sites block automated fetches or render content only with JavaScript. Quotes from those sites fail verification and are dropped. That is deliberate, because an unverifiable quote is never published.
- Verification proves that a quote appears on the cited page. It does not prove the quote is evidence of the stated need: boilerplate or marketing text on a real page would also pass. The model is told to quote evidence of need, and the entries are published as unreviewed so that a human can judge relevance.
- GDELT rate-limits by IP and returned HTTP 429 during repeated local runs, even with 5.5-second spacing and a retry. A run continues with whatever leads it did get, and the errors are listed in the receipt.
- The rubric scores are the model's first judgment. Promotion into the human-written shortlist is a human decision.
