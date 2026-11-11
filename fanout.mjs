#!/usr/bin/env node
// fanout - run a list of tasks in parallel across Claude Code (ccp) and Codex (cxp) profiles.
// Profiles are chosen with `ccp pick` / `cxp pick` (most room left first) unless a task names one.
// Every worker runs headless with its prompt on stdin; results land in one folder per run.
import { spawn, execFile } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, createWriteStream } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const here = import.meta.dirname;
const PS1 = {
    claude: process.env.CCP_PS1 || resolve(here, '..', 'claude-profiles', 'ccp.ps1'),
    codex: process.env.CXP_PS1 || resolve(here, '..', 'codex-profiles', 'cxp.ps1'),
};
const HOME_VAR = { claude: 'CLAUDE_CONFIG_DIR', codex: 'CODEX_HOME' };
// What each permission mode means per tool. "profile" passes nothing: the profile's saved mode applies.
const PERM = {
    readonly: { claude: ['--permission-mode', 'plan'], codex: ['-c', 'approval_policy=on-request', '-c', 'sandbox_mode=read-only'] },
    auto: { claude: ['--permission-mode', 'auto'], codex: ['-c', 'approval_policy=on-request', '-c', 'sandbox_mode=workspace-write'] },
    bypass: { claude: ['--permission-mode', 'bypassPermissions'], codex: ['-c', 'approval_policy=never', '-c', 'sandbox_mode=danger-full-access'] },
    profile: { claude: [], codex: [] },
};

const HELP = `fanout <tasks.json> [options]     run the tasks in the file
fanout --each "<prompt>" [options] give the same prompt to every available profile

tasks.json is an array of:
  { "prompt": "...",            required
    "id": "auth-review",        default t1, t2, ...
    "tool": "claude" | "codex", default: whichever has the most room left
    "profile": "<name>",        default: picked for you (needs "tool" if set)
    "cwd": "F:/project",        default: the current folder
    "perm": "readonly" | "auto" | "bypass" | "profile",   default: readonly
    "worktree": true,           run in a new git worktree + branch of cwd
    "model": "<name>",          default: the profile's own model. A plain name needs "tool";
                                or per tool: { "claude": "opus", "codex": "gpt-5" }
    "effort": "<level>" }       default: the profile's own effort. Same two forms as "model"

Options:
  --perm <mode>     default mode for tasks that do not set one (default: readonly)
  --tool <tool>     only use claude or codex for tasks that do not name a tool
  --out <dir>       where results go (default: <fanout folder>/runs/<timestamp>)
  -j <n>            workers running at once (default: 8)
  --timeout <min>   stop a worker after this many minutes (default: 60)
  --no-retry        do not retry a failed task on another profile
  --dry-run         show which profile each task would get, run nothing`;

function fail(msg) { console.error(`fanout: ${msg}`); process.exit(2); }

// "model" / "effort" of a task: a plain value, or { claude, codex }. Returns the value for one tool, or null.
function forTool(value, tool) {
    if (value == null) return null;
    return (typeof value === 'object' ? value[tool] : value) ?? null;
}
function checkPerTool(task, field) {   // the values end up on a command line (a shell one for codex), so keep them plain
    const v = task[field];
    if (v == null) return;
    const isMap = typeof v === 'object' && !Array.isArray(v);
    if (!isMap && typeof v !== 'string') fail(`task ${task.id}: "${field}" must be a string or { "claude": ..., "codex": ... }`);
    if (isMap) for (const k of Object.keys(v)) if (!HOME_VAR[k]) fail(`task ${task.id}: "${field}" has unknown tool '${k}' (use: claude, codex)`);
    for (const x of isMap ? Object.values(v) : [v]) {
        if (typeof x !== 'string' || !/^[\w.:\[\]-]+$/.test(x)) fail(`task ${task.id}: "${field}" value '${x}' is not a plain name`);
    }
    // a model name belongs to one tool, so a plain one is only safe when the task can run on that tool alone
    if (field === 'model' && !isMap && !(task.tool || opt.tool)) fail(`task ${task.id}: "model" needs "tool", or give it per tool: { "claude": ..., "codex": ... }`);
}

