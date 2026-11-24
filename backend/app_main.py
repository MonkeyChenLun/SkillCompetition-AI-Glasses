# app_main.py
# -*- coding: utf-8 -*-
import os, sys, time, json, asyncio, base64, audioop
from typing import Any, Dict, Optional, Tuple, List, Callable, Set, Deque
from collections import deque
from dataclasses import dataclass
import re
# 在其它 import 之后加：
from qwen_extractor import extract_english_label
from navigation_master import NavigationMaster, OrchestratorResult 
# 新增：导入盲道导航器
from workflow_blindpath import BlindPathNavigator
# 新增：导入过马路导航器
from workflow_crossstreet import CrossStreetNavigator
import torch
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from starlette.websockets import WebSocketState
import uvicorn
import cv2
import numpy as np
from ultralytics import YOLO
from obstacle_detector_client import ObstacleDetectorClient

import torch  # 添加这行


import mediapipe as mp
import bridge_io
import threading
import yolomedia  # 确保和 app_main.py 同目录，文件名就是 yolomedia.py
# ---- Windows 事件循环策略 ----
if sys.platform.startswith("win"):
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    except Exception:
        pass

# ---- .env ----
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

# ---- DashScope ASR 基础 ----
from dashscope import audio as dash_audio  # 若未安装，会在原项目里抛错提示

API_KEY = os.getenv("DASHSCOPE_API_KEY")

# 没有 API Key 也能跑：导航 / 找物品 / 按键全部是本地模型，
# 只有"语音输入(ASR)"和"闲聊(omni)"需要 Key。
ASR_ENABLED = bool(API_KEY)
if not ASR_ENABLED:
    print("[ASR] 未配置 DASHSCOPE_API_KEY —— 语音输入关闭，只能用键盘（1/3/5/0）",
          flush=True)

MODEL        = "paraformer-realtime-v2"
SAMPLE_RATE  = 16000
AUDIO_FMT    = "pcm"
CHUNK_MS     = 20
BYTES_CHUNK  = SAMPLE_RATE * CHUNK_MS // 1000 * 2
SILENCE_20MS = bytes(BYTES_CHUNK)

# ---- 引入我们的模块 ----
from audio_stream import (
    register_stream_route,         # 挂 /stream.wav
    broadcast_pcm16_realtime,      # 实时向连接分发 16k PCM
    hard_reset_audio,              # 音频+AI 播放总闸
    BYTES_PER_20MS_16K,
    is_playing_now,
    current_ai_task,
)
from omni_client import stream_chat, voice_intent
from asr_core import (
    ASRCallback,
    set_current_recognition,
    stop_current_recognition,
)
from audio_player import initialize_audio_system, play_voice_text

# ---- 同步录制器（已移除：录视频/音频拖慢帧率，按需求关闭）----
import signal
import atexit

# ---- IMU UDP ----
UDP_IP   = "0.0.0.0"
UDP_PORT = 12345

app = FastAPI()

# ====== 状态与容器 ======
app.mount("/static", StaticFiles(directory="static"), name="static")

ui_clients: Dict[int, WebSocket] = {}
current_partial: str = ""
recent_finals: List[str] = []
preview_guidance = ("", "")
RECENT_MAX = 50
last_frames: Deque[Tuple[float, bytes]] = deque(maxlen=10)

camera_viewers: Dict[WebSocket, asyncio.Queue[bytes]] = {}
esp32_camera_ws: Optional[WebSocket] = None
imu_ws_clients: Set[WebSocket] = set()
esp32_audio_ws: Optional[WebSocket] = None

# 【新增】盲道导航相关全局变量
blind_path_navigator = None
navigation_active = False
yolo_seg_model = None
obstacle_detector = None

# 【新增】过马路导航相关全局变量
cross_street_navigator = None
cross_street_active = False
orchestrator = None
_navigation_lock = asyncio.Lock()
_navigation_revision = 0


async def _update_navigation(action: Callable, *args, **kwargs):
    # 等当前帧结束再改状态，并让该帧的提示和画面失效。
    global _navigation_revision
    _navigation_revision += 1
    async with _navigation_lock:
        return action(*args, **kwargs)

# 【新增】omni对话状态标志
chat_history = deque(maxlen=8)

# 【新增】按 3 后等待用户说出物品名
_pending_item = False
# 切模式后的残留识别丢弃窗口（时间戳）
_suppress_final_until = 0.0
# 正在清场（此时不接受任何 ASR 结果）
_switching = False

