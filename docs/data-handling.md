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
- **Probes** ran in throwaway git repositories created for this and deleted
  afterwards, each with an isolated `THURVIEW_HOME` so that no existing review
  was touched. Synthetic markers were planted:
  - `AKIAIOSFODNN7EXAMPLE` — AWS's own documentation example key, never a live
    credential — in `src/config.ts`, a file **inside** the diff;
  - `NOTINDIFF-SYNTHETIC-7f3a2b` in `docs/untouched-notes.txt`, and an exported
    symbol `neverChangedByThisDiff` in `src/untouched-module.ts`, both in files
    the diff **never touches**;
  - a marker in a commit body, and a `.env.example` nobody points at, for the
    commit and explainer routes.
- **What was driven.** Reviews and an explainer were scaffolded, published and
  deleted. A server was raised and driven from its tailnet address. The forge
  adapter's `submit` and `reply` were driven against a fake `gh`, and
  `update --check` was run with `fetch` interposed. **No real secret was read or
  used at any point.**
- **This document was reviewed** by a second, independent pass over it and the
  sources, which overturned two of its claims and added three findings. What that
  pass corrected is in the text; what it could not check is in the last section.

## 1. What physically lands in a review

`scaffold` creates `review.md`, `data.yaml`, `map.yaml` and `theme.yaml`. They
are written into thurview's own store, not into the repository: after
scaffolding, three publishes and a delete, `git status --porcelain` in the
reviewed working tree printed nothing. **No part of a review can end up in a
commit by accident.**

That is a claim about the review, not about the tool. One other command does
write inside the working tree: `thurview setup hooks --scope project` creates
`.claude/`, `.codex/` and `.opencode/` there. Measured —

```text
$ thurview setup hooks --scope project
hooks:
  scope: project
  claude:   <repo>/.claude/settings.json
  codex:    <repo>/.codex/hooks.json
  opencode: <repo>/.opencode/plugins/axi-thurview.js
$ git status --porcelain
?? .claude/
?? .codex/
?? .opencode/
```

Those files hold the agent-session wiring, no review content and nothing read
from the code. But they are untracked files in the repository, so a `git add -A`
commits them. Nothing else thurview does writes inside the repository.

`publish` seals a revision (`src/cli.ts:1292-1310`): it copies those four files
and writes `document.json`, `map.json`, `changes.json`, `coverage.json`,
`theme.json` and `meta.json` beside them.

What each of those actually carries, measured:

| Artefact           | Carries                                                                                         | Evidence                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `changes.json`     | Path, status, added/deleted counts. **No content.**                                             | Measured: `[{"path":"src/config.ts","status":"M","additions":2,"deletions":1,"binary":false}]` |
| `document.json`    | The prose, **and verbatim source for every anchor with a `peek`**                               | Measured: the marker from a file outside the diff was found here                               |
| `graph/<sha>.json` | Every parseable, non-skipped file path and symbol name in the repository at both pinned commits | Measured, see below                                                                            |
| `threads.json`     | The reader's and the agent's comments verbatim                                                  | Measured: a posted comment appeared in the file unchanged                                      |
| the diff itself    | **Not stored.** Rendered from git per request                                                   | Measured, see below                                                                            |

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

So **the paths and symbol names of files the change never touches are written to
disk**, with no decision by the author. Three limits keep that short of "the
whole repository": the graph only takes files in a language it has a grammar for,
it skips `node_modules`, `dist`, `build`, `vendor`, `target` and `.git`
(`src/graph.ts:199`), and it stops at `MAX_FILES = 4000`
(`src/graph.ts:216,232`). In the probe, `docs/untouched-notes.txt` was absent
from the graph for exactly that reason. So it is every **parseable, non-skipped**
file, not literally every file.

String literal values do not reach the graph at all: grepping it for the literal
`NOTINDIFF-SYMBOL-9c11de` returned `0`. Paths and identifiers, not content.

### An explainer writes a full repository listing to disk

`explain` is wider than a review, and this was measured rather than read. Its
scope defaults to `**`, the whole repository, and the sealed
`coverage.json` accounts for **every path in scope** — including the files the
graph deliberately skips. In a probe repository of four files:

```text
scope: **
files: {'total': 4, 'inGraph': 1, 'outsideGraph': 3, 'capped': 0}
uncovered: ['.env.example', 'assets/brand.css', 'docs-note.txt']
```

`.env.example` is there not because anyone pointed at it but because it exists.
For an explainer, therefore, **a listing of every file in the repository lands on
disk** and is served by the unauthenticated review endpoint of section 4. Still
paths and not content — but a complete file listing is itself information about a
codebase. `coverage.json` is `null` for a review, so this applies to explainers
only.

