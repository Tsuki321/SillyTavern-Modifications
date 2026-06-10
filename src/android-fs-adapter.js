/**
 * Android File System Adapter for SillyTavern
 * Adapts Node.js file operations to Android scoped storage
 */

import fs from 'node:fs';
import path from 'node:path';
import { serverDirectory } from './server-directory.js';

const isAndroid = process.platform === 'android' || process.env.ANDROID_ROOT;

/**
 * Get the appropriate data root for the platform
 */
export function getDataRoot() {
    if (isAndroid) {
        // Use Android app-specific directory
        return process.env.ANDROID_DATA_DIR || path.join(serverDirectory, 'data');
    }
    return globalThis.DATA_ROOT || path.join(serverDirectory, 'data');
}

/**
 * Ensure Android-compatible path
 */
export function toAndroidPath(filePath) {
    if (!isAndroid) return filePath;

    // Convert Windows/Unix paths to Android-safe paths
    return filePath.replace(/\\/g, '/');
}

/**
 * Initialize Android storage structure
 */
export async function initAndroidStorage() {
    if (!isAndroid) return;

    const dataRoot = getDataRoot();
    const requiredDirs = [
        'characters',
        'chats',
        'worlds',
        'groups',
        'group chats',
        'User Avatars',
        'backgrounds',
        'themes',
        'instruct',
        'context',
        'QuickReplies',
        'movingUI',
        'assets',
        'user',
        'backups',
        'vectors',
        'settings'
    ];

    console.log('[Android] Initializing storage in:', dataRoot);

    for (const dir of requiredDirs) {
        const dirPath = path.join(dataRoot, dir);
        try {
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
                console.log('[Android] Created directory:', dir);
            }
        } catch (error) {
            console.error('[Android] Failed to create directory:', dir, error);
        }
    }
}

/**
 * Wrap file operations with Android-specific handling
 */
export const androidFS = {
    /**
     * Read file with Android-compatible error handling
     */
    readFile: (filePath, encoding) => {
        const androidPath = toAndroidPath(filePath);
        try {
            return fs.readFileSync(androidPath, encoding);
        } catch (error) {
            console.error('[Android] Read error:', androidPath, error);
            throw error;
        }
    },

    /**
     * Write file with Android-compatible atomic writes
     */
    writeFile: (filePath, data, encoding) => {
        const androidPath = toAndroidPath(filePath);
        try {
            // Ensure parent directory exists
            const dir = path.dirname(androidPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            return fs.writeFileSync(androidPath, data, encoding);
        } catch (error) {
            console.error('[Android] Write error:', androidPath, error);
            throw error;
        }
    },

    /**
     * Check if file exists
     */
    exists: (filePath) => {
        const androidPath = toAndroidPath(filePath);
        return fs.existsSync(androidPath);
    },

    /**
     * Delete file
     */
    unlink: (filePath) => {
        const androidPath = toAndroidPath(filePath);
        return fs.unlinkSync(androidPath);
    },

    /**
     * Read directory
     */
    readdir: (dirPath, options) => {
        const androidPath = toAndroidPath(dirPath);
        return fs.readdirSync(androidPath, options);
    },

    /**
     * Create directory
     */
    mkdir: (dirPath, options) => {
        const androidPath = toAndroidPath(dirPath);
        return fs.mkdirSync(androidPath, options);
    }
};

/**
 * Export Android detection flag
 */
export { isAndroid };
