package com.sillytavern.app;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Start Node.js service
        startNodeJsService();
    }

    private void startNodeJsService() {
        Intent serviceIntent = new Intent(this, NodeJsService.class);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
    }

    @Override
    protected void onDestroy() {
        // Stop Node.js service
        Intent serviceIntent = new Intent(this, NodeJsService.class);
        stopService(serviceIntent);
        super.onDestroy();
    }
}
