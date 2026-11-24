# preview_window.py
# -*- coding: utf-8 -*-
"""
后端本地可视化窗口（OpenCV + PIL 中文渲染）

作用：不依赖前端，直接在电脑上开一个窗口，显示：
  - 实时画面（带导航标注）
  - 当前状态 / 是否在录音 / 识别文本 / AI 回复
  - 快捷键提示

用法：
    import preview_window
    preview_window.set_status_provider(fn)   # fn() -> dict
    preview_window.start()
    preview_window.push_jpeg(jpeg_bytes)     # 任意线程调用
"""
import os
import threading
import time
from collections import deque

import cv2
import numpy as np

try:
    from PIL import Image, ImageDraw, ImageFont
except Exception:
    Image = None

WIN = os.getenv("PREVIEW_WINDOW", "AI Glasses - Backend")
FRAME_TIMEOUT = 3.0
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\simsun.ttc",
]

_frames: "deque[tuple[bytes, float]]" = deque(maxlen=1)
_lock = threading.Lock()
_stop = threading.Event()
_thread = None
_status_provider = None
_font_cache = {}
_last_ts = 0.0
_fps = 0.0

STATE_CN = {
    "IDLE": "空闲",
    "OBSTACLE": "障碍物检测",
    "CHAT": "大模型闲聊",
    "BLINDPATH_NAV": "盲道导航",
    "SEEKING_CROSSWALK": "寻找并对准斑马线",
    "WAIT_TRAFFIC_LIGHT": "等待红绿灯",
    "CROSSING": "过马路中",
    "SEEKING_NEXT_BLINDPATH": "寻找下一段盲道",
    "RECOVERY": "恢复中",
    "ITEM_SEARCH": "找物品",
}
STATE_COLOR = {
    "IDLE": (120, 120, 120),
    "CHAT": (200, 160, 60),
    "BLINDPATH_NAV": (80, 200, 80),
    "SEEKING_CROSSWALK": (80, 200, 200),
    "WAIT_TRAFFIC_LIGHT": (60, 180, 240),
    "CROSSING": (60, 60, 240),
    "SEEKING_NEXT_BLINDPATH": (80, 200, 200),
    "RECOVERY": (60, 60, 200),
    "ITEM_SEARCH": (200, 140, 60),
}

STAGES = ("BLINDPATH_NAV", "SEEKING_CROSSWALK", "WAIT_TRAFFIC_LIGHT", "CROSSING", "SEEKING_NEXT_BLINDPATH")
KEY_HINTS = "1  步行导航     3  找物     5  确认行人绿灯     0  停止       回车  录音       Esc  退出"


HINTS = "直接说：开始导航  ·  帮我找钥匙  ·  开始避障  ·  开始闲聊  ·  停止" if os.getenv("PC_PTT", "0") == "0" else KEY_HINTS


def _font(size: int):
    f = _font_cache.get(size)
    if f is not None:
        return f
    if Image is None:
        return None
    for p in FONT_CANDIDATES:
        try:
            f = ImageFont.truetype(p, size)
            _font_cache[size] = f
            return f
        except Exception:
            continue
    return None


def set_status_provider(fn):
    global _status_provider
    _status_provider = fn


def push_jpeg(jpeg: bytes):
    if not jpeg:
        return
    global _last_ts, _fps
    with _lock:
        now = time.monotonic()
        dt = now - _last_ts
        if dt >= FRAME_TIMEOUT:
            _fps = 0.0
        elif _last_ts and dt > 0:
            _fps = _fps * 0.85 + (1.0 / dt) * 0.15
        _last_ts = now
        _frames.append((jpeg, now))


def _get_status() -> dict:
    try:
        if _status_provider:
            return _status_provider() or {}
    except Exception:
        pass
    return {}


