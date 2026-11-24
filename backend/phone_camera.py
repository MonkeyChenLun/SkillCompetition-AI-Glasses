# phone_camera.py
# -*- coding: utf-8 -*-
"""
手机摄像头接入（替代 ESP32-CAM）

原理：从手机的 MJPEG 流里抠出 JPEG 帧，再以本地 WebSocket 客户端身份
推给后端自己的 /ws/camera —— 后续解码、导航、推流全部复用原有逻辑。

支持两种手机 App（会自动探测，不用手改端口）：
    IP Webcam    http://<手机IP>:8080/video      （推荐，可到 30fps）
    DroidCam     http://<手机IP>:4747/video
另外也兼容 /videofeed、/mjpegfeed，以及只提供单张图的 /shot.jpg（轮询模式）。

环境变量：
    PHONE_CAM_URL=http://172.20.10.2:8080/video   手机视频流地址
    PHONE_CAM_FPS=25                              推送帧率上限
    PHONE_CAM_WS=ws://127.0.0.1:8081/ws/camera    本地后端地址
    PC_CAMERA=1                                   开关
"""
import os
import threading
import time
import urllib.request
from urllib.parse import urlparse

from websockets.sync.client import connect

DEFAULT_URL = "http://172.20.10.2:8080/video"
DEFAULT_WS = "ws://127.0.0.1:8081/ws/camera"

# 常见手机摄像头 App 的端口与路径，按顺序探测
CAND_PORTS = [8080, 4747]          # 8080=IP Webcam / 4747=DroidCam
CAND_PATHS = ["/video", "/videofeed", "/mjpegfeed", "/video?640x480", "/shot.jpg"]

_stop = threading.Event()
_thread = None
_last_err = ""


def _candidate_urls(base: str):
    """把配置的 URL 拆开，生成"同端口其它路径 → 另一个端口所有路径"的探测顺序。"""
    base = base.rstrip("/")
    p = urlparse(base)
    scheme = p.scheme or "http"
    host = p.hostname or "127.0.0.1"
    port = p.port or 8080

    urls = [base]
    ports = [port] + [x for x in CAND_PORTS if x != port]
    for pt in ports:
        for path in CAND_PATHS:
            u = f"{scheme}://{host}:{pt}{path}"
            if u not in urls:
                urls.append(u)
    return urls


def _open_stream(url: str, timeout: float = 8.0):
    req = urllib.request.Request(url, headers={"User-Agent": "AI-Glasses/1.0"})
    return urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=timeout)


def _split_jpeg(buf: bytes):
    """从缓冲区里切出一帧完整 JPEG，返回 (jpeg, 剩余缓冲)。"""
    s = buf.find(b"\xff\xd8")
    if s < 0:
        return None, buf[-2:] if len(buf) > 2 else buf
    e = buf.find(b"\xff\xd9", s + 2)
    if e < 0:
        return None, buf[s:]
    return buf[s:e + 2], buf[e + 2:]


def _iter_jpeg(resp):
    """从 MJPEG 流里按 SOI/EOI 切出完整 JPEG（IP Webcam / DroidCam 通用）。"""
    buf = b""
    while not _stop.is_set():
        try:
            chunk = resp.read1(65536)  # 读取已到达的数据，无需等缓冲区填满
        except Exception:
            return
        if not chunk:
            return
        buf += chunk
        latest = None
        while True:
            jpeg, buf = _split_jpeg(buf)
            if jpeg is None:
                break
            latest = jpeg
        if latest is not None:
            yield latest
        if len(buf) > 4_000_000:      # 异常流保护
            buf = buf[-1_000_000:]


def _iter_single_jpeg(url: str, min_dt: float):
    """单张图接口（/shot.jpg）轮询模式：每次请求取一张。"""
    while not _stop.is_set():
        t0 = time.time()
        try:
            with _open_stream(url, timeout=5) as r:
                data = r.read()
            s = data.find(b"\xff\xd8")
            e = data.rfind(b"\xff\xd9")
            if s >= 0 and e > s:
                yield data[s:e + 2]
            else:
                return
        except OSError:
            return
        rest = min_dt - (time.time() - t0)
        if rest > 0:
            time.sleep(rest)


def _worker():
    global _last_err
    cam_url = os.getenv("PHONE_CAM_URL", DEFAULT_URL)
    ws_url = os.getenv("PHONE_CAM_WS", DEFAULT_WS)
    max_fps = float(os.getenv("PHONE_CAM_FPS", "25"))
    min_dt = 1.0 / max_fps if max_fps > 0 else 0.0

    while not _stop.is_set():
        # 1) 找到能用的视频流
        resp = None
        used = ""
        single = False
        for u in _candidate_urls(cam_url):
            if _stop.is_set():
                return
            try:
                r = _open_stream(u)
                ctype = (r.headers.get("Content-Type") or "").lower()
                if r.status == 200 and ("multipart/" in ctype or ctype.startswith(("image/jpeg", "application/octet-stream", "video/"))):
                    resp, used = r, u
                    single = ctype.startswith("image/")   # /shot.jpg 这类单图接口
                    print(f"[PHONE-CAM] 视频流已连接：{u} ({ctype or '未知类型'}"
                          f"{'，单图轮询' if single else ''})", flush=True)
                    break
                r.close()
            except Exception as e:
                _last_err = f"{u} -> {e}"
                continue
        if resp is None:
            print(f"[PHONE-CAM] 连不上手机摄像头，2 秒后重试。最后错误：{_last_err}", flush=True)
            _stop.wait(2.0)
            continue

        # 2) 连本地后端，逐帧推送
        try:
            with connect(ws_url, max_size=None, open_timeout=10) as ws:
                print(f"[PHONE-CAM] 已接入后端 {ws_url}，开始推帧", flush=True)
                sent = 0
                t_last = 0.0
                t_report = time.time()
                if single:
                    resp.close()
                frames = _iter_single_jpeg(used, min_dt) if single else _iter_jpeg(resp)
                for jpeg in frames:
                    if _stop.is_set():
                        break
                    now = time.time()
                    if min_dt and (now - t_last) < min_dt:
                        continue          # 按目标帧率丢帧
                    t_last = now
                    try:
                        ws.send(jpeg)
                    except Exception as e:
                        print(f"[PHONE-CAM] 推送失败，重连：{e}", flush=True)
                        break
                    sent += 1
                    if now - t_report >= 5.0:
                        print(f"[PHONE-CAM] 已推送 {sent} 帧，当前 {sent / (now - t_report):.1f} fps", flush=True)
                        sent, t_report = 0, now
        except Exception as e:
            print(f"[PHONE-CAM] 后端连接失败，重试：{e}", flush=True)
        finally:
            try:
                resp.close()
            except Exception:
                pass
        if not _stop.is_set():
            _stop.wait(1.0)


def start():
    """启动手机摄像头推流线程（幂等）。"""
    global _thread
    if os.getenv("PC_CAMERA", "1") != "1":
        print("[PHONE-CAM] PC_CAMERA=0，跳过手机摄像头", flush=True)
        return
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_worker, name="phone-camera", daemon=True)
    _thread.start()
    print(f"[PHONE-CAM] 推流线程已启动，目标 {os.getenv('PHONE_CAM_URL', DEFAULT_URL)}", flush=True)


def stop():
    _stop.set()
