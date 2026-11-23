"""Adapter between the original camera pipeline and an offline video timeline."""

import os
import sys
import wave
from contextlib import ExitStack, contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import av
from dotenv import dotenv_values

from crossing_overlay import CrossingOverlay, vehicle_cue

ORIGINAL = Path(__file__).resolve().parent.parent / "list" / "OpenAIglasses_for_Navigation"
RATE = 22050


class OriginalAudio:
    def __init__(self, player, tts, staging):
        self.player, self.tts = player, tts
        self.staging = staging
        self.events = []
        self.cache = {}
        self.pending = None
        self.now = 0
        self.priority_until = 0
        self.alerting = False
        self.tts_driver = None

    def play_file(self, key):
        path = self.player.AUDIO_MAP[key]
        if path not in self.cache:
            self.cache[path] = self.read_pcm(path)
        self.schedule(self.cache[path], self.alerting)

    def speak(self, text):
        if not self.tts._enabled:
            return False
        if text not in self.cache:
            if self.tts_driver is None:
                self.tts._init_engine()
                engine = self.tts._engine
                if engine is None:
                    return False
                self.tts_driver = engine.proxy._driver
                voice = self.tts._pick_zh_voice(engine)
                if voice:
                    self.tts_driver.setProperty("voice", voice)
                self.tts_driver.setProperty("rate", self.tts._rate)
                self.tts_driver.setProperty("volume", 1.0)
            path = self.staging / f"tts-{len(self.cache)}.wav"
            # The SAPI file writer is synchronous. Its playback loop can hang on a second file.
            self.tts_driver.save_to_file(text, str(path))
            self.cache[text] = self.read_pcm(path)
        self.schedule(self.cache[text], self.alerting)
        return True

    @staticmethod
    def read_pcm(path):
        converter = av.AudioResampler(format="s16", layout="mono", rate=RATE)
        with av.open(str(path)) as audio:
            frames = [out for frame in audio.decode(audio=0) for out in converter.resample(frame)]
            frames.extend(converter.resample(None))
        return b"".join(frame.to_ndarray().tobytes() for frame in frames)

    def alert(self, play_voice, text):
        self.alerting = True
        try:
            play_voice(text)
        finally:
            self.alerting = False

    def schedule(self, pcm, priority=False):
        if not pcm:
            return
        if self.now < self.priority_until:
            if priority:
                self.pending = (pcm, True)
            return
        if self.events:
            start, previous = self.events[-1]
            if start == self.now:
                self.events.pop()
            elif self.now < start + len(previous) // 2:
                if not priority:
                    self.pending = (pcm, False)
                    return
                self.events[-1] = (start, previous[:2 * (self.now - start)])
        self.pending = None
        self.events.append((self.now, pcm))
        if priority:
            self.priority_until = self.now + len(pcm) // 2

    def advance(self, seconds):
        self.now = round(seconds * RATE)
        if self.pending is not None:
            self.schedule(*self.pending)

    def write(self, path, duration):
        total = round(duration * RATE)
        cursor = 0
        silence = bytes(RATE * 2)
        with wave.open(str(path), "wb") as wav:
            wav.setparams((1, 2, RATE, 0, "NONE", "not compressed"))
            for start, pcm in [*self.events, (total, b"")]:
                while cursor < min(start, total):
                    count = min(start - cursor, total - cursor, RATE)
                    wav.writeframesraw(silence[:count * 2])
                    cursor += count
                if cursor >= total:
                    break
                clip = pcm[:2 * (total - cursor)]
                wav.writeframesraw(clip)
                cursor += len(clip) // 2