# 【新增】模型加载函数
def load_navigation_models():
    """加载盲道导航所需的模型"""
    global yolo_seg_model, obstacle_detector

    try:
        seg_model_path = os.getenv("BLIND_PATH_MODEL", os.path.join(os.path.dirname(os.path.abspath(__file__)), "model", "yolo-seg.pt"))
        #print(f"[NAVIGATION] 尝试加载模型: {seg_model_path}")

        if os.path.exists(seg_model_path):
            print(f"[NAVIGATION] 模型文件存在，开始加载...")
            yolo_seg_model = YOLO(seg_model_path)

            # 强制放到 GPU
            if torch.cuda.is_available():
                yolo_seg_model.to("cuda")
                print(f"[NAVIGATION] 盲道分割模型加载成功并放到GPU: {yolo_seg_model.device}")
            else:
                print("[NAVIGATION] CUDA不可用，模型仍在CPU")

            # 测试模型是否能正常运行
            try:
                test_img = np.zeros((640, 640, 3), dtype=np.uint8)
                results = yolo_seg_model.predict(
                    test_img,
                    device="cuda" if torch.cuda.is_available() else "cpu",
                    verbose=False
                )
                print(f"[NAVIGATION] 模型测试成功，支持的类别数: {len(yolo_seg_model.names) if hasattr(yolo_seg_model, 'names') else '未知'}")
                if hasattr(yolo_seg_model, 'names'):
                    print(f"[NAVIGATION] 模型类别: {yolo_seg_model.names}")
            except Exception as e:
                print(f"[NAVIGATION] 模型测试失败: {e}")
        else:
            print(f"[NAVIGATION] 错误：找不到模型文件: {seg_model_path}")
            print(f"[NAVIGATION] 当前工作目录: {os.getcwd()}")
            print(f"[NAVIGATION] 请检查文件路径是否正确")
            
        # 【修改开始】使用 ObstacleDetectorClient 替代直接的 YOLO
        obstacle_model_path = os.getenv("OBSTACLE_MODEL", os.path.join(os.path.dirname(os.path.abspath(__file__)), "model", "yoloe-11l-seg.pt"))
        print(f"[NAVIGATION] 尝试加载障碍物检测模型: {obstacle_model_path}")
        
        if os.path.exists(obstacle_model_path):
            print(f"[NAVIGATION] 障碍物检测模型文件存在，开始加载...")
            try:
                # 使用 ObstacleDetectorClient 封装的 YOLO-E
                obstacle_detector = ObstacleDetectorClient(model_path=obstacle_model_path)
                print(f"[NAVIGATION] ========== YOLO-E 障碍物检测器加载成功 ==========")
                
                # 检查模型是否成功加载
                if hasattr(obstacle_detector, 'model') and obstacle_detector.model is not None:
                    print(f"[NAVIGATION] YOLO-E 模型已初始化")
                    print(f"[NAVIGATION] 模型设备: {next(obstacle_detector.model.parameters()).device}")
                else:
                    print(f"[NAVIGATION] 警告：YOLO-E 模型初始化异常")
                
                # 检查白名单是否成功加载
                if hasattr(obstacle_detector, 'WHITELIST_CLASSES'):
                    print(f"[NAVIGATION] 白名单类别数: {len(obstacle_detector.WHITELIST_CLASSES)}")
                    print(f"[NAVIGATION] 白名单前10个类别: {', '.join(obstacle_detector.WHITELIST_CLASSES[:10])}")
                else:
                    print(f"[NAVIGATION] 警告：白名单类别未定义")
                
                # 检查文本特征是否成功预计算
                if hasattr(obstacle_detector, 'whitelist_embeddings') and obstacle_detector.whitelist_embeddings is not None:
                    print(f"[NAVIGATION] YOLO-E 文本特征已预计算")
                    print(f"[NAVIGATION] 文本特征张量形状: {obstacle_detector.whitelist_embeddings.shape if hasattr(obstacle_detector.whitelist_embeddings, 'shape') else '未知'}")
                else:
                    print(f"[NAVIGATION] 警告：YOLO-E 文本特征未预计算")
                
                # 测试障碍物检测功能
                print(f"[NAVIGATION] 开始测试 YOLO-E 检测功能...")
                try:
                    test_img = np.zeros((640, 640, 3), dtype=np.uint8)
                    # 在测试图像中画一个白色矩形，模拟一个物体
                    cv2.rectangle(test_img, (200, 200), (400, 400), (255, 255, 255), -1)
                    
                    # 测试检测（不提供 path_mask）
                    test_results = obstacle_detector.detect(test_img)
                    print(f"[NAVIGATION] YOLO-E 检测测试成功!")
                    print(f"[NAVIGATION] 测试检测结果数: {len(test_results)}")
                    
                    if len(test_results) > 0:
                        print(f"[NAVIGATION] 测试检测到的物体:")
                        for i, obj in enumerate(test_results):
                            print(f"  - 物体 {i+1}: {obj.get('name', 'unknown')}, "
                                  f"面积比例: {obj.get('area_ratio', 0):.3f}, "
                                  f"位置: ({obj.get('center_x', 0):.0f}, {obj.get('center_y', 0):.0f})")
                except Exception as e:
                    print(f"[NAVIGATION] YOLO-E 检测测试失败: {e}")
                    import traceback
                    traceback.print_exc()
                
                print(f"[NAVIGATION] ========== YOLO-E 障碍物检测器加载完成 ==========")
                
            except Exception as e:
                print(f"[NAVIGATION] 障碍物检测器加载失败: {e}")
                import traceback
                traceback.print_exc()
                obstacle_detector = None
        else:
            print(f"[NAVIGATION] 警告：找不到障碍物检测模型文件: {obstacle_model_path}")
        
    except Exception as e:
        print(f"[NAVIGATION] 模型加载失败: {e}")
        import traceback
        traceback.print_exc()

# 实时视频可能改变分辨率，避免 cuDNN 为新尺寸搜索算法时卡住首帧。
torch.backends.cudnn.benchmark = False

# 在程序启动时加载模型
print("[NAVIGATION] 开始加载导航模型...")
load_navigation_models()
print(f"[NAVIGATION] 模型加载完成 - yolo_seg_model: {yolo_seg_model is not None}")

# 【已移除】同步录制：录视频/音频会持续写盘，是帧率低的主因之一
def cleanup_on_exit():
    """程序退出时的清理工作"""
    print("\n[SYSTEM] 正在退出…", flush=True)

def signal_handler(sig, frame):
    """处理Ctrl+C信号"""
    print("\n[SYSTEM] 收到中断信号，正在安全退出...")
    cleanup_on_exit()
    import sys
    sys.exit(0)

# 注册信号处理器
signal.signal(signal.SIGINT, signal_handler)  # Ctrl+C
signal.signal(signal.SIGTERM, signal_handler)  # 终止信号
atexit.register(cleanup_on_exit)  # 正常退出时也调用

print("[RECORDER] 录制功能已关闭（不写盘，省 IO）")



# 【新增】预加载红绿灯检测模型（避免进入WAIT_TRAFFIC_LIGHT状态时卡顿）
try:
    import trafficlight_detection
    print("[TRAFFIC_LIGHT] 开始预加载红绿灯检测模型...")
    if trafficlight_detection.init_model():
        print("[TRAFFIC_LIGHT] 红绿灯检测模型预加载成功")
        # 执行一次测试推理，完全预热模型
        try:
            test_img = np.zeros((640, 640, 3), dtype=np.uint8)
            _ = trafficlight_detection.process_single_frame(test_img)
            print("[TRAFFIC_LIGHT] 模型预热完成")
        except Exception as e:
            print(f"[TRAFFIC_LIGHT] 模型预热失败: {e}")
    else:
        print("[TRAFFIC_LIGHT] 红绿灯检测模型预加载失败")
except Exception as e:
    print(f"[TRAFFIC_LIGHT] 红绿灯模型预加载出错: {e}")

# ============== 关键：系统级"硬重置"总闸 =================
interrupt_lock = asyncio.Lock()

# ============== YOLO媒体线程管理 =================
yolomedia_thread: Optional[threading.Thread] = None
yolomedia_stop_event = threading.Event()
yolomedia_running = False
yolomedia_sending_frames = False  # 新增：标记YOLO是否已经开始发送处理后的帧

# 物品名称到YOLO类别的映射
ITEM_TO_CLASS_MAP = {
    "红牛": "Red_Bull",
    "AD钙奶": "AD_milk",
    "ad钙奶": "AD_milk",
    "钙奶": "AD_milk",
}

def _preview_push(jpeg_data: bytes):
    """把一帧推给本地可视化窗口（无前端方案）。"""
    try:
        import preview_window
        preview_window.push_jpeg(jpeg_data)
    except Exception:
        pass


async def ui_broadcast_raw(msg: str):
    dead = []
    for k, ws in list(ui_clients.items()):
        try:
            await ws.send_text(msg)
        except Exception:
            dead.append(k)
    for k in dead:
        ui_clients.pop(k, None)


async def ui_broadcast_partial(text: str):
    global current_partial
    current_partial = text
    await ui_broadcast_raw("PARTIAL:" + text)

