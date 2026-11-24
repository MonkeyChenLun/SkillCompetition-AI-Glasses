# pc_mic.py
# -*- coding: utf-8 -*-
"""
电脑麦克风接入（替代 ESP32 麦克风）

原理：用 sounddevice 采 16kHz / 单声道 / 16bit PCM，再以本地 WebSocket
客户端身份推给后端自己的 /ws_audio（先发 START），ASR 链路完全复用。

防自激：喇叭正在出声时，麦克风改发静音帧，避免 AI 听到自己的声音。

环境变量：
    PC_MIC=1                    开关（默认 1）
    PC_MIC_DEVICE=              输入设备序号或名称（留空用系统默认）
    PC_MIC_WS=ws://127.0.0.1:8081/ws_audio
    PC_MIC_MUTE_TAIL_MS=300     播放结束后的静音尾巴
"""
import os
import queue
import threading
import time

import numpy as np

try:
    import sounddevice as sd
except Exception:
    sd = None

from websockets.sync.client import connect

SR = 16000
BLOCK = SR // 50          # 20ms = 320 帧

_q: "queue.Queue[bytes]" = queue.Queue(maxsize=200)
_stop = threading.Event()
_thread = None
_stream = None
_capture_sr = SR
_ratecv_state = None
_last_play_end = 0.0
_muted_flag = False

# ---- 按一下开始、再按一下结束（toggle 录音）----
# PC_PTT=1：只有录音状态下才把音频发给 ASR；结束时收尾出结果
_ptt_mode = os.getenv("PC_PTT", "0") == "1"
_ptt_active = threading.Event()
_ptt_release = threading.Event()


def start_recording() -> bool:
    """开始录音（重复调用无副作用）。"""
    _ptt_release.clear()
    _ptt_active.set()
    return True


def stop_recording() -> bool:
    """结束录音：让 ASR 收尾出 final 并提交。"""
    if _ptt_active.is_set():
        _ptt_active.clear()
        _ptt_release.set()
    return False


def toggle_recording() -> bool:
    """切换录音状态，返回切换后的状态（True=正在录音）。"""
    if _ptt_active.is_set():
        return stop_recording()
    return start_recording()


def is_recording() -> bool:
    return _ptt_active.is_set()


def abort_recording():
    """放弃当前录音：不上行、不提交（切功能时用，避免误触发一次识别）"""
    _ptt_release.clear()
    _ptt_active.clear()
    while not _q.empty():
        try:
            _q.get_nowait()
        except Exception:
            break


def ptt_active() -> bool:
    """兼容旧接口（可视化窗口用）"""
    return _ptt_active.is_set()


def _muted() -> bool:
    """播放中或刚播完的一小段时间内静音，避免喇叭声音被自己听到。"""
    global _last_play_end
    try:
        import local_speaker
        import tts_fallback
        playing = local_speaker.busy(60) or tts_fallback.is_speaking()
    except Exception:
        playing = False
    if playing:
        _last_play_end = time.monotonic()
        return True
    tail = float(os.getenv("PC_MIC_MUTE_TAIL_MS", "300")) / 1000.0
    return (time.monotonic() - _last_play_end) < tail


def _push(pcm: bytes):
    try:
        if _q.full():
            try:
                _q.get_nowait()
            except Exception:
                pass
        _q.put_nowait(pcm)
    except Exception:
        pass


def _callback(indata, frames, time_info, status):
    global _ratecv_state
    try:
        pcm = bytes(indata)
    except Exception:
        return
    if _capture_sr != SR:
        try:
            import audioop
            pcm, _ratecv_state = audioop.ratecv(pcm, 2, 1, _capture_sr, SR, _ratecv_state)
        except Exception:
            return
    _push(pcm)


def _device_from_env():
    v = os.getenv("PC_MIC_DEVICE", "").strip()
    if not v:
        return None
    try:
        return int(v)
    except ValueError:
        return v


