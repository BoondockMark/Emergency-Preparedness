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
    const child = execFile(command, args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1', GCM_INTERACTIVE: 'never', ...env }, timeout: 45_000, maxBuffer: 2_000_000, encoding: 'utf8' }, (error, stdout) => {
      if (error) reject(fail(error.code === 'ENOENT' ? `${command} is not installed. Install it, then try again.` : `${label} failed. Check repository access and Git/GitHub CLI setup, then retry. Your saved files are preserved.`));
      else resolve(stdout);
    });
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
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
    const pushUrls = (await git(root, ['remote', 'get-url', '--push', '--all', 'origin'])).trim().split('\n');
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
    const stateFile = path.join(stateDir, hash(target.path) + '.json');
    const stateText = await fs.readFile(stateFile, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    const state = stateText ? JSON.parse(stateText) : null;
    if (state && (![state.commit, state.baseCommit, ...(state.pushed ? [state.pushed] : [])].every(value => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) || state.number !== undefined && (!Number.isSafeInteger(state.number) || state.number < 1))) throw fail('Stored editor Git state is invalid. Restore it before publishing.');
    if (state && (state.repository !== name || state.path !== target.path || !/^editor\/handout-[A-Z]{3}-\d{3}-[a-f0-9]{12}$/.test(state.branch))) throw fail('Stored editor branch information does not match this repository.');
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
    const assetDir = `assets/handouts/${target.code}`, scope = [target.path, assetDir];
    if ((await git(info.root, ['diff', '--no-ext-diff', '--no-textconv', '--name-only', baseline, baseCommit, '--', ...scope])).trim()) throw fail('This handout or its assets changed on GitHub since your local baseline. Sync and review those changes before publishing; nothing was overwritten.');
    const parent = updating ? info.state.commit : baseCommit;
    const branch = updating ? info.state.branch : `editor/handout-${target.code}-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    if (updating) {
      const local = (await git(info.root, ['rev-parse', '--verify', `refs/heads/${branch}`])).trim();
      if (local !== info.state.commit) throw fail('The local editor branch changed outside this workflow. Review it before retrying.');
    }
    const worktrees = await git(info.root, ['worktree', 'list', '--porcelain']);
    if (worktrees.split('\n').includes(`branch refs/heads/${branch}`)) throw fail('This editor branch is checked out in a worktree. Switch that worktree before publishing.');
    const files = new Set([target.path, `${assetDir}/manifest.json`]);
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
        if (file === target.path && (!bytes || hash(bytes) !== target.revision)) throw fail('The saved handout changed. Save and prepare it again.');
        if (!bytes) { await git(info.root, ['update-index', '--force-remove', '--', file], { env }); continue; }
        size += bytes.length; if (size > 30_000_000) throw fail('The handout and assets exceed the 30 MB editor publication limit.');
        const tracked = await git(info.root, ['ls-tree', parent, '--', file]);
        if (!tracked) {
          const ignored = await git(info.root, ['ls-files', '--others', '--ignored', '--exclude-standard', '--', file]);
          if (ignored.trim()) throw fail('A required handout or asset file is ignored by Git. Resolve that ignore rule before publishing.');
        }
        const blob = (await git(info.root, ['hash-object', '-w', '--stdin'], { input: bytes })).trim();
        await git(info.root, ['update-index', '--add', '--cacheinfo', tracked.startsWith('100755') ? '100755' : '100644', blob, file], { env });
      }
      tree = (await git(info.root, ['write-tree'], { env })).trim();
      changed = Boolean((await git(info.root, ['diff', '--name-only', parent, tree, '--', ...scope])).trim());
      names = (await git(info.root, ['diff', '--no-renames', '--name-only', '-z', baseCommit, tree, '--', ...scope])).split('\0').filter(Boolean);
      if (!names.length && !updating) throw fail('These saved files already match GitHub. There is nothing to publish.');
      patch = await git(info.root, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', baseCommit, tree, '--', target.path, `${assetDir}/manifest.json`]);
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
      if ((await git(info.root, ['rev-parse', 'HEAD'])).trim() !== info.head || (await git(info.root, ['worktree', 'list', '--porcelain'])).split('\n').includes(`branch refs/heads/${plan.branch}`)) throw fail('A checkout changed after the review. Prepare the handout again.');
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
