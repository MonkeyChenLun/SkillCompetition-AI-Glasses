# tts_fallback.py
# -*- coding: utf-8 -*-
"""
离线 TTS 兜底（Windows SAPI / pyttsx3）

用途：语音库（voice/*.wav）是预录音的，只能覆盖固定句子。
像"前方有路锥，停一下。"这种带具体障碍物名称的句子库里没有，
这里用系统 TTS 现场合成，保证"能说出是什么障碍物"。

特性：
  - 单工作线程 + 队列，pyttsx3 不是线程安全的，必须串行
  - 优先选中文音色（Microsoft Huihui / zh-CN）
  - 相同文本 0.8s 内不重复；静音窗口内不播
  - speak() 返回是否成功入队，便于调用方决定要不要回落到预录音
"""
import os
import queue
import threading
import time

_enabled = os.getenv("TTS_FALLBACK", "1") == "1"
_rate = int(os.getenv("TTS_FALLBACK_RATE", "185"))

_q: "queue.Queue[str]" = queue.Queue(maxsize=8)
_thread = None
_engine = None
_engine_broken = False
_last_text = ""
_last_ts = 0.0
_MIN_GAP = 0.8
_lock = threading.Lock()
_speaking = False   # 正在出声（供其他播报路径避让）


def _pick_zh_voice(engine):
    try:
        for v in engine.getProperty("voices"):
            langs = " ".join([str(x) for x in (getattr(v, "languages", None) or [])]).lower()
            name = (getattr(v, "name", "") or "").lower()
            if "zh" in langs or "chinese" in name or "huihui" in name:
                return v.id
    except Exception:
        pass
    return None


def _init_engine():
    global _engine, _engine_broken
    if _engine is not None or _engine_broken:
        return
    try:
        import pyttsx3
        e = pyttsx3.init()
        vid = _pick_zh_voice(e)
        if vid:
            e.setProperty("voice", vid)
        e.setProperty("rate", _rate)
        e.setProperty("volume", 1.0)
        _engine = e
        print(f"[TTS] 离线语音已就绪（rate={_rate}）", flush=True)
    except Exception as e:
        _engine_broken = True
        print(f"[TTS] 初始化失败，将回落到预录音：{e}", flush=True)


def _worker():
    global _speaking
    while True:
        text = _q.get()
        if text is None:
            break
        try:
            _init_engine()
            if _engine is None:
                continue
            # 预录音还在播就先等它说完，避免两层声音叠在一起
            t0 = time.time()
            while time.time() - t0 < 1.2:
                try:
                    import local_speaker
                    if not local_speaker.busy(80):
                        break
                except Exception:
                    break
                time.sleep(0.05)
            _speaking = True
            _engine.say(text)
            _engine.runAndWait()
        except Exception as e:
            print(f"[TTS] 播放失败: {e}", flush=True)
        finally:
            _speaking = False


def _ensure_thread():
    global _thread
    if _thread and _thread.is_alive():
        return
    _thread = threading.Thread(target=_worker, name="tts-fallback", daemon=True)
    _thread.start()


def speak(text: str) -> bool:
    """把一句话交给离线 TTS；返回 True 表示已受理（调用方不必再回落）。"""
    if not _enabled or not text:
        return False
    # 静音窗口 / 喇叭正在播预录音时，不抢话
    try:
        import local_speaker
        if local_speaker.is_muted():
            return False
    except Exception:
        pass

    global _last_text, _last_ts
    now = time.time()
    with _lock:
        if text == _last_text and (now - _last_ts) < _MIN_GAP:
            return True          # 视为已处理，避免重复入队
        _last_text, _last_ts = text, now

    _ensure_thread()
    try:
        _q.put_nowait(text)
        return True
    except queue.Full:
        return False


def clear():
    try:
        while True:
            _q.get_nowait()
    except Exception:
        pass


def is_available() -> bool:
    return _enabled and not _engine_broken


def is_speaking() -> bool:
    """是否正在出声（预录音播报可用它避让，避免两层声音叠在一起）"""
    return _speaking
