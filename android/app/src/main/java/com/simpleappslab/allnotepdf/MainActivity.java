package com.simpleappslab.allnotepdf;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.util.Collections;
import java.util.Objects;

public class MainActivity extends BridgeActivity {
    @Override
    protected void load() {
        super.load();
        Uri origin = Uri.parse(bridge.getLocalUrl());
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (Objects.equals(url.getScheme(), origin.getScheme()) &&
                    Objects.equals(url.getHost(), origin.getHost()) && url.getPort() == origin.getPort()) {
                    return super.shouldInterceptRequest(view, request);
                }
                return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden",
                    Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
        });
    }
}
