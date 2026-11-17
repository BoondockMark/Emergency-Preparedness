import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => Object.assign(Error(message), { status: 409 });
export function githubRemote(value) {
  const match = value.trim().match(/^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  if (!match || match[1] === '.' || match[2] === '.') throw fail('Origin must be a GitHub HTTPS or SSH remote without embedded credentials.');
  return `${match[1]}/${match[2]}`;
}
export function runGitCommand(command, args, { cwd, input, env = {}, label = command } = {}) {
  return new Promise((resolve, reject) => {
    const environment = { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1', GCM_INTERACTIVE: 'never', ...env };
    const child = execFile(command, args, { cwd, env: environment, timeout: 45_000, maxBuffer: 2_000_000, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) reject(fail(error.code === 'ENOENT' ? `${command} is not installed. Install it, then try again.` : command === 'gh' ? githubFailure(error, stderr, environment) : command === 'git' ? gitFailure(error, args, stderr, environment, label) : `${label} failed. Check repository access and Git/GitHub CLI setup, then retry. Your saved files are preserved.`));
      else resolve(stdout);
    });
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}

export function gitFailure(error, args, stderr = '', environment = {}, label = 'git') {
  const step = label === 'git' ? `git ${args[0]}` : `${label} (git ${args[0]})`;
  let help;
  if (error.killed) help = 'The command timed out. Check the connection for network commands, then retry.';
  else if (/not a git repository/i.test(stderr)) help = 'Run the editor from the handout library’s Git checkout.';
  else if (/dubious ownership|unsafe repository/i.test(stderr)) help = 'Git does not trust this checkout’s ownership. Review the ownership and Git safe.directory configuration on the machine running the editor.';
  else if (/unable to auto-detect email|identity unknown|empty ident name/i.test(stderr)) help = 'Configure git config user.name and git config user.email in this checkout.';
  else if (/authentication failed|could not read Username|terminal prompts disabled|permission denied \(publickey\)/i.test(stderr)) help = 'Git transport authentication failed. GitHub CLI access alone does not configure Git. For HTTPS, run gh auth setup-git --hostname github.com, then retry.';
  else if (args[0] === 'merge-base' && error.code === 1 && !stderr.trim()) help = 'The local checkout and GitHub base branch have no common commit available. Check for a shallow checkout or unrelated history before syncing.';
  else if (/unknown (?:option|switch)|unrecognized option/i.test(stderr)) help = 'Check git --version and update Git for Windows or your Git installation, then retry.';
  else help = 'Run this Git step from the library checkout on the machine running the editor to investigate.';
  // Show Git’s reason, but never echo command arguments (which can contain a
  // remote credential) or environment credentials into the browser response.
  let detail = stderr;
  for (const [name, value] of Object.entries(environment)) {
    if (/(?:TOKEN|PASSWORD|SECRET|CREDENTIAL|AUTHORIZATION|API_KEY)/i.test(name) && typeof value === 'string' && value.length >= 4) detail = detail.replaceAll(value, '[redacted]');
  }
  detail = detail.replace(/https?:\/\/[^\s/]*@/gi, 'https://[redacted]@')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g, '[redacted]')
    .replace(/(authorization\s*:\s*)(?:basic|bearer)\s+\S+/gi, '$1[redacted]')
    .replace(/([?&](?:access_token|token|password|secret)=)[^\s&]+/gi, '$1[redacted]')
    .replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, 1200);
  const code = typeof error.code === 'number' ? ` (exit ${error.code})` : /^[A-Z][A-Z0-9_]*$/.test(error.code || '') ? ` (${error.code})` : '';
  return `${step} failed${code}. ${help}${detail ? ` Git reported: ${detail}` : ''} Your saved files are preserved.`;
}

export function githubFailure(error, stderr = '', environment = {}) {
  // Classify known failures without returning CLI output, which may contain credentials.
  let message;
  if (error.killed) message = 'The GitHub request timed out. Check your connection and retry.';
  else if (/HTTP 401|bad credentials|authentication token|gh auth login|not logged into/i.test(stderr)) {
    const token = environment.GH_TOKEN ? 'GH_TOKEN' : environment.GITHUB_TOKEN ? 'GITHUB_TOKEN' : null;
    message = token
      ? `GitHub authentication failed. The editor is using ${token}, which overrides saved GitHub CLI credentials. Replace or unset it in the environment that starts the editor, then restart the editor. Check gh auth status on that machine.`
      : 'GitHub authentication is missing or expired. Run gh auth login --hostname github.com on the machine running the editor, then retry.';
  } else if (/rate limit/i.test(stderr)) message = 'GitHub rate limit reached. Wait for the limit to reset, then retry.';
  else if (/saml|single sign.on|\bsso\b/i.test(stderr)) message = 'GitHub requires organization SSO authorization. Authorize the editor’s GitHub CLI credentials for the organization, then retry.';
  else if (/HTTP 403|resource not accessible|HTTP 404|not found/i.test(stderr)) message = 'GitHub denied repository access. Check origin and run gh auth status on the machine running the editor. The signed-in account or token needs repository write access and permission to create pull requests.';
  else if (/HTTP 5\d\d/i.test(stderr)) message = 'GitHub is temporarily unavailable. Retry in a few minutes.';
  else if (/could not resolve|no such host|dial tcp|connection refused|connection reset|network is unreachable|TLS|certificate|proxy|Forbidden|\bGet "https:\/\/api\.github\.com/i.test(stderr)) message = 'The editor could not connect to the GitHub API. Check the network, proxy, firewall, and environment access to api.github.com, then retry.';
  else message = 'GitHub request failed. Run gh auth status and gh api repos/OWNER/REPO (using the origin repository) on the machine running the editor to diagnose access, then retry.';
  return `${message} Your saved files are preserved.`;
}

export function createGitPublisher({ run = runGitCommand } = {}) {
  const plans = new Map(), queues = new Map();
  function queued(root, action) {
    const next = (queues.get(root) || Promise.resolve()).catch(() => {}).then(action);
    queues.set(root, next); next.then(() => { if (queues.get(root) === next) queues.delete(root); }, () => { if (queues.get(root) === next) queues.delete(root); });
    return next;
  }
  const git = (root, args, options = {}) => run('git', args, { cwd: root, ...options });
  const api = async (root, endpoint, data) => JSON.parse(await run('gh', ['api', endpoint, '--hostname', 'github.com', ...(data ? ['--method', 'POST', '--input', '-'] : [])], { cwd: root, input: data ? JSON.stringify(data) : undefined, label: 'GitHub request' }));
  async function repository(target) {
    const root = await fs.realpath(target.root);
    const top = await git(root, ['rev-parse', '--show-toplevel']);
    if (await fs.realpath(top.trim()) !== root) throw fail('The handout library must be its own Git checkout.');
    if ((await git(root, ['ls-files', '--unmerged'])).trim()) throw fail('Resolve the current Git merge before publishing from the editor.');
    const remote = (await git(root, ['remote', 'get-url', 'origin'])).trim(), name = githubRemote(remote);
    const pushUrls = (await git(root, ['remote', 'get-url', '--push', '--all', 'origin'])).trim().split(/\r?\n/);
    if (pushUrls.length !== 1 || githubRemote(pushUrls[0]) !== name) throw fail('Origin fetch and push must point to the same GitHub repository.');
    const pushRemote = pushUrls[0];
    if (githubRemote((await git(root, ['ls-remote', '--get-url', pushRemote])).trim()) !== name) throw fail('Git URL rewriting changes the push repository. Resolve that configuration before publishing.');
    const repo = await api(root, `repos/${name}`);
    if (repo.full_name?.toLowerCase() !== name.toLowerCase() || repo.permissions?.push !== true) throw fail('GitHub access to this repository could not be verified. Sign in with gh auth login and repository write access.');
    if (target.private && repo.private !== true) throw fail('Private handouts can only be published to a private GitHub repository. Nothing was committed or pushed.');
    await git(root, ['check-ref-format', `refs/heads/${repo.default_branch}`]);
    await git(root, ['var', 'GIT_AUTHOR_IDENT'], { label: 'Git author identity check' });
    await git(root, ['var', 'GIT_COMMITTER_IDENT'], { label: 'Git committer identity check' });
    const common = await fs.realpath(path.resolve(root, (await git(root, ['rev-parse', '--git-common-dir'])).trim()));
    if (target.private && target.publicRoot && (common === path.resolve(target.publicRoot) || common.startsWith(path.resolve(target.publicRoot) + path.sep))) throw fail('The private library must use a separate Git repository outside the public checkout.');
    const stateDir = path.join(common, 'handout-editor'); await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
    let stateFile = path.join(stateDir, hash(target.path) + '.json');
    const readState = file => fs.readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    let stateText = await readState(stateFile);
    // Older Windows versions keyed state by the native source path. Retain
    // that file and branch when discovery starts returning portable paths.
    if (!stateText && target.path.includes('/')) {
      const legacyFile = path.join(stateDir, hash(target.path.replaceAll('/', '\\')) + '.json');
      const legacyText = await readState(legacyFile);
      if (legacyText) { stateFile = legacyFile; stateText = legacyText; }
    }
    const state = stateText ? JSON.parse(stateText) : null;
    if (state && (![state.commit, state.baseCommit, ...(state.pushed ? [state.pushed] : [])].every(value => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) || state.number !== undefined && (!Number.isSafeInteger(state.number) || state.number < 1))) throw fail('Stored editor Git state is invalid. Restore it before publishing.');
    if (state && (state.repository !== name || typeof state.path !== 'string' || state.path.replaceAll('\\', '/') !== target.path.replaceAll('\\', '/') || !/^editor\/handout-[A-Z]{3}-\d{3}-[a-f0-9]{12}$/.test(state.branch))) throw fail('Stored editor branch information does not match this repository.');
    return { root, remote, pushRemote, name, repo, stateDir, stateFile, state, stateHash: hash(stateText), head: (await git(root, ['rev-parse', 'HEAD'])).trim() };
  }
  async function readFile(root, relative) {
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) || relative.split('/').includes('.git')) throw fail('A publish file escapes the selected library.');
    try {
      if (!(await fs.lstat(file)).isFile() || await fs.realpath(file) !== file) throw fail('Symlinks and non-regular files cannot be published by the editor.');
      return await fs.readFile(file);
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function storedFile(root, commit, relative) {
    const exists = await git(root, ['ls-tree', '-z', commit, '--', relative]);
    if (!exists) return null;
    return git(root, ['show', `${commit}:${relative}`]);
  }
  async function saveState(info, state) {
    const file = `${info.stateFile}.${randomUUID()}.tmp`;
    await fs.writeFile(file, JSON.stringify(state), { flag: 'wx', mode: 0o600 }); await fs.rename(file, info.stateFile);
  }
  async function openPr(info) {
    if (!info.state) return null;
    if (info.state.number) {
      const pr = await api(info.root, `repos/${info.name}/pulls/${info.state.number}`);
      if (pr.head?.ref !== info.state.branch || pr.head?.repo?.full_name?.toLowerCase() !== info.name.toLowerCase()) throw fail('The existing pull request no longer matches the editor branch.');
      return pr;
    }
    const found = await api(info.root, `repos/${info.name}/pulls?state=open&head=${encodeURIComponent(info.name.split('/')[0] + ':' + info.state.branch)}`);
    return found.find(pr => pr.head?.ref === info.state.branch && pr.head?.repo?.full_name?.toLowerCase() === info.name.toLowerCase()) || null;
  }
  async function buildPlan(target, session) {
    const info = await repository(target), oldPr = await openPr(info);
    const updating = oldPr?.state === 'open' || info.state && !oldPr && !info.state.number;
    if (updating && oldPr && oldPr.head.sha !== info.state.commit && oldPr.head.sha !== info.state.pushed) throw fail('The editor branch changed on GitHub. Review those changes before publishing again.');
    const base = info.repo.default_branch;
    if (updating && oldPr && oldPr.base?.ref !== base) throw fail('The pull request base changed. Resolve it on GitHub before publishing again.');
    const ref = `refs/handout-editor/${randomUUID()}`;
    let baseCommit;
    try { await git(info.root, ['fetch', '--no-tags', 'origin', `refs/heads/${base}:${ref}`], { label: 'Fetching the GitHub base branch' }); baseCommit = (await git(info.root, ['rev-parse', ref])).trim(); }
    finally { await git(info.root, ['update-ref', '-d', ref]).catch(() => {}); }
    const baseline = updating ? info.state.baseCommit : oldPr?.merged_at ? info.state.commit : info.state && oldPr?.state === 'closed' ? info.state.baseCommit : (await git(info.root, ['merge-base', info.head, baseCommit])).trim();
    // Git tree/index paths always use '/', even when the editor identifies a
    // source with Windows separators. Keep target.path for editor verification
    // and durable workflow state, which use the original library identifier.
    const sourcePath = target.path.replaceAll('\\', '/');
    const assetDir = `assets/handouts/${target.code}`, scope = [sourcePath, assetDir];
    if ((await git(info.root, ['diff', '--no-ext-diff', '--no-textconv', '--name-only', baseline, baseCommit, '--', ...scope])).trim()) throw fail('This handout or its assets changed on GitHub since your local baseline. Sync and review those changes before publishing; nothing was overwritten.');
    const parent = updating ? info.state.commit : baseCommit;
    const branch = updating ? info.state.branch : `editor/handout-${target.code}-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    if (updating) {
      const local = (await git(info.root, ['rev-parse', '--verify', `refs/heads/${branch}`])).trim();
      if (local !== info.state.commit) throw fail('The local editor branch changed outside this workflow. Review it before retrying.');
    }
    const worktrees = await git(info.root, ['worktree', 'list', '--porcelain']);
    if (worktrees.split(/\r?\n/).includes(`branch refs/heads/${branch}`)) throw fail('This editor branch is checked out in a worktree. Switch that worktree before publishing.');
    const files = new Set([sourcePath, `${assetDir}/manifest.json`]);
    for (const manifest of [await readFile(info.root, `${assetDir}/manifest.json`), await storedFile(info.root, parent, `${assetDir}/manifest.json`)]) {
      if (!manifest) continue;
      for (const entry of JSON.parse(manifest.toString()).assets || []) {
        if (typeof entry.file !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.file) || entry.file.includes('..')) throw fail('An asset name is not safe to publish.');
        files.add(`${assetDir}/${entry.file}`); files.add(`${assetDir}/${entry.file}.base64`);
      }
    }
    if (files.size > 150) throw fail('This handout has too many asset files for one editor publication.');
    const directory = await fs.mkdtemp(path.join(info.stateDir, 'index-')), index = path.join(directory, 'index');
    const env = { GIT_INDEX_FILE: index }; const snapshots = []; let size = 0;
    let tree, changed, diff, patch, names;
    try {
      await git(info.root, ['read-tree', parent], { env });
      for (const file of files) {
        const bytes = await readFile(info.root, file); snapshots.push({ file, hash: bytes ? hash(bytes) : null });
        if (file === sourcePath && (!bytes || hash(bytes) !== target.revision)) throw fail('The saved handout changed. Save and prepare it again.');
        if (!bytes) { await git(info.root, ['update-index', '--force-remove', '--', file], { env }); continue; }
        size += bytes.length; if (size > 30_000_000) throw fail('The handout and assets exceed the 30 MB editor publication limit.');
        const tracked = await git(info.root, ['ls-tree', parent, '--', file]);
        if (!tracked) {
          const ignored = await git(info.root, ['ls-files', '--others', '--ignored', '--exclude-standard', '--', file]);
          if (ignored.trim()) throw fail('A required handout or asset file is ignored by Git. Resolve that ignore rule before publishing.');
        }
        const blob = (await git(info.root, ['hash-object', '-w', `--path=${file}`, '--stdin'], { input: bytes })).trim();
        await git(info.root, ['update-index', '--add', '--cacheinfo', tracked.startsWith('100755') ? '100755' : '100644', blob, file], { env });
      }
      tree = (await git(info.root, ['write-tree'], { env })).trim();
      changed = Boolean((await git(info.root, ['diff', '--name-only', parent, tree, '--', ...scope])).trim());
      names = (await git(info.root, ['diff', '--no-renames', '--name-only', '-z', baseCommit, tree, '--', ...scope])).split('\0').filter(Boolean);
      if (!names.length && !updating) throw fail('These saved files already match GitHub. There is nothing to publish.');
      patch = await git(info.root, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', baseCommit, tree, '--', sourcePath, `${assetDir}/manifest.json`]);
      if (patch.length > 150_000) throw fail('The text diff is too large to review in the editor. Use the normal Git workflow for this change.');
      diff = await git(info.root, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--stat', baseCommit, tree, '--', ...scope]);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
    const token = randomUUID();
    for (const [key, plan] of plans) if (Date.now() - plan.created > 600_000) plans.delete(key);
    if (plans.size >= 8) plans.delete(plans.keys().next().value);
    const plan = { info, target, session, base, baseCommit, parent, branch, tree, changed, snapshots, names, oldPr: updating ? oldPr : null, created: Date.now() };
    plans.set(token, plan);
    return { token, repository: info.name, private: Boolean(info.repo.private), branch, base, files: names, summary: diff, patch, updating: Boolean(updating), url: plan.oldPr?.html_url, revision: target.revision };
  }
  async function publishPlan(token, session, title, notes, verify) {
    const plan = plans.get(token);
    if (!plan || plan.session !== session || Date.now() - plan.created > 600_000) throw fail('This review expired. Save and prepare the handout again.');
    if (typeof title !== 'string' || title.trim().length < 3 || title.length > 120 || /[\r\n\x00-\x1f]/.test(title) || typeof notes !== 'string' || notes.length > 8000) throw fail('Use a 3–120 character title on one line and notes up to 8,000 characters.');
    const info = await repository(plan.target);
    if (info.repo.private !== plan.info.repo.private || info.remote !== plan.info.remote || info.pushRemote !== plan.info.pushRemote || info.stateHash !== plan.info.stateHash || info.head !== plan.info.head) throw fail('Git state changed after the review. Prepare the handout again.');
    await verify(plan.target);
    for (const snapshot of plan.snapshots) { const bytes = await readFile(info.root, snapshot.file); if ((bytes ? hash(bytes) : null) !== snapshot.hash) throw fail('A saved file or asset changed after the review. Prepare it again.'); }
    const lock = await fs.open(path.join(info.stateDir, 'publish.lock'), 'wx', 0o600).catch(() => { throw fail('Another editor publication is running in this repository. Retry when it finishes.'); });
    try {
      // Recheck the durable state after acquiring the cross-process lock.
      if (hash(await fs.readFile(info.stateFile, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; })) !== info.stateHash) throw fail('Another publication finished. Prepare the handout again.');
      if ((await git(info.root, ['rev-parse', 'HEAD'])).trim() !== info.head || (await git(info.root, ['worktree', 'list', '--porcelain'])).split(/\r?\n/).includes(`branch refs/heads/${plan.branch}`)) throw fail('A checkout changed after the review. Prepare the handout again.');
      let commit = plan.parent;
      if (plan.changed) {
        const sign = (await git(info.root, ['config', '--type=bool', '--default=false', '--get', 'commit.gpgsign'])).trim() === 'true';
        commit = (await git(info.root, ['commit-tree', ...(sign ? ['-S'] : []), plan.tree, '-p', plan.parent], { input: title.trim() + '\n', label: 'Creating the handout commit' })).trim();
        await git(info.root, ['update-ref', `refs/heads/${plan.branch}`, commit, plan.branch === info.state?.branch ? info.state.commit : '0'.repeat(commit.length)], { label: 'Recording the editor branch' });
      }
      const state = { repository: info.name, path: plan.target.path, branch: plan.branch, baseCommit: plan.baseCommit, commit, pushed: plan.branch === info.state?.branch ? info.state.pushed : undefined, number: plan.oldPr?.number, url: plan.oldPr?.html_url };
      if ((await git(info.root, ['rev-parse', '--verify', `refs/heads/${plan.branch}`])).trim() !== commit) throw fail('The editor branch changed. Prepare it again.');
      await saveState(info, state); plans.delete(token);
      await git(info.root, ['push', info.pushRemote, `${commit}:refs/heads/${plan.branch}`], { label: 'Pushing the editor branch' });
      state.pushed = commit; await saveState(info, state);
      const found = await api(info.root, `repos/${info.name}/pulls?state=open&head=${encodeURIComponent(info.name.split('/')[0] + ':' + plan.branch)}`);
      const pr = found.find(pr => pr.head?.ref === plan.branch && pr.head?.repo?.full_name?.toLowerCase() === info.name.toLowerCase()) || await api(info.root, `repos/${info.name}/pulls`, { title: title.trim(), head: plan.branch, base: plan.base, draft: true, body: `${notes.trim()}\n\nUpdates ${plan.target.code} from the local handout editor. Includes only the handout and its declared asset files.\n\nEditor syntax checks passed. Full build, proof review, and normal publication checks still apply.`.trim() });
      if (pr.head?.ref !== plan.branch || pr.head?.repo?.full_name?.toLowerCase() !== info.name.toLowerCase() || !/^https:\/\/github\.com\//.test(pr.html_url)) throw fail('GitHub returned an unexpected pull request. Check the editor branch on GitHub before retrying.');
      state.number = pr.number; state.url = pr.html_url; await saveState(info, state);
      return { url: state.url, number: state.number, branch: plan.branch, commit, repository: info.name, revision: plan.target.revision };
    } finally { await lock.close(); await fs.rm(path.join(info.stateDir, 'publish.lock'), { force: true }); }
  }
  return {
    prepare(target, session) { return queued(target.root, () => buildPlan(target, session)); },
    publish(token, session, title, notes, verify) {
      const plan = plans.get(token); if (!plan) return Promise.reject(fail('This review expired. Save and prepare it again.'));
      return queued(plan.target.root, () => publishPlan(token, session, title, notes, verify));
    }
  };
}
