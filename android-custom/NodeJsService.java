package com.sillytavern.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.res.AssetManager;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * Foreground service that hosts the SillyTavern Node.js backend.
 *
 * <p>Responsibilities:
 * <ul>
 *   <li>Extract the bundled backend (assets/backend) to internal storage, recursively,
 *       re-extracting whenever the bundled VERSION stamp differs from the installed one.</li>
 *   <li>Launch the bundled Android Node.js runtime against server.js via ProcessBuilder.</li>
 *   <li>Forward the Node process output to logcat and wait until /api/health reports ready.</li>
 *   <li>Shut the Node process down when the service is stopped or the task is removed.</li>
 * </ul>
 */
public class NodeJsService extends Service {
    private static final String TAG = "NodeJsService";
    private static final String CHANNEL_ID = "NodeJsServiceChannel";
    private static final int NOTIFICATION_ID = 1;

    private static final String ACTION_STOP = "com.sillytavern.app.STOP_SERVER";

    private static final int SERVER_PORT = 8000;
    private static final long READY_TIMEOUT_MS = 120_000;
    private static final long READY_POLL_INTERVAL_MS = 1_000;
    private static final long STOP_TIMEOUT_MS = 5_000;

    private final Object lifecycleLock = new Object();
    private volatile boolean started = false;
    private volatile boolean stopRequested = false;
    private volatile Process nodeProcess = null;
    private Thread serverThread = null;
    private Thread logThread = null;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        // Must be called quickly after startForegroundService(), otherwise the system kills us.
        startForeground(NOTIFICATION_ID, buildNotification("SillyTavern", "Server starting..."));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            Log.i(TAG, "Stop requested");
            stopNodeProcess();
            stopSelf();
            return START_NOT_STICKY;
        }

        synchronized (lifecycleLock) {
            if (started) {
                Log.d(TAG, "Server thread already running, ignoring duplicate start");
                return START_STICKY;
            }
            started = true;
            stopRequested = false;
        }

        serverThread = new Thread(this::runServer, "SillyTavern-Server");
        serverThread.start();
        return START_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        Log.i(TAG, "Task removed, stopping server");
        stopNodeProcess();
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        stopNodeProcess();
        Thread thread;
        synchronized (lifecycleLock) {
            thread = serverThread;
            serverThread = null;
        }
        if (thread != null) {
            thread.interrupt();
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ------------------------------------------------------------------
    // Server lifecycle
    // ------------------------------------------------------------------

    private void runServer() {
        try {
            Log.i(TAG, "Extracting backend...");
            updateNotification("SillyTavern", "Preparing server files...");
            File backendDir = extractBackend();

            Log.i(TAG, "Launching Node.js backend...");
            updateNotification("SillyTavern", "Starting server...");
            launchNode(backendDir);

            Log.i(TAG, "Waiting for backend to become ready...");
            waitForReady();

            Log.i(TAG, "Backend is ready on port " + SERVER_PORT);
            updateNotification("SillyTavern", "Server running on port " + SERVER_PORT);

            // Block until the process exits so we can report unexpected deaths.
            Process process = nodeProcess;
            int exitCode = (process != null) ? process.waitFor() : -1;
            if (!stopRequested) {
                Log.e(TAG, "Node.js process exited unexpectedly with code " + exitCode);
                updateNotification("SillyTavern", "Server stopped unexpectedly (code " + exitCode + ")");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            Log.i(TAG, "Server thread interrupted");
        } catch (Exception e) {
            Log.e(TAG, "Failed to start backend", e);
            updateNotification("SillyTavern", "Server failed to start: " + firstLine(e.getMessage()));
        } finally {
            synchronized (lifecycleLock) {
                started = false;
            }
        }
    }

    private void stopNodeProcess() {
        stopRequested = true;
        Process process = nodeProcess;
        nodeProcess = null;
        if (process == null) {
            return;
        }
        Log.i(TAG, "Stopping Node.js process...");
        process.destroy();
        try {
            boolean exited = process.waitFor(STOP_TIMEOUT_MS, java.util.concurrent.TimeUnit.MILLISECONDS);
            if (!exited) {
                Log.w(TAG, "Node.js did not exit gracefully, forcing");
                process.destroyForcibly();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            process.destroyForcibly();
        }
        Thread logger = logThread;
        if (logger != null) {
            logger.interrupt();
            logThread = null;
        }
        Log.i(TAG, "Node.js process stopped");
    }

    // ------------------------------------------------------------------
    // Backend extraction
    // ------------------------------------------------------------------

    /**
     * Extracts assets/backend to internal storage.
     * Re-extracts only when the bundled VERSION stamp differs from the installed one,
     * so app updates actually refresh the backend instead of running stale code forever.
     */
    private File extractBackend() throws IOException {
        File backendDir = new File(getFilesDir(), "backend");
        String bundledVersion = readAssetText("backend/VERSION", "0").trim();
        String installedVersion = readInstalledVersion(backendDir);

        if (backendDir.exists() && bundledVersion.equals(installedVersion)) {
            Log.d(TAG, "Backend up to date (version " + installedVersion + ")");
            return backendDir;
        }

        Log.i(TAG, "Installing backend version " + bundledVersion + " (was: " + installedVersion + ")");
        deleteRecursive(backendDir);
        if (!backendDir.mkdirs()) {
            throw new IOException("Failed to create backend directory: " + backendDir);
        }
        copyAssetRecursive("backend", backendDir);

        File nodeBinary = findNodeBinary(backendDir, false);
        if (nodeBinary != null && !nodeBinary.setExecutable(true)) {
            Log.w(TAG, "Failed to set executable bit on " + nodeBinary);
        }
        return backendDir;
    }

    private String readInstalledVersion(File backendDir) {
        File versionFile = new File(backendDir, "VERSION");
        if (!versionFile.isFile()) {
            return "";
        }
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(new java.io.FileInputStream(versionFile), StandardCharsets.UTF_8))) {
            String line = reader.readLine();
            return (line != null) ? line.trim() : "";
        } catch (IOException e) {
            Log.w(TAG, "Failed to read installed backend version", e);
            return "";
        }
    }

    private String readAssetText(String assetPath, String fallback) {
        try (InputStream in = getAssets().open(assetPath);
             BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line).append('\n');
            }
            return sb.toString();
        } catch (IOException e) {
            return fallback;
        }
    }

    private void copyAssetRecursive(String assetPath, File dest) throws IOException {
        AssetManager assets = getAssets();
        String[] children = assets.list(assetPath);
        if (children != null && children.length > 0) {
            if (!dest.exists() && !dest.mkdirs()) {
                throw new IOException("Failed to create directory: " + dest);
            }
            for (String child : children) {
                copyAssetRecursive(assetPath + "/" + child, new File(dest, child));
            }
            return;
        }
        // Leaf node: copy as a file. (Empty asset dirs are skipped; the server mkdirs what it needs.)
        File parent = dest.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IOException("Failed to create directory: " + parent);
        }
        try (InputStream in = assets.open(assetPath);
             OutputStream out = new FileOutputStream(dest)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
        }
    }

    private void deleteRecursive(File file) {
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursive(child);
                }
            }
        }
        if (file.exists() && !file.delete()) {
            Log.w(TAG, "Failed to delete " + file);
        }
    }

    // ------------------------------------------------------------------
    // Node.js process management
    // ------------------------------------------------------------------

    /** Maps Android ABIs to the bundled standalone Node.js runtime file names. */
    private static String abiToNodeBinary(String abi) {
        switch (abi) {
            case "arm64-v8a": return "node-arm64";
            case "armeabi-v7a": return "node-armv7";
            case "x86_64": return "node-x64";
            case "x86": return "node-x86";
            default: return null;
        }
    }

    private File findNodeBinary(File backendDir, boolean failIfMissing) throws IOException {
        File runtimeDir = new File(backendDir, "nodejs");
        List<String> abis = new ArrayList<>();
        if (Build.SUPPORTED_ABIS != null) {
            abis.addAll(Arrays.asList(Build.SUPPORTED_ABIS));
        }
        for (String abi : abis) {
            String name = abiToNodeBinary(abi);
            if (name == null) continue;
            File candidate = new File(runtimeDir, name);
            if (candidate.isFile()) {
                Log.i(TAG, "Using Node.js runtime " + name + " for ABI " + abi);
                return candidate;
            }
        }
        if (failIfMissing) {
            throw new IOException(
                "No Node.js runtime bundled for this device (ABIs: " + abis + "). "
                + "Expected one of backend/nodejs/node-{arm64,armv7,x64,x86}. See ANDROID.md.");
        }
        return null;
    }

    private void launchNode(File backendDir) throws IOException {
        File nodeBinary = findNodeBinary(backendDir, true);
        File serverJs = new File(backendDir, "server.js");
        if (!serverJs.isFile()) {
            throw new IOException("Bundled backend is missing server.js: " + serverJs);
        }

        File dataRoot = new File(getFilesDir(), "st-data");
        File configDir = new File(getFilesDir(), "st-config");
        File configFile = new File(configDir, "config.yaml");
        if (!dataRoot.exists() && !dataRoot.mkdirs()) {
            throw new IOException("Failed to create data directory: " + dataRoot);
        }
        if (!configDir.exists() && !configDir.mkdirs()) {
            throw new IOException("Failed to create config directory: " + configDir);
        }
        // server.js resolves the default config from the backend dir; user data/config live
        // outside of it so backend re-extraction on app update never wipes them.
        List<String> command = Arrays.asList(
            nodeBinary.getAbsolutePath(),
            serverJs.getAbsolutePath(),
            "--port", String.valueOf(SERVER_PORT),
            "--dataRoot", dataRoot.getAbsolutePath(),
            "--configPath", configFile.getAbsolutePath()
        );

        ProcessBuilder pb = new ProcessBuilder(command);
        pb.directory(backendDir);
        pb.redirectErrorStream(true);
        Map<String, String> env = pb.environment();
        env.put("HOME", getFilesDir().getAbsolutePath());
        env.put("TMPDIR", getCacheDir().getAbsolutePath());
        env.put("ANDROID_DATA_DIR", dataRoot.getAbsolutePath());
        // No git binary exists on-device; never attempt extension auto-updates.
        env.put("SILLYTAVERN_EXTENSIONS_AUTOUPDATE", "false");

        Log.i(TAG, "Starting: " + String.join(" ", command));
        Process process = pb.start();
        nodeProcess = process;
        startLogPump(process.getInputStream());
    }

    private void startLogPump(final InputStream in) {
        logThread = new Thread(() -> {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
                String line;
                while (!Thread.currentThread().isInterrupted() && (line = reader.readLine()) != null) {
                    Log.i("SillyTavern-Node", line);
                }
            } catch (IOException e) {
                if (!stopRequested) {
                    Log.w(TAG, "Node log pump ended", e);
                }
            }
        }, "SillyTavern-LogPump");
        logThread.setDaemon(true);
        logThread.start();
    }

    private void waitForReady() throws IOException, InterruptedException {
        String healthUrl = "http://127.0.0.1:" + SERVER_PORT + "/api/health";
        long deadline = System.currentTimeMillis() + READY_TIMEOUT_MS;
        int attempt = 0;
        while (System.currentTimeMillis() < deadline) {
            if (stopRequested || Thread.currentThread().isInterrupted()) {
                throw new InterruptedException("Stop requested while waiting for backend");
            }
            Process process = nodeProcess;
            if (process != null && !process.isAlive()) {
                throw new IOException("Node.js process died during startup (exit " + process.exitValue() + ")");
            }
            attempt++;
            if (probeHealth(healthUrl)) {
                return;
            }
            if (attempt % 10 == 0) {
                updateNotification("SillyTavern", "Starting server... (" + (attempt / 10 * 10) + "s)");
            }
            Thread.sleep(READY_POLL_INTERVAL_MS);
        }
        throw new IOException("Backend did not become ready within " + (READY_TIMEOUT_MS / 1000) + "s");
    }

    private boolean probeHealth(String healthUrl) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(healthUrl).openConnection();
            connection.setConnectTimeout(2000);
            connection.setReadTimeout(2000);
            connection.setRequestMethod("GET");
            if (connection.getResponseCode() != 200) {
                return false;
            }
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                StringBuilder body = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    body.append(line);
                }
                return body.toString().contains("\"status\"") && body.toString().contains("\"ok\"");
            }
        } catch (IOException e) {
            return false;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    // ------------------------------------------------------------------
    // Notifications
    // ------------------------------------------------------------------

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "SillyTavern Server",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Keeps the embedded SillyTavern server running");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private Notification buildNotification(String title, String text) {
        Intent openApp = new Intent(this, MainActivity.class);
        openApp.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openAppIntent = PendingIntent.getActivity(
            this, 0, openApp, pendingIntentFlags());

        Intent stopIntent = new Intent(this, NodeJsService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPendingIntent = PendingIntent.getService(
            this, 1, stopIntent, pendingIntentFlags());

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(getApplicationInfo().icon)
            .setContentIntent(openAppIntent)
            .addAction(new NotificationCompat.Action.Builder(
                null, "Stop server", stopPendingIntent).build())
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build();
    }

    private void updateNotification(String title, String text) {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, buildNotification(title, text));
        }
    }

    private static int pendingIntentFlags() {
        // FLAG_IMMUTABLE is required on Android 12+ and available since API 23.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.FLAG_UPDATE_CURRENT;
    }

    private static String firstLine(String message) {
        if (message == null || message.isEmpty()) {
            return "unknown error";
        }
        int newline = message.indexOf('\n');
        String first = (newline >= 0) ? message.substring(0, newline) : message;
        return (first.length() > 120) ? first.substring(0, 120) + "..." : first;
    }
}
