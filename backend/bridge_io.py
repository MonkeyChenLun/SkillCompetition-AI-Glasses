# bridge_io.py
# 极简桥：接原始JPEG → 提供BGR帧给外部算法；外部算法产出BGR → 广播给前端
import threading
from collections import deque
import time
import cv2
import numpy as np

# 原始JPEG帧缓冲（只保留最新 N 帧）
_MAX_BUF = 4
_frames = deque(maxlen=_MAX_BUF)
_cond = threading.Condition()

# 向前端发送JPEG的回调，由 app_main.py 在启动时注册
_sender_lock = threading.Lock()
_sender_cb = None

# 向前端发送UI文本的回调（由 app_main.py 在启动时注册）
_ui_sender_lock = threading.Lock()
_ui_sender_cb = None

def set_sender(cb):
    """由 app_main.py 调用，注册一个函数：cb(jpeg_bytes)->None"""
    global _sender_cb
    with _sender_lock:
        _sender_cb = cb

def set_ui_sender(cb):
    """由 app_main.py 调用，注册一个函数：cb(text:str)->None"""
    global _ui_sender_cb
    with _ui_sender_lock:
        _ui_sender_cb = cb

def push_item_frame(bgr):
    with _cond:
        _frames.clear()
        _frames.append(bgr)
        _cond.notify()


def clear_item_frames():
    with _cond:
        _frames.clear()


def wait_raw_bgr(timeout_sec: float = 0.5):
    with _cond:
        if not _cond.wait_for(lambda: bool(_frames), timeout=timeout_sec):
            return None
        return _frames.pop()


def send_vis_bgr(bgr, quality: int = 80):
    """被 YOLO/MediaPipe 脚本调用：把处理后画面推给前端 viewer"""
    if bgr is None:
        return
    
    # 直接编码，不做任何增强处理
    ok, enc = cv2.imencode(".jpg", bgr, [int(cv2.IMWRITE_JPEG_QUALITY), int(quality)])
    if not ok:
        return
    with _sender_lock:
        cb = _sender_cb
    if cb:
        try:
            cb(enc.tobytes())
        except Exception:
            pass

def send_ui_final(text: str):
    """把一条UI文案作为 final answer 推给前端（线程安全回调）"""
    if not text:
        return
    with _ui_sender_lock:
        cb = _ui_sender_cb
    if cb:
        try:
            cb(str(text))
        except Exception:
            pass
