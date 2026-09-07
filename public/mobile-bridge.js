/**
 * Mobile shell bridge for the SillyTavern Android app.
 *
 * Architecture: the Capacitor WebView is only a boot shell. The embedded Node.js backend
 * (started natively by MainActivity/NodeJsService) is the ONLY HTTP server, so once it is
 * healthy this bridge redirects the WebView to it (same-origin: no CORS, cookie, or CSRF
 * issues, and zero changes needed in the SillyTavern frontend).
 *
 * Modes:
 *  - Desktop browser (no window.Capacitor): no-op, init() returns 'desktop'.
 *  - Boot shell (Capacitor, NOT on the backend origin): splash screen -> wait for
 *    /api/health -> location.replace(backend). init() returns 'redirecting' or 'error'.
 *  - Backend origin (Capacitor, on http://127.0.0.1:8000): only lifecycle handlers
 *    (pause/resume/back-button). init() returns 'server'.
 *
 * The module is import-safe in Node (for unit tests): the auto-boot block below only runs
 * when both window and document exist.
 */

const DEFAULT_SERVER_HOST = '127.0.0.1';
const DEFAULT_SERVER_PORT = 8000;
// First boot can be slow on low-end devices (backend extraction, config init, keygen).
const DEFAULT_READY_BUDGET_MS = 120000;
const DEFAULT_PROBE_TIMEOUT_MS = 3000;
const DEFAULT_BASE_RETRY_DELAY_MS = 500;
const DEFAULT_MAX_RETRY_DELAY_MS = 2000;

const BACKEND_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * Check whether the given location is already served by the backend.
 * @param {{hostname?: string, port?: string|number}|undefined|null} location Window.location-like
 * @param {number|string} serverPort Expected backend port
 * @returns {boolean}
 */
export function isServedFromBackend(location, serverPort) {
    if (!location || typeof location.hostname !== 'string') {
        return false;
    }
    return BACKEND_HOSTS.has(location.hostname) && String(location.port) === String(serverPort);
}

/**
 * Decide what the Android back button should do, using SillyTavern's real UI structure:
 * popups are native <dialog class="popup"> elements (topmost wins), drawers use
 * .drawer-content.openDrawer with a sibling .drawer-toggle.
 * @param {Document|undefined|null} doc Document-like with querySelector(All)
 * @returns {{type: 'popup', element: object}|{type: 'drawer', drawer: object, toggle: object}|{type: 'minimize'}}
 */
export function resolveBackAction(doc) {
    if (!doc || typeof doc.querySelectorAll !== 'function') {
        return { type: 'minimize' };
    }
    const openPopups = doc.querySelectorAll('dialog.popup[open]');
    if (openPopups && openPopups.length > 0) {
        return { type: 'popup', element: openPopups[openPopups.length - 1] };
    }
    const openDrawer = typeof doc.querySelector === 'function'
        ? doc.querySelector('.drawer-content.openDrawer:not(.pinnedOpen)')
        : null;
    if (openDrawer) {
        const toggle = openDrawer.parentElement && typeof openDrawer.parentElement.querySelector === 'function'
            ? openDrawer.parentElement.querySelector('.drawer-toggle')
            : null;
        if (toggle) {
            return { type: 'drawer', drawer: openDrawer, toggle };
        }
    }
    return { type: 'minimize' };
}

export class MobileServerBridge {
    /**
     * @param {object} [options]
     * @param {string} [options.serverHost]
     * @param {number} [options.serverPort]
     * @param {number} [options.readyBudgetMs] Total time to wait for the backend
     * @param {number} [options.probeTimeoutMs] Per-probe timeout (AbortController)
     * @param {number} [options.baseRetryDelayMs]
     * @param {number} [options.maxRetryDelayMs]
     * @param {Function} [options.fetchImpl] fetch implementation (injectable for tests)
     */
    constructor(options = {}) {
        this.serverHost = options.serverHost || DEFAULT_SERVER_HOST;
        this.serverPort = options.serverPort || DEFAULT_SERVER_PORT;
        this.serverUrl = `http://${this.serverHost}:${this.serverPort}`;
        this.readyBudgetMs = options.readyBudgetMs ?? DEFAULT_READY_BUDGET_MS;
        this.probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
        this.baseRetryDelayMs = options.baseRetryDelayMs ?? DEFAULT_BASE_RETRY_DELAY_MS;
        this.maxRetryDelayMs = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
        this.fetchImpl = options.fetchImpl
            || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
        this.isServerReady = false;
    }

