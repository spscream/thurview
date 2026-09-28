# What a thurview review contains, where it is stored, and what leaves the machine

Written for a team deciding whether to put thurview in front of their code. Every
answer below names the evidence behind it: a line of source, the output of a
command, or a probe that was run. Where something was read from the code and
never run, it says so in those words. The last section lists what was not
established at all.

## How this was checked

- **Source** read at commit `c5e83c1`. Line references are to that commit.
- **Binary** `thurview 0.17.0`, the published package installed on the machine.
  The shipped `dist/` was checked against every source claim used below: the
  bind default (`dist/server/server.js:364`), the `/file` endpoint
  (`dist/server/server.js:208`), the storage root (`dist/store.js:8`), and the
  absence of any redaction code. They agree. Whether 0.17.0 was built from
  exactly `c5e83c1` was not established, so each claim was confirmed against the
  shipped code one at a time rather than assumed.
- **Probes** ran in a throwaway git repository created for this, deleted
  afterwards, with an isolated `THURVIEW_HOME` so that no existing review was
  touched. Two synthetic markers were planted:
  - `AKIAIOSFODNN7EXAMPLE` — AWS's own documentation example key, never a live
    credential — in `src/config.ts`, a file **inside** the diff;
  - `NOTINDIFF-SYNTHETIC-7f3a2b` in `docs/untouched-notes.txt`, and an exported
    symbol `neverChangedByThisDiff` in `src/untouched-module.ts`, both in files
    the diff **never touches**.

  No real secret was read or used at any point.

## 1. What physically lands in a review

`scaffold` creates `review.md`, `data.yaml`, `map.yaml` and `theme.yaml`. They
are written into thurview's own store, not into the repository: after the whole
probe, `git status --porcelain` in the reviewed working tree printed nothing. **A
review cannot end up in a commit by accident**, because nothing is ever written
inside the repository.

`publish` seals a revision (`src/cli.ts:1292-1310`): it copies those four files
and writes `document.json`, `map.json`, `changes.json`, `coverage.json`,
`theme.json` and `meta.json` beside them.

What each of those actually carries, measured:

| Artefact           | Carries                                                                                            | Evidence                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `changes.json`     | Path, status, added/deleted counts. **No content.**                                                | Measured: `[{"path":"src/config.ts","status":"M","additions":2,"deletions":1,"binary":false}]` |
| `document.json`    | The prose, **and verbatim source for every anchor with a `peek`**                                  | Measured: the marker from a file outside the diff was found here                               |
| `graph/<sha>.json` | Every parseable file path and every symbol name in the **whole repository** at both pinned commits | Measured, see below                                                                            |
| `threads.json`     | The reader's and the agent's comments verbatim                                                     | Measured: a posted comment appeared in the file unchanged                                      |
| the diff itself    | **Not stored.** Rendered from git per request                                                      | Measured, see below                                                                            |

**The diff is not copied anywhere.** After publishing a review whose diff adds
the synthetic AWS key, `grep -rl AKIAIOSFODNN7EXAMPLE` over the entire store
returned nothing. The server recomputes the diff from git on each request
(`/api/reviews/<id>/diff`, `src/server/server.ts:231-253`, which calls
`showFile` at both pins). The review's contents therefore live, for the most
part, where they already lived: in the git repository.

### Files the diff does not include do land in a review

Two separate routes, and the second needs nobody's decision:

**By the author, verbatim.** An anchor with a `peek` names any file at a pinned
commit; `src/document/compile.ts:239-276` resolves it with `git show
<commit>:<path>` and stores the highlighted lines inside `document.json`. The
file does not have to be in the diff. Measured: a peek at
`docs/untouched-notes.txt`, a file the diff never touches, put
`NOTINDIFF-SYNTHETIC-7f3a2b` into `revisions/1/document.json`.

**Automatically, by the code graph.** The graph is built over the whole
repository at both pinned commits before any scoping (`src/coverage.ts:112-118`
describes the repo-wide cap that runs first). Measured: after adding
`src/untouched-module.ts` on the base side only — so that the diff still touched
`src/config.ts` alone — the cached graph held

