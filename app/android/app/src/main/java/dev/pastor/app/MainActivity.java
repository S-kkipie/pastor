package dev.pastor.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** Whether the app is in front: the alerts service stays quiet then. */
    static volatile boolean visible;
    /** The session a tapped notification opens, until the app takes it. */
    static volatile String pendingSession;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PastorNotifyPlugin.class);
        super.onCreate(savedInstanceState);
        take(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        take(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        visible = true;
    }

    @Override
    public void onPause() {
        visible = false;
        super.onPause();
    }

    private void take(Intent intent) {
        if (intent == null) return;
        String s = intent.getStringExtra(NotifyService.EXTRA_SESSION);
        if (s != null && !s.isEmpty()) pendingSession = s;
    }
}
