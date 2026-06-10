package com.sillytavern.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.FileOutputStream;

public class NodeJsService extends Service {
    private static final String TAG = "NodeJsService";
    private static final String CHANNEL_ID = "NodeJsServiceChannel";
    private static final int NOTIFICATION_ID = 1;
    private Process nodeProcess;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("SillyTavern")
                .setContentText("Server running")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .build();

        startForeground(NOTIFICATION_ID, notification);

        startNodeJs();

        return START_STICKY;
    }

    private void startNodeJs() {
        try {
            File filesDir = getFilesDir();
            File backendDir = new File(filesDir, "backend");

            // Extract backend files on first run
            if (!backendDir.exists()) {
                extractBackendFiles();
            }

            // Determine architecture and select appropriate Node binary
            String abi = Build.SUPPORTED_ABIS[0];
            String nodeBinaryName;

            if (abi.contains("arm64")) {
                nodeBinaryName = "node-arm64";
            } else if (abi.contains("armeabi")) {
                nodeBinaryName = "node-armv7";
            } else if (abi.contains("x86_64")) {
                nodeBinaryName = "node-x64";
            } else {
                throw new RuntimeException("Unsupported architecture: " + abi);
            }

            // Extract node binary
            File nodeBinary = new File(filesDir, "node");
            if (!nodeBinary.exists()) {
                extractAsset("nodejs/" + nodeBinaryName, nodeBinary);
                nodeBinary.setExecutable(true);
            }

            File serverJs = new File(backendDir, "server.js");
            if (!serverJs.exists()) {
                throw new RuntimeException("Backend files not extracted");
            }

            // Start Node.js process
            ProcessBuilder pb = new ProcessBuilder(
                nodeBinary.getAbsolutePath(),
                serverJs.getAbsolutePath(),
                "--disableCsrf"
            );
            pb.directory(backendDir);
            pb.redirectErrorStream(true);

            // Set environment
            pb.environment().put("NODE_ENV", "production");
            pb.environment().put("PORT", "3000");

            nodeProcess = pb.start();
            Log.i(TAG, "Node.js process started on " + abi);

            // Monitor process output
            new Thread(() -> {
                try {
                    InputStream is = nodeProcess.getInputStream();
                    byte[] buffer = new byte[1024];
                    int read;
                    while ((read = is.read(buffer)) != -1) {
                        String output = new String(buffer, 0, read);
                        Log.d(TAG, "Node.js: " + output);
                    }
                } catch (IOException e) {
                    Log.e(TAG, "Error reading Node.js output", e);
                }
            }).start();

        } catch (Exception e) {
            Log.e(TAG, "Failed to start Node.js", e);
        }
    }

    private void extractAsset(String assetName, File outputFile) throws IOException {
        InputStream in = getAssets().open(assetName);
        FileOutputStream out = new FileOutputStream(outputFile);
        byte[] buffer = new byte[8192];
        int read;
        while ((read = in.read(buffer)) != -1) {
            out.write(buffer, 0, read);
        }
        in.close();
        out.close();
    }

    private void extractBackendFiles() {
        try {
            Log.i(TAG, "Extracting backend files...");
            File filesDir = getFilesDir();
            File backendDir = new File(filesDir, "backend");
            backendDir.mkdirs();

            // Extract backend assets directory
            copyAssetFolder("backend", backendDir.getAbsolutePath());

            Log.i(TAG, "Backend files extracted successfully");
        } catch (Exception e) {
            Log.e(TAG, "Failed to extract backend files", e);
        }
    }

    private void copyAssetFolder(String srcFolder, String destFolder) throws IOException {
        String[] files = getAssets().list(srcFolder);
        if (files == null || files.length == 0) return;

        File destDir = new File(destFolder);
        destDir.mkdirs();

        for (String file : files) {
            String srcPath = srcFolder + "/" + file;
            String destPath = destFolder + "/" + file;

            String[] subFiles = getAssets().list(srcPath);
            if (subFiles != null && subFiles.length > 0) {
                // It's a directory
                copyAssetFolder(srcPath, destPath);
            } else {
                // It's a file
                extractAsset(srcPath, new File(destPath));
            }
        }
    }

    @Override
    public void onDestroy() {
        if (nodeProcess != null) {
            nodeProcess.destroy();
            Log.i(TAG, "Node.js process stopped");
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Node.js Service",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Runs the SillyTavern backend server");

            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(channel);
        }
    }
}