def _draw(img, st: dict, fps: float):
    # 给视频与状态各自留出空间，竖屏和横屏输入都完整显示。
    width, height = 1080, 620
    if Image is None:
        return img if img is not None else np.zeros((height, width, 3), np.uint8)
    pil = Image.new("RGB", (width, height), "#101820")
    draw = ImageDraw.Draw(pil)
    state = st.get("state", "IDLE")
    accent, white, muted = "#72e3c2", "#edf4f5", "#a7bac2"
    draw.text((24, 15), "导航监视器", font=_font(25), fill=white)
    online = img is not None
    draw.text((1054, 23), f"接收画面   {fps:.1f} FPS" if online else "等待视频帧",
              anchor="ra", font=_font(16), fill=accent if online else muted)
    x, y, vw, vh = 20, 64, 714, 482
    draw.rectangle((x, y, x+vw, y+vh), fill="#091017")
    if online:
        h, w = img.shape[:2]
        scale = min(vw / w, vh / h)
        size = (max(1, round(w * scale)), max(1, round(h * scale)))
        resized = cv2.resize(img, size, interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR)
        pil.paste(Image.fromarray(cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)),
                  (x + (vw-size[0])//2, y + (vh-size[1])//2))
    else:
        draw.text((x+vw//2, y+vh//2), "等待摄像头画面", anchor="mm", font=_font(23), fill=muted)
    draw.text((758, 66), "步行导航" if state in STAGES or state == "RECOVERY" else "当前模式", font=_font(16), fill=muted)
    draw.text((758, 94), STATE_CN.get(state, state), font=_font(27), fill=white)
    def paragraph(value, top, lines, size=18):
        font = _font(size)
        line = ""
        for ch in str(value).replace("\n", " "):
            if draw.textlength(line + ch, font=font) > 286:
                draw.text((758, top), line if lines > 1 else line + "…", font=font, fill=white)
                lines -= 1
                if not lines:
                    return
                line, top = "", top + size + 6
            line += ch
        draw.text((758, top), line, font=font, fill=white)
    if state in STAGES:
        for index, stage in enumerate(STAGES):
            row = 153 + index * 40
            active = stage == state
            draw.ellipse((760,row+7,770,row+17), fill=accent if active else "#41515b")
            draw.text((784,row), STATE_CN[stage], font=_font(18), fill=accent if active else muted)
        draw.text((758, 381), "导航提示", font=_font(16), fill=muted)
        paragraph(st.get("nav") or "等待画面分析", 415, 4)
    else:
        draw.text((758, 163), "语音输入" + (" · 录音中" if st.get("ptt") else ""), font=_font(16), fill=accent)
        paragraph(st.get("asr") or ("直接说出你的需求" if os.getenv("PC_PTT", "0") == "0" else "按回车开始录音"), 197, 3)
        draw.text((758, 310), "助手回复", font=_font(16), fill=muted)
        paragraph(st.get("ai") or "—", 347, 6)
    draw.line((20, 565, 1060, 565), fill="#35434c")
    draw.text((24, 580), HINTS, font=_font(17), fill=muted)
    return cv2.cvtColor(np.asarray(pil), cv2.COLOR_RGB2BGR)


def _worker():
    cv2.namedWindow(WIN, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(WIN, 1080, 620)
    frame = None
    frame_at = 0.0
    last_status = None
    try:
        while not _stop.is_set():
            with _lock:
                packet = _frames.pop() if _frames else None
                fps = _fps

            now = time.monotonic()
            changed = False
            if packet is not None:
                jpeg, received_at = packet
                if now - received_at < FRAME_TIMEOUT:
                    decoded = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)
                    if decoded is not None:
                        frame, frame_at = decoded, received_at
                        changed = True
            if frame is not None and now - frame_at >= FRAME_TIMEOUT:
                frame = None
                changed = True

            status = _get_status()
            if changed or status != last_status:
                cv2.imshow(WIN, _draw(frame, status, fps if frame is not None else 0.0))
                last_status = status.copy()

            if (cv2.waitKey(15) & 0xFF) == 27:
                _stop.set()
                break
    except cv2.error:
        pass
    finally:
        try:
            cv2.destroyWindow(WIN)
        except cv2.error:
            pass


def start():
    global _thread
    if os.getenv("PC_PREVIEW", "1") != "1":
        print("[PREVIEW] PC_PREVIEW=0，不显示本地画面窗口", flush=True)
        return
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_worker, name="preview-window", daemon=True)
    _thread.start()
    print(f"[PREVIEW] 本地画面窗口已启动：{WIN}（ESC 关闭窗口）", flush=True)


def stop():
    _stop.set()
