/**
 * The declared review scope: which paths of the repository under review a
 * thurview document is allowed to read.
 *
 * Without one, every route that takes a path reads it at a pinned commit and
 * nothing enumerates what is reviewable, so a `.env`, a keystore or a generated
 * blob committed at either pin is served in full to whoever can reach the
 * server. The scope inverts that default: a path is readable only because the
 * repository said so.
 *
 * Three things follow from where the rules live and what they are for.
 *
 * **The rules are an allowlist, not an ignore list.** An ignore list covers the
 * file types someone remembered; an allowlist makes an unexpected file fail by
 * absence. That is the property that does the work, so `extensions` and
 * `filenames` are what a path must match, and `exclude` only narrows further.
 *
 * **`filenames` is a list of its own beside `extensions`,** because thurview is
 * language-agnostic: `Dockerfile`, `Makefile`, `Jenkinsfile` and a dotfile whose
 * entire name is its suffix have no extension to allow.
 *
 * **`exclude` matches from the first segment of the path, never at any segment.**
 * `src/generated` excludes `src/generated/**` and leaves `lib/src/generated/**`
 * alone. Any-segment matching is right for a tool's own list of build output -
 * `graph.ts`'s SKIP says why it keeps it - and wrong for a rule a person wrote,
 * where "any segment named `test`" silently drops a package whose own name ends
 * in `test`.
 *
 * The rules are read from the repository under review, at the pinned head
 * commit, which means the change request being reviewed can edit them. That is
 * deliberate and it is visible in the diff, but it bounds what this is: a
 * control against putting the wrong file in front of a reviewer by accident,
 * not a boundary that holds against an author who does not want it to.
 */
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { fileExists, showFile } from "./git.js";

/** Where the rules live, at the root of the repository under review. */
export const SCOPE_FILE = "thurview-scope.yaml";

export class ScopeError extends Error {}

const list = z.array(z.string().min(1)).default([]);

const ScopeSchema = z
  .object({
    /** allowed extensions, with or without the leading dot; matched case-insensitively */
    extensions: list,
    /** allowed whole file names, matched exactly - for the extensionless and the dotfiles */
    filenames: list,
    /** directory paths excluded from the first segment of the path, not at any segment */
    exclude: list,
  })
  .strict()
  .refine((s) => s.extensions.length > 0 || s.filenames.length > 0, {
    message:
      "declare at least one entry under `extensions` or `filenames`: an allowlist that allows nothing hides the whole repository",
  });

export interface ReviewScope {
  /** whether the repository declared rules at all; false means every path is readable, as before */
  declared: boolean;
  extensions: string[];
  filenames: string[];
  exclude: string[];
  /**
   * Cache key for anything derived under this scope. A code graph or a symbol
   * index built while one set of rules was in force must never answer for
   * another, or a narrowed scope keeps serving the paths it just excluded.
   */
  digest: string;
  inScope(path: string): boolean;
  /** one line naming the rules, for `publish`, `scaffold` and the reader's page */
  verdict: string;
}

/** Nothing declared: every path at the pins is readable, which is thurview's behaviour without a scope file. */
export const OPEN_SCOPE: ReviewScope = {
  declared: false,
  extensions: [],
  filenames: [],
  exclude: [],
  digest: "open",
  inScope: () => true,
  verdict: `no ${SCOPE_FILE} at the pinned head commit: every path is readable`,
};

/**
 * The path as the rules see it, canonical and idempotent. Segment-wise rather
 * than by stripping prefixes: `git show <rev>:<path>` resolves any number of
 * leading `./`, so a matcher that strips one of them answers about a different
 * path than git reads, and `././secrets/key.css` walks past an `exclude` that
 * holds `secrets/key.css` out. `..` is kept, and refused where it is read.
 */
function clean(path: string): string {
  return path
    .split("/")
    .filter((s) => s !== "" && s !== ".")
    .join("/");
}

