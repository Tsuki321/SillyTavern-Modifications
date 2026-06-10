import { describe, test, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { router } from '../../src/endpoints/health.js';

describe('Health Endpoint', () => {
    let app;

    beforeEach(() => {
        app = express();
        app.use('/api', router);
    });

    test('GET /api/health returns 200', async () => {
        const response = await request(app)
            .get('/api/health')
            .expect(200);

        expect(response.status).toBe(200);
    });

    test('Health response includes status ok', async () => {
        const response = await request(app).get('/api/health');

        expect(response.body).toHaveProperty('status', 'ok');
    });

    test('Health response includes version', async () => {
        const response = await request(app).get('/api/health');

        expect(response.body).toHaveProperty('version');
        expect(typeof response.body.version).toBe('string');
    });

    test('Health response includes timestamp', async () => {
        const response = await request(app).get('/api/health');

        expect(response.body).toHaveProperty('timestamp');
        expect(typeof response.body.timestamp).toBe('number');
        expect(response.body.timestamp).toBeGreaterThan(0);
    });

    test('Health response includes platform', async () => {
        const response = await request(app).get('/api/health');

        expect(response.body).toHaveProperty('platform');
        expect(typeof response.body.platform).toBe('string');
    });

    test('Health response is valid JSON', async () => {
        const response = await request(app).get('/api/health');

        expect(response.headers['content-type']).toMatch(/json/);
        expect(() => JSON.parse(JSON.stringify(response.body))).not.toThrow();
    });
});