## 2. Is anything redacted — no

**Nothing is redacted, filtered or scanned, anywhere, at any stage.** This is the
answer to the question the teams are asking, and it was established by behaviour
as well as by reading.

By code:

- `grep -rniE 'redact|scrub|sanitiz|mask|secret|credential|passwd|password|apikey|api_key'`
  over `src/` — **no matches.**
- The same grep over the shipped `dist/` — **no matches.**
- There is **no ignore list, denylist or allowlist that exists to hold anything
  back.** The codebase does contain path and type filters — the graph's language
  support and its skip list of build directories (`src/graph.ts:199`), its
  repo-wide file cap, an explainer's scope glob, and the fixed extension list the
  `/blob` route serves (`src/server/server.ts:118-129`) — but every one of them
  is about what the tool can parse or render. **None of them is about
  sensitivity, and none can be configured to exclude a path.**

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

It is **not** `0.0.0.0`, so on the machine this was measured on the local network
could not reach it — the second listener was a real `tailscale0` address. **Do not
carry that conclusion to another machine.** The second half of the condition is
`100.64.0.0/10` regardless of interface name, and that is the carrier-grade NAT
range: ISPs hand it out, mobile tethering uses it, and some corporate networks do
too. On a machine whose ordinary `eth0` or `wlan0` holds an address in that
range, thurview would bind its normal network interface and the local network
would reach it. That case was not measured — there is no second machine here to
measure it on — but it follows from the condition as written, so a team should
check their own hosts with
`ip -4 -o addr | awk '$4 ~ /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./'`.

The URL thurview prints is the MagicDNS name of the host
(`src/cli.ts:222-232`), which is why a handed-over review reads as
`http://<host>:<port>/review/<uuid>` rather than localhost.

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
- **Commit messages and authorship go too.** `GET /api/reviews/<id>/commits`
  (`src/server/server.ts:228-230`) returns, for every commit between the pins,
  the subject, the **full commit body**, the author name and the date
  (`src/git.ts:178-203`). Measured: a commit body planted for the probe came back
  verbatim. Commit prose is content nobody thinks of as part of a review.
- **The reach is bounded by the commit tree, not the filesystem.** `path=/etc/passwd`
  and `path=../../../../etc/passwd` both returned `not found at head`, because
  the read goes through `git show <commit>:<path>`. There is no directory escape.
  The separate `/assets/` route serves only thurview's own bundled interface
  (`src/server/server.ts:374-396`), and a traversal attempt against it returned
  the application's own page rather than a file. Note what that particular
  measurement does and does not show: `curl` and the server's own `new URL`
  normalise `..` before routing, so the request never entered the `/assets/`
  branch at all and its `..` filter was not what stopped it. The route's own
  reads are confined to thurview's bundled interface directory, which is why
  there is no escape.
- **Writes are unauthenticated too.** A `POST` created a comment thread, which
  was stored; a `DELETE` destroyed an entire review and returned `{"ok":true}`.
- **The verdict is unauthenticated too**, which is the heaviest of these — its
  own section below.
- **A change stream, also unauthenticated.** `GET /api/reviews/<id>/events` is a
  server-sent-event stream that fires whenever the review directory changes
  (`src/server/server.ts:340-352`). It carries no content — only the fact and the
  timing of a change.

### An unauthenticated peer can approve the change

`POST /api/reviews/<id>/submit` (`src/server/server.ts:314`) records a decision
and, for an approve, flips the review's status. Measured, from the tailnet
address with no credential:

```text
status before: awaiting-review
status after:  accepted
decisions on disk: [{'decision': 'approve', 'revision': 1,
                     'body': 'approved with no credential at all'}]
```

This matters beyond the review itself. `thurview wait` unblocks on a decision,
and `forge pass` builds the change request's payload out of the stored threads
and the latest decision — so a comment and a verdict written by an
unauthenticated peer are what the agent then carries into the team's own pull
request. One brake exists: `forge submit` refuses to post an approve without
`--confirm` (`src/cli.ts:783`). Nothing brakes the local status change, and
nothing brakes a `request-changes` or a comment.

For a team: **anyone on the tailnet who is permitted by the Tailscale ACL can
list every review on that machine, read any file of the reviewed repository at
the pinned commits along with every commit message and author, post comments as
the reviewer, approve or reject the change, and delete reviews.** Whether a given
tailnet peer is in fact permitted depends on the Tailscale ACL, which was not
examined — see the last section.

## 5. What leaves the machine

The three channels that carry review material, checked separately. **Nothing goes
to a third party except a version check.**

