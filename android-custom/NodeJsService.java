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
import java.io.*;

public class NodeJsService extends Service {
    private static final String TAG = "NodeJsService";
    private static final String CHANNEL_ID = "NodeJsServiceChannel";
    private Process nodeProcess;

    static {
        System.loadLibrary("node");
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        startForeground(1, buildNotification());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        new Thread(() -> {
            try {
                extractBackend();
                startNodeJs();
            } catch (Exception e) {
                Log.e(TAG, "Failed to start Node.js", e);
            }
        }).start();
        return START_STICKY;
    }

    private void extractBackend() throws IOException {
        File backendDir = new File(getFilesDir(), "backend");
        if (backendDir.exists()) return;
        backendDir.mkdirs();

        String[] assets = getAssets().list("backend");
        if (assets == null) return;

        for (String asset : assets) {
            copyAsset("backend/" + asset, new File(backendDir, asset));
        }
    }

    private void copyAsset(String assetPath, File dest) throws IOException {
        try (InputStream in = getAssets().open(assetPath);
             OutputStream out = new FileOutputStream(dest)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
        }
    }

    private native int startNodeJs(String[] args);

    private void startNodeJs() {
        String backendPath = new File(getFilesDir(), "backend/server.js").getAbsolutePath();
        String[] args = {"node", backendPath};
        int result = startNodeJs(args);
        Log.d(TAG, "Node.js exited with code: " + result);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "SillyTavern Server",
                NotificationManager.IMPORTANCE_LOW
            );
            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification() {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("SillyTavern")
            .setContentText("Server running on port 3000")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .build();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        if (nodeProcess != null) nodeProcess.destroy();
        super.onDestroy();
    }
}
