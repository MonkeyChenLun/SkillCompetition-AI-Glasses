# local_speaker.py
# -*- coding: utf-8 -*-
"""
电脑喇叭输出（替代 ESP32 扬声器）

所有下行音频最终都汇到 audio_stream.broadcast_pcm16_realtime()，
那里会以 20ms 为一片喂给本模块，这里用 sounddevice 实时播放。

环境变量：
    PC_SPEAKER=1            开关（默认 1）
    PC_SPEAKER_DEVICE=      输出设备序号或名称（留空用系统默认）
"""
import os
import threading
import time

import numpy as np

try:
    import sounddevice as sd
except Exception as e:  # 没装 sounddevice 时降级为静默
    sd = None
    _import_err = e

SR = 8000          # 下行 PCM 统一是 8kHz / 单声道 / 16bit
MAX_SECONDS = 3.0  # 缓冲上限，超过丢最旧的，保证实时

_enabled = os.getenv("PC_SPEAKER", "1") == "1"
_lock = threading.Lock()
_buf = bytearray()
_stream = None
_device = None
_out_sr = SR
_ratecv_state = None
_started = False
_last_feed = 0.0   # 最近一次喂数据的时间（判断"正在出声"更可靠）
_mute_until = 0.0  # 静音窗口截止时间


def _device_from_env():
    v = os.getenv("PC_SPEAKER_DEVICE", "").strip()
    if not v:
        return None
    try:
        return int(v)
    except ValueError:
        return v


def _resample_to_out(pcm: bytes) -> bytes:
    """设备不支持 8k 时，上采样到 _out_sr。"""
    global _ratecv_state
    if _out_sr == SR:
        return pcm
    import audioop
    out, _ratecv_state = audioop.ratecv(pcm, 2, 1, SR, _out_sr, _ratecv_state)
    return out


def _callback(outdata, frames, time_info, status):
    need = frames * 2
    with _lock:
        if len(_buf) >= need:
            data = bytes(_buf[:need])
            del _buf[:need]
        else:
            data = bytes(_buf)
            _buf.clear()
    if len(data) < need:
        data = data + b"\x00" * (need - len(data))
    # RawOutputStream passes a writable byte buffer, including on underrun.
    outdata[:] = data


def _open_stream():
    """先按 8k 打开，失败则按 16k 打开并上采样。"""
    global _stream, _out_sr
    for sr in (SR, 16000):
        try:
            st = sd.RawOutputStream(
                samplerate=sr,
                channels=1,
                dtype="int16",
                blocksize=sr // 50,      # 20ms
                device=_device,
                callback=_callback,
            )
            st.start()
            _out_sr = sr
            return st
        except Exception as e:
            print(f"[SPEAKER] 以 {sr}Hz 打开输出失败: {e}", flush=True)
    return None


def start():
    """启动喇叭（幂等）。"""
    global _stream, _device, _started
    if _started or not _enabled:
        return
    _started = True
    if sd is None:
        print(f"[SPEAKER] 未安装 sounddevice，电脑喇叭不可用: {_import_err}", flush=True)
        return
    _device = _device_from_env()
    _stream = _open_stream()
    if _stream is None:
        print("[SPEAKER] 电脑喇叭初始化失败，导航语音将只在网页端可见", flush=True)
    else:
        try:
            info = sd.query_devices(_device, "output")
            name = info.get("name", "default")
        except Exception:
            name = "default"
        print(f"[SPEAKER] 电脑喇叭已就绪：{name} @ {_out_sr}Hz", flush=True)


def feed(pcm8k: bytes):
    """喂入 8kHz PCM16 数据（线程安全，可从任意线程调用）。"""
    global _last_feed
    if not _enabled or not pcm8k:
        return
    if time.time() < _mute_until:      # 静音窗口内直接丢弃
        return
    if _stream is None:
        start()
        if _stream is None:
            return
    _last_feed = time.monotonic()
    data = _resample_to_out(pcm8k)
    limit = int(_out_sr * 2 * MAX_SECONDS)
    with _lock:
        _buf.extend(data)
        if len(_buf) > limit:
            del _buf[: len(_buf) - limit]


def busy(threshold_ms: int = 60) -> bool:
    """是否正在出声：缓冲还有余量，或最近 200ms 内刚喂过数据。"""
    if _stream is None:
        return False
    if (time.monotonic() - _last_feed) < 0.20:
        return True
    with _lock:
        n = len(_buf)
    return (n / 2) * 1000.0 / _out_sr > threshold_ms


def flush():
    """清空缓冲（硬重置时调用，避免旧语音拖尾）。"""
    global _last_feed
    _last_feed = 0.0
    with _lock:
        _buf.clear()


def set_muted(seconds: float = 3.0):
    """静音窗口：这段时间内喂进来的音频全部丢弃，并立刻清空缓冲。
    seconds<=0 表示立即解除静音。"""
    global _mute_until
    _mute_until = 0.0 if seconds <= 0 else max(_mute_until, time.time() + seconds)
    flush()


def is_muted() -> bool:
    return time.time() < _mute_until
