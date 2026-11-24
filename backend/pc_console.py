# pc_console.py
# -*- coding: utf-8 -*-
"""
电脑键盘控制台（无前端方案的输入层）

按键（全局生效，无需窗口聚焦）：
    Enter（回车）  按一下开始录音，再按一下结束并提交识别
    1             步行导航
    3             找物品（按完后说话告诉它要找什么）
    5             确认本方向行人绿灯
    0             停止（找物品/导航/红绿灯都能停）
    ESC           退出后端（一次即可）

实现：用 Win32 GetAsyncKeyState 轮询，能拿到"按下/松开"两个边沿，
不需要额外安装 keyboard/pynput 之类的库。
"""
import ctypes
import os
import threading
import time

_user32 = ctypes.windll.user32

VK_RETURN = 0x0D
VK_0 = 0x30
VK_1 = 0x31
VK_3 = 0x33
VK_5 = 0x35
VK_ESC = 0x1B

POLL = 0.015

_stop = threading.Event()
_thread = None
_cmd_handler = None
_stop_handler = None
_item_handler = None
_record_handler = None
_exit_handler = None
_prev = {}


def set_command_handler(fn):
    """fn(text:str) —— 收到文字命令（等价于说了一句话）"""
    global _cmd_handler
    _cmd_handler = fn


def set_stop_handler(fn):
    """fn() —— 收到"全部停止"命令"""
    global _stop_handler
    _stop_handler = fn


def set_item_handler(fn):
    """fn() —— 按 3：进入"听物品名"模式"""
    global _item_handler
    _item_handler = fn


def set_record_handler(fn):
    """fn() —— 按回车：开始/结束录音（由 app_main 决定是否先打断播报）"""
    global _record_handler
    _record_handler = fn


def set_exit_handler(fn):
    """fn() —— 退出后端（干净关闭）"""
    global _exit_handler
    _exit_handler = fn


def _down(vk: int) -> bool:
    return bool(_user32.GetAsyncKeyState(vk) & 0x8000)


def _edge(vk: int):
    """返回 (刚按下, 刚松开)。同一拍只能调用一次，否则边沿会被吃掉。"""
    now = _down(vk)
    was = _prev.get(vk, False)
    _prev[vk] = now
    return (now and not was), ((not now) and was)


def _emit(text: str):
    print(f"[KEY] 触发：{text}", flush=True)
    try:
        if _cmd_handler:
            _cmd_handler(text)
    except Exception as e:
        print(f"[KEY] 命令执行失败: {e}", flush=True)


def _worker():
    import pc_mic

    print("=" * 62, flush=True)
    print("  键盘控制已就绪（全局生效，不用切窗口）", flush=True)
    print("  回车 = 开始/结束录音    1 步行导航", flush=True)
    print("  3 找物品(按完说话)      5 确认行人绿灯  0 停止   ESC 退出", flush=True)
    print("=" * 62, flush=True)

    while not _stop.is_set():
        # ---- 回车：按一下开始，再按一下结束 ----
        if _edge(VK_RETURN)[0]:
            try:
                if _record_handler:
                    _record_handler()
                else:
                    pc_mic.toggle_recording()
            except Exception as e:
                print(f"[KEY] 录音切换失败: {e}", flush=True)

        # ---- 数字键：功能切换 ----
        if _edge(VK_1)[0]:
            _emit("步行导航")
        if _edge(VK_3)[0]:
            print("[KEY] 触发：找物品（请说物品名）", flush=True)
            try:
                if _item_handler:
                    _item_handler()
            except Exception as e:
                print(f"[KEY] 找物品失败: {e}", flush=True)
        if _edge(VK_5)[0]:
            _emit("确认行人绿灯")
        if _edge(VK_0)[0]:
            print("[KEY] 触发：停止", flush=True)
            try:
                if _stop_handler:
                    _stop_handler()
            except Exception as e:
                print(f"[KEY] 停止失败: {e}", flush=True)

        # ---- ESC：退出（一次就退干净）----
        if _edge(VK_ESC)[0]:
            print("[KEY] ESC 按下，退出后端", flush=True)
            _stop.set()
            try:
                if _exit_handler:
                    _exit_handler()
                else:
                    os._exit(0)
            except Exception:
                os._exit(0)
            break

        time.sleep(POLL)


def start():
    """启动键盘监听（幂等）。"""
    global _thread
    if os.getenv("PC_KEYS", "0") != "1":
        print("[KEY] PC_KEYS=0，跳过键盘控制", flush=True)
        return
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_worker, name="pc-console", daemon=True)
    _thread.start()


def stop():
    _stop.set()
