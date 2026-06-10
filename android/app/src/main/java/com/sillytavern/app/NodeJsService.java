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
            File nodeBinary = new File(filesDir, "node");
            File serverJs = new File(filesDir, "server.js");

            // Extract node binary if needed
            if (!nodeBinary.exists()) {
                extractAsset("node", nodeBinary);
                nodeBinary.setExecutable(true);
            }

            // Extract backend files if needed
            if (!serverJs.exists()) {
                extractBackendFiles();
            }

            // Start Node.js process
            ProcessBuilder pb = new ProcessBuilder(
                nodeBinary.getAbsolutePath(),
                serverJs.getAbsolutePath()
            );
            pb.directory(filesDir);
            pb.redirectErrorStream(true);

            nodeProcess = pb.start();
            Log.i(TAG, "Node.js process started");

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
        // TODO: Extract src/, server.js, and node_modules from assets
        Log.i(TAG, "Extracting backend files...");
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