```text
files: ['src/config.ts', 'src/untouched-module.ts']
{"id": "src/untouched-module.ts:neverChangedByThisDiff", "name": "neverChangedByThisDiff", ...}
```

So **the names of every source file and every symbol in the repository are
written to disk**, whether or not the change touches them. String literal values
are not: grepping the graph for the literal `NOTINDIFF-SYMBOL-9c11de` returned
`0`. Paths and identifiers, not content.

`explain` widens this further by design: its scope defaults to the whole
repository, and its coverage accounts for every in-scope file path
(`src/coverage.ts:145`). That part is read from the code — an explainer's
coverage output was not exercised, because `coverage.json` is `null` for a
review.

## 2. Is anything redacted — no

**Nothing is redacted, filtered or scanned, anywhere, at any stage.** This is the
answer to the question the teams are asking, and it was established by behaviour
as well as by reading.

By code:

- `grep -rniE 'redact|scrub|sanitiz|mask|secret|credential|passwd|password|apikey|api_key'`
  over `src/` — **no matches.**
- The same grep over the shipped `dist/` — **no matches.**
- There is **no ignore list, denylist or allowlist of paths.** The only path
  filters in the codebase are the graph's own language support, its repo-wide
  file cap, and an explainer's scope glob. None of them is about sensitivity.

By behaviour — the decisive part:

- `GET /api/reviews/<id>/diff?path=src/config.ts` returned
  `AKIAIOSFODNN7EXAMPLE` verbatim.
- `GET /api/reviews/<id>/file?path=docs/untouched-notes.txt` returned
  `{"lines":["internal note","NOTINDIFF-SYNTHETIC-7f3a2b"]}` — a file outside the
  diff, served in full.
- A comment body typed by the reader reached the forge payload unchanged
  (section 5).

`publish` validates structure — that anchors resolve, that line ranges exist at
the pinned commit, that fences are ones the renderer knows. **It never looks at
what the content is.** The one thing in the format that mentions a trust
boundary is the `security:` key in `data.yaml`, which is a claim the author
types; it is prose, not a scan, and publishing without it only produces
`"Not assessed"` in the output.

## 3. Where it is stored on disk

- **Root:** `~/.thurview`, overridable with `$THURVIEW_HOME` (`src/store.ts:104`).
- **Outside the repository**, always. Measured: the reviewed working tree stayed
  clean through scaffold, three publishes and a delete.
- **Layout:** `reviews/<uuid>/` holding `review.json`, the four authored files,
  `graph/<sha>.json` per pinned commit and `revisions/<n>/`. Alongside:
  `agents/`, `passes/`, `forge/` and a global `server.json`.
- **Permissions: `0644` on files, `0755` on directories.** thurview passes no
  mode to `writeFile` or `mkdir` (`src/store.ts`, `writeAtomic`), so the files
  get whatever the umask gives; with the common `022` that is world-readable.
  Measured on both the probe store and the default one. **On a shared machine,
  every local user can read every review.**
- **`delete` is complete.** Measured: a store holding 18 files went to zero —
  only the empty `reviews/` directory and the global `server.json` remained.
  `deleteReview` (`src/store.ts`) removes the review directory with its graph
  caches and sealed revisions, and the agent, pass and forge-facts files that
  live outside it.

## 4. Who can reach the server — the decisive finding

**The server binds the tailnet, not just loopback, and has no authentication of
any kind.**

`src/server/server.ts:418`:

```ts
const hosts = opts.hosts ?? ["127.0.0.1", ...tailscaleAddresses()];
```

and `tailscaleAddresses` (`src/server/server.ts:131-142`) returns every IPv4
address on an interface named `tailscale*` or inside `100.64.0.0/10`.

Measured with `ss -ltnp` while a server was up — two listeners, one port:

```text
LISTEN 0 511      127.0.0.1:43381  0.0.0.0:*  users:(("node",pid=…,fd=21))
LISTEN 0 511 <tailnet addr>:43381  0.0.0.0:*  users:(("node",pid=…,fd=22))
```

It is **not** `0.0.0.0`: the local network cannot reach it. It is the tailnet,
which is usually a wider audience than the person at the keyboard. The URL
thurview prints is the MagicDNS name of the host (`src/cli.ts:222-232`), which is
why a handed-over review reads as `http://<host>:<port>/review/<uuid>` rather
than localhost.

