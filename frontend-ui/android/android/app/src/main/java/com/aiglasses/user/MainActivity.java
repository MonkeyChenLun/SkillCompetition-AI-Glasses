package com.aiglasses.user;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GlassesAccessibilityPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