// ---- arguments
const argv = process.argv.slice(2);
const opt = { perm: 'readonly', jobs: 8, timeout: 60, retry: true, dry: false };
let tasksFile = null;
for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => argv[++i] ?? fail(`${a} needs a value`);
    if (a === '--perm') opt.perm = value();
    else if (a === '--tool') opt.tool = value();
    else if (a === '--out') opt.out = value();
    else if (a === '--each') opt.each = value();
    else if (a === '-j') opt.jobs = Number(value());
    else if (a === '--timeout') opt.timeout = Number(value());
    else if (a === '--no-retry') opt.retry = false;
    else if (a === '--dry-run') opt.dry = true;
    else if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
    else if (a.startsWith('-')) fail(`unknown option ${a}`);
    else if (tasksFile) fail(`unexpected argument ${a}`);
    else tasksFile = a;
}
if (!tasksFile && !opt.each) { console.log(HELP); process.exit(2); }
if (tasksFile && opt.each) fail('give a tasks file or --each, not both');
if (!PERM[opt.perm]) fail(`unknown --perm ${opt.perm} (use: ${Object.keys(PERM).join(', ')})`);
if (opt.tool && !HOME_VAR[opt.tool]) fail(`unknown --tool ${opt.tool} (use: claude, codex)`);
if (!(opt.jobs >= 1)) fail('-j needs a number of 1 or more');
if (!(opt.timeout > 0)) fail('--timeout needs a number of minutes');

// ---- profiles
function profileTool(tool, args) {   // run ccp.ps1 / cxp.ps1, return parsed JSON (null when it fails, e.g. nothing to pick)
    return new Promise((done) => {
        execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1[tool], ...args],
            { maxBuffer: 16 * 1024 * 1024, windowsHide: true },
            (err, stdout, stderr) => {
                if (err) { done({ error: (stderr || err.message).trim() }); return; }
                try { done({ data: JSON.parse(stdout) }); } catch { done({ error: `unexpected output from ${tool} profiles tool` }); }
            }).stdin?.end();
    });
}

const tools = Object.keys(HOME_VAR);
const listed = {};   // tool -> [{ name, number, path }]
const ranked = [];   // slots `pick` returned, best first across both tools
async function loadProfiles(needPick) {
    await Promise.all(tools.map(async (tool) => {
        if (!existsSync(PS1[tool])) fail(`${PS1[tool]} not found (set ${tool === 'claude' ? 'CCP_PS1' : 'CXP_PS1'})`);
        const list = await profileTool(tool, ['list', '--json']);
        if (list.error) fail(`${tool}: ${list.error}`);
        listed[tool] = list.data;
        if (!needPick) return;
        const pick = await profileTool(tool, ['pick', '-n', '99', '--json']);
        if (pick.error) { console.error(`fanout: no ${tool} profile available (${pick.error.replace(/^c[cx]p: /, '')})`); return; }
        for (const p of pick.data) ranked.push({ tool, profile: p.profile, path: p.path, headroom: p.headroom_percent });
    }));
    ranked.sort((a, b) => (b.headroom ?? -1) - (a.headroom ?? -1) || a.tool.localeCompare(b.tool));
}

function pinned(tool, profile) {   // a profile the task named, by name or list number
    const p = listed[tool].find((x) => x.name.toLowerCase() === String(profile).toLowerCase() || String(x.number) === String(profile));
    if (!p) fail(`no ${tool} profile '${profile}' (have: ${listed[tool].map((x) => x.name).join(', ')})`);
    return { tool, profile: p.name, path: p.path, headroom: null };
}

