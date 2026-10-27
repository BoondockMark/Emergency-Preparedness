import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createGitPublisher, githubRemote, runGitCommand } from '../scripts/lib/editor-git.mjs';
const digest = value => createHash('sha256').update(value).digest('hex');
const pagePath = 'handouts/section/STH-001.md';
const session = 'test-git-session';
async function fixture(t, { privateRepo = false, privatePage = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'editor-git-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'checkout'), remote = path.join(directory, 'remote.git');
  await fs.mkdir(root); const git = (args, input) => runGitCommand('git', args, { cwd: root, input });
  await runGitCommand('git', ['init', '--bare', remote], { cwd: directory });
  await git(['init', '-b', 'main']); await git(['config', 'commit.gpgsign', 'false']); await git(['config', 'user.name', 'Editor Test']); await git(['config', 'user.email', 'editor@example.org']);
  await fs.mkdir(path.join(root, 'handouts/section'), { recursive: true }); await fs.writeFile(path.join(root, pagePath), 'Original handout\n');
  await fs.mkdir(path.join(root, 'assets/handouts/STH-001'), { recursive: true });
  await fs.writeFile(path.join(root, 'assets/handouts/STH-001/manifest.json'), '{"assets":[]}\n');
  await fs.writeFile(path.join(root, 'unrelated.txt'), 'original\n');
  await git(['add', '.']); await git(['commit', '-m', 'Initial']); await git(['push', remote, 'HEAD:refs/heads/main']);
  await git(['remote', 'add', 'origin', 'https://github.com/test/repo.git']);
  const remoteState = { private: privateRepo, prs: [], failPush: false, failCreate: false, lastBody: undefined, pushed: 0 };
  async function run(command, args, options) {
    if (command === 'git') {
      const actual = [...args];
      if (actual[0] === 'fetch') actual[2] = remote;
      if (actual[0] === 'push') {
        if (remoteState.failPush) throw Error('Simulated push failure');
        actual[1] = remote; remoteState.pushed++;
      }
      return runGitCommand(command, actual, options);
    }
    assert.equal(command, 'gh'); assert.equal(args[args.indexOf('--hostname') + 1], 'github.com'); const endpoint = args[1];
    if (endpoint === 'repos/test/repo') return JSON.stringify({ full_name: 'test/repo', private: remoteState.private, default_branch: 'main', permissions: { push: true } });
    const number = endpoint.match(/\/pulls\/(\d+)$/)?.[1];
    if (number) return JSON.stringify(remoteState.prs.find(pr => pr.number === Number(number)));
    if (endpoint.includes('/pulls?')) {
      const head = new URL('https://api.github.com/' + endpoint).searchParams.get('head').split(':')[1];
      return JSON.stringify(remoteState.prs.filter(pr => pr.state === 'open' && pr.head.ref === head));
    }
    const body = JSON.parse(options.input); remoteState.lastBody = body;
    if (remoteState.failCreate) throw Error('Simulated PR failure');
    const sha = (await git(['rev-parse', `refs/heads/${body.head}`])).trim();
    const pr = { number: remoteState.prs.length + 1, state: 'open', draft: body.draft, html_url: 'https://github.com/test/repo/pull/' + (remoteState.prs.length + 1), base: { ref: body.base }, head: { ref: body.head, sha, repo: { full_name: 'test/repo' } } };
    remoteState.prs.push(pr); return JSON.stringify(pr);
  }
  const publisher = createGitPublisher({ run });
  const target = async () => ({ root, publicRoot: path.join(directory, 'public'), private: privatePage, path: pagePath, code: 'STH-001', revision: digest(await fs.readFile(path.join(root, pagePath))) });
  const prepare = async () => publisher.prepare(await target(), session);
  const publish = plan => publisher.publish(plan.token, session, 'Update preparedness handout', 'Review these edits.', async () => {});
  return { root, remote, git, publisher, target, prepare, publish, state: remoteState };
}

test('GitHub remote parsing rejects credentials and non-GitHub destinations', () => {
  assert.equal(githubRemote('https://github.com/owner/repo.git'), 'owner/repo');
  assert.equal(githubRemote('git@github.com:owner/repo.git'), 'owner/repo');
  for (const remote of ['https://token@github.com/owner/repo.git', 'https://github.com.evil/owner/repo', '/tmp/repo', 'ssh://evil/repo']) assert.throws(() => githubRemote(remote));
});

test('Git publication includes only the page and declared assets and preserves the user checkout and index', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, pagePath), 'Updated handout\n');
  await fs.writeFile(path.join(f.root, 'unrelated.txt'), 'staged unrelated work\n'); await f.git(['add', 'unrelated.txt']);
  await fs.writeFile(path.join(f.root, 'assets/handouts/STH-001/manifest.json'), '{"assets":[{"file":"map.svg"}]}\n');
  await fs.writeFile(path.join(f.root, 'assets/handouts/STH-001/map.svg.base64'), 'c3Zn\n');
  await fs.writeFile(path.join(f.root, 'assets/handouts/STH-001/secret.txt'), 'not a declared asset');
  const head = await f.git(['rev-parse', 'HEAD']), index = await f.git(['ls-files', '--stage']);
  const plan = await f.prepare(); assert.deepEqual(plan.files.sort(), ['assets/handouts/STH-001/manifest.json', 'assets/handouts/STH-001/map.svg.base64', pagePath].sort());
  const result = await f.publish(plan);
  assert.equal(f.state.lastBody.draft, true); assert.match(result.url, /\/pull\/1$/);
  assert.equal(await f.git(['rev-parse', 'HEAD']), head); assert.equal(await f.git(['ls-files', '--stage']), index);
  assert.equal(await f.git(['show', `${result.commit}:unrelated.txt`]), 'original\n');
  assert.equal(await f.git(['show', `${result.commit}:${pagePath}`]), 'Updated handout\n');
  assert.doesNotMatch(await f.git(['ls-tree', '-r', '--name-only', result.commit]), /secret.txt/);
  assert.equal(await f.git(['branch', '--show-current']), 'main\n');
});

