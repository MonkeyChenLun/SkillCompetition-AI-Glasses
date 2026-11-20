package com.aiglasses.user;

import android.content.Context;
import android.content.res.Configuration;
import android.media.AudioAttributes;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.view.accessibility.AccessibilityManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/** Runs text-only synthesis with a locally installed Chinese voice. */
@CapacitorPlugin(name = "GlassesAccessibility")
public class GlassesAccessibilityPlugin extends Plugin {

    private final Handler main = new Handler(Looper.getMainLooper());
    private TextToSpeech engine;
    private Voice offlineVoice;
    private AccessibilityManager accessibilityManager;
    private String currentUtterance;
    private boolean engineReady;
    private boolean initializing = true;
    private boolean destroyed;
    private final Runnable initTimeout = () -> {
        if (destroyed || !initializing) return;
        initializing = false;
        emitAccessibilityState();
    };
    private final AccessibilityManager.TouchExplorationStateChangeListener touchListener = enabled ->
        main.post(() -> {
            if (destroyed) return;
            if (enabled) stopCurrentSpeech();
            emitAccessibilityState();
        });

    @Override
    public void load() {
        main.post(() -> {
            if (destroyed) return;
            // Report the OS preference through the bridge and apply scaling in layout once.
            getBridge().getWebView().getSettings().setTextZoom(100);
            accessibilityManager = (AccessibilityManager) getContext().getSystemService(Context.ACCESSIBILITY_SERVICE);
            if (accessibilityManager != null) {
                accessibilityManager.addTouchExplorationStateChangeListener(touchListener);
            }

            engine = new TextToSpeech(getContext().getApplicationContext(), status ->
                main.post(() -> {
                    if (destroyed) return;
                    main.removeCallbacks(initTimeout);
                    initializing = false;
                    engineReady = status == TextToSpeech.SUCCESS;
                    if (engineReady) {
                        engine.setAudioAttributes(
                            new AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                .build()
                        );
                        engine.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                            @Override
                            public void onStart(String id) {
                                main.post(() -> {
                                    if (id.equals(currentUtterance)) emitSpeechState("started", id);
                                });
                            }

                            @Override
                            public void onDone(String id) {
                                main.post(() -> finishUtterance("completed", id));
                            }

                            @Override
                            public void onError(String id) {
                                onError(id, TextToSpeech.ERROR);
                            }

                            @Override
                            public void onError(String id, int errorCode) {
                                main.post(() -> handleSpeechError(id, errorCode));
                            }

                            @Override
                            public void onStop(String id, boolean interrupted) {
                                main.post(() -> finishUtterance("stopped", id));
                            }
                        });
                        refreshVoice();
                    }
                    emitAccessibilityState();
                })
            );
            main.postDelayed(initTimeout, 5_000);
        });
    }

    @PluginMethod
    public void getState(PluginCall call) {
        main.post(() -> call.resolve(accessibilityState()));
    }

    @PluginMethod
    public void speak(PluginCall call) {
        final String text = call.getString("text", "").trim();
        if (text.isEmpty() || text.length() > TextToSpeech.getMaxSpeechInputLength()) {
            call.reject("Supply non-empty text within the Android speech input limit.", "INVALID_TEXT");
            return;
        }

        main.post(() -> {
            if (touchExplorationEnabled()) {
                call.reject("TalkBack or another touch exploration service is active.", "TOUCH_EXPLORATION_ACTIVE");
                return;
            }
            if (!engineReady || offlineVoice == null) {
                call.reject("An offline Chinese voice is not available.", "OFFLINE_VOICE_UNAVAILABLE");
                return;
            }
            stopCurrentSpeech();
            // Engines can change their active voice. Verify before handing them any text.
            if (!setOfflineVoice(offlineVoice)) {
                offlineVoice = null;
                emitAccessibilityState();
                call.reject("An offline Chinese voice is not available.", "OFFLINE_VOICE_UNAVAILABLE");
                return;
            }

            final String id = UUID.randomUUID().toString();
            final int status = engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, id);
            if (status != TextToSpeech.SUCCESS) {
                call.reject("The local speech engine could not start.", "SPEECH_FAILED");
                return;
            }

            currentUtterance = id;
            call.resolve(new JSObject().put("utteranceId", id));
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> {
            stopCurrentSpeech();
            call.resolve();
        });
    }

    @Override
    protected void handleOnResume() {
        main.post(() -> {
            if (destroyed) return;
            if (engineReady && currentUtterance == null) refreshVoice();
            emitAccessibilityState();
        });
    }

    @Override
    protected void handleOnPause() {
        main.post(this::stopCurrentSpeech);
    }

    @Override
    protected void handleOnDestroy() {
        main.post(() -> {
            destroyed = true;
            main.removeCallbacks(initTimeout);
            stopCurrentSpeech();
            if (accessibilityManager != null) {
                accessibilityManager.removeTouchExplorationStateChangeListener(touchListener);
            }
            if (engine != null) {
                engine.shutdown();
                engine = null;
            }
            engineReady = false;
            offlineVoice = null;
        });
    }

    @Override
    protected void handleOnConfigurationChanged(Configuration configuration) {
        main.post(() -> {
            if (destroyed) return;
            getBridge().getWebView().getSettings().setTextZoom(100);
            emitAccessibilityState();
        });
    }

    private boolean touchExplorationEnabled() {
        return accessibilityManager != null && accessibilityManager.isEnabled() && accessibilityManager.isTouchExplorationEnabled();
    }

    private JSObject accessibilityState() {
        return new JSObject()
            .put("ttsStatus", initializing ? "initializing" : offlineVoice != null ? "available" : "unavailable")
            .put("touchExplorationEnabled", touchExplorationEnabled())
            .put("fontScale", getContext().getResources().getConfiguration().fontScale);
    }

    private void emitAccessibilityState() {
        notifyListeners("accessibilityStateChange", accessibilityState());
    }

    private void refreshVoice() {
        offlineVoice = null;
        final Set<Voice> voices = engine.getVoices();
        if (voices == null) return;

        final ArrayList<Voice> candidates = new ArrayList<>();
        for (Voice voice : voices) {
            if (isOfflineChinese(voice)) candidates.add(voice);
        }
        candidates.sort(
            Comparator.comparingInt(GlassesAccessibilityPlugin::localePriority)
                .thenComparing(Comparator.comparingInt(Voice::getQuality).reversed())
                .thenComparing(Voice::getName)
        );
        for (Voice voice : candidates) {
            if (setOfflineVoice(voice)) {
                offlineVoice = voice;
                return;
            }
        }
    }

    private boolean setOfflineVoice(Voice voice) {
        if (!isOfflineChinese(voice) || engine.setVoice(voice) != TextToSpeech.SUCCESS) return false;
        final Voice selected = engine.getVoice();
        return isOfflineChinese(selected) && voice.getName().equals(selected.getName());
    }

    private static boolean isOfflineChinese(Voice voice) {
        if (voice == null || voice.isNetworkConnectionRequired() || !"zh".equals(voice.getLocale().getLanguage())) return false;
        final Set<String> features = voice.getFeatures();
        return features == null || !features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED);
    }

    private static int localePriority(Voice voice) {
        final Locale locale = voice.getLocale();
        if ("CN".equals(locale.getCountry())) return 0;
        if ("Hans".equals(locale.getScript())) return 1;
        return 2;
    }

    private void handleSpeechError(String id, int errorCode) {
        if (!id.equals(currentUtterance)) return;
        if (
            errorCode == TextToSpeech.ERROR_NOT_INSTALLED_YET ||
            errorCode == TextToSpeech.ERROR_NETWORK ||
            errorCode == TextToSpeech.ERROR_NETWORK_TIMEOUT
        ) {
            offlineVoice = null;
            emitAccessibilityState();
        }
        finishUtterance("error", id);
    }

    private void finishUtterance(String phase, String id) {
        if (!id.equals(currentUtterance)) return;
        currentUtterance = null;
        emitSpeechState(phase, id);
    }

    private void stopCurrentSpeech() {
        final String id = currentUtterance;
        if (id == null) return;
        currentUtterance = null;
        if (engine != null) engine.stop();
        emitSpeechState("stopped", id);
    }

    private void emitSpeechState(String phase, String id) {
        notifyListeners("speechStateChange", new JSObject().put("phase", phase).put("utteranceId", id));
    }
}
