/**
 * Health check endpoint for mobile app
 */

import express from 'express';

const router = express.Router();

router.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: Date.now(),
        version: '1.18.0',
        platform: process.platform
    });
});

export { router };
