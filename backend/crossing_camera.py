"""信号灯和近处车辆叠加，供原项目的实时过马路模式调用。"""
from dataclasses import dataclass
import logging
import time

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

import trafficlight_detection
from obstacle_detector_client import gpu_infer_slot

log = logging.getLogger(__name__)

VEHICLE_LABELS = {
    "car": "车", "van": "车", "truck": "卡车", "bus": "公交车",
    "motorcycle": "摩托车", "electric scooter": "电动车", "electric bicycle": "电动车",
    "scooter": "电动车", "bicycle": "自行车",
}
VEHICLE_LABELS_CN = set(VEHICLE_LABELS.values()) | {"电瓶车"}
MIN_NEAR_SECONDS = 1.5
MIN_BOX_HEIGHT = .10
MIN_BOX_BOTTOM = .55
VEHICLE_INTERVAL = .15
MAX_TRACK_GAP = .4
MAX_FRAME_AGE = .5


@dataclass
class VehicleTrack:
    label: str
    box: tuple[int, int, int, int]
    first_seen: float
    last_seen: float
    announced: bool = False


def _overlap(a, b):
    left, top = max(a[0], b[0]), max(a[1], b[1])
    right, bottom = min(a[2], b[2]), min(a[3], b[3])
    shared = max(0, right - left) * max(0, bottom - top)
    return shared / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - shared)


def vehicle_cue(text):
    if not text or not text.startswith(("前方有", "左侧有", "右侧有")):
        return False
    return text[3:].split("，", 1)[0] in VEHICLE_LABELS_CN


class NearVehicles:
    def __init__(self):
        self.tracks = []

    def update(self, boxes, height, at, *, can_announce=True):
        remaining = [track for track in self.tracks if at - track.last_seen <= MAX_TRACK_GAP]
        tracks, labels = [], set()
        for label, box in boxes:
            if box[3] - box[1] < height * MIN_BOX_HEIGHT or box[3] < height * MIN_BOX_BOTTOM:
                continue
            score, index = max(
                ((_overlap(track.box, box), index) for index, track in enumerate(remaining) if track.label == label),
                default=(0, -1),
            )
            if score >= .25:
                track = remaining.pop(index)
                track.box, track.last_seen = box, at
            else:
                track = VehicleTrack(label, box, at, at)
            if can_announce and not track.announced and at - track.first_seen >= MIN_NEAR_SECONDS:
                track.announced = True
                labels.add(label)
            tracks.append(track)
        self.tracks = tracks + remaining
        return sorted(labels)


class CrossingCamera:
    def __init__(self, obstacle_detector):
        self.model = obstacle_detector.model if obstacle_detector is not None else None
        self.classes = list(VEHICLE_LABELS)
        self.embeddings = None
        font_path = trafficlight_detection._FONT_PATH
        self.font = ImageFont.truetype(font_path, trafficlight_detection.UNIFIED_FONT_PX) if font_path else None
        self.tracker = NearVehicles()
        self.reset()

    @property
    def has_vehicle_model(self):
        return self.model is not None

    def reset(self):
        self.vehicle_at = None
        self.frame_size = None
        self.boxes = []
        self.tracker.tracks.clear()

    def _detect_vehicles(self, frame):
        # 避障模型也服务于盲道。只有词表发生切换时才重置其预测器。
        if self.embeddings is None:
            with gpu_infer_slot():
                self.embeddings = self.model.get_text_pe(self.classes)
        names = self.model.names
        if list(names.values() if isinstance(names, dict) else names) != self.classes:
            self.model.set_classes(self.classes, self.embeddings)
        with gpu_infer_slot():
            result = self.model.predict(frame, conf=.25, verbose=False)[0]
        if result.boxes is None:
            return []
        h, w = frame.shape[:2]
        boxes = []
        for x1, y1, x2, y2, _, class_id in result.boxes.data.cpu().tolist():
            x1, x2 = (min(w - 1, max(0, round(x))) for x in (x1, x2))
            y1, y2 = (min(h - 1, max(0, round(y))) for y in (y1, y2))
            if x2 > x1 and y2 > y1:
                boxes.append((VEHICLE_LABELS[self.classes[int(class_id)]], (x1, y1, x2, y2)))
        return boxes

    def annotate(self, frame, annotated, lights, received_at, *, can_announce):
        h, w = frame.shape[:2]
        if self.frame_size != (h, w):
            self.reset()
            self.frame_size = (h, w)

        warning = ""
        if self.has_vehicle_model and (
            self.vehicle_at is None or received_at - self.vehicle_at >= VEHICLE_INTERVAL
        ):
            try:
                self.boxes = self._detect_vehicles(frame)
                self.vehicle_at = received_at
                if time.monotonic() - received_at <= MAX_FRAME_AGE:
                    labels = self.tracker.update(self.boxes, h, received_at, can_announce=can_announce)
                    if labels:
                        warning = f"前方有{'和'.join(labels)}，注意避让。"
                else:
                    self.tracker.tracks.clear()
            except Exception:
                log.exception("过马路车辆叠加推理失败，恢复原有避障流程")
                self.model = None
                self.reset()

        output = annotated.copy()
        trafficlight_detection.draw_light_boxes(output, lights.get("boxes", ()))
        if self.vehicle_at is None or time.monotonic() - self.vehicle_at > MAX_FRAME_AGE:
            return output, warning
        for _, (x1, y1, x2, y2) in self.boxes:
            cv2.rectangle(output, (x1, y1), (x2, y2), (0, 255, 255), 2)
        if self.boxes and self.font:
            canvas = Image.fromarray(cv2.cvtColor(output, cv2.COLOR_BGR2RGB))
            draw = ImageDraw.Draw(canvas)
            for label, (x1, y1, _, _) in self.boxes:
                draw.text((x1, max(0, y1 - 21)), label, font=self.font, fill="white")
            output = cv2.cvtColor(np.asarray(canvas), cv2.COLOR_RGB2BGR)
        return output, warning
