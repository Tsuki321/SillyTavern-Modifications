import { describe, test, expect } from '@jest/globals';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SCRIPT = path.join(process.cwd(), '..', 'scripts', 'provision-android-runtime.sh');

describe('Android runtime provisioning script', () => {
    test('offline self-test passes (no network)', async () => {
        const { stdout } = await execFileAsync('bash', [SCRIPT, '--self-test'], {
            timeout: 120000,
        });
        expect(stdout).toMatch(/12 passed, 0 failed/);
        expect(stdout).toMatch(/PASS: ELF validation accepts correct Android runtime/);
        expect(stdout).toMatch(/PASS: ELF validation rejects Linux \(glibc\) binary/);
        expect(stdout).toMatch(/PASS: corrupted \.deb is rejected/);
    }, 150000);
});
