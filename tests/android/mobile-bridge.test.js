import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { MobileServerBridge, isServedFromBackend, resolveBackAction } from '../../public/mobile-bridge.js';

describe('isServedFromBackend', () => {
    test('detects the backend origin', () => {
        expect(isServedFromBackend({ hostname: '127.0.0.1', port: '8000' }, 8000)).toBe(true);
        expect(isServedFromBackend({ hostname: 'localhost', port: '8000' }, 8000)).toBe(true);
    });

    test('rejects the Capacitor shell origin (default port)', () => {
        expect(isServedFromBackend({ hostname: 'localhost', port: '' }, 8000)).toBe(false);
    });

    test('rejects wrong ports and hosts', () => {
        expect(isServedFromBackend({ hostname: '127.0.0.1', port: '3000' }, 8000)).toBe(false);
        expect(isServedFromBackend({ hostname: 'example.com', port: '8000' }, 8000)).toBe(false);
    });

    test('handles missing location', () => {
        expect(isServedFromBackend(undefined, 8000)).toBe(false);
        expect(isServedFromBackend(null, 8000)).toBe(false);
        expect(isServedFromBackend({}, 8000)).toBe(false);
    });
});

describe('resolveBackAction', () => {
    test('closes the topmost open popup first', () => {
        const bottom = { id: 'bottom' };
        const top = { id: 'top' };
        const doc = {
            querySelectorAll: () => [bottom, top],
            querySelector: () => null,
        };
        const action = resolveBackAction(doc);
        expect(action.type).toBe('popup');
        expect(action.element).toBe(top);
    });

    test('closes an open drawer when no popup is open', () => {
        const toggle = { click: () => {} };
        const drawer = { parentElement: { querySelector: () => toggle } };
        const doc = {
            querySelectorAll: () => [],
            querySelector: (selector) => selector.includes('drawer-content') ? drawer : null,
        };
        const action = resolveBackAction(doc);
        expect(action.type).toBe('drawer');
        expect(action.toggle).toBe(toggle);
    });

    test('minimizes when nothing is open', () => {
        const doc = { querySelectorAll: () => [], querySelector: () => null };
        expect(resolveBackAction(doc)).toEqual({ type: 'minimize' });
    });

    test('minimizes when document is missing', () => {
        expect(resolveBackAction(undefined)).toEqual({ type: 'minimize' });
        expect(resolveBackAction(null)).toEqual({ type: 'minimize' });
    });
});

describe('MobileServerBridge', () => {
    const realWindow = globalThis.window;
    const realDocument = globalThis.document;

    beforeEach(() => {
        delete globalThis.window;
        delete globalThis.document;
    });

    afterEach(() => {
        if (realWindow === undefined) delete globalThis.window;
        else globalThis.window = realWindow;
        if (realDocument === undefined) delete globalThis.document;
        else globalThis.document = realDocument;
    });

    describe('init', () => {
        test('is a no-op on desktop (no Capacitor)', async () => {
            globalThis.window = {};
            const bridge = new MobileServerBridge();
            await expect(bridge.init()).resolves.toBe('desktop');
            expect(bridge.isServerReady).toBe(false);
        });

        test('enters server mode when already on the backend origin', async () => {
            globalThis.window = {
                Capacitor: { Plugins: {} },
                location: { hostname: '127.0.0.1', port: '8000' },
            };
            const bridge = new MobileServerBridge();
            await expect(bridge.init()).resolves.toBe('server');
            expect(bridge.isServerReady).toBe(true);
        });
    });

    describe('waitForServer', () => {
        test('resolves once the health probe succeeds', async () => {
            let calls = 0;
            const fetchImpl = async (url) => {
                calls++;
                expect(url).toContain('/api/health');
                if (calls < 3) throw new Error('connect ECONNREFUSED');
                return { ok: true };
            };
            const bridge = new MobileServerBridge({
                fetchImpl,
                readyBudgetMs: 5000,
                probeTimeoutMs: 500,
                baseRetryDelayMs: 5,
                maxRetryDelayMs: 10,
            });
            await expect(bridge.waitForServer()).resolves.toBe(true);
            expect(calls).toBe(3);
        });

        test('rejects after the budget runs out', async () => {
            const fetchImpl = async () => { throw new Error('connect ECONNREFUSED'); };
            const bridge = new MobileServerBridge({
                fetchImpl,
                readyBudgetMs: 80,
                probeTimeoutMs: 20,
                baseRetryDelayMs: 5,
                maxRetryDelayMs: 10,
            });
            await expect(bridge.waitForServer()).rejects.toThrow(/did not become ready/);
        });

        test('aborts probes that hang (no hanging wait)', async () => {
            const fetchImpl = (_url, options) => new Promise((_resolve, reject) => {
                options.signal.addEventListener('abort', () => reject(new Error('aborted')));
            });
            const bridge = new MobileServerBridge({
                fetchImpl,
                readyBudgetMs: 120,
                probeTimeoutMs: 15,
                baseRetryDelayMs: 5,
                maxRetryDelayMs: 10,
            });
            const started = Date.now();
            await expect(bridge.waitForServer()).rejects.toThrow();
            // Must fail on the ~120ms budget, not hang forever.
            expect(Date.now() - started).toBeLessThan(10000);
        });
    });

    describe('checkHealthOnce', () => {
        test('returns true on ok, false on failure', async () => {
            const okBridge = new MobileServerBridge({ fetchImpl: async () => ({ ok: true }) });
            await expect(okBridge.checkHealthOnce(50)).resolves.toBe(true);

            const badBridge = new MobileServerBridge({
                fetchImpl: async () => { throw new Error('down'); },
            });
            await expect(badBridge.checkHealthOnce(50)).resolves.toBe(false);
        });
    });

    describe('handleBackButton', () => {
        test('dispatches cancel on the topmost popup', () => {
            let dispatched = null;
            const popup = { dispatchEvent: (event) => { dispatched = event; } };
            globalThis.document = { querySelectorAll: () => [popup], querySelector: () => null };
            globalThis.window = { Capacitor: { Plugins: {} } };

            const bridge = new MobileServerBridge();
            expect(bridge.handleBackButton()).toBe(true);
            expect(dispatched).not.toBeNull();
            expect(dispatched.type).toBe('cancel');
        });

        test('clicks the drawer toggle when a drawer is open', () => {
            let clicked = false;
            const toggle = { click: () => { clicked = true; } };
            const drawer = { parentElement: { querySelector: () => toggle } };
            globalThis.document = {
                querySelectorAll: () => [],
                querySelector: () => drawer,
            };
            globalThis.window = { Capacitor: { Plugins: {} } };

            const bridge = new MobileServerBridge();
            expect(bridge.handleBackButton()).toBe(true);
            expect(clicked).toBe(true);
        });

        test('minimizes the app when nothing is open', () => {
            let minimized = false;
            globalThis.document = { querySelectorAll: () => [], querySelector: () => null };
            globalThis.window = {
                Capacitor: { Plugins: { App: { minimizeApp: () => { minimized = true; } } } },
            };

            const bridge = new MobileServerBridge();
            expect(bridge.handleBackButton()).toBe(true);
            expect(minimized).toBe(true);
        });
    });
});