test('Git retries resume the same committed branch and later edits update its existing pull request', async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.root, pagePath), 'First edit\n');
  let plan = await f.prepare(); f.state.failPush = true; await assert.rejects(f.publish(plan), /push failure/);
  const branch = plan.branch;
  f.state.failPush = false; plan = await f.prepare(); assert.equal(plan.branch, branch); f.state.failCreate = true;
  await assert.rejects(f.publish(plan), /PR failure/);
  f.state.failCreate = false; plan = await f.prepare(); const first = await f.publish(plan);
  await fs.writeFile(path.join(f.root, pagePath), 'Second edit\n');
  plan = await f.prepare(); assert.equal(plan.branch, branch); const second = await f.publish(plan);
  assert.equal(second.number, first.number); assert.equal(f.state.prs.length, 1);
  assert.notEqual(second.commit, first.commit); assert.equal((await f.git(['rev-parse', `${second.commit}^`])).trim(), first.commit);
});

test('Git rejects public targets for private pages, mismatched push remotes and changed reviewed files', async t => {
  const f = await fixture(t, { privatePage: true }); await fs.writeFile(path.join(f.root, pagePath), 'Private edit\n');
  await assert.rejects(f.prepare(), /private GitHub repository/); assert.equal(f.state.pushed, 0);
  f.state.private = true; await f.git(['remote', 'set-url', '--push', 'origin', 'https://github.com/test/public.git']);
  await assert.rejects(f.prepare(), /fetch and push/);
  await f.git(['remote', 'set-url', '--push', 'origin', 'https://github.com/test/repo.git']);
  const plan = await f.prepare(); await fs.writeFile(path.join(f.root, pagePath), 'Newer private edit\n');
  await assert.rejects(f.publish(plan), /changed after the review/); assert.equal(f.state.pushed, 0);
  const fresh = await f.prepare(); f.state.private = false;
  await assert.rejects(f.publish(fresh), /private GitHub repository/); assert.equal(f.state.pushed, 0);
});

test('Git rejects upstream page conflicts and can start a new PR after its own prior changes merge', async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.root, pagePath), 'First PR edit\n');
  const first = await f.publish(await f.prepare());
  f.state.prs[0].state = 'closed'; f.state.prs[0].merged_at = new Date().toISOString();
  await f.git(['push', f.remote, `${first.commit}:refs/heads/main`]);
  await fs.writeFile(path.join(f.root, pagePath), 'Next PR edit\n'); const next = await f.prepare();
  assert.notEqual(next.branch, first.branch); await f.publish(next); assert.equal(f.state.prs.length, 2);
  // A separate upstream change cannot be silently overwritten by the current PR.
  const tree = (await f.git(['rev-parse', 'HEAD^{tree}'])).trim();
  const other = (await f.git(['commit-tree', tree, '-p', first.commit], 'Upstream changed the handout back\n')).trim();
  await f.git(['push', f.remote, `${other}:refs/heads/main`]);
  await assert.rejects(f.prepare(), /changed on GitHub/);
});

test('Git excludes unrelated local commits and rejects a non-fast-forward push without overwriting GitHub', async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.root, 'unrelated.txt'), 'unrelated local commit\n'); await f.git(['add', 'unrelated.txt']); await f.git(['commit', '-m', 'Unrelated local change']);
  await fs.writeFile(path.join(f.root, pagePath), 'Reviewed edit\n'); const plan = await f.prepare();
  assert.match(plan.patch, /Reviewed edit/); assert.doesNotMatch(plan.patch, /unrelated local commit/);
  const first = await f.publish(plan); assert.equal(await f.git(['show', `${first.commit}:unrelated.txt`]), 'original\n');
  await fs.writeFile(path.join(f.root, pagePath), 'Next edit\n'); const next = await f.prepare();
  const tree = (await f.git(['rev-parse', `${first.commit}^{tree}`])).trim();
  const external = (await f.git(['commit-tree', tree, '-p', first.commit], 'Someone else updated the PR\n')).trim();
  await f.git(['push', f.remote, `${external}:refs/heads/${first.branch}`]);
  await assert.rejects(f.publish(next), /Pushing the editor branch failed/);
  assert.equal((await f.git(['ls-remote', f.remote, `refs/heads/${first.branch}`])).split('\t')[0], external);
});

test('Git publishes private-page snapshots only after verifying a private target repository', async t => {
  const f = await fixture(t, { privateRepo: true, privatePage: true });
  await fs.writeFile(path.join(f.root, pagePath), 'Private contact information\n');
  const plan = await f.prepare(); assert.equal(plan.private, true); const result = await f.publish(plan);
  assert.equal(await f.git(['show', `${result.commit}:${pagePath}`]), 'Private contact information\n');
  assert.equal(f.state.prs.length, 1);
  const visibility = await fixture(t, { privateRepo: true });
  await fs.writeFile(path.join(visibility.root, pagePath), 'Draft reviewed for a private repository\n');
  const reviewed = await visibility.prepare(); visibility.state.private = false;
  await assert.rejects(visibility.publish(reviewed), /Git state changed after the review/);
  assert.equal(visibility.state.pushed, 0);
});
