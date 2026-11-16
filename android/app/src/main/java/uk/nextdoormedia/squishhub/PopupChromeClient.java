package uk.nextdoormedia.squishhub;

import android.annotation.SuppressLint;
import android.app.Dialog;
import android.graphics.Color;
import android.os.Message;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;

/**
 * Lets pages inside the app open popup windows (window.open) that keep their
 * link to the page that opened them. WAX Cloud Wallet logs in and signs in
 * such a popup and reports back with window.opener.postMessage, so without
 * this it cannot work inside the app.
 */
public class PopupChromeClient extends BridgeWebChromeClient {

    private final Bridge bridge;
    private Dialog dialog;
    private WebView popup;

    public PopupChromeClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
        closePopup();
        popup = new WebView(view.getContext());
        WebSettings s = popup.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(popup, true);
        // Keep every page of the wallet's flow inside the popup.
        popup.setWebViewClient(new WebViewClient());
        popup.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onCloseWindow(WebView window) {
                closePopup();
            }
        });

        FrameLayout root = new FrameLayout(view.getContext());
        root.setBackgroundColor(Color.WHITE);
        root.addView(popup, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        Button close = new Button(view.getContext());
        close.setText("✕ Close");
        close.setOnClickListener(v -> closePopup());
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.gravity = Gravity.TOP | Gravity.END;
        root.addView(close, lp);

        dialog = new Dialog(view.getContext(), android.R.style.Theme_Black_NoTitleBar_Fullscreen);
        dialog.setContentView(root);
        dialog.setOnDismissListener(d -> destroyPopup());
        dialog.show();

        WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
        transport.setWebView(popup);
        resultMsg.sendToTarget();
        return true;
    }

    private void closePopup() {
        if (dialog != null && dialog.isShowing()) dialog.dismiss();
        else destroyPopup();
    }

    private void destroyPopup() {
        if (popup != null) {
            popup.stopLoading();
            popup.destroy(); // the opener then sees popup.closed == true
            popup = null;
        }
        dialog = null;
    }
}
