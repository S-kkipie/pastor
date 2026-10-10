package dev.pastor.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Keeps the phone told while Pastor is closed: a foreground service that asks
 * the bridge for new alerts (a turn that ended, a question, a permission) every
 * few seconds and shows each as a system notification. Tapping one opens that
 * session in the app.
 */
public class NotifyService extends Service {
    static final String PREFS = "pastor.notify";
    static final String CH_SERVICE = "pastor-service";
    static final String CH_ALERTS = "pastor-alerts";
    static final String EXTRA_SESSION = "pastor.session";
    private static final int SERVICE_ID = 1;
    private static final long INTERVAL_MS = 10_000;

    private volatile boolean running;
    private Thread worker;

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void start(Context c) {
        Intent i = new Intent(c, NotifyService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
        else c.startService(i);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26 && nm != null) {
            NotificationChannel service = new NotificationChannel(CH_SERVICE, "Conexión con tus PCs", NotificationManager.IMPORTANCE_MIN);
            service.setShowBadge(false);
            nm.createNotificationChannel(service);
            NotificationChannel alerts = new NotificationChannel(CH_ALERTS, "Avisos de Claude", NotificationManager.IMPORTANCE_HIGH);
            alerts.setDescription("Cuando Claude termina, pregunta algo o pide un permiso");
            alerts.enableVibration(true);
            nm.createNotificationChannel(alerts);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String server = prefs(this).getString("server", "");
        Notification n = new NotificationCompat.Builder(this, CH_SERVICE)
            .setSmallIcon(R.drawable.ic_stat_pastor)
            .setContentTitle("Pastor")
            .setContentText("Avisos activos · " + server.replaceFirst("^https?://", ""))
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setContentIntent(openApp(null, 0))
            .build();
        int type = Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING : 0;
        ServiceCompat.startForeground(this, SERVICE_ID, n, type);
        if (!running) {
            running = true;
            worker = new Thread(this::loop, "pastor-alerts");
            worker.start();
        }
        return START_STICKY;
    }

    private void loop() {
        while (running) {
            try { poll(); } catch (Exception ignored) { }
            try { Thread.sleep(INTERVAL_MS); } catch (InterruptedException e) { return; }
        }
    }

    private void poll() throws Exception {
        SharedPreferences p = prefs(this);
        String server = p.getString("server", ""), token = p.getString("token", "");
        if (server.isEmpty() || token.isEmpty()) { stopSelf(); return; }
        long since = p.getLong("since", 0);
        HttpURLConnection c = (HttpURLConnection) new URL(server + "/api/alerts?since=" + since).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(12000);
        c.setRequestProperty("Authorization", "Bearer " + token);
        int code = c.getResponseCode();
        if (code == 401) { p.edit().remove("token").apply(); stopSelf(); return; }
        if (code != 200) return;
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"))) {
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
        }
        JSONObject body = new JSONObject(sb.toString());
        // First contact: start from now, without replaying old alerts.
        if (since == 0) { p.edit().putLong("since", body.optLong("now", System.currentTimeMillis())).apply(); return; }
        JSONArray list = body.optJSONArray("alerts");
        if (list == null) return;
        long last = since;
        for (int i = 0; i < list.length(); i++) {
            JSONObject a = list.getJSONObject(i);
            long t = a.optLong("t", 0);
            if (t <= since) continue;
            last = Math.max(last, t);
            // In front of it already: the app shows its own toast.
            if (MainActivity.visible) continue;
            show(a);
        }
        if (last > since) p.edit().putLong("since", last).apply();
    }

    private void show(JSONObject a) {
        String session = a.optString("session", "");
        String kind = a.optString("kind", "done");
        String machine = a.optString("machine", "");
        int id = a.optString("id", String.valueOf(System.nanoTime())).hashCode();
        Notification n = new NotificationCompat.Builder(this, CH_ALERTS)
            .setSmallIcon(R.drawable.ic_stat_pastor)
            .setContentTitle(a.optString("title", "Pastor"))
            .setContentText(a.optString("body", ""))
            .setStyle(new NotificationCompat.BigTextStyle().bigText(a.optString("body", "")))
            .setSubText(machine)
            .setCategory("done".equals(kind) ? NotificationCompat.CATEGORY_STATUS : NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setColor(0xFFD97757)
            .setAutoCancel(true)
            .setContentIntent(openApp(session, id))
            .build();
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.notify(id, n);
    }

    private PendingIntent openApp(String session, int requestCode) {
        Intent i = new Intent(this, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (session != null) i.putExtra(EXTRA_SESSION, session);
        return PendingIntent.getActivity(this, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public void onDestroy() {
        running = false;
        if (worker != null) worker.interrupt();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
