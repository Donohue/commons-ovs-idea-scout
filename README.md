# ovs-idea-scout

Finds candidate problems for [Open Venture Studio](https://commons.diy/s/open-venture-studio) for task [#1408](https://commons.diy/s/open-venture-studio/t/1408). It keeps them in **its own list**, a Commons Resource named "Scouted venture candidates (automated, unreviewed)".

The reviewed [candidate shortlist](https://commons.diy/s/open-venture-studio/resources/res_b2d52bc18b614e6ab6644f894b328d37) is **read, never written**. The scout reads it only to avoid duplicates. People decide what moves from the scouted list to the shortlist.

## What one run does

1. **Checks identity.** The Commons key must belong to the expected active agent (`claudius-1` by default). The run records the Space's activation-pack version and event cursor as a start receipt.
2. **Reads both lists.** The shortlist, plus the scout's own list once it exists. The scout finds its list by name and by the identity that created it, so no ID needs configuring. Titles and cited URLs from both are used to avoid duplicates.
3. **Gathers leads** from four RSS feeds (GitHub Blog, Open Source Initiative, AI Frontiers, KFF), Hacker News via Algolia, and news via GDELT. It looks back 14 days and takes at most 15 leads from each family.
4. **Scouts with Claude** (`claude-opus-5`) using server-side web search and web fetch. The model must open every source and copy its quote word for word, then return candidates through a strict `submit_candidates` tool. If Claude declines a request, the API retries it on Anthropic's recommended fallback model (`fallbacks: "default"`).
5. **Verifies mechanically.** A cited URL must have appeared in this run's search, fetch, or lead results. The scout then fetches the live page itself and checks that the quote is on it.
   - Unverified sources are dropped. A candidate with no verified source is dropped.
   - Rejected: duplicates, candidates whose sources are all already cited, and candidates with no named problem or no evidence (R1 or R2 = 0).
   - Over-long fields are trimmed rather than rejected.
6. **Publishes at most 3 new candidates to the scout's own list.** The first publishing run creates the list. Later runs add a new version.
   - Each publishing run adds one line to the list's Changelog: the date, the titles, the counts, and a link to the run log.
   - The scout rewrites only its marked sections, so notes people add elsewhere in the list are kept.
   - It re-reads the list immediately before writing and rebuilds on top of any edit that landed meanwhile.
7. **Writes a receipt** (`out/receipt.json`). It holds counts, rejections with reasons, token usage, and the start and end cursors.

**When nothing new clears the bar, it writes nothing** and exits with `HEARTBEAT_OK`. It never posts messages, claims tasks, reviews anything, or edits the shortlist.

## Safety properties

- **Credentials:** the Commons key is sent only to `https://commons.diy`, and redirects are refused. Third-party fetches never carry a credential.
- **Untrusted content:** leads and page text are treated as untrusted data. Before rendering, text is flattened and stripped of `<`, `>`, backticks, and marker strings, so a page cannot forge the section boundaries or inject markup.
- **Run logs are public** when the repository is public. The receipt includes the model's search notes, the titles of rejected candidates, and the reasons they were rejected. It never includes a credential.
- **Quality gate:** if fewer than half of the cited sources verify, the run publishes nothing and exits with code 3.
- **Size guard:** the list stays under 48 KB (the API limit is 50,000 bytes). The oldest entries rotate out but remain in version history.

## Exit codes

| Code | Meaning | What happens in CI |
|---|---|---|
| 0 | Published, or nothing new (`HEARTBEAT_OK`) | green |
| 1 | Unexpected error | red; runs again the next day |
| 2 | Credential missing or rejected, or the credential belongs to the wrong identity | red, **and the workflow disables itself** |
| 3 | Quality gate: too few sources verified | red, nothing published |
| 4 | Model refusal (after the fallback also declined) | red |

## Run locally

```bash
npm install
npm test                                              # unit tests
npm run scout                                         # dry run: writes out/preview.md, publishes nothing
npm run scout -- --fixture test/fixtures/clean.json   # uses a recorded model output instead of calling Claude
npm run scout -- --publish                            # real publish (needs both credentials)
```

**Credentials:**

- **Anthropic:** `ANTHROPIC_API_KEY`.
- **Commons:** `COMMONS_KEY`. Locally, the private `~/.commons/credentials.json` is used instead if its host is `https://commons.diy`.

**Optional overrides:**

- `COMMONS_EXPECTED_HANDLE`
- `COMMONS_SHORTLIST_RESOURCE_ID`
- `COMMONS_SCOUT_RESOURCE_NAME`

## Host it on GitHub Actions

`.github/workflows/idea-scout.yml` runs daily at 13:17 UTC. It can also be started manually.

1. Add the repository secrets. Each command prompts for the value, so it never lands in shell history:
   ```bash
   gh secret set ANTHROPIC_API_KEY
   gh secret set COMMONS_KEY
   ```
2. Trigger a manual dry run from the Actions tab (leave *publish* off) and read the uploaded receipt and preview.
3. Turn on publishing for scheduled runs: `gh variable set SCOUT_PUBLISH --body true`.

**To pause or stop:**

- Back to dry runs: `gh variable set SCOUT_PUBLISH --body false`.
- Stop the schedule: `gh workflow disable idea-scout`.
- Stop publishing immediately: revoke or rotate the Commons key.

## Cost

One measured run (2026-09-11) used about $1.12:

- 18k output tokens;
- 693k cache-read tokens;
- 52k cache-write tokens, at Opus 5 rates.

Web search fees come on top: at most 10 searches, about $0.10. Daily runs cost roughly $35 a month. Dry runs cost the same as publishing runs. The receipt records exact usage for every run.

## Known limits

- **X/Twitter:** X pages return HTTP 402 to automated fetches, so X is not covered.
- **Blocked or JavaScript-rendered pages:** some sites block automated fetches or render content with JavaScript. Quotes from those sites fail verification and are dropped. That is deliberate: an unverifiable quote is never published.
- **What verification proves:** that a quote appears on the cited page, not that it is evidence of the stated need. Boilerplate on a real page would also pass. The model is told to quote evidence of need, and entries are published as unreviewed so a person can judge relevance.
- **GDELT rate limits:** GDELT limits requests by IP and returned HTTP 429 during repeated local runs, even with spacing and a retry. The run continues with whatever leads it got and lists the errors in the receipt.
- **Scores:** the rubric scores are the model's first judgment. Moving a candidate into the shortlist is a decision for people.

## License

MIT. See [LICENSE](LICENSE).
