package dev.pastor.app;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** The app's side of the alerts service: start it with the bridge and token, stop it, and hand over a tapped session. */
@CapacitorPlugin(name = "PastorNotify", permissions = {
    @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
})
public class PastorNotifyPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        String server = call.getString("server", ""), token = call.getString("token", "");
        if (server.isEmpty() || token.isEmpty()) { call.reject("Falta servidor o token"); return; }
        var p = NotifyService.prefs(getContext());
        var e = p.edit().putString("token", token);
        // A different bridge: its alerts start from now.
        if (!server.equals(p.getString("server", ""))) e.putString("server", server).putLong("since", 0);
        e.apply();
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "afterPermission");
            return;
        }
        NotifyService.start(getContext());
        call.resolve(result(true));
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        boolean granted = getPermissionState("notifications") == PermissionState.GRANTED;
        if (granted) NotifyService.start(getContext());
        call.resolve(result(granted));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        NotifyService.prefs(getContext()).edit().remove("token").apply();
        getContext().stopService(new Intent(getContext(), NotifyService.class));
        call.resolve(result(false));
    }

    @PluginMethod
    public void status(PluginCall call) {
        boolean granted = Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED;
        JSObject r = result(granted && !NotifyService.prefs(getContext()).getString("token", "").isEmpty());
        r.put("granted", granted);
        call.resolve(r);
    }

    /** The session a tapped notification asked for, once. */
    @PluginMethod
    public void takeSession(PluginCall call) {
        JSObject r = new JSObject();
        r.put("session", MainActivity.pendingSession);
        MainActivity.pendingSession = null;
        call.resolve(r);
    }

    /** Android's battery-optimisation list, where Pastor can be let run in the background. */
    @PluginMethod
    public void batterySettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    private JSObject result(boolean active) {
        JSObject r = new JSObject();
        r.put("active", active);
        return r;
    }
}