    /**
     * Initialize the bridge. See the header comment for the three modes.
     * @returns {Promise<'desktop'|'server'|'redirecting'|'error'>}
     */
    async init() {
        const windowRef = globalThis.window;
        if (!windowRef || !windowRef.Capacitor) {
            return 'desktop';
        }

        // Already served by the backend: no splash, no redirect, just lifecycle handlers.
        if (isServedFromBackend(windowRef.location, this.serverPort)) {
            this.isServerReady = true;
            this.setupLifecycleHandlers();
            return 'server';
        }

        // Boot shell: wait for the natively-started backend, then hand over to it.
        this.showLoadingScreen();
        try {
            await this.waitForServer((attempt, elapsedMs) => {
                this.updateLoadingStatus(`Starting SillyTavern... (${Math.round(elapsedMs / 1000)}s)`);
            });
            this.isServerReady = true;
            this.updateLoadingStatus('Server ready. Loading...');
            windowRef.location.replace(`${this.serverUrl}/`);
            return 'redirecting';
        } catch (error) {
            console.error('[MobileBridge] Backend failed to become ready:', error);
            this.showError('The local server did not start. The Node.js runtime may be missing from this build - see ANDROID.md.');
            return 'error';
        }
    }

    /**
     * Poll /api/health until the backend answers or the budget runs out.
     * Uses AbortController per probe: fetch() has no `timeout` option.
     * @param {(attempt: number, elapsedMs: number) => void} [onProgress]
     * @returns {Promise<true>}
     */
    async waitForServer(onProgress) {
        if (!this.fetchImpl) {
            throw new Error('No fetch implementation available');
        }
        const startedAt = Date.now();
        const deadline = startedAt + this.readyBudgetMs;
        let delayMs = this.baseRetryDelayMs;
        let attempt = 0;

        for (;;) {
            attempt++;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.probeTimeoutMs);
            try {
                const response = await this.fetchImpl(`${this.serverUrl}/api/health`, {
                    method: 'GET',
                    cache: 'no-store',
                    signal: controller.signal,
                });
                if (response && response.ok) {
                    return true;
                }
            } catch (error) {
                // Connection refused / timeout / abort: backend not up yet. Keep waiting.
            } finally {
                clearTimeout(timer);
            }

            const elapsedMs = Date.now() - startedAt;
            if (elapsedMs >= this.readyBudgetMs || Date.now() >= deadline) {
                throw new Error(`Backend did not become ready within ${this.readyBudgetMs}ms`);
            }
            if (onProgress) {
                try { onProgress(attempt, elapsedMs); } catch { /* progress UI must never break the loop */ }
            }
            await this.delay(delayMs);
            delayMs = Math.min(delayMs * 1.5, this.maxRetryDelayMs);
        }
    }

    /**
     * Single health probe with its own timeout. Used for resume re-checks.
     * @param {number} [timeoutMs]
     * @returns {Promise<boolean>}
     */
    async checkHealthOnce(timeoutMs = this.probeTimeoutMs) {
        if (!this.fetchImpl) {
            return false;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await this.fetchImpl(`${this.serverUrl}/api/health`, {
                method: 'GET',
                cache: 'no-store',
                signal: controller.signal,
            });
            return !!(response && response.ok);
        } catch {
            return false;
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Setup Capacitor lifecycle handlers. Safe to call when plugins are absent.
     */
    setupLifecycleHandlers() {
        const windowRef = globalThis.window;
        const app = windowRef && windowRef.Capacitor && windowRef.Capacitor.Plugins
            ? windowRef.Capacitor.Plugins.App
            : null;
        if (!app || typeof app.addListener !== 'function') {
            return;
        }

        app.addListener('appStateChange', ({ isActive }) => {
            if (isActive) {
                this.onAppResume();
            } else {
                this.onAppPause();
            }
        });

        // Note: Capacitor's backButton payload is informational ({ canGoBack }); registering
        // the listener overrides the default behavior, there is no preventDefault().
        app.addListener('backButton', () => {
            this.handleBackButton();
        });
    }

    /**
     * App moved to background: notify the page so it can pause timers/streams.
     */
    onAppPause() {
        try {
            globalThis.window && globalThis.window.dispatchEvent(
                new CustomEvent('sillytavern:mobile-pause'));
        } catch (error) {
            console.warn('[MobileBridge] pause dispatch failed:', error);
        }
    }

    /**
     * App returned to foreground: notify the page and verify the backend survived.
     */
    async onAppResume() {
        try {
            globalThis.window && globalThis.window.dispatchEvent(
                new CustomEvent('sillytavern:mobile-resume'));
        } catch (error) {
            console.warn('[MobileBridge] resume dispatch failed:', error);
        }

        // The OS may have killed the backend while we were away.
        const healthy = await this.checkHealthOnce();
        this.isServerReady = healthy;
        if (!healthy && isServedFromBackend(globalThis.window && globalThis.window.location, this.serverPort)) {
            console.warn('[MobileBridge] Backend gone after resume, re-waiting...');
            this.showLoadingScreen();
            this.updateLoadingStatus('Reconnecting to server...');
            try {
                await this.waitForServer();
                this.isServerReady = true;
                globalThis.window.location.reload();
            } catch {
                this.showError('Lost connection to the local server.');
            }
        }
    }

    /**
     * Handle the Android back button.
     * @returns {boolean} True if the press was handled.
     */
    handleBackButton() {
        const action = resolveBackAction(globalThis.document);
        if (action.type === 'popup') {
            // Dispatching 'cancel' runs the Popup's own close path (result propagation,
            // allowEscapeClose / double-escape force-close semantics included).
            action.element.dispatchEvent(new Event('cancel', { cancelable: true }));
            return true;
        }
        if (action.type === 'drawer') {
            action.toggle.click();
            return true;
        }
        const windowRef = globalThis.window;
        const app = windowRef && windowRef.Capacitor && windowRef.Capacitor.Plugins
            ? windowRef.Capacitor.Plugins.App
            : null;
        if (app && typeof app.minimizeApp === 'function') {
            try {
                const result = app.minimizeApp();
                if (result && typeof result.catch === 'function') {
                    result.catch((error) => console.warn('[MobileBridge] minimizeApp failed:', error));
                }
            } catch (error) {
                console.warn('[MobileBridge] minimizeApp failed:', error);
            }
            return true;
        }
        return false;
    }

    /**
     * Show (or reuse) the boot splash overlay.
     */
    showLoadingScreen() {
        const doc = globalThis.document;
        if (!doc || doc.getElementById('mobile-loading')) {
            return;
        }
        const overlay = doc.createElement('div');
        overlay.id = 'mobile-loading';
        overlay.innerHTML = `
            <style>
                #mobile-loading { position: fixed; inset: 0; background: #000; display: flex;
                    align-items: center; justify-content: center; z-index: 10000;
                    flex-direction: column; color: #fff; font-family: sans-serif; }
                #mobile-loading .mobile-spinner { width: 44px; height: 44px; margin-bottom: 20px;
                    border: 4px solid #333; border-top-color: #fff; border-radius: 50%;
                    animation: mobile-spin 0.9s linear infinite; }
                @keyframes mobile-spin { to { transform: rotate(360deg); } }
                #mobile-loading-status { opacity: 0.8; font-size: 14px; }
                #mobile-loading .mobile-error { max-width: 80%; text-align: center; }
                #mobile-loading .mobile-retry { margin-top: 16px; padding: 10px 28px; font-size: 15px;
                    border-radius: 6px; border: 1px solid #666; background: #222; color: #fff; }
            </style>
            <div class="mobile-spinner"></div>
            <p>Starting SillyTavern...</p>
            <p id="mobile-loading-status"></p>
        `;
        doc.body.appendChild(overlay);
    }

    /**
     * Update the splash status line (no-op if the splash is not shown).
     * @param {string} text
     */
    updateLoadingStatus(text) {
        const doc = globalThis.document;
        const status = doc && doc.getElementById('mobile-loading-status');
        if (status) {
            status.textContent = text;
        }
    }

    /**
     * Hide the splash overlay.
     */
    hideLoadingScreen() {
        const doc = globalThis.document;
        const overlay = doc && doc.getElementById('mobile-loading');
        if (overlay) {
            overlay.style.opacity = '0';
            overlay.style.transition = 'opacity 0.3s';
            setTimeout(() => overlay.remove(), 300);
        }
    }

    /**
     * Replace the splash with an error panel and a Retry button (never alert()).
     * @param {string} message
     */
    showError(message) {
        const doc = globalThis.document;
        if (!doc) {
            return;
        }
        let overlay = doc.getElementById('mobile-loading');
        if (!overlay) {
            this.showLoadingScreen();
            overlay = doc.getElementById('mobile-loading');
        }
        if (!overlay) {
            return;
        }
        overlay.innerHTML = `
            <div class="mobile-error">
                <p style="font-size: 18px; margin-bottom: 8px;">Couldn't start the server</p>
                <p id="mobile-error-text" style="opacity: 0.8; font-size: 14px;"></p>
                <button id="mobile-retry" class="mobile-retry" type="button">Retry</button>
            </div>
        `;
        const text = doc.getElementById('mobile-error-text');
        if (text) {
            text.textContent = message;
        }
        const retry = doc.getElementById('mobile-retry');
        if (retry) {
            retry.addEventListener('click', () => {
                overlay.remove();
                this.init().catch((error) => console.error('[MobileBridge] Retry failed:', error));
            });
        }
    }

    /**
     * Delay helper.
     * @param {number} ms
     * @returns {Promise<void>}
     */
    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

// Auto-boot in browsers only. This script MUST stay a synchronous head script (no defer):
// in the boot shell it has to redirect to the backend before the app scripts start firing
// same-origin API calls at the wrong origin.
if (typeof globalThis.document !== 'undefined' && typeof globalThis.window !== 'undefined') {
    const boot = () => {
        const bridge = new MobileServerBridge();
        globalThis.window.MobileBridge = bridge;
        bridge.init().catch((error) => console.error('[MobileBridge] init failed:', error));
    };
    if (globalThis.document.readyState === 'loading') {
        globalThis.document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
}
