# qwen_extractor.py
# -*- coding: utf-8 -*-
from typing import List, Tuple
import os
from openai import OpenAI

# —— 本地优先映射（YOLOE 开放词表的英文类名；可随时扩充）——
# 说明：左列是用户可能说的中文，右列是喂给 CLIP/YOLOE 的英文名词。
# 用通用名词（bottle / cup / phone）比品牌名更容易被文本编码器理解。
LOCAL_CN2EN = {
    # ---- 数码 ----
    "手机": "cell phone", "电话": "cell phone", "手表": "watch", "智能手表": "watch",
    "耳机": "headphones", "蓝牙耳机": "earbuds", "电脑": "laptop", "笔记本": "laptop",
    "平板": "tablet", "键盘": "keyboard", "鼠标": "mouse", "充电器": "charger",
    "充电线": "cable", "数据线": "cable", "充电宝": "power bank", "相机": "camera",
    "遥控器": "remote control", "显示器": "monitor", "音箱": "speaker",
    # ---- 随身 ----
    "钥匙": "keys", "钱包": "wallet", "书包": "backpack", "背包": "backpack",
    "包": "bag", "手提包": "handbag", "雨伞": "umbrella", "伞": "umbrella",
    "眼镜": "glasses", "墨镜": "sunglasses", "帽子": "hat", "口罩": "face mask",
    "身份证": "id card", "卡": "card", "纸巾": "tissue", "湿巾": "wet wipe",
    # ---- 饮料食品 ----
    "红牛": "Red_Bull", "ad钙奶": "AD_milk", "ad 钙奶": "AD_milk", "ad": "AD_milk",
    "钙奶": "AD_milk", "矿泉水": "bottle", "水瓶": "bottle", "水杯": "cup",
    "杯子": "cup", "可乐": "coke", "雪碧": "sprite", "饮料": "drink",
    "牛奶": "milk", "面包": "bread", "苹果": "apple", "香蕉": "banana",
    "橘子": "orange", "橙子": "orange", "饼干": "biscuit", "泡面": "instant noodles",
    "饭盒": "lunch box", "零食": "snack", "糖果": "candy",
    # ---- 家具 ----
    "椅子": "chair", "凳子": "stool", "桌子": "table", "沙发": "sofa",
    "床": "bed", "柜子": "cabinet", "书架": "bookshelf", "垃圾桶": "trash can",
    "门": "door", "窗": "window", "楼梯": "stairs", "电梯": "elevator",
    # ---- 厨房 ----
    "碗": "bowl", "盘子": "plate", "筷子": "chopsticks", "勺子": "spoon",
    "刀": "knife", "锅": "pot", "水壶": "kettle", "微波炉": "microwave",
    "冰箱": "refrigerator",
    # ---- 文具 ----
    "书": "book", "笔": "pen", "铅笔": "pencil", "本子": "notebook",
    "纸": "paper", "剪刀": "scissors", "尺子": "ruler",
    # ---- 出行 / 环境 ----
    "自行车": "bicycle", "电动车": "scooter", "汽车": "car", "摩托车": "motorcycle",
    "婴儿车": "stroller", "行李箱": "suitcase", "柱子": "pole", "电线杆": "pole",
    "台阶": "step", "路障": "barrier", "锥桶": "traffic cone", "消防栓": "fire hydrant",
    "树": "tree", "花盆": "potted plant", "指示牌": "sign",
    # ---- 人 / 动物 ----
    "人": "person", "行人": "person", "狗": "dog", "猫": "cat",
}

def _make_client() -> OpenAI:
    # 复用你百炼兼容端点；支持从环境变量读取
    base_url = os.getenv("DASHSCOPE_COMPAT_BASE", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    api_key = os.getenv("DASHSCOPE_API_KEY")
    if not api_key:
        raise RuntimeError("未设置 DASHSCOPE_API_KEY；请配置 .env 或 Windows 环境变量。")
    return OpenAI(api_key=api_key, base_url=base_url)

PROMPT_SYS = (
    "You are a label normalizer. Convert the given Chinese object "
    "description into a short, lowercase English YOLO/vision class name "
    "(1~3 words). If multiple are given, return the single most likely one. "
    "Output ONLY the label, no punctuation, no JSON, no explanation."
)

_SAFE_LABEL_RE = None


def _sanitize_label(raw: str) -> str:
    """
    把模型返回的文本收拾成"能当类别名"的字符串。
    模型偶尔会回 {"label": "bottle"} 这种 JSON，直接拿去当 YOLOE 提示词
    会让检测全废，所以这里严格过滤：只允许英文/数字/空格/连字符。
    """
    global _SAFE_LABEL_RE
    if not raw:
        return ""
    s = raw.strip().strip('"').strip("'").strip()
    # 常见 JSON 形态：{"label": "xxx"} / {"class": "xxx"}
    low = s.lower()
    if s.startswith("{") or s.startswith("["):
        import re as _re
        m = _re.search(r'[:：]\s*["\']([^"\']+)["\']', s)
        s = m.group(1) if m else ""
    # 去掉 "label:" / "class:" 之类前缀
    import re as _re2
    s = _re2.sub(r'^\s*(label|class|name|answer)\s*[:：]\s*', "", s, flags=_re2.I)
    s = s.replace("_", " ")
    # 只保留 ASCII 字母数字和空格、连字符
    s = "".join(ch for ch in s if (ch.isascii() and (ch.isalnum() or ch in " -")))
    s = " ".join(s.split()).strip().lower()
    if len(s) > 40 or not s:
        return ""
    return s


def extract_english_label(query_cn: str) -> Tuple[str, str]:
    """
    返回 (label_en, source)；source ∈ {'local', 'qwen', 'fallback'}
    """
    q = (query_cn or "").strip().lower()
    if q in LOCAL_CN2EN:
        return LOCAL_CN2EN[q], "local"

    # 简单规则：去掉前缀修饰词
    for k, v in LOCAL_CN2EN.items():
        if k in q:
            return v, "local"

    # 调用 Qwen Turbo（兼容 Chat Completions）
    try:
        client = _make_client()
        msgs = [
            {"role": "system", "content": PROMPT_SYS},
            {"role": "user",   "content": query_cn.strip()},
        ]
        rsp = client.chat.completions.create(
            model=os.getenv("QWEN_INTENT_MODEL") or os.getenv("QWEN_OMNI_MODEL") or os.getenv("QWEN_MODEL", "qwen-turbo"),
            messages=msgs,
            stream=False,
            timeout=15,
        )
        raw = (rsp.choices[0].message.content or "").strip()
        label = _sanitize_label(raw)
        if not label:
            print(f"[QWEN-EXTRACT] 返回内容不可用，丢弃：{raw[:80]!r}", flush=True)
            return "", "fallback"
        return label, "qwen"
    except Exception as e:
        # 不再静默回退 bottle（否则"找手机"会变成"找矿泉水"）
        print(f"[QWEN-EXTRACT] 调用失败：{e}", flush=True)
        return "", "fallback"