**There is no authentication.** Grepping `src/server/server.ts` for
`authoriz|cookie|session|bearer|auth` returns nothing, and so does a grep for any
`Origin` or CORS check. Everything below was measured from the tailnet address
with no credential of any kind:

- **The review id does not have to be guessed.** `GET /api/reviews` lists every
  review on the machine — id, title, the absolute path of the worktree, and the
  pinned commits. Knowing the URL is not the barrier; there is no barrier.
- **Any file at the pinned commits is readable**, through
  `GET /api/reviews/<id>/file` (`src/server/server.ts:254-270`), which takes the
  path and the side as query parameters. It served a file the diff never
  touched. A `.env` committed at either pin would be readable the same way.
- **A second read route serves raw bytes.** `GET /api/reviews/<id>/blob?path=…`
  (`src/server/server.ts:353-369`) returns a file at the head commit
  unrendered. It is narrower than `/file`: only the head side, and only
  extensions on a fixed list of fonts, images and CSS
  (`src/server/server.ts:118-129`), because it exists to serve the fonts and
  images a themed review needs. Measured: it returned a CSS file the diff never
  touched; `src/a.ts` was refused with `path must name a font, image or css
file`. It widens nothing that `/file` does not already allow, but it belongs
  on the list of the surface.
- **The reach is bounded by the commit tree, not the filesystem.** `path=/etc/passwd`
  and `path=../../../../etc/passwd` both returned `not found at head`, because
  the read goes through `git show <commit>:<path>`. There is no directory escape.
  The separate `/assets/` route serves only thurview's own bundled interface and
  strips `..`; measured, `/assets/../../../../etc/passwd` returned the
  application's own page.
- **Writes are unauthenticated too.** A `POST` created a comment thread, which
  was stored; a `DELETE` destroyed an entire review and returned `{"ok":true}`.
- **A change stream, also unauthenticated.** `GET /api/reviews/<id>/events` is a
  server-sent-event stream that fires whenever the review directory changes
  (`src/server/server.ts:340-352`). It carries no content — only the fact and the
  timing of a change.

For a team: **anyone on the tailnet who is permitted by the Tailscale ACL can
list every review on that machine, read any file of the reviewed repository at
the pinned commits, post comments as the reviewer, and delete reviews.** Whether
a given tailnet peer is in fact permitted depends on the Tailscale ACL, which was
not examined — see the last section.

## 5. What leaves the machine

Three channels, checked separately. **Nothing goes to a third party except a
version check.**

### `forge submit` and `forge reply` — to the repository's own forge

Measured by putting a fake `gh` on `PATH` that records its argv and stdin, and
calling the shipped adapter. `submit` produced exactly:

```text
ARGV: api --hostname <the repo's own host> repos/<owner>/<repo>/pulls/7/reviews --method POST --input -
STDIN: {"commit_id":"<head sha>","body":"<the reader's summary>","event":"REQUEST_CHANGES",
        "comments":[{"path":"src/config.ts","line":6,"side":"RIGHT","body":"<the reader's comment>"}]}
```

`reply` produced two GraphQL mutations against the same host, carrying the thread
id and the reply prose.

So what is posted is **the reader's and agent's own prose, plus file paths and
line numbers** — which is what a review comment is. No diff, no file contents, no
graph. The host is the one in the repository's own remote (`--hostname` comes
from the parsed remote, `src/forge/github.ts:130`), so for a team on their own
GitHub Enterprise or GitLab, the review never leaves their forge.

Two caveats worth stating plainly. The prose is passed through **verbatim** — a
key typed into a comment is posted as typed. And path and line anchors are
themselves information about the codebase, disclosed to whoever can read that
change request.

### `update --check` and `update` — to the npm registry

Measured by interposing `fetch` in the running process:

```text
[outbound fetch] GET https://registry.npmjs.org/thurview/latest
[outbound headers] {"accept":"application/json"}
[outbound body] (none)
```

One request, carrying the package name and nothing else. No review content, no
identifier, no repository name. `update` itself then shells out to the package
manager (`npm install -g thurview@latest` or equivalent); the installing path was
not run.

