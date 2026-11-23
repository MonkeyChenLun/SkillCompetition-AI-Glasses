"""Keep the original crossing display and add signal and vehicle overlays."""

from collections import Counter
from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

VEHICLE_LABELS = {
    "car": "车", "truck": "卡车", "bus": "公交车", "van": "车",
    "motorcycle": "摩托车", "electric scooter": "电动车",
    "electric bicycle": "电动车", "scooter": "电动车", "bicycle": "自行车",
}
YELLOW = (0, 255, 255)


# Camera proximity estimate: a sufficiently large box in the lower part of the frame.
MIN_NEAR_SECONDS = 1.5
MIN_BOX_HEIGHT = .10
MIN_BOX_BOTTOM = .55
MAX_TRACK_GAP = .2


@dataclass
class VehicleTrack:
    label: str
    box: tuple
    first_seen: float
    last_seen: float
    announced: bool = False


def overlap(a, b):
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    intersection = max(0, x2 - x1) * max(0, y2 - y1)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - intersection
    return intersection / union


class NearVehicles:
    def __init__(self):
        self.tracks = []

    def alerts(self, boxes, height, seconds):
        remaining = [track for track in self.tracks if seconds - track.last_seen <= MAX_TRACK_GAP]
        current = []
        alerts = set()
        for label, box in boxes:
            if box[3] - box[1] < height * MIN_BOX_HEIGHT or box[3] < height * MIN_BOX_BOTTOM:
                continue
            matches = [(overlap(track.box, box), i) for i, track in enumerate(remaining) if track.label == label]
            score, index = max(matches, default=(0, -1))
            if score >= .25:
                track = remaining.pop(index)
                track.box, track.last_seen = box, seconds
            else:
                track = VehicleTrack(label, box, seconds, seconds)
            if not track.announced and seconds - track.first_seen >= MIN_NEAR_SECONDS:
                track.announced = True
                alerts.add(label)
            current.append(track)
        self.tracks = current + remaining
        return sorted(alerts)


def vehicle_cue(text):
    if not text or not text.startswith(("前方有", "右侧有", "左侧有")):
        return False
    name = text[3:].split("，", 1)[0]
    return name in set(VEHICLE_LABELS.values()) | {"电瓶车"}


class CrossingOverlay:
    def __init__(self, traffic, obstacle, gpu_infer_slot, play_voice, narration):
        self.traffic = traffic
        self.detect_lights = traffic.process_single_frame
        self.model = obstacle.model
        self.inference_slot = gpu_infer_slot
        self.classes = list(VEHICLE_LABELS)
        self.embeddings = self.model.get_text_pe(self.classes)
        self.model.set_classes(self.classes, self.embeddings)
        self.play_voice = play_voice
        self.narration = narration
        self.last_light_voice = None
        self.pending_light = None
        self.last_light_seen = 0.0
        self.near_vehicles = NearVehicles()
        self.vehicle_font = ImageFont.truetype(traffic._FONT_PATH, traffic.UNIFIED_FONT_PX) if traffic._FONT_PATH else None
        self.frames = Counter()
        self.alerts = Counter()

    def on_frame(self, raw):
        self.light_result = self.detect_lights(raw)
        self.light_pixels = self.light_result["vis_image"]
        self.light_mask = np.any(self.light_pixels != raw, axis=2)
        if self.light_result["detected_light"]:
            self.frames["信号灯"] += 1

    def lights_on(self, image, ui_broadcast_callback=None):
        output = image.copy()
        output[self.light_mask] = self.light_pixels[self.light_mask]
        return {**self.light_result, "vis_image": output}

    def finish(self, raw, annotated, seconds):
        image = self.lights_on(annotated)["vis_image"]
        # 原项目的障碍物网络继续用于分类，独立于过街状态在原始画面上检测。
        if list(self.model.names.values()) != self.classes:
            self.model.set_classes(self.classes, self.embeddings)
        with self.inference_slot():
            detections = self.model.predict(raw, conf=.25, verbose=False)[0]

        boxes = []
        h, w = raw.shape[:2]
        for x1, y1, x2, y2, _, class_id in detections.boxes.data.cpu().tolist():
            label = VEHICLE_LABELS[self.classes[int(class_id)]]
            x1, x2 = (max(0, min(w - 1, round(x))) for x in (x1, x2))
            y1, y2 = (max(0, min(h - 1, round(y))) for y in (y1, y2))
            if x1 >= x2 or y1 >= y2:
                continue
            boxes.append((label, (x1, y1, x2, y2)))
            cv2.rectangle(image, (x1, y1), (x2, y2), YELLOW, 2)

        if self.vehicle_font and boxes:
            canvas = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
            draw = ImageDraw.Draw(canvas)
            for label, (x1, y1, _, _) in boxes:
                draw.text((x1, max(0, y1 - 21)), label, fill="white", font=self.vehicle_font)
            image = cv2.cvtColor(np.asarray(canvas), cv2.COLOR_RGB2BGR)
        else:
            for label, (x1, y1, _, _) in boxes:
                self.traffic.draw_text_cn(image, label, (x1, max(0, y1 - 21)), ui_hint=False)

        self.frames.update({label for label, _ in boxes})
        alerts = self.near_vehicles.alerts(boxes, h, seconds)
        self.alerts.update(alerts)

        light = self.traffic.LIGHT_VOICE_MAP.get(self.light_result["stable_light"])
        if light in ("红灯", "绿灯"):
            if light != self.last_light_voice or seconds - self.last_light_seen >= 1.5:
                self.pending_light = light
            self.last_light_seen = seconds
        elif seconds - self.last_light_seen > .5:
            self.pending_light = None

        if alerts:
            text = f"前方有{'和'.join(alerts)}，注意避让。"
            self.narration.alert(self.play_voice, text)
            print(f"避让 {seconds:.2f}s {text}", flush=True)
        elif self.pending_light and self.narration.now >= self.narration.priority_until:
            self.narration.alert(self.play_voice, self.pending_light)
            self.last_light_voice = self.pending_light
            self.pending_light = None
        return image