async def ui_broadcast_final(text: str):
    global current_partial, recent_finals, preview_guidance
    current_partial = ""
    if text.startswith("[导航] ") and orchestrator:
        preview_guidance = orchestrator.get_state(), text[len("[导航] "):]
    recent_finals.append(text)
    if len(recent_finals) > RECENT_MAX:
        recent_finals = recent_finals[-RECENT_MAX:]
    await ui_broadcast_raw("FINAL:" + text)
    print(f"[ASR/AI FINAL] {text}", flush=True)

async def full_system_reset(reason: str = ""):
    await _enter_mode(reason or "停止")
    if orchestrator:
        await _update_navigation(orchestrator.dispatch_voice, "stop")
    await _announce("已停止当前任务。")


# ========= 启动/停止 YOLO 媒体处理 =========
def start_yolomedia_with_target(target_name: str):
    """启动yolomedia线程，搜索指定物品"""
    global yolomedia_thread, yolomedia_stop_event, yolomedia_running, yolomedia_sending_frames

    # 上一轮必须真正退出后才能开新一轮，否则两个线程抢 GPU/画面
    if yolomedia_thread is not None and yolomedia_thread.is_alive():
        stop_yolomedia()
        if yolomedia_thread.is_alive():
            print("[YOLOMEDIA] 上一轮还没退干净，放弃本次启动（稍后再按 3）", flush=True)
            return

    # 查找对应的YOLO类别
    yolo_class = ITEM_TO_CLASS_MAP.get(target_name, target_name)
    yolo_class = str(yolo_class or "").strip()

    # 目标名必须是"干净英文名词"，否则 YOLOE 文本编码出来全是噪声，
    # 表现就是"框不出东西"。JSON/中文/空串一律拒绝，并打日志说明。
    if (not yolo_class) or yolo_class.startswith("{") or yolo_class.startswith("[") \
            or any(ord(ch) > 127 for ch in yolo_class):
        print(f"[YOLOMEDIA] 目标名不合法，放弃本次启动：{target_name!r}", flush=True)
        return

    print(f"[YOLOMEDIA] Starting with target: {target_name} -> YOLO class: {yolo_class}", flush=True)

    # 【关键】每轮用独立 Event：共用同一个 Event 时，start 里的 clear()
    # 会把"上一个线程正在等的 set()"抹掉，导致旧线程永远停不下来、两轮叠跑
    ev = threading.Event()
    yolomedia_stop_event = ev
    yolomedia_running = True
    yolomedia_sending_frames = False

    def _run():
        try:
            yolomedia.main(headless=True, prompt_name=yolo_class, stop_event=ev)
        except Exception as e:
            print(f"[YOLOMEDIA] worker stopped: {e}", flush=True)
        finally:
            # 只有当前线程仍是"登记在册"的那一个时才清标志，
            # 避免旧线程退出时把新一轮的状态抹掉
            global yolomedia_running, yolomedia_sending_frames
            if threading.current_thread() is yolomedia_thread:
                yolomedia_running = False
                yolomedia_sending_frames = False

    yolomedia_thread = threading.Thread(target=_run, name="yolomedia", daemon=True)
    yolomedia_thread.start()
    print(f"[YOLOMEDIA] background worker started for: {yolo_class}（正在初始化，暂时显示原始画面）", flush=True)

def stop_yolomedia():
    """停止yolomedia线程"""
    global yolomedia_thread, yolomedia_stop_event, yolomedia_running, yolomedia_sending_frames

    # 注意：不看 yolomedia_running，只看线程是否还活着，
    # 否则"标志已置 False 但线程还在跑"的情况会漏停，导致两轮叠跑
    if yolomedia_thread is not None and yolomedia_thread.is_alive():
        print("[YOLOMEDIA] Stopping worker...", flush=True)
        try:
            yolomedia_stop_event.set()
        except Exception:
            pass

        # 首次加载模型要 3~5 秒，给足时间等它跑到检查点
        yolomedia_thread.join(timeout=12.0)
        if yolomedia_thread.is_alive():
            print("[YOLOMEDIA] 线程 12s 内没退出（可能还在加载模型），下次启动前会再检查", flush=True)

    yolomedia_running = False
    yolomedia_sending_frames = False

    print("[YOLOMEDIA] Worker stopped, 等待状态切换.", flush=True)

# ========= 模式切换：先彻底清场，再进新功能 =========
# 解决"语音聊天没被打断"和"上一个功能还在跑"两个问题
_WALK_START = ("步行导航", "开始导航", "盲道导航", "帮我导航", "开始过马路", "帮我过马路", "检测红绿灯", "看红绿灯")
_WALK_STOP = ("停止步行导航", "结束步行导航", "停止导航", "结束导航", "过马路结束", "结束过马路", "停止检测", "停止红绿灯")
_CHAT_START = ("闲聊模式", "开始闲聊", "陪我聊聊天", "聊聊天")
_CONFIRM = ("确认行人绿灯", "现在通过", "立即通过")
_COMMAND_KEYWORDS = (*_WALK_START, *_WALK_STOP, *_CHAT_START, *_CONFIRM, "找物模式", "障碍物检测")
_MENU = "可以说，带我走盲道、帮我找钥匙、看看前方障碍物，或者陪我聊聊天。"


async def _announce(message):
    await ui_broadcast_final(f"[系统] {message}")
    play_voice_text(message)


async def _enter_mode(mode_name: str):
    """
    切换功能前统一清场：
      1) 停掉正在播报的 AI 语音（hard_reset_audio 会取消 omni 任务）
      2) 停掉找物品的 yolomedia 线程
      3) 复位导航器 / 状态机，避免旧状态残留
    """
    global _pending_item, _suppress_final_until, _switching, preview_guidance
    preview_guidance = ("", "")
    chat_history.clear()
    _pending_item = False
    # 整个清场期间（可能要等 yolomedia 退出）屏蔽 ASR 结果，
    # 否则清场途中吐出的半句会被当成新问题丢给大模型，出现"按了 0 还在说话"
    _switching = True
    _suppress_final_until = time.time() + 2.0

    # 立刻闭嘴：按 0 / 切功能时不允许还有语音在播（包括 yolomedia 的引导音）
    # 清场结束时会显式 unmute，所以这里给个足够长的值即可
    try:
        from audio_player import mute_output
        mute_output(15.0)
    except Exception:
        pass

    try:
        await hard_reset_audio(f"switch->{mode_name}")
        if yolomedia_running:
            try:
                # 放线程池里停，避免 join 卡住事件循环
                await asyncio.get_running_loop().run_in_executor(None, stop_yolomedia)
            except Exception as e:
                print(f"[SWITCH] 停止找物品失败: {e}", flush=True)
        if orchestrator:
            try:
                await _update_navigation(orchestrator.stop_item_search, restore_nav=False)
            except Exception:
                pass
            try:
                await _update_navigation(orchestrator.reset)
            except Exception:
                pass
        # 切功能时放弃当前录音（不上行、不提交，避免"没按回车却提交了"）
        try:
            import pc_mic
            pc_mic.abort_recording()
        except Exception:
            pass
        print(f"[SWITCH] 已清场，进入 {mode_name}", flush=True)
    finally:
        # 清场结束后再留 1 秒抑制窗口，然后恢复接收 ASR
        _suppress_final_until = time.time() + 1.0
        _switching = False
        # 解除静音，让新模式自己的启动提示音能正常播
        try:
            from audio_player import unmute
            unmute()
        except Exception:
            pass