### Telemetry and analytics — none found

- `grep -rliE 'telemetry|analytics|posthog|sentry|mixpanel|amplitude'` over `src/`
  and over the whole shipped package including its SDK — **no matches.**
- Measured with the same interposed `fetch`: `publish` made exactly one outbound
  call, `GET http://127.0.0.1:<port>/api/health` — the local liveness probe.
  `graph impact` made none at all.
- The served page references only same-origin assets: `href="/app.css"` and
  `src="/app.js"`, nothing else. Fonts are bundled.

One opt-in third-party channel exists in the theme format: a theme may declare
`fonts.stylesheets`, which becomes `@import url(...)` in the served CSS
(`src/theme.ts:295`). If an agent derives a theme from a project that uses a
hosted font service, **the reader's browser** will fetch from that service. The
default theme declares none, and the served CSS in the probe contained zero
`@import` rules.

## 6. The `https://claude.ai/artifact/...` documents

**thurview does not produce them.** Grepping the entire repository — every `.ts`,
`.js`, `.mjs`, `.md` and `.json` outside `node_modules` — for
`claude.ai|artifact|anthropic` matches nothing except this document's own
mention of the question.

thurview has exactly two publishing surfaces: the local HTTP server of section 4,
and the forge adapters of section 5. A document at such an address got there by a
separate route the agent used, not through thurview. **For a team choosing
thurview, the review content does not go to that address** — it stays in their
git repository, in `~/.thurview` on the machine, and in whatever comments reach
their own forge.

## 7. What is missing, and roughly what it would cost

Section 2's answer is "nothing is redacted", so this names what could exist.
Scope and place only; none of it is implemented here.

1. **An ignore list.** A path matcher — `.thurviewignore` at the repository root,
   or a key in the `THURVIEW.md` the tool already reads (`src/cli.ts:326`) —
   consulted wherever file content is read. There are three call sites and they
   are narrow: `showFile` in `src/git.ts:84`, which both server endpoints go
   through, and the peek resolution in `src/document/compile.ts:239-276`.
   **Small:** one matcher, three call sites, plus the decision about what an
   ignored file looks like in the UI (absent, or present and refused).

2. **A scan for known secret shapes before `publish`.** `publish` already walks
   every anchor and accumulates rows of errors and warnings
   (`src/cli.ts:1225-1268`); a scanner would run in that same pass, over the
   peeked ranges and over the diff at the pins. **Medium:** the pass itself is
   cheap, the rule set and its false-positive rate are the real work.

3. **Refusing to publish on a match.** Once 2 exists this is one more error row
   in the pass that already fails `publish`, with a flag to override. **Trivial
   on top of 2.**

4. **Not asked for, but larger than all three: the server.** Section 4 is a
   bigger exposure than the absence of redaction, because it needs no secret in
   the code at all. Two shapes, both cheap in code: default `opts.hosts` to
   loopback and make the tailnet an explicit opt-in — `opts.hosts` is already a
   parameter (`src/server/server.ts:418`), so this is a flag and a default; or
   add a shared token to the URL and check it in the request handler. The second
   is more work because the browser app and the `reviewUrl` helper both have to
   carry it.

## What was not established

- **Whether another device on the tailnet actually reaches the port.** What was
  measured is that the socket is bound on the tailnet interface. The Tailscale
  ACL was not examined and no other machine was contacted, deliberately.
- **The GitLab adapter's payload was not run**, only GitHub's. The GitLab shape
  was read from `src/forge/gitlab.ts` and is not reported above as measured.
- **`thurview update` (installing) was not run**, only `update --check`.
- **The browser bundle was not audited.** `app.js` was not read for outbound
  requests; the finding that the page references only same-origin assets comes
  from the served HTML and CSS.
- **Explainer and design documents were not exercised.** Only a review was
  published. The claim that an explainer's coverage lists every in-scope file
  path is read from the code, not measured.
- **Whether the published 0.17.0 is built from `c5e83c1`.** Each cited claim was
  confirmed against the shipped `dist/` individually; the build provenance was
  not.
- **Scale.** The probe repository was tiny. Nothing here says how large the graph
  cache or a sealed revision becomes on a real codebase.
