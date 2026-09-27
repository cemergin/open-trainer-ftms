import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "apps", "trainer-lab", "dist");
const dryRun = process.argv.includes("--dry-run");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const gitAuthentication = ["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential"];

function execute(command, args, { cwd = root, allowFailure = false, capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(result.stderr?.trim() || `${command} exited with status ${result.status}.`);
  }
  return result;
}

function output(command, args, options = {}) {
  return execute(command, args, { ...options, capture: true }).stdout.trim();
}

function requireCleanSource(expectedCommit) {
  if (output("git", ["status", "--porcelain", "--untracked-files=all"])) {
    throw new Error("Commit the source changes before publishing. Use --dry-run to check an uncommitted build.");
  }
  if (output("git", ["rev-parse", "HEAD"]) !== expectedCommit) {
    throw new Error("The source commit changed during verification. Run deployment again.");
  }
}

function verifyOutput() {
  for (const page of ["index.html", "lab.html"]) {
    const path = join(dist, page);
    if (!existsSync(path)) throw new Error(`The build is missing ${page}.`);
    const html = readFileSync(path, "utf8");
    for (const [, reference] of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(reference)) continue;
      if (reference.startsWith("/")) {
        throw new Error(`${page} uses a root-relative URL (${reference}); GitHub project sites need relative URLs.`);
      }
      const file = reference.split(/[?#]/, 1)[0];
      if (file && !existsSync(resolve(dist, file))) {
        throw new Error(`${page} references a missing build file: ${file}.`);
      }
    }
  }
}

function pagesSettings(repository) {
  const result = execute("gh", ["api", `repos/${repository}/pages`], { capture: true, allowFailure: true });
  if (result.status === 0) return JSON.parse(result.stdout);
  if (result.stderr.includes("(HTTP 404)")) return null;
  throw new Error(result.stderr.trim() || "Could not read GitHub Pages settings.");
}

function publish(repository, commit, settings) {
  const directory = mkdtempSync(join(tmpdir(), "open-trainer-pages-"));
  const git = (args, options = {}) => execute("git", [...gitAuthentication, ...args], { cwd: directory, ...options });
  try {
    git(["init", "--initial-branch=gh-pages"]);
    git(["remote", "add", "origin", `https://github.com/${repository}.git`]);
    const branch = git(["ls-remote", "--heads", "origin", "refs/heads/gh-pages"], { capture: true }).stdout.trim();
    if (branch) {
      git(["fetch", "--depth=1", "origin", "gh-pages"]);
      git(["reset", "--hard", "FETCH_HEAD"]);
    }
    for (const entry of readdirSync(directory)) {
      if (entry !== ".git") rmSync(join(directory, entry), { recursive: true, force: true });
    }
    cpSync(dist, directory, { recursive: true });
    writeFileSync(join(directory, ".nojekyll"), "");
    if (settings?.cname) writeFileSync(join(directory, "CNAME"), `${settings.cname}\n`);
    git(["add", "--all"]);
    const changed = git(["diff", "--cached", "--quiet"], { allowFailure: true }).status;
    if (changed === 1) {
      const user = JSON.parse(output("gh", ["api", "user"]));
      git([
        "-c", `user.name=${user.name || user.login}`,
        "-c", `user.email=${user.id}+${user.login}@users.noreply.github.com`,
        "commit", "-m", `Deploy ${commit.slice(0, 12)} to GitHub Pages`,
      ]);
      git(["push", "origin", "HEAD:refs/heads/gh-pages"]);
    } else if (changed !== 0) {
      throw new Error("Could not inspect the deployment changes.");
    } else {
      console.log("The gh-pages branch already contains this build.");
    }
    if (!settings) {
      execute("gh", [
        "api", "--method", "POST", `repos/${repository}/pages`,
        "-f", "build_type=legacy", "-f", "source[branch]=gh-pages", "-f", "source[path]=/",
      ], { capture: true });
    }
    const [owner, name] = repository.split("/");
    const siteUrl = settings?.html_url ?? `https://${owner}.github.io/${name.toLowerCase() === `${owner.toLowerCase()}.github.io` ? "" : `${name}/`}`;
    console.log(`Published the build to gh-pages. Site: ${siteUrl}`);
    console.log(`GitHub may take a few minutes to finish deployment. Status: gh api repos/${repository}/pages`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

try {
  const options = process.argv.slice(2);
  if (options.includes("--help")) {
    console.log("Usage: npm run deploy [-- --dry-run]\nChecks, builds, and publishes the app to this repository's gh-pages branch.\n--dry-run runs local checks without requiring a clean commit or writing to GitHub.");
    process.exit(0);
  }
  if (options.some((option) => option !== "--dry-run")) throw new Error("Unknown option. Use --help for usage.");
  const commit = output("git", ["rev-parse", "HEAD"]);
  if (!dryRun) requireCleanSource(commit);
  for (const command of ["typecheck", "test", "build"]) execute(npm, ["run", command]);
  verifyOutput();
  if (dryRun) {
    console.log("Dry run passed: checks, build, and GitHub Pages asset paths are valid. Nothing was published.");
  } else {
    requireCleanSource(commit);
    const repository = JSON.parse(output("gh", ["repo", "view", "--json", "nameWithOwner,isPrivate"]));
    if (repository.isPrivate) throw new Error("This free Pages deployment is configured for public repositories.");
    const settings = pagesSettings(repository.nameWithOwner);
    if (settings && (settings.build_type === "workflow" || settings.source?.branch !== "gh-pages" || settings.source?.path !== "/")) {
      throw new Error("This repository already has a different Pages publishing source. Review its Pages settings before switching to gh-pages /.");
    }
    publish(repository.nameWithOwner, commit, settings);
  }
} catch (error) {
  console.error(`Deployment failed: ${error.message}`);
  process.exitCode = 1;
}