async def _toggle_record():
    """回车：开始 / 结束录音。开始前如果 AI 正在播报，先打断它。"""
    import pc_mic

    if not ASR_ENABLED:
        print("[KEY] 未配置 DASHSCOPE_API_KEY，语音输入不可用（键盘 1/3/5/0 照常）", flush=True)
        await ui_broadcast_final("[系统] 未配置 API Key，语音输入不可用")
        return

    if pc_mic.is_recording():
        pc_mic.stop_recording()
        print("[KEY] 结束录音，提交识别", flush=True)
        return

    # AI 正在说话 → 按回车直接打断
    if is_playing_now():
        print("[KEY] 打断 AI 播报", flush=True)
        await hard_reset_audio("record-interrupt")
        await ui_broadcast_final("[系统] 已打断")
    pc_mic.start_recording()
    print("[KEY] 开始录音…（再按回车结束）", flush=True)


async def _start_item_listen():
    await start_ai_with_text_custom("找物模式")


async def start_ai_with_text_custom(user_text: str):
    global _pending_item
    text = user_text.strip().strip("。！？!?，, ")
    if not text or _switching:
        return
    state = orchestrator.get_state() if orchestrator else "IDLE"
    item = ""
    if text in _CONFIRM:
        if state == "WAIT_TRAFFIC_LIGHT":
            message = await _update_navigation(orchestrator.dispatch_voice, "confirm")
            await ui_broadcast_final(f"[导航] {message}")
            play_voice_text(message)
        return
    if text in _WALK_START or text == "继续":
        intent = "walk"
    elif text in (*_WALK_STOP, "停止", "停下", "退出找物", "找到了", "拿到了"):
        intent = "stop"
    elif text in _CHAT_START:
        intent = "chat"
    elif text in ("障碍物检测", "开始避障"):
        intent = "obstacle"
    elif text in ("选择模式", "有什么模式"):
        intent = "menu"
    elif text == "找物模式":
        intent = "find"
    else:
        revision = _navigation_revision
        try:
            intent, item = await voice_intent(text, "等待物品名称" if _pending_item else state)
        except Exception as exc:
            print(f"[VOICE] 意图识别失败: {type(exc).__name__}")
            match = re.fullmatch(r"(?:请)?(?:帮我找一下|帮我找|找一下)(.{1,30})", text)
            if match or _pending_item:
                intent, item = "find", match.group(1) if match else text
            elif state in ("IDLE", "CHAT"):
                intent = "talk"
            else:
                await _announce("暂时无法理解，可以直接说开始导航、找物模式或开始闲聊。")
                return
        if revision != _navigation_revision:
            return

    if state in ("CHAT", "IDLE") and intent == "chat" and text not in _CHAT_START:
        intent = "talk"
    if intent in ("menu", "stay"):
        await _announce(_MENU)
        return
    if intent in ("chat", "talk") and os.getenv("QWEN_OMNI_ENABLED", "1") != "1":
        await _announce("闲聊服务已关闭。")
        return
    if intent == "talk" and state not in ("IDLE", "CHAT"):
        await _announce("当前任务进行中。想聊天可以说开始闲聊。")
        return
    if intent == "talk":
        if orchestrator and state == "IDLE":
            await _update_navigation(orchestrator.dispatch_voice, "chat")
        await start_ai_with_text(text)
        return
    if not orchestrator:
        await _announce("导航系统未就绪。")
        return
    if intent == "walk" and state in ("BLINDPATH_NAV","SEEKING_CROSSWALK","WAIT_TRAFFIC_LIGHT","CROSSING","SEEKING_NEXT_BLINDPATH","RECOVERY"):
        await _announce("步行导航进行中")
        return
    if intent == "obstacle" and obstacle_detector is None:
        await _announce("障碍物检测器未就绪。")
        return
    if intent == "find" and item:
        label, _ = await asyncio.to_thread(extract_english_label, item)
        if not label:
            await _announce("请再说一次要找的物品名。")
            return
    await _enter_mode(intent)
    bridge_io.clear_item_frames()
    message = await _update_navigation(orchestrator.dispatch_voice, intent)
    if intent == "find":
        _pending_item = not item
        if item:
            start_yolomedia_with_target(label)
            message = f"正在寻找{item}。" if yolomedia_running else "找物启动失败。"
        else:
            message = "你想找什么物品？"
    await _announce(message)


# ========= Omni 播放启动 =========
async def start_ai_with_text(user_text: str):
    """硬重置后，开启新的 AI 语音输出。"""
    async def _runner():
        txt_buf: List[str] = []
        rate_state = None

        # 组装（图像+文本）
        content_list = []
        if last_frames and time.time() - last_frames[-1][0] < 3:
            try:
                _, jpeg_bytes = last_frames[-1]
                img_b64 = base64.b64encode(jpeg_bytes).decode("ascii")
                content_list.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"}
                })
            except Exception:
                pass
        content_list.append({"type": "text", "text": user_text})

        try:
            async for piece in stream_chat(content_list, history=list(chat_history), voice=os.getenv("QWEN_OMNI_VOICE", "Serena"), audio_format="wav"):
                # 文本增量（仅 UI）
                if piece.text_delta:
                    txt_buf.append(piece.text_delta)
                    try:
                        await ui_broadcast_partial("[AI] " + "".join(txt_buf))
                    except Exception:
                        pass

                # 音频分片：Omni 返回 24k (PCM16) 的 wav audio.data（Base64）；下行需要 8k PCM16
                if piece.audio_b64:
                    try:
                        pcm24 = base64.b64decode(piece.audio_b64)
                    except Exception:
                        pcm24 = b""
                    if pcm24:
                        # 24k → 8k (使用ratecv保证音调和速度不变)
                        pcm8k, rate_state = audioop.ratecv(pcm24, 2, 1, 24000, 8000, rate_state)
                        pcm8k = audioop.mul(pcm8k, 2, 0.60)
                        if pcm8k:
                            await broadcast_pcm16_realtime(pcm8k)

        except asyncio.CancelledError:
            # 被新一轮打断
            raise
        except Exception as e:
            try:
                await _announce("大模型暂时无法回复，请稍后再试。")
                print(f"[OMNI] {type(e).__name__}")
                return
            except Exception:
                pass
        finally:
            # 自然结束时，给当前连接一个 "完结" 信号
            from audio_stream import stream_clients  # 局部导入，避免环依赖
            for sc in list(stream_clients):
                if not sc.abort_event.is_set():
                    try: sc.q.put_nowait(b"\x00"*BYTES_PER_20MS_16K)  # 一帧静音
                    except Exception: pass
                    try: sc.q.put_nowait(None)
                    except Exception: pass

        final_text = "".join(txt_buf).strip()
        if final_text:
            chat_history.extend(({"role":"user","content":user_text}, {"role":"assistant","content":final_text}))
            await ui_broadcast_final("[AI] " + final_text)

    # 真正启动前先硬重置，保证**绝无**旧音频残留
    await hard_reset_audio("start_ai_with_text")
    loop = asyncio.get_running_loop()
    from audio_stream import current_ai_task as _task_holder  # 读写模块内全局
    from audio_stream import __dict__ as _as_dict
    # 设置模块内的 current_ai_task
    task = loop.create_task(_runner())
    _as_dict["current_ai_task"] = task

