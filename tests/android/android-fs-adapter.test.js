import { describe, test, expect, beforeEach } from '@jest/globals';
import { getDataRoot, toAndroidPath, androidFS, isAndroid } from '../../src/android-fs-adapter.js';
import fs from 'node:fs';
import path from 'node:path';

describe('Android File System Adapter', () => {
    const testDir = path.join(process.cwd(), 'test-data');

    beforeEach(() => {
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true });
        }
        fs.mkdirSync(testDir, { recursive: true });
    });

    describe('getDataRoot', () => {
        test('returns data root path', () => {
            const root = getDataRoot();
            expect(root).toBeDefined();
            expect(typeof root).toBe('string');
        });
    });

    describe('toAndroidPath', () => {
        test('converts Windows paths to forward slashes on Android', () => {
            if (isAndroid) {
                const winPath = 'C:\\Users\\data\\file.txt';
                const androidPath = toAndroidPath(winPath);
                expect(androidPath).toBe('C:/Users/data/file.txt');
            }
        });

        test('returns path unchanged on non-Android', () => {
            if (!isAndroid) {
                const path = '/data/file.txt';
                const result = toAndroidPath(path);
                expect(result).toBe(path);
            }
        });
    });

    describe('androidFS.writeFile', () => {
        test('writes file successfully', () => {
            const filePath = path.join(testDir, 'test.txt');
            androidFS.writeFile(filePath, 'Hello Android', 'utf8');
            expect(fs.existsSync(filePath)).toBe(true);
        });

        test('creates parent directories if missing', () => {
            const filePath = path.join(testDir, 'nested', 'dir', 'test.txt');
            androidFS.writeFile(filePath, 'Nested file', 'utf8');
            expect(fs.existsSync(filePath)).toBe(true);
        });
    });

    describe('androidFS.readFile', () => {
        test('reads file successfully', () => {
            const filePath = path.join(testDir, 'read-test.txt');
            const content = 'Read this content';
            fs.writeFileSync(filePath, content, 'utf8');

            const result = androidFS.readFile(filePath, 'utf8');
            expect(result).toBe(content);
        });

        test('throws error for missing file', () => {
            const filePath = path.join(testDir, 'missing.txt');
            expect(() => androidFS.readFile(filePath, 'utf8')).toThrow();
        });
    });

    describe('androidFS.exists', () => {
        test('returns true for existing file', () => {
            const filePath = path.join(testDir, 'exists.txt');
            fs.writeFileSync(filePath, 'content');
            expect(androidFS.exists(filePath)).toBe(true);
        });

        test('returns false for missing file', () => {
            const filePath = path.join(testDir, 'does-not-exist.txt');
            expect(androidFS.exists(filePath)).toBe(false);
        });
    });

    describe('androidFS.readdir', () => {
        test('lists directory contents', () => {
            fs.writeFileSync(path.join(testDir, 'file1.txt'), 'a');
            fs.writeFileSync(path.join(testDir, 'file2.txt'), 'b');

            const files = androidFS.readdir(testDir);
            expect(files).toContain('file1.txt');
            expect(files).toContain('file2.txt');
        });
    });

    describe('androidFS.unlink', () => {
        test('deletes file successfully', () => {
            const filePath = path.join(testDir, 'delete-me.txt');
            fs.writeFileSync(filePath, 'content');
            expect(fs.existsSync(filePath)).toBe(true);

            androidFS.unlink(filePath);
            expect(fs.existsSync(filePath)).toBe(false);
        });
    });

    describe('androidFS.mkdir', () => {
        test('creates directory', () => {
            const dirPath = path.join(testDir, 'new-dir');
            androidFS.mkdir(dirPath, { recursive: true });
            expect(fs.existsSync(dirPath)).toBe(true);
        });
    });
});