Two more outbound channels exist and carry nothing of the review, named here so
the list is not mistaken for exhaustive: `scaffold` runs `git fetch` against
`origin` (`src/cli.ts:897,928`), and `forge status` and `forge prior` call
`gh`/`glab` to read the change request. Both talk to the team's own remote, in
the direction of reading.

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
graph. A multi-line comment adds `start_line` and `start_side`
(`src/forge/github.ts:347-356`); still anchors, still no content.

That `--hostname` is passed at all was measured; **that it carries the
repository's own host is read from the code, not run**: `repoOf` shells out to
`git remote get-url origin` and `parseRemote` takes the host out of that URL
(`src/forge/index.ts:47-48`, `src/forge/github.ts:358-365`). On that reading, a
team on their own GitHub Enterprise or GitLab keeps the review inside their own
forge.

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
  — **no matches.** Over the whole installed package it matches five files, and
  anyone re-checking this should expect them: the SVG attribute `amplitude` in
  `property-information` and `@types/hast`, a syntax-highlighting grammar in
  `@shikijs/langs`, and the phrase "analytics data" in a dependency's README.
  **No telemetry client is present**, in thurview or in its SDK.
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

**thurview does not produce them.** `git grep -niE 'claude\.ai|artifact|anthropic'`
over every tracked file finds two kinds of hit and no third: this document's own
mention of the question, and a comment in `scripts/ci/check-pr-title.sh:14` that
uses the English word "artifact" about a pull request title. There is no client,
no URL and no upload path for such an address anywhere in the codebase.

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

2. **A scan for known secret shapes before `publish`.** `compileDocument`
   (`src/cli.ts:1193-1201`) already walks every anchor and resolves its peek, and
   its diagnostics become the rows counted just after
   (`src/cli.ts:1215-1220`). A scanner belongs there, over the peeked ranges and
   over the diff at the pins. **Medium:** hanging it off that pass is cheap, the
   rule set and its false-positive rate are the real work.

3. **Refusing to publish on a match.** One more `error`-level diagnostic in the
   pass above, which already fails `publish` when `errors` is non-zero
   (`src/cli.ts:1221-1222`), with a flag to override. **Trivial on top of 2.**

4. **Not asked for, but larger than all three: the server.** Section 4 is a
   bigger exposure than the absence of redaction, because it needs no secret in
   the code at all, and because the writes — a comment, and a verdict the agent
   then acts on — are not a disclosure problem but an integrity one. Two shapes,
   both cheap in code: default `opts.hosts` to loopback and make the tailnet an
   explicit opt-in — `opts.hosts` is already a parameter
   (`src/server/server.ts:418`), so this is a flag and a default; or add a shared
   token to the URL and check it in the request handler. The second is more work
   because the browser app and the `reviewUrl` helper both have to carry it. If
   only one thing is done, gating the mutating routes — `submit`, `DELETE`,
   `threads` — is worth more than gating the reads.

## What was not established

- **Whether another device on the tailnet actually reaches the port.** What was
  measured is that the socket is bound on the tailnet interface. The Tailscale
  ACL was not examined and no other machine was contacted, deliberately.
- **Whether a host with a CGNAT address on an ordinary interface exposes the
  server to its local network.** It follows from the bind condition, and section 4
  says so, but there was no such machine to measure it on.
- **The GitLab adapter's payload was not run**, only GitHub's. The GitLab shape
  was read from `src/forge/gitlab.ts` and is not reported above as measured.
- **`thurview update` (installing) was not run**, only `update --check`.
- **The browser bundle was not audited.** `app.js` was not read. Its only
  external URL is the SVG XML namespace, which is not a request, and the page
  references only same-origin assets — but what the interface stores locally and
  what it posts were not examined.
- **Design documents were not exercised.** Reviews and an explainer were
  published; `thurview design` was not run, and it may scope differently.
- **CSRF and DNS rebinding were not tested.** The absence of an `Origin` check is
  established; whether a page in a developer's browser could reach the random
  local port was not measured.
- **Whether the published 0.17.0 is built from `c5e83c1`.** Each cited claim was
  confirmed against the shipped `dist/` individually; the build provenance was
  not.
- **Scale.** The probe repositories were tiny. The `MAX_FILES = 4000` cap and
  graph truncation were read, not exercised, so nothing here says how large a
  graph cache or a sealed revision becomes on a real codebase.

## A defect found along the way

Not a data-handling question, but it was measured and should not be lost.
`/api/reviews/<id>/commits` parses `git log` output with `%x1f` field separators
(`src/git.ts:178-203`) and a multi-line commit body breaks that parse: the
`author` and `date` fields come back empty and the author name and ISO date
appear instead as the first element of the commit's `files` array. Measured on a
commit with a two-paragraph message. It is a display defect rather than an
exposure — the same data, in the wrong field.
