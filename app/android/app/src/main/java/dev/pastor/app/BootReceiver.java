package dev.pastor.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** After a reboot or an app update, alerts come back on without opening the app. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String token = NotifyService.prefs(context).getString("token", "");
        if (token.isEmpty()) return;
        try { NotifyService.start(context); } catch (Exception ignored) { }
    }
}
