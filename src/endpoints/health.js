/**
 * Health check endpoint for the mobile app (and process supervisors in general).
 * Polled by NodeJsService and mobile-bridge.js until the backend is ready.
 */

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { serverDirectory } from '../server-directory.js';

const router = express.Router();

let cachedVersion = null;

/**
 * Read the server version from package.json instead of hardcoding it.
 * @returns {string}
 */
function getServerVersion() {
    if (cachedVersion !== null) {
        return cachedVersion;
    }
    try {
        const packageJson = JSON.parse(fs.readFileSync(path.join(serverDirectory, 'package.json'), 'utf8'));
        cachedVersion = typeof packageJson.version === 'string' ? packageJson.version : 'unknown';
    } catch {
        cachedVersion = 'unknown';
    }
    return cachedVersion;
}

router.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: Date.now(),
        version: getServerVersion(),
        platform: process.platform,
        uptime: Math.round(process.uptime()),
    });
});

export { router };
