package uk.nextdoormedia.squishhub;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WalletCheckPlugin.class);
        super.onCreate(savedInstanceState);
        // WAX Cloud Wallet logs in and signs in a popup window.
        WebView webView = getBridge().getWebView();
        webView.getSettings().setSupportMultipleWindows(true);
        webView.getSettings().setJavaScriptCanOpenWindowsAutomatically(true);
        webView.setWebChromeClient(new PopupChromeClient(getBridge()));
    }
}
