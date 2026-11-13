import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { profileCommand, codexCommand } from '../platform.mjs';

const exec = promisify(execFile);
const runner = fileURLToPath(new URL('../fanout.mjs', import.meta.url));

test('profile commands select native scripts and platform-specific overrides', () => {
    for (const platform of ['darwin', 'linux', 'win32']) {
        for (const tool of ['claude', 'codex']) {
            const windows = platform === 'win32';
            const prefix = tool === 'claude' ? 'CCP' : 'CXP';
            const command = profileCommand(tool, '/projects/fanout-skill', {}, platform);
            assert.equal(command.command, windows ? 'powershell.exe' : 'bash');
            assert.ok(command.script.replaceAll('\\', '/').endsWith(`${tool}-profiles/${tool === 'claude' ? 'ccp' : 'cxp'}.${windows ? 'ps1' : 'bash'}`));
            const key = `${prefix}_${windows ? 'PS1' : 'BASH'}`;
            assert.equal(command.override, key);
            const custom = profileCommand(tool, '/projects/fanout-skill', { [key]: '/custom path/tool' }, platform);
            assert.equal(custom.script, '/custom path/tool');
            assert.equal(custom.args.at(-1), custom.script);
        }
    }
});

test('Codex uses direct arguments on POSIX and a shell for the Windows shim', () => {
    const args = ['exec', '-o', '/output path/result.md', '-'];
    assert.deepEqual(codexCommand(args, 'darwin'), { command: 'codex', args, shell: false });
    assert.deepEqual(codexCommand(args, 'win32'), {
        command: 'codex "exec" "-o" "/output path/result.md" "-"', args: [], shell: true,
    });
});

function fixture(t) {
    const dir = mkdtempSync(join(tmpdir(), 'fanout test '));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const profile = join(dir, 'profiles.bash');
    writeFileSync(profile, `#!/usr/bin/env bash
if [ "$1" = list ]; then
  echo '[{"name":"mock-a","number":1,"path":"/mock/a"},{"name":"mock-b","number":2,"path":"/mock/b"}]'
else
  echo '[{"profile":"mock-a","path":"/mock/a","headroom_percent":90},{"profile":"mock-b","path":"/mock/b","headroom_percent":80}]'
fi
`);
    const worker = `#!${process.execPath}
const fs = require('node:fs');
let prompt = '';
process.stdin.on('data', data => prompt += data);
process.stdin.on('end', () => {
    if (prompt === 'timeout') {
        const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
        fs.writeFileSync(process.env.PID_FILE, String(child.pid));
        setInterval(() => {}, 1000);
        return;
    }
    const home = process.env.CODEX_HOME;
    if (prompt === 'retry' && home === '/mock/a') process.exit(1);
    const result = JSON.stringify({prompt, args: process.argv.slice(2), home, claudeHome: process.env.CLAUDE_CONFIG_DIR});
    const index = process.argv.indexOf('-o');
    if (index >= 0) fs.writeFileSync(process.argv[index + 1], result);
    else console.log(JSON.stringify({result}));
});
`;
    for (const name of ['claude', 'codex']) writeFileSync(join(bin, name), worker, { mode: 0o755 });
    const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, CCP_BASH: profile, CXP_BASH: profile, PID_FILE: join(dir, 'pid') };
    const tasks = join(dir, 'tasks.json');
    const out = join(dir, 'output $(touch injected)');
    return { dir, env, out, async run(data, args = []) {
        writeFileSync(tasks, JSON.stringify(data));
        return exec(process.execPath, [runner, tasks, '--out', out, ...args], { env, cwd: dir, timeout: 15000 });
    }, summary() { return JSON.parse(readFileSync(join(out, 'summary.json'))); } };
}

const posix = { skip: process.platform === 'win32' };
test('dry run discovers profiles without starting workers or writing results', posix, async t => {
    const f = fixture(t);
    const { stdout } = await f.run([{ prompt: 'hello', model: { claude: 'test-model' }, effort: 'low' }], ['--dry-run']);
    assert.match(stdout, /claude \/ mock-a.*model=test-model.*effort=low/);
    assert.equal(existsSync(f.out), false);
});

test('both workers receive stdin, profile, permissions and model arguments; output paths remain literal', posix, async t => {
    const f = fixture(t);
    await f.run(['claude', 'codex'].map(tool => ({ id: tool, tool, profile: 'mock-b', prompt: 'hello\nworld', model: 'test-model', effort: 'high' })));
    for (const row of f.summary()) {
        assert.equal(row.status, 'ok');
        const result = JSON.parse(readFileSync(row.out));
        assert.equal(result.prompt, 'hello\nworld');
        assert.equal(row.tool === 'codex' ? result.home : result.claudeHome, '/mock/b');
        assert.ok(result.args.includes('test-model'));
        assert.ok(result.args.includes(row.tool === 'codex' ? 'sandbox_mode=read-only' : 'plan'));
        assert.ok(result.args.includes(row.tool === 'codex' ? 'model_reasoning_effort=high' : 'high'));
    }
    assert.equal(existsSync(join(f.dir, 'injected')), false);
});

test('failed unpinned worker retries on another profile', posix, async t => {
    const f = fixture(t);
    await f.run([{ tool: 'codex', prompt: 'retry' }]);
    const [row] = f.summary();
    assert.equal(row.status, 'ok');
    assert.equal(row.attempts, 2);
    assert.equal(row.profile, 'mock-b');
});

test('timeout kills the worker process group including descendants', posix, async t => {
    const f = fixture(t);
    await assert.rejects(f.run([{ tool: 'codex', profile: 'mock-a', prompt: 'timeout' }], ['--timeout', '0.02']), error => error.code === 1);
    const [row] = f.summary();
    assert.equal(row.status, 'failed');
    assert.match(row.error, /timed out/);
    const pid = Number(readFileSync(f.env.PID_FILE, 'utf8'));
    // A terminated descendant may briefly remain a zombie awaiting its parent's reaper.
    const state = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
    assert.ok(state.status === 1 || state.stdout.trim().startsWith('Z'), `descendant ${pid} still running: ${state.stdout}`);
});