def _open_stream():
    """优先 16k；设备不支持时用默认采样率并重采样到 16k。"""
    global _stream, _capture_sr
    dev = _device_from_env()
    for sr in (SR, None):
        try:
            if sr is None:
                info = sd.query_devices(dev, "input")
                sr = int(info["default_samplerate"])
            st = sd.RawInputStream(
                samplerate=sr,
                channels=1,
                dtype="int16",
                blocksize=max(160, sr // 50),
                device=dev,
                callback=_callback,
            )
            st.start()
            _capture_sr = sr
            _stream = st
            name = "default"
            try:
                name = sd.query_devices(dev, "input").get("name", "default")
            except Exception:
                pass
            print(f"[MIC] 电脑麦克风已就绪：{name} @ {sr}Hz -> 16kHz", flush=True)
            return True
        except Exception as e:
            print(f"[MIC] 打开麦克风失败({sr}): {e}", flush=True)
    return False


def _worker():
    global _muted_flag
    ws_url = os.getenv("PC_MIC_WS", "ws://127.0.0.1:8081/ws_audio")
    silence = b"\x00" * (BLOCK * 2)
    while not _stop.is_set():
        try:
            with connect(ws_url, max_size=None, open_timeout=10) as ws:
                ws.send("START")
                print(f"[MIC] 已接入后端 {ws_url}，开始上行音频", flush=True)
                while not _stop.is_set():
                    # 处理服务端下发（RESTART = ASR 重连）
                    try:
                        msg = ws.recv(timeout=0)
                        if isinstance(msg, str) and "NO_ASR" in msg:
                            print("[MIC] 后端未配置 API Key，语音输入不可用（键盘 1/3/5/0 照常）", flush=True)
                            _ptt_active.clear()
                        elif isinstance(msg, str) and "RESTART" in msg:
                            print("[MIC] 收到 RESTART，重启 ASR 会话", flush=True)
                            ws.send("STOP")
                            ws.send("START")
                    except TimeoutError:
                        pass
                    except Exception:
                        break

                    # 结束录音：收尾 -> 让 ASR 输出 final -> 重开一轮
                    if _ptt_release.is_set():
                        _ptt_release.clear()
                        try:
                            ws.send("STOP")
                            print("[MIC] 录音结束，提交识别…", flush=True)
                            time.sleep(0.7)
                            ws.send("START")
                            while not _q.empty():      # 丢掉按键间隙的旧音频
                                try:
                                    _q.get_nowait()
                                except Exception:
                                    break
                        except Exception as e:
                            print(f"[MIC] 收尾失败，重连：{e}", flush=True)
                            break
                        continue

                    try:
                        pcm = _q.get(timeout=0.02)
                    except queue.Empty:
                        continue

                    # 没在录音就不上行（但仍要排空队列，避免积压）
                    if _ptt_mode and not _ptt_active.is_set():
                        continue

                    mute = _muted()
                    if mute != _muted_flag:
                        _muted_flag = mute
                        print(f"[MIC] {'静音（喇叭出声中）' if mute else '恢复拾音'}", flush=True)
                    try:
                        ws.send(silence if mute else pcm)
                    except Exception as e:
                        print(f"[MIC] 上行失败，重连：{e}", flush=True)
                        break
        except Exception as e:
            print(f"[MIC] 后端连接失败，2 秒后重试：{e}", flush=True)
        if not _stop.is_set():
            _stop.wait(2.0)


def start():
    """启动电脑麦克风（幂等）。"""
    global _thread
    if os.getenv("PC_MIC", "1") != "1":
        print("[MIC] PC_MIC=0，跳过电脑麦克风", flush=True)
        return
    if _thread and _thread.is_alive():
        return
    if sd is None:
        print("[MIC] 未安装 sounddevice，电脑麦克风不可用", flush=True)
        return
    if not _open_stream():
        print("[MIC] 麦克风不可用，语音指令功能将失效", flush=True)
        return
    _stop.clear()
    _thread = threading.Thread(target=_worker, name="pc-mic", daemon=True)
    _thread.start()


def stop():
    global _stream
    _stop.set()
    try:
        if _stream is not None:
            _stream.stop()
            _stream.close()
            _stream = None
    except Exception:
        pass
