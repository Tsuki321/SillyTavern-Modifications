/**
 * Mobile initialization bridge for SillyTavern Android
 * Manages Node.js server lifecycle and connects frontend to backend
 */

class MobileServerBridge {
    constructor() {
        this.serverPort = 3000;
        this.serverUrl = `http://localhost:${this.serverPort}`;
        this.maxRetries = 10;
        this.retryDelay = 500;
        this.isServerReady = false;
    }

    /**
     * Initialize the mobile bridge
     */
    async init() {
        console.log('[MobileBridge] Initializing...');

        // Check if running in Capacitor
        if (!window.Capacitor) {
            console.log('[MobileBridge] Not running in Capacitor, skipping mobile initialization');
            return;
        }

        this.showLoadingScreen();

        try {
            // Start Node.js server
            await this.startNodeServer();

            // Wait for server to be ready
            await this.waitForServer();

            // Configure API endpoints
            this.configureEndpoints();

            // Setup lifecycle handlers
            this.setupLifecycleHandlers();

            this.hideLoadingScreen();
            console.log('[MobileBridge] Initialization complete');

        } catch (error) {
            console.error('[MobileBridge] Initialization failed:', error);
            this.showError('Failed to start server. Please restart the app.');
        }
    }

    /**
     * Start the embedded Node.js server
     */
    async startNodeServer() {
        console.log('[MobileBridge] Starting Node.js server...');

        if (window.Capacitor?.Plugins?.NodeJS) {
            try {
                await window.Capacitor.Plugins.NodeJS.start({
                    script: 'server.js',
                    port: this.serverPort
                });
                console.log('[MobileBridge] Node.js server started');
            } catch (error) {
                console.error('[MobileBridge] Failed to start Node.js:', error);
                throw error;
            }
        } else {
            console.warn('[MobileBridge] NodeJS plugin not available');
        }
    }

    /**
     * Wait for server to respond
     */
    async waitForServer() {
        console.log('[MobileBridge] Waiting for server to be ready...');

        for (let i = 0; i < this.maxRetries; i++) {
            try {
                const response = await fetch(`${this.serverUrl}/api/health`, {
                    method: 'GET',
                    timeout: 2000
                });

                if (response.ok) {
                    this.isServerReady = true;
                    console.log('[MobileBridge] Server is ready');
                    return;
                }
            } catch (error) {
                console.log(`[MobileBridge] Server not ready, retry ${i + 1}/${this.maxRetries}`);
            }

            await this.delay(this.retryDelay);
        }

        throw new Error('Server failed to start within timeout');
    }

    /**
     * Configure API endpoints to use localhost
     */
    configureEndpoints() {
        console.log('[MobileBridge] Configuring endpoints...');

        // Override base URL for API calls
        if (typeof window !== 'undefined') {
            window.MOBILE_MODE = true;
            window.API_BASE_URL = this.serverUrl;
        }
    }

    /**
     * Setup app lifecycle handlers
     */
    setupLifecycleHandlers() {
        console.log('[MobileBridge] Setting up lifecycle handlers...');

        if (!window.Capacitor?.Plugins?.App) return;

        const { App } = window.Capacitor.Plugins;

        // Handle app going to background
        App.addListener('appStateChange', ({ isActive }) => {
            console.log('[MobileBridge] App state changed:', isActive ? 'active' : 'background');

            if (!isActive) {
                this.onAppPause();
            } else {
                this.onAppResume();
            }
        });

        // Handle Android back button
        App.addListener('backButton', (event) => {
            console.log('[MobileBridge] Back button pressed');
            this.handleBackButton(event);
        });
    }

    /**
     * Handle app pause (background)
     */
    onAppPause() {
        console.log('[MobileBridge] App paused');
        // Reduce polling, cleanup listeners
        if (window.eventSource) {
            window.eventSource.close();
        }
    }

    /**
     * Handle app resume (foreground)
     */
    onAppResume() {
        console.log('[MobileBridge] App resumed');
        // Reconnect, restart polling
        if (this.isServerReady && window.eventSource?.readyState !== EventSource.OPEN) {
            // Reinitialize event source if needed
        }
    }

    /**
     * Handle Android back button
     */
    handleBackButton(event) {
        // Check if drawer/modal is open
        const hasOpenModal = document.querySelector('.drawer.open, .modal.show');

        if (hasOpenModal) {
            // Close modal/drawer instead of exiting app
            event.preventDefault();
            // Trigger close on topmost modal/drawer
            const closeButton = document.querySelector('.drawer.open .drawer_close, .modal.show .modal_close');
            if (closeButton) closeButton.click();
        } else {
            // Let app minimize to background
            if (window.Capacitor?.Plugins?.App) {
                window.Capacitor.Plugins.App.minimizeApp();
            }
        }
    }

    /**
     * Show loading screen
     */
    showLoadingScreen() {
        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'mobile-loading';
        loadingDiv.innerHTML = `
            <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                        background: #000; display: flex; align-items: center; justify-content: center;
                        z-index: 10000; flex-direction: column; color: #fff;">
                <div class="spinner" style="margin-bottom: 20px;"></div>
                <p>Starting SillyTavern...</p>
            </div>
        `;
        document.body.appendChild(loadingDiv);
    }

    /**
     * Hide loading screen
     */
    hideLoadingScreen() {
        const loadingDiv = document.getElementById('mobile-loading');
        if (loadingDiv) {
            loadingDiv.style.opacity = '0';
            loadingDiv.style.transition = 'opacity 0.3s';
            setTimeout(() => loadingDiv.remove(), 300);
        }
    }

    /**
     * Show error message
     */
    showError(message) {
        alert(message);
    }

    /**
     * Delay helper
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Initialize bridge when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', async () => {
        const bridge = new MobileServerBridge();
        await bridge.init();
    });
} else {
    (async () => {
        const bridge = new MobileServerBridge();
        await bridge.init();
    })();
}
