import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

export function profileCommand(tool, root, env = process.env, platform = process.platform) {
    const prefix = tool === 'claude' ? 'CCP' : 'CXP';
    const name = tool === 'claude' ? 'ccp' : 'cxp';
    const windows = platform === 'win32';
    const override = `${prefix}_${windows ? 'PS1' : 'BASH'}`;
    const script = env[override] || resolve(root, '..', `${tool}-profiles`, `${name}.${windows ? 'ps1' : 'bash'}`);
    return { script, override, command: windows ? 'powershell.exe' : 'bash',
        args: windows ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script] : [script] };
}

export function codexCommand(args, platform = process.platform) {
    // Windows uses an npm .cmd shim. POSIX can pass arguments directly, including paths with spaces.
    if (platform === 'win32') return { command: ['codex', ...args.map((a) => `"${a}"`)].join(' '), args: [], shell: true };
    return { command: 'codex', args, shell: false };
}

export function killTree(pid, platform = process.platform) {
    if (!pid) return;
    if (platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        killer.on('error', () => {});
    } else {
        // Workers start in their own process group so descendants are stopped as well.
        try { process.kill(-pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
}