// ---- tasks
let tasks;
if (opt.each) tasks = null;   // one per slot, built after profiles are known
else {
    try { tasks = JSON.parse(readFileSync(tasksFile, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { fail(`cannot read ${tasksFile}: ${e.message}`); }
    if (!Array.isArray(tasks) || !tasks.length) fail('tasks file must be a non-empty JSON array');
}

await loadProfiles(opt.each || tasks.some((t) => !t.profile));

if (opt.each) {
    const slots = ranked.filter((s) => !opt.tool || s.tool === opt.tool);
    if (!slots.length) fail('no profile available');
    tasks = slots.map((s) => ({ id: `${s.tool}-${s.profile}`, prompt: opt.each, tool: s.tool, profile: s.profile }));
}

const load = new Map();   // "tool/profile" -> tasks given to it, to spread work evenly
const key = (s) => `${s.tool}/${s.profile}`;
function choose(task, avoid = []) {   // best slot for a task: fewest tasks so far, then most room left
    const wanted = task.tool || opt.tool;
    const pool = ranked.filter((s) => (!wanted || s.tool === wanted) && !avoid.includes(key(s)));
    if (!pool.length) return null;
    const slot = pool.reduce((best, s) => ((load.get(key(s)) || 0) < (load.get(key(best)) || 0) ? s : best));
    load.set(key(slot), (load.get(key(slot)) || 0) + 1);
    return slot;
}

const seen = new Set();
tasks.forEach((t, i) => {
    if (typeof t.prompt !== 'string' || !t.prompt.trim()) fail(`task ${i + 1} has no prompt`);
    t.id = String(t.id || `t${i + 1}`).replace(/[^\w.@+-]/g, '_');
    if (seen.has(t.id)) fail(`duplicate task id '${t.id}'`);
    seen.add(t.id);
    if (t.tool && !HOME_VAR[t.tool]) fail(`task ${t.id}: unknown tool '${t.tool}' (use: claude, codex)`);
    if (t.profile && !t.tool) fail(`task ${t.id}: "profile" needs "tool"`);
    t.perm = t.perm || opt.perm;
    if (!PERM[t.perm]) fail(`task ${t.id}: unknown perm '${t.perm}' (use: ${Object.keys(PERM).join(', ')})`);
    checkPerTool(t, 'model'); checkPerTool(t, 'effort');
    t.cwd = resolve(t.cwd || process.cwd());
    if (!existsSync(t.cwd)) fail(`task ${t.id}: cwd ${t.cwd} does not exist`);
    t.fixed = Boolean(t.profile);   // a named profile is never swapped for another on retry
    t.slot = t.fixed ? pinned(t.tool, t.profile) : choose(t);
    if (!t.slot) fail(`task ${t.id}: no ${t.tool || opt.tool || ''} profile available`.replace('  ', ' '));
});

if (opt.dry) {
    for (const t of tasks) {
        const model = forTool(t.model, t.slot.tool); const effort = forTool(t.effort, t.slot.tool);
        console.log(`${t.id}  ->  ${t.slot.tool} / ${t.slot.profile}  [${t.perm}]  ${t.cwd}${t.worktree ? '  (worktree)' : ''}`
            + `${model ? `  model=${model}` : ''}${effort ? `  effort=${effort}` : ''}`);
    }
    process.exit(0);
}

// ---- run
const now = new Date();   // local time, as yyyymmdd-hhmmss
const stamp = new Date(now - now.getTimezoneOffset() * 60000).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const out = resolve(opt.out || join(here, 'runs', stamp));
mkdirSync(out, { recursive: true });

function git(cwd, args) {
    return new Promise((done) => execFile('git', ['-C', cwd, ...args], { windowsHide: true },
        (err, stdout, stderr) => done({ ok: !err, text: (stdout + stderr).trim() })));
}

function killTree(pid) { spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); }

function runOnce(task, slot, attempt) {   // -> { ok, exit, error }
    return new Promise((done) => {
        const tag = attempt > 1 ? `${task.id}.try${attempt}` : task.id;
        const outFile = join(out, `${task.id}.out.md`);
        const log = createWriteStream(join(out, `${tag}.log`));
        const env = { ...process.env };
        // the folder for home comes from `list`, but claude treats "unset" and "set to ~/.claude" differently
        if (slot.profile === 'home') delete env[HOME_VAR[slot.tool]]; else env[HOME_VAR[slot.tool]] = slot.path;
        let child; let stdout = '';
        const model = forTool(task.model, slot.tool); const effort = forTool(task.effort, slot.tool);
        if (slot.tool === 'claude') {
            const extra = [...(model ? ['--model', model] : []), ...(effort ? ['--effort', effort] : [])];
            child = spawn('claude', ['-p', '--output-format', 'json', ...PERM[task.perm].claude, ...extra], { cwd: task.cwd, env, windowsHide: true });
        } else {
            // codex is an npm .cmd shim, so it needs a shell; every argument here is fixed text, a checked plain name or a quoted path
            const extra = [...(effort ? ['-c', `model_reasoning_effort=${effort}`] : [])];
            child = spawn(['codex', ...PERM[task.perm].codex, ...extra, 'exec', ...(model ? ['-m', model] : []), '--skip-git-repo-check', '-o', `"${outFile}"`, '-'].join(' '),
                { cwd: task.cwd, env, shell: true, windowsHide: true });
        }
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, opt.timeout * 60000);
        child.stdout.on('data', (d) => { stdout += d; log.write(d); });
        child.stderr.on('data', (d) => log.write(d));
        child.on('error', (e) => { clearTimeout(timer); log.end(); done({ ok: false, exit: null, error: e.message }); });
        child.on('close', (code) => {
            clearTimeout(timer); log.end();
            if (timedOut) { done({ ok: false, exit: code, error: `timed out after ${opt.timeout} min` }); return; }
            let ok = code === 0; let error = ok ? null : `exit ${code}`;
            if (slot.tool === 'claude') {   // the answer is the "result" field of claude's JSON
                try {
                    const r = JSON.parse(stdout);
                    if (r.is_error) { ok = false; error = String(r.result || r.subtype || 'claude reported an error').slice(0, 300); }
                    if (ok) writeFileSync(outFile, String(r.result ?? ''));
                } catch { if (ok) { ok = false; error = 'claude printed no JSON result'; } }
            } else if (ok && !existsSync(outFile)) { ok = false; error = 'codex wrote no final message'; }
            done({ ok, exit: code, error });
        });
        child.stdin.on('error', () => { });   // a worker that dies early must not crash the run
        child.stdin.end(task.prompt);
    });
}

async function runTask(task) {
    const started = Date.now();
    const r = { id: task.id, tool: task.slot.tool, profile: task.slot.profile, perm: task.perm, cwd: task.cwd,
        status: 'failed', attempts: 0, seconds: 0, error: null, out: null, log: join(out, `${task.id}.log`) };
    writeFileSync(join(out, `${task.id}.prompt.txt`), task.prompt);
    if (task.worktree) {
        r.branch = `fanout/${stamp}/${task.id}`;
        const dir = join(out, 'worktrees', task.id);
        mkdirSync(dirname(dir), { recursive: true });
        const made = await git(task.cwd, ['worktree', 'add', '-b', r.branch, dir]);
        if (!made.ok) { r.error = `git worktree failed: ${made.text.split('\n').pop()}`; return r; }
        task.cwd = r.cwd = dir;
    }
    const tried = [];
    let slot = task.slot;
    while (slot) {
        r.attempts++; r.tool = slot.tool; r.profile = slot.profile;
        r.model = forTool(task.model, slot.tool); r.effort = forTool(task.effort, slot.tool);
        tried.push(key(slot));
        console.error(`[start] ${task.id} on ${slot.tool}/${slot.profile}${r.attempts > 1 ? ' (retry)' : ''}`);
        const res = await runOnce(task, slot, r.attempts);
        r.error = res.error;
        if (res.ok) { r.status = 'ok'; r.out = join(out, `${task.id}.out.md`); break; }
        console.error(`[fail]  ${task.id} on ${slot.tool}/${slot.profile}: ${res.error}`);
        if (r.attempts > 1) r.log = join(out, `${task.id}.try${r.attempts}.log`);
        slot = opt.retry && !task.fixed && r.attempts < 2 ? choose(task, tried) : null;   // one retry, on a different profile
    }
    r.seconds = Math.round((Date.now() - started) / 1000);
    console.error(`[${r.status === 'ok' ? 'done' : 'gave up'}] ${task.id} (${r.seconds}s)`);
    return r;
}

const results = new Array(tasks.length);
let next = 0;
await Promise.all(Array.from({ length: Math.min(opt.jobs, tasks.length) }, async () => {
    while (next < tasks.length) { const i = next++; results[i] = await runTask(tasks[i]); }
}));

writeFileSync(join(out, 'summary.json'), JSON.stringify(results, null, 2));
const w = (k) => Math.max(k.length, ...results.map((r) => String(r[k] ?? '').length));
const cols = ['id', 'tool', 'profile', 'status', 'seconds'];
console.log(cols.map((c) => c.padEnd(w(c))).join('  '));
for (const r of results) console.log(cols.map((c) => String(r[c] ?? '').padEnd(w(c))).join('  ') + (r.error ? `  ${r.error}` : ''));
console.log(`\nResults: ${out}  (<id>.out.md per task, summary.json for all)`);
process.exit(results.every((r) => r.status === 'ok') ? 0 : 1);