# ---------- 页面 / 健康 ----------
@app.get("/", response_class=HTMLResponse)
def root():
    with open(os.path.join("templates", "index.html"), "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())

@app.get("/api/health", response_class=PlainTextResponse)
def health():
    return "OK"

# 注册 /stream.wav
register_stream_route(app)

# ---------- WebSocket：WebUI 文本（ASR/AI 状态推送） ----------
@app.websocket("/ws_ui")
async def ws_ui(ws: WebSocket):
    await ws.accept()
    ui_clients[id(ws)] = ws
    try:
        init = {"partial": current_partial, "finals": recent_finals[-10:]}
        await ws.send_text("INIT:" + json.dumps(init, ensure_ascii=False))
        while True:
            await asyncio.sleep(60)
    except WebSocketDisconnect:
        pass
    finally:
        ui_clients.pop(id(ws), None)

# ---------- WebSocket：ESP32 音频入口（ASR 上行） ----------
@app.websocket("/ws_audio")
async def ws_audio(ws: WebSocket):
    global esp32_audio_ws
    esp32_audio_ws = ws
    await ws.accept()
    print("\n[AUDIO] client connected")

    # 没配 Key：语音通道直接进入"只收不发"状态，键盘功能不受影响
    if not ASR_ENABLED:
        try:
            await ws.send_text("NO_ASR")
        except Exception:
            pass
        try:
            while True:
                msg = await ws.receive()
                if msg.get("type") in ("websocket.close", "websocket.disconnect"):
                    break
        except Exception:
            pass
        finally:
            esp32_audio_ws = None
            print("[AUDIO] 无 API Key，语音通道已关闭")
        return

    recognition = None
    streaming = False
    last_ts = time.monotonic()
    keepalive_task: Optional[asyncio.Task] = None

    async def stop_rec(send_notice: Optional[str] = None):
        nonlocal recognition, streaming, keepalive_task
        if keepalive_task and keepalive_task is not asyncio.current_task() and not keepalive_task.done():
            keepalive_task.cancel()
            try: await keepalive_task
            except Exception: pass
        keepalive_task = None
        if recognition:
            try: recognition.stop()
            except Exception: pass
            recognition = None
        await set_current_recognition(None)
        streaming = False
        if send_notice:
            try: await ws.send_text(send_notice)
            except Exception: pass

    async def on_sdk_error(_msg: str):
        await stop_rec(send_notice="RESTART")

    # 保活：只在"正在录音"时补静音。
    # 原来无论有没有人说话都在持续喂 600ms 静音，ASR 按音频时长计费，
    # 等于后端一开着就在烧钱。不录音时让会话自然闲置，下一轮录音会重新 START。
    _KA_WHEN_IDLE = os.getenv("ASR_KEEPALIVE_WHEN_IDLE", "0") == "1"

    def _recording_now() -> bool:
        if _KA_WHEN_IDLE:
            return True
        try:
            import pc_mic
            return pc_mic.is_recording()
        except Exception:
            return True   # 非电脑麦克风模式（ESP32）保持原行为

    async def keepalive_loop():
        nonlocal last_ts, recognition, streaming
        try:
            while streaming and recognition is not None:
                idle = time.monotonic() - last_ts
                if idle > 0.35 and _recording_now():
                    try:
                        for _ in range(30):  # ~600ms 静音
                            recognition.send_audio_frame(SILENCE_20MS)
                        last_ts = time.monotonic()
                    except Exception:
                        await on_sdk_error("keepalive send failed")
                        return
                await asyncio.sleep(0.10)
        except asyncio.CancelledError:
            return

    try:
        while True:
            if WebSocketState and ws.client_state != WebSocketState.CONNECTED:
                break
            try:
                msg = await ws.receive()
            except WebSocketDisconnect:
                break
            except RuntimeError as e:
                if "Cannot call \"receive\"" in str(e):
                    break
                raise

            if "text" in msg and msg["text"] is not None:
                raw = (msg["text"] or "").strip()
                cmd = raw.upper()

                if cmd == "START":
                    print("[AUDIO] START received")
                    await stop_rec()
                    loop = asyncio.get_running_loop()
                    def post(coro):
                        asyncio.run_coroutine_threadsafe(coro, loop)

                    # 组装 ASR 回调（把依赖都注入）
                    cb = ASRCallback(
                        on_sdk_error=lambda s: post(on_sdk_error(s)),
                        post=post,
                        ui_broadcast_partial=ui_broadcast_partial,
                        ui_broadcast_final=ui_broadcast_final,
                        is_playing_now_fn=is_playing_now,
                        start_ai_with_text_fn=start_ai_with_text_custom,  # 使用自定义版本
                        full_system_reset_fn=full_system_reset,
                        interrupt_lock=interrupt_lock,
                        is_command_fn=lambda t: any(k in t for k in _COMMAND_KEYWORDS),
                    )

                    recognition = dash_audio.asr.Recognition(
                        api_key=API_KEY, model=MODEL, format=AUDIO_FMT,
                        sample_rate=SAMPLE_RATE, callback=cb
                    )
                    recognition.start()
                    await set_current_recognition(recognition)
                    streaming = True
                    last_ts = time.monotonic()
                    keepalive_task = asyncio.create_task(keepalive_loop())
                    await ui_broadcast_partial("（已开始接收音频…）")
                    await ws.send_text("OK:STARTED")

                elif cmd == "STOP":
                    if recognition:
                        for _ in range(15):  # ~300ms 静音
                            try: recognition.send_audio_frame(SILENCE_20MS)
                            except Exception: break
                    await stop_rec(send_notice="OK:STOPPED")

                elif raw.startswith("PROMPT:"):
                    # 设备端主动发起一轮：同样使用“先硬重置后播放”的强语义
                    text = raw[len("PROMPT:"):].strip()
                    if text:
                        async with interrupt_lock:
                            await start_ai_with_text_custom(text) # 使用自定义的启动函数
                        await ws.send_text("OK:PROMPT_ACCEPTED")
                    else:
                        await ws.send_text("ERR:EMPTY_PROMPT")

            elif "bytes" in msg and msg["bytes"] is not None:
                if streaming and recognition:
                    try:
                        recognition.send_audio_frame(msg["bytes"])
                        last_ts = time.monotonic()
                    except Exception:
                        await on_sdk_error("send_audio_frame failed")

    except Exception as e:
        print(f"\n[WS ERROR] {e}")
    finally:
        await stop_rec()
        try:
            if WebSocketState is None or ws.client_state == WebSocketState.CONNECTED:
                await ws.close(code=1000)
        except Exception:
            pass
        if esp32_audio_ws is ws:
            esp32_audio_ws = None
        print("[WS] connection closed")

# ---------- WebSocket：ESP32 相机入口（JPEG 二进制） ----------
def ensure_navigators():
    """初始化盲道/过马路导航器与统领状态机（可重复调用，不依赖相机是否已连上）"""
    global blind_path_navigator, cross_street_navigator, orchestrator

    if blind_path_navigator is None and yolo_seg_model is not None:
        blind_path_navigator = BlindPathNavigator(yolo_seg_model, obstacle_detector)
        print("[NAVIGATION] 盲道导航器已初始化", flush=True)
    elif yolo_seg_model is None:
        print("[NAVIGATION] 警告：YOLO模型未加载，无法初始化导航器", flush=True)

    if cross_street_navigator is None and yolo_seg_model is not None:
        cross_street_navigator = CrossStreetNavigator(
            seg_model=yolo_seg_model,
            coco_model=None,   # 不使用交通灯检测
            obs_model=None     # 暂时也不用障碍物检测，让它更快
        )
        print("[CROSS_STREET] 过马路导航器已初始化", flush=True)

    if orchestrator is None and blind_path_navigator is not None and cross_street_navigator is not None:
        from crossing_camera import CrossingCamera
        orchestrator = NavigationMaster(blind_path_navigator, cross_street_navigator,
                                        crossing_camera=CrossingCamera(obstacle_detector))
        print("[NAV MASTER] 统领状态机已初始化（托管模式）", flush=True)


def _publish_camera_frame(jpeg_data: bytes):
    _preview_push(jpeg_data)
    for pending in camera_viewers.values():
        if pending.full():
            pending.get_nowait()
        pending.put_nowait(jpeg_data)


def _process_navigation_jpeg(data: bytes, navigator: NavigationMaster, state: str, frame_number: int, received_at=None):
    try:
        bgr = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    except cv2.error:
        bgr = None
    if bgr is None or bgr.size == 0:
        return None, ""

    out_img = bgr
    guidance = ""
    try:
        if state == "CROSSING":
            from tts_fallback import is_speaking
            result = navigator.process_frame(bgr, received_at=received_at,
                                             can_announce_vehicle=not is_speaking())
        else:
            result = navigator.process_frame(bgr, received_at=received_at)
        guidance = result.guidance_text
        if result.annotated_image is not None:
            out_img = result.annotated_image
    except Exception as e:
        if frame_number % 100 == 0:
            print(f"[NAV MASTER] 处理帧时出错: {e}")

    if out_img is bgr:
        return data, guidance
    ok, encoded = cv2.imencode(".jpg", out_img, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
    return (encoded.tobytes() if ok else None), guidance


@app.websocket("/ws/camera")
async def ws_camera_esp(ws: WebSocket):
    global esp32_camera_ws, preview_guidance
    if esp32_camera_ws is not None:
        await ws.close(code=1013)
        return
    esp32_camera_ws = ws
    latest = None
    frame_ready = asyncio.Event()

    async def _processor():
        nonlocal latest
        frame_counter = 0
        while True:
            await frame_ready.wait()
            frame_ready.clear()
            (data, received_at), latest = latest, None
            frame_counter += 1
            last_frames.append((time.time(), data))

            try:
                async with _navigation_lock:
                    navigator = orchestrator
                    state = navigator.get_state() if navigator else "IDLE"
                    if _switching or navigator is None:
                        if not yolomedia_sending_frames:
                            _publish_camera_frame(data)
                        continue

                    revision = _navigation_revision
                    work = asyncio.create_task(asyncio.to_thread(
                        _process_navigation_jpeg, data, navigator, state, frame_counter, received_at,
                    ))
                    try:
                        jpeg, guidance = await asyncio.shield(work)
                    except asyncio.CancelledError:
                        # 线程任务不能取消，等它结束后才能复位导航器。
                        await asyncio.gather(work, return_exceptions=True)
                        raise
                    if _switching or revision != _navigation_revision:
                        continue

                if jpeg is not None and not (state == "ITEM_SEARCH" and yolomedia_sending_frames):
                    _publish_camera_frame(jpeg)
                if guidance:
                    try:
                        await ui_broadcast_final(f"[导航] {guidance}")
                        play_voice_text(guidance)
                    except Exception:
                        pass
            except Exception as e:
                print(f"[CAMERA] 帧处理异常: {e}")

    proc_task = None
    try:
        await ws.accept()
        print("[CAMERA] 视频源已连接")
        ensure_navigators()
        proc_task = asyncio.create_task(_processor())
        while True:
            msg = await ws.receive()
            data = msg.get("bytes")
            if data and data.startswith(b"\xff\xd8"):
                latest = data, time.monotonic()
                frame_ready.set()
            elif msg.get("type") in ("websocket.close", "websocket.disconnect"):
                break
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[CAMERA ERROR] {e}")
    finally:
        if proc_task is not None:
            proc_task.cancel()
            await asyncio.gather(proc_task, return_exceptions=True)
        try:
            if WebSocketState is None or ws.client_state == WebSocketState.CONNECTED:
                await ws.close(code=1000)
        except Exception:
            pass
        try:
            if yolomedia_running:
                await asyncio.to_thread(stop_yolomedia)
            bridge_io.clear_item_frames()
            async with _navigation_lock:
                if blind_path_navigator:
                    blind_path_navigator.reset()
                if cross_street_navigator:
                    cross_street_navigator.reset()
                if orchestrator:
                    orchestrator.reset()
                    print("[NAV MASTER] 统领器已重置")
        finally:
            preview_guidance = ("", "")
            esp32_camera_ws = None
            print("[CAMERA] 视频源已断开")


# ---------- WebSocket：浏览器订阅相机帧 ----------
@app.websocket("/ws/viewer")
async def ws_viewer(ws: WebSocket):
    await ws.accept()
    pending: asyncio.Queue[bytes] = asyncio.Queue(maxsize=1)
    camera_viewers[ws] = pending
    print(f"[VIEWER] Browser connected. Total viewers: {len(camera_viewers)}", flush=True)

    async def _send_frames():
        while True:
            await ws.send_bytes(await pending.get())

    async def _wait_for_disconnect():
        while (await ws.receive())["type"] != "websocket.disconnect":
            pass

    tasks = (asyncio.create_task(_send_frames()), asyncio.create_task(_wait_for_disconnect()))
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        camera_viewers.pop(ws, None)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        print(f"[VIEWER] Removed. Total viewers: {len(camera_viewers)}", flush=True)


# ---------- WebSocket：浏览器订阅 IMU ----------
@app.websocket("/ws")
async def ws_imu(ws: WebSocket):
    await ws.accept()
    imu_ws_clients.add(ws)
    try:
        while True:
            await asyncio.sleep(60)
    except WebSocketDisconnect:
        pass
    finally:
        imu_ws_clients.discard(ws)

async def imu_broadcast(msg: str):
    if not imu_ws_clients: return
    dead = []
    for ws in list(imu_ws_clients):
        try:
            await ws.send_text(msg)
        except Exception:
            dead.append(ws)
    for ws in dead:
        imu_ws_clients.discard(ws)

# ---------- 服务端 IMU 估计（原样保留） ----------
from math import atan2, hypot, pi
GRAV_BETA   = 0.98
STILL_W     = 0.4
YAW_DB      = 0.08
YAW_LEAK    = 0.2
ANG_EMA     = 0.15
AUTO_REZERO = True
USE_PROJ    = True
FREEZE_STILL= True
G     = 9.807
A_TOL = 0.08 * G
gLP = {"x":0.0, "y":0.0, "z":0.0}
gOff= {"x":0.0, "y":0.0, "z":0.0}
BIAS_ALPHA = 0.002
yaw  = 0.0
Rf = Pf = Yf = 0.0
ref = {"roll":0.0, "pitch":0.0, "yaw":0.0}
holdStart = 0.0
isStill   = False
last_ts_imu = 0.0
last_wall = 0.0
imu_store: List[Dict[str, Any]] = []

def _wrap180(a: float) -> float:
    a = a % 360.0
    if a >= 180.0: a -= 360.0
    if a < -180.0: a += 360.0
    return a

def process_imu_and_maybe_store(d: Dict[str, Any]):
    global gLP, gOff, yaw, Rf, Pf, Yf, ref, holdStart, isStill, last_ts_imu, last_wall

    t_ms = float(d.get("ts", 0.0))
    now_wall = time.monotonic()
    if t_ms <= 0.0:
        t_ms = (now_wall * 1000.0)
    if last_ts_imu <= 0.0 or t_ms <= last_ts_imu or (t_ms - last_ts_imu) > 3000.0:
        dt = 0.02
    else:
        dt = (t_ms - last_ts_imu) / 1000.0
    last_ts_imu = t_ms

    ax = float(((d.get("accel") or {}).get("x", 0.0)))
    ay = float(((d.get("accel") or {}).get("y", 0.0)))
    az = float(((d.get("accel") or {}).get("z", 0.0)))
    wx = float(((d.get("gyro")  or {}).get("x", 0.0)))
    wy = float(((d.get("gyro")  or {}).get("y", 0.0)))
    wz = float(((d.get("gyro")  or {}).get("z", 0.0)))

    gLP["x"] = GRAV_BETA * gLP["x"] + (1.0 - GRAV_BETA) * ax
    gLP["y"] = GRAV_BETA * gLP["y"] + (1.0 - GRAV_BETA) * ay
    gLP["z"] = GRAV_BETA * gLP["z"] + (1.0 - GRAV_BETA) * az
    gmag = hypot(gLP["x"], gLP["y"], gLP["z"]) or 1.0
    gHat = {"x": gLP["x"]/gmag, "y": gLP["y"]/gmag, "z": gLP["z"]/gmag}

    roll  = (atan2(az, ay)   * 180.0 / pi)
    pitch = (atan2(-ax, ay)  * 180.0 / pi)

    aNorm = hypot(ax, ay, az); wNorm = hypot(wx, wy, wz)
    nearFlat = (abs(roll) < 2.0 and abs(pitch) < 2.0)
    stillCond = (abs(aNorm - G) < A_TOL) and (wNorm < STILL_W)

    if stillCond:
        if holdStart <= 0.0: holdStart = t_ms
        if not isStill and (t_ms - holdStart) > 350.0: isStill = True
        gOff["x"] = (1.0 - BIAS_ALPHA)*gOff["x"] + BIAS_ALPHA*wx
        gOff["y"] = (1.0 - BIAS_ALPHA)*gOff["y"] + BIAS_ALPHA*wy
        gOff["z"] = (1.0 - BIAS_ALPHA)*gOff["z"] + BIAS_ALPHA*wz
    else:
        holdStart = 0.0; isStill = False

    if USE_PROJ:
        yawdot = ((wx - gOff["x"])*gHat["x"] + (wy - gOff["y"])*gHat["y"] + (wz - gOff["z"])*gHat["z"])
    else:
        yawdot = (wy - gOff["y"])

    if abs(yawdot) < YAW_DB: yawdot = 0.0
    if FREEZE_STILL and stillCond: yawdot = 0.0

    yaw = _wrap180(yaw + yawdot * dt)

    if (YAW_LEAK > 0.0) and nearFlat and stillCond and abs(yaw) > 0.0:
        step = YAW_LEAK * dt * (-1.0 if yaw > 0 else (1.0 if yaw < 0 else 0.0))
        if abs(yaw) <= abs(step): yaw = 0.0
        else: yaw += step

    global Rf, Pf, Yf, ref, last_wall
    Rf = ANG_EMA * roll  + (1.0 - ANG_EMA) * Rf
    Pf = ANG_EMA * pitch + (1.0 - ANG_EMA) * Pf
    Yf = ANG_EMA * yaw   + (1.0 - ANG_EMA) * Yf

    if AUTO_REZERO and nearFlat and (wNorm < STILL_W):
        if holdStart <= 0.0: holdStart = t_ms
        if not isStill and (t_ms - holdStart) > 350.0:
            ref.update({"roll": Rf, "pitch": Pf, "yaw": Yf})
            isStill = True

    R = _wrap180(Rf - ref["roll"])
    P = _wrap180(Pf - ref["pitch"])
    Y = _wrap180(Yf - ref["yaw"])

    now_wall = time.monotonic()
    if last_wall <= 0.0 or (now_wall - last_wall) >= 0.100:
        last_wall = now_wall
        item = {
            "ts": t_ms/1000.0,
            "angles": {"roll": R, "pitch": P, "yaw": Y},
            "accel":  {"x": ax, "y": ay, "z": az},
            "gyro":   {"x": wx, "y": wy, "z": wz},
        }
        imu_store.append(item)

# ---------- UDP 接收 IMU 并转发 ----------
class UDPProto(asyncio.DatagramProtocol):
    def connection_made(self, transport):
        print(f"[UDP] listening on {UDP_IP}:{UDP_PORT}")
    def datagram_received(self, data, addr):
        try:
            s = data.decode('utf-8', errors='ignore').strip()
            d = json.loads(s)
            if 'ts' not in d and 'timestamp_ms' in d:
                d['ts'] = d.pop('timestamp_ms')
            process_imu_and_maybe_store(d)
            asyncio.create_task(imu_broadcast(json.dumps(d)))
        except Exception:
            pass



# === 新增：注册给 bridge_io 的发送回调（把 JPEG 广播给 /ws/viewer） ===
@app.on_event("startup")
async def on_startup_register_bridge_sender():
    main_loop = asyncio.get_running_loop()

    def _publish_item_frame(jpeg_bytes: bytes, stop_event: threading.Event):
        global yolomedia_sending_frames
        if not yolomedia_running or stop_event is not yolomedia_stop_event or stop_event.is_set():
            return
        if not yolomedia_sending_frames:
            yolomedia_sending_frames = True
            print("[YOLOMEDIA] 开始发送处理后的帧，切换到YOLO画面", flush=True)
        _publish_camera_frame(jpeg_bytes)

    def _sender(jpeg_bytes: bytes):
        try:
            main_loop.call_soon_threadsafe(_publish_item_frame, jpeg_bytes, yolomedia_stop_event)
        except RuntimeError:
            pass  # 后端已关闭

    bridge_io.set_sender(_sender)

@app.on_event("startup")
async def on_startup_init_audio():
    """启动时初始化音频系统"""
    # 在后台线程中初始化，避免阻塞启动
    def _init():
        try:
            initialize_audio_system()
        except Exception as e:
            print(f"[AUDIO] 初始化失败: {e}")
    
    threading.Thread(target=_init, daemon=True).start()

# ===== 本地键盘控制 + 本地可视化窗口（不需要前端）=====
_MAIN_LOOP: Optional[asyncio.AbstractEventLoop] = None
_SERVER = None   # uvicorn.Server，供 ESC 一键退出

@app.on_event("startup")
async def on_startup_console_ui():
    global _MAIN_LOOP
    _MAIN_LOOP = asyncio.get_running_loop()

    def _cmd(text: str):
        """键盘按键 -> 等价于说了一句话"""
        if _MAIN_LOOP is None:
            return
        asyncio.run_coroutine_threadsafe(start_ai_with_text_custom(text), _MAIN_LOOP)

    async def _stop_all():
        await _enter_mode("stop")
        await ui_broadcast_final("[系统] 已停止")

    def _stop_cmd():
        if _MAIN_LOOP is None:
            return
        asyncio.run_coroutine_threadsafe(_stop_all(), _MAIN_LOOP)

    def _item_cmd():
        """按 3：进入听物品名模式"""
        if _MAIN_LOOP is None:
            return
        asyncio.run_coroutine_threadsafe(_start_item_listen(), _MAIN_LOOP)

    def _record_cmd():
        """回车：开始/结束录音（播报中按回车会先打断）"""
        if _MAIN_LOOP is None:
            return
        asyncio.run_coroutine_threadsafe(_toggle_record(), _MAIN_LOOP)

    def _exit_cmd():
        """ESC：一次就退干净"""
        print("[PC-UI] 收到退出指令，正在关闭服务…", flush=True)
        if _SERVER is not None:
            _SERVER.should_exit = True
        else:
            os._exit(0)

    def _status() -> Dict[str, Any]:
        st = orchestrator.get_state() if orchestrator else "IDLE"
        nav_state, nav = preview_guidance
        if st != nav_state:
            nav = ""
        ai = ""
        for t in reversed(recent_finals):
            if not ai and t.startswith("[AI] "):
                ai = t[5:]
            if ai:
                break
        try:
            import pc_mic
            ptt = pc_mic.ptt_active()
        except Exception:
            ptt = False
        asr = current_partial or ""
        if asr.startswith("[AI] "):
            ai = asr[5:]          # 正在流式输出的 AI 文本，别混进"我"那一行
            asr = ""
        elif asr.startswith("（已开始接收音频"):
            asr = ""
        return {"state": st, "ptt": ptt, "asr": asr, "ai": ai, "nav": nav}

    try:
        import preview_window
        preview_window.set_status_provider(_status)
        preview_window.start()
    except Exception as e:
        print(f"[PC-UI] 本地画面窗口启动失败: {e}", flush=True)

    try:
        import pc_console
        pc_console.set_command_handler(_cmd)
        pc_console.set_stop_handler(_stop_cmd)
        pc_console.set_item_handler(_item_cmd)
        pc_console.set_record_handler(_record_cmd)
        pc_console.set_exit_handler(_exit_cmd)
        pc_console.start()
    except Exception as e:
        print(f"[PC-UI] 键盘控制启动失败: {e}", flush=True)

    # 先把导航器建好，这样没有相机时按键 1 也能立刻生效
    try:
        ensure_navigators()
    except Exception as e:
        print(f"[PC-UI] 导航器预初始化失败: {e}", flush=True)

@app.on_event("startup")
async def on_startup_pc_io():
    """无 ESP32 模式：电脑喇叭 + 手机摄像头 + 电脑麦克风（PC_IO=0 可关闭）"""
    if os.getenv("PC_IO", "1") != "1":
        print("[PC-IO] PC_IO=0，保持 ESP32 模式", flush=True)
        return
    try:
        import local_speaker
        local_speaker.start()
    except Exception as e:
        print(f"[PC-IO] 电脑喇叭启动失败: {e}", flush=True)
    try:
        import phone_camera
        phone_camera.start()
    except Exception as e:
        print(f"[PC-IO] 手机摄像头启动失败: {e}", flush=True)
    try:
        import pc_mic
        pc_mic.start()
    except Exception as e:
        print(f"[PC-IO] 电脑麦克风启动失败: {e}", flush=True)

@app.on_event("startup")
async def on_startup():
    loop = asyncio.get_running_loop()
    await loop.create_datagram_endpoint(lambda: UDPProto(), local_addr=(UDP_IP, UDP_PORT))

@app.on_event("shutdown")
async def on_shutdown():
    """应用关闭时的清理工作"""
    print("[SHUTDOWN] 开始清理资源...")
    
    # 停止YOLO媒体处理
    stop_yolomedia()
    
    # 停止音频和AI任务
    await hard_reset_audio("shutdown")

    # 停止手机摄像头 / 电脑麦克风
    try:
        import phone_camera, pc_mic, pc_console, preview_window
        phone_camera.stop()
        pc_mic.stop()
        pc_console.stop()
        preview_window.stop()
    except Exception:
        pass

    print("[SHUTDOWN] 资源清理完成")

# app_main.py —— 在文件里已有的 @app.on_event("startup") 之后，再加一个新的 startup 钩子


# --- 导出接口（可选） ---
def get_last_frames():
    return last_frames

def get_camera_ws():
    return esp32_camera_ws

if __name__ == "__main__":
    # 用显式 Server 实例，这样 ESC 能一次干净退出（之前 os.kill(SIGINT) 会被
    # uvicorn 自己的信号处理接管，要点两次才退）
    _config = uvicorn.Config(
        app, host="0.0.0.0", port=8081,
        log_level="warning", access_log=False,
        loop="asyncio", workers=1, reload=False,
    )
    _SERVER = uvicorn.Server(_config)
    _SERVER.run()