@contextmanager
def original_pipeline(mode, staging):
    if not ORIGINAL.is_dir():
        raise FileNotFoundError(ORIGINAL)
    sys.path.insert(0, str(ORIGINAL))
    settings = {
        name: value for name, value in dotenv_values(ORIGINAL / ".env").items()
        if value is not None and (
            name.startswith(("AIGLASS_", "TTS_FALLBACK", "CROSSWALK_", "BLIND_MIN_"))
            or name in ("OBSTACLE_SPEECH_COOLDOWN", "BLIND_PATH_MODEL", "OBSTACLE_MODEL",
                        "TRAFFICLIGHT_MODEL", "VOICE_DIR", "AUDIO_BASE_DIR")
        ) and name not in os.environ
    }
    original_cwd = Path.cwd()
    try:
        os.chdir(ORIGINAL)
        with patch.dict(os.environ, settings):
            import torch
            from ultralytics import YOLO
            import audio_player
            import crosswalk_awareness
            import navigation_master
            import trafficlight_detection
            import tts_fallback
            import workflow_blindpath
            import workflow_crossstreet
            from obstacle_detector_client import ObstacleDetectorClient, gpu_infer_slot

            torch.backends.cudnn.benchmark = False
            narration = OriginalAudio(audio_player, tts_fallback, staging)
            clock = SimpleNamespace(time=lambda: 100.0 + narration.now / RATE)
            audio_player._merge_voice_map()

            with ExitStack() as scope:
                for module in (audio_player, crosswalk_awareness, navigation_master,
                               trafficlight_detection, workflow_blindpath, workflow_crossstreet):
                    scope.enter_context(patch.object(module, "time", clock))
                for name, value in {
                    "_initialized": True, "_last_voice_time": 0, "_last_voice_text": "",
                    "play_audio_threadsafe": narration.play_file,
                }.items():
                    scope.enter_context(patch.object(audio_player, name, value))
                scope.enter_context(patch.object(tts_fallback, "speak", narration.speak))
                trafficlight_detection.reset_detection_state()

                if mode == "traffic":
                    if not trafficlight_detection.init_model():
                        raise RuntimeError("原项目红绿灯模型加载失败")

                    def annotate(image):
                        return trafficlight_detection.process_single_frame(image)["vis_image"]
                else:
                    model = YOLO(os.getenv("BLIND_PATH_MODEL", str(ORIGINAL / "model/yolo-seg.pt")))
                    if torch.cuda.is_available():
                        model.to("cuda")
                    obstacle_path = Path(os.getenv("OBSTACLE_MODEL", str(ORIGINAL / "model/yoloe-11l-seg.pt")))
                    obstacle = ObstacleDetectorClient(str(obstacle_path)) if obstacle_path.is_file() else None
                    cross = workflow_crossstreet.CrossStreetNavigator(seg_model=model, coco_model=None, obs_model=None)
                    blind_obstacle = (cross.obstacle_detector or obstacle) if mode == "crossing" else obstacle
                    blind = workflow_blindpath.BlindPathNavigator(model, blind_obstacle)
                    overlay = None
                    if mode == "crossing":
                        if obstacle is None:
                            raise FileNotFoundError(obstacle_path)
                        if not trafficlight_detection.init_model():
                            raise RuntimeError("原项目红绿灯模型加载失败")
                        overlay = CrossingOverlay(trafficlight_detection, obstacle, gpu_infer_slot,
                                                  audio_player.play_voice_text, narration)
                        scope.enter_context(patch.object(trafficlight_detection, "process_single_frame",
                                                         overlay.lights_on))

                        def navigation_voice(text):
                            if not vehicle_cue(text):
                                audio_player.play_voice_text(text)

                        scope.enter_context(patch.object(workflow_blindpath, "play_voice_text", navigation_voice))
                    else:
                        navigation_voice = audio_player.play_voice_text
                    navigator = navigation_master.NavigationMaster(blind, cross)
                    if mode == "blind":
                        navigator.start_blind_path_navigation()
                    else:
                        navigator.start_crossing()
                        audio_player.play_voice_text("过马路模式已启动。")

                    def annotate(image):
                        if overlay is not None:
                            overlay.on_frame(image)
                        result = navigator.process_frame(image)
                        if result.extras and "error" in result.extras:
                            raise RuntimeError(f"原项目导航处理失败：{result.extras['error']}")
                        navigation_voice(result.guidance_text)
                        annotated = result.annotated_image if result.annotated_image is not None else image
                        if overlay is not None:
                            return overlay.finish(image, annotated, narration.now / RATE)
                        return annotated

                yield annotate, narration
                if mode == "crossing":
                    print(f"检测帧数 {dict(overlay.frames)} | 分类避让播报 {dict(overlay.alerts)}", flush=True)
    finally:
        os.chdir(original_cwd)
        sys.path.remove(str(ORIGINAL))
