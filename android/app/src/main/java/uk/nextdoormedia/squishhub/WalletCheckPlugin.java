package uk.nextdoormedia.squishhub;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Tells the web layer whether a wallet app (Anchor) is installed to handle
 * esr: signing requests. Without one, Android has nowhere to send them.
 */
@CapacitorPlugin(name = "WalletCheck")
public class WalletCheckPlugin extends Plugin {

    @PluginMethod
    public void hasEsrHandler(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("esr:check"));
        PackageManager pm = getContext().getPackageManager();
        boolean installed = !pm.queryIntentActivities(intent, 0).isEmpty();
        JSObject ret = new JSObject();
        ret.put("installed", installed);
        call.resolve(ret);
    }
}