function extensionOf(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * Build a scope from already-parsed rules. Exported so the matcher can be unit
 * tested without a git repository behind it.
 */
export function makeScope(raw: unknown): ReviewScope {
  const parsed = ScopeSchema.safeParse(raw ?? {});
  if (!parsed.success)
    throw new ScopeError(
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
    );
  const extensions = [
    ...new Set(parsed.data.extensions.map((e) => e.replace(/^\./, "").toLowerCase())),
  ].sort();
  // An entry that cannot match anything has to be refused where it is written.
  // These two lists fail closed, so a typo in them hides files rather than
  // exposing them - but it hides them while the verdict claims a rule is in
  // force, and "1 extension" that matches nothing is not a rule.
  for (const e of extensions) {
    if (/[*?[\]/]/.test(e))
      throw new ScopeError(
        `extensions: "${e}" is a glob or a path, and extensions takes a bare suffix (write "ts", not "*.ts")`,
      );
    if (e.includes("."))
      throw new ScopeError(
        `extensions: "${e}" holds a dot, and only the last suffix of a name is matched (write "gz", not "tar.gz")`,
      );
  }
  const filenames = [...new Set(parsed.data.filenames)].sort();
  for (const f of filenames)
    if (f.includes("/"))
      throw new ScopeError(
        `filenames: "${f}" is a path, and filenames matches a whole file name anywhere in the tree (write "Dockerfile", not "src/Dockerfile")`,
      );
  const exclude = [...new Set(parsed.data.exclude.map(clean))].sort();
  for (const e of exclude) {
    if (!e) throw new ScopeError("exclude: an empty path excludes the whole repository");
    // A glob here would read as working and quietly match nothing: the rule is
    // positional by design, so say so rather than accept `**/test` and drop it.
    if (/[*?[\]]/.test(e))
      throw new ScopeError(
        `exclude: "${e}" is a glob, and exclude takes a directory path matched from the first segment (write "app/src/test", not "**/test")`,
      );
    if (e.split("/").includes("..")) throw new ScopeError(`exclude: "${e}" leaves the repository`);
  }
  const digest = createHash("sha256")
    .update(JSON.stringify({ extensions, filenames, exclude }))
    .digest("hex")
    .slice(0, 12);
  const inScope = (path: string): boolean => {
    const p = clean(path);
    if (!p) return false;
    // A path that climbs out of the repository is nothing the rules can allow.
    // `git show` refuses these itself, so this is the belt to that braces.
    if (p.split("/").includes("..")) return false;
    // The rules themselves are always readable. A reviewer told a file was
    // withheld has to be able to read the rule that withheld it, and that rule
    // is part of the change request under review.
    if (p === SCOPE_FILE) return true;
    for (const dir of exclude) if (p === dir || p.startsWith(`${dir}/`)) return false;
    const name = p.split("/").pop() ?? p;
    if (filenames.includes(name)) return true;
    const ext = extensionOf(p);
    return ext !== "" && extensions.includes(ext);
  };
  const parts = [
    extensions.length
      ? `${extensions.length} extension${extensions.length === 1 ? "" : "s"}`
      : null,
    filenames.length ? `${filenames.length} file name${filenames.length === 1 ? "" : "s"}` : null,
    exclude.length
      ? `${exclude.length} excluded director${exclude.length === 1 ? "y" : "ies"}`
      : null,
  ].filter(Boolean);
  return {
    declared: true,
    extensions,
    filenames,
    exclude,
    digest,
    inScope,
    verdict: `${SCOPE_FILE} allows ${parts.join(", ")}; every other path is withheld`,
  };
}

/**
 * Whether a changed file may be shown at all. A rename is readable only when
 * both of its sides are: the diff's "before" is the content of `oldPath`, so a
 * `git mv secrets/token.ts src/token.ts` under `exclude: [secrets]` would list
 * an allowed path whose diff is an excluded file. Withhold the whole change and
 * count it as withheld, which is what `/diff` already answers for it.
 */
export function changeInScope(scope: ReviewScope, c: { path: string; oldPath?: string }): boolean {
  return scope.inScope(c.path) && (!c.oldPath || scope.inScope(c.oldPath));
}

/** The rules a published revision was sealed under, as `meta.json` records them. */
export interface SealedRules {
  declared: boolean;
  extensions: string[];
  filenames: string[];
  exclude: string[];
}

/**
 * Whether every path `sealed` allowed is still allowed now. A revision holds only
 * what the rules in force when it was published let in, so when the rules since
 * widened there is nothing in it the rules in force would withhold, and refusing
 * it would cost the reader the history for nothing. Narrowing is the case the
 * refusal exists for, and it stays refused.
 */
export function allowsEverything(now: ReviewScope, sealed: SealedRules): boolean {
  // A revision sealed with no rules declared holds whatever the repository had,
  // so only an equally open scope can be trusted to serve it.
  if (!sealed.declared) return !now.declared;
  if (!now.declared) return true;
  const covers = (mine: string[], theirs: string[]) => theirs.every((x) => mine.includes(x));
  if (!covers(now.extensions, sealed.extensions)) return false;
  if (!covers(now.filenames, sealed.filenames)) return false;
  // Every directory excluded now must already have been excluded then, or this
  // scope withholds something the revision was allowed to seal.
  return now.exclude.every((dir) =>
    sealed.exclude.some((s) => dir === s || dir.startsWith(`${s}/`)),
  );
}

const cache = new Map<string, ReviewScope | ScopeError>();

/**
 * The scope declared at `commit` in the repository at `cwd`. Read from git
 * rather than from the working tree, so the rules are the ones the reviewed
 * commit carries and cannot drift under the reader while a branch is checked
 * out beneath a running server.
 *
 * A file that is present but malformed throws rather than falling back to an
 * open scope: a scope that is declared and silently not applied is worse than
 * none, because it reads as an assurance.
 */
export async function scopeAt(cwd: string, commit: string): Promise<ReviewScope> {
  const key = `${cwd}@${commit}`;
  const hit = cache.get(key);
  if (hit) {
    if (hit instanceof ScopeError) throw hit;
    return hit;
  }
  const text = await showFile(cwd, commit, SCOPE_FILE);
  let value: ReviewScope | ScopeError;
  if (text === null) {
    // `showFile` answers null for "no such path" and for any git failure alike,
    // and the second must not read as "this repository declared nothing": in a
    // partial clone missing exactly this blob that would open the whole tree.
    value = (await fileExists(cwd, commit, SCOPE_FILE))
      ? new ScopeError(
          `${SCOPE_FILE} exists at ${commit.slice(0, 8)} but git would not read it; refusing to review as if no rules were declared`,
        )
      : OPEN_SCOPE;
  } else {
    try {
      value = makeScope(parseYaml(text) ?? {});
    } catch (e) {
      value =
        e instanceof ScopeError
          ? e
          : new ScopeError(`${SCOPE_FILE} is not valid YAML: ${(e as Error).message}`);
    }
  }
  cache.set(key, value);
  if (value instanceof ScopeError) throw value;
  return value;
}
