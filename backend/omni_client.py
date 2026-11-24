# omni_client.py
# -*- coding: utf-8 -*-
"""
Omni-Turbo 流式对话客户端（达摩院 DashScope OpenAI 兼容模式）

模型名不再硬编码，可通过 .env 配置：
    QWEN_OMNI_MODEL=qwen3.5-omni-flash
    QWEN_OMNI_FALLBACKS=qwen3.5-omni-plus,qwen3-omni-flash
"""
import os, base64
from typing import AsyncGenerator, Dict, Any, List, Optional

from openai import AsyncOpenAI

# ===== OpenAI 兼容（达摩院 DashScope 兼容模式）=====
DEFAULT_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1"

# 旧名 qwen-omni-turbo 已下线，默认改用当前在售的 omni 模型
DEFAULT_MODEL = "qwen3.5-omni-flash"
DEFAULT_FALLBACKS = ["qwen3.5-omni-plus", "qwen3-omni-flash"]

# qwen3.5-omni 实测可用音色：Serena / Ethan / Dylan / Sunny / Tina
# Cherry / Chelsie / Jada / Alex 会报 400 Voice not supported
DEFAULT_VOICE = "Serena"

# 系统提示：回答会被直接朗读，必须口语化、不许输出 JSON/坐标
# （不带这段时，用户说"找眼镜"模型会回 bbox_2d + label 的 JSON，然后被念出来）
SYSTEM_PROMPT = os.getenv(
    "QWEN_OMNI_SYSTEM",
    "你是智能导盲眼镜的语音助手，回答会被直接朗读出来。要求："
    "1) 只用口语化中文，简短（1~2 句）；"
    "2) 绝对不要输出 JSON、坐标、bbox、markdown、代码块或列表符号；"
    "3) 描述看到的东西请用自然语言，例如“你右前方有一个杯子”；"
    "4) 用户想找物品时，回答“你可以直接说帮我找某样东西”，不要自己报坐标。",
)

_client: Optional[AsyncOpenAI] = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is not None:
        return _client
    api_key = os.getenv("DASHSCOPE_API_KEY")
    if not api_key:
        raise RuntimeError("未设置 DASHSCOPE_API_KEY；请在 .env 中配置")
    _client = AsyncOpenAI(
        api_key=api_key,
        base_url=os.getenv("DASHSCOPE_COMPAT_BASE", DEFAULT_BASE),
    )
    return _client


def _model_chain() -> List[str]:
    """主模型 + 备用模型，全部可由 .env 覆盖。"""
    primary = (os.getenv("QWEN_OMNI_MODEL") or DEFAULT_MODEL).strip()
    raw = os.getenv("QWEN_OMNI_FALLBACKS")
    fallbacks = [m.strip() for m in raw.split(",") if m.strip()] if raw else list(DEFAULT_FALLBACKS)
    return [primary] + [m for m in fallbacks if m != primary]


def _explain(err: Exception) -> str:
    """把 DashScope 的英文错误码翻译成可操作的中文提示。"""
    text = str(err)
    low = text.lower()
    if "model_not_found" in low or "model not exist" in low:
        return (
            f"模型不存在（{text}）。qwen-omni-turbo 已下线，"
            "请在 .env 设置 QWEN_OMNI_MODEL=qwen3.5-omni-flash"
        )
    if "accessdenied" in low or "unpurchased" in low or "access to model denied" in low:
        return (
            f"账号未开通该模型（{text}）。请到百炼控制台「模型广场」开通对应模型，"
            "或改用已开通额度的 API Key"
        )
    if "limit_requests" in low or "throttl" in low or "rate limit" in low:
        return (
            f"请求被限流（{text}）。该 Key 所属账号的免费额度已耗尽或欠费，"
            "请到百炼控制台充值 / 提升配额"
        )
    if "invalid_api_key" in low or "401" in low:
        return f"API Key 无效（{text}）"
    if "arrearage" in low or "overdue" in low:
        return f"账号欠费（{text}）"
    return f"调用失败：{text}"


class OmniStreamPiece:
    """对外的统一增量数据：text/audio 二选一或同时。"""

    def __init__(self, text_delta: Optional[str] = None, audio_b64: Optional[str] = None):
        self.text_delta = text_delta
        self.audio_b64 = audio_b64


async def stream_chat(
    content_list: List[Dict[str, Any]],
    voice: Optional[str] = None,
    audio_format: str = "wav",
    history=(),
) -> AsyncGenerator[OmniStreamPiece, None]:
    """
    发起一轮 Omni ChatCompletions 流式对话：
    - content_list: OpenAI chat 的 content，多模态（image_url/text）
    - 以 stream=True 返回
    - 增量产出：OmniStreamPiece(text_delta=?, audio_b64=?)
    - 失败时抛 RuntimeError，message 为中文可操作提示
    """
    client = _get_client()

    wanted_voice = (voice or os.getenv("QWEN_OMNI_VOICE") or DEFAULT_VOICE).strip()
    # 先按请求音色，失败再退回默认音色（qwen3.5-omni 已不支持 Cherry）
    voice_try = [wanted_voice] + ([DEFAULT_VOICE] if wanted_voice != DEFAULT_VOICE else [])

    completion = None
    last_err: Optional[Exception] = None
    used_model = ""
    used_voice = ""
    for model in _model_chain():
        for v in voice_try:
            try:
                completion = await client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": SYSTEM_PROMPT},
                        *history,
                        {"role": "user", "content": content_list},
                    ],
                    modalities=["text", "audio"],
                    audio={"voice": v, "format": audio_format},
                    stream=True,
                    stream_options={"include_usage": True},
                )
                used_model, used_voice = model, v
                break
            except Exception as e:
                last_err = e
                msg = str(e)
                if "Voice" in msg and "not supported" in msg:
                    print(f"[OMNI] 音色 {v} 不支持，换 {DEFAULT_VOICE} 重试", flush=True)
                    continue
                print(f"[OMNI] 模型 {model} 调用失败：{e}", flush=True)
                break
        if completion is not None:
            break

    if completion is None:
        raise RuntimeError(_explain(last_err) if last_err else "Omni 调用失败")

    print(f"[OMNI] 使用模型 {used_model} / 音色 {used_voice}", flush=True)

    # 异步读取流，等待云端时相机和 ASR 仍可运行。
    async for chunk in completion:
        text_delta: Optional[str] = None
        audio_b64: Optional[str] = None

        if getattr(chunk, "choices", None):
            c0 = chunk.choices[0]
            delta = getattr(c0, "delta", None)
            # 文本增量
            if delta and getattr(delta, "content", None):
                piece = delta.content
                if piece:
                    text_delta = piece
            # 音频分片
            if delta and getattr(delta, "audio", None):
                aud = delta.audio
                audio_b64 = aud.get("data") if isinstance(aud, dict) else getattr(aud, "data", None)
            if audio_b64 is None:
                msg = getattr(c0, "message", None)
                if msg and getattr(msg, "audio", None):
                    ma = msg.audio
                    audio_b64 = ma.get("data") if isinstance(ma, dict) else getattr(ma, "data", None)

        if (text_delta is not None) or (audio_b64 is not None):
            yield OmniStreamPiece(text_delta=text_delta, audio_b64=audio_b64)

async def voice_intent(text, state):
    """只返回允许的模式名和找物目标，过街确认仅接受用户的明确口令。"""
    import json
    response = await _get_client().chat.completions.create(
        model=os.getenv("QWEN_INTENT_MODEL") or _model_chain()[0],
        messages=[
            {"role": "system", "content": (
                "你是导盲眼镜的意图分类器。只返回 JSON 对象，intent 是 walk（请求引路）、"
                "find（寻找实物）、obstacle（单独检查前方障碍）、chat（明确想聊天）、"
                "stop（停止任务）、menu（询问功能）、talk（普通聊天或知识问题）、"
                "stay（意思不清，或谈及模式但没有要求执行）。不能决定能否过街。"
                "item 填用户要找的物品原名，没有就填空字符串。"
                "等待物品名称时用户只说一个物品名也选 find。chat 仅用于要求切换到闲聊模式；问候、提问、要求回答、知识讨论一律 talk。")},
            {"role": "user", "content": json.dumps({"state":state,"utterance":text}, ensure_ascii=False)},
        ], temperature=0, max_tokens=80, response_format={"type":"json_object"},
        timeout=8,
    )
    value = json.loads(response.choices[0].message.content)
    if not isinstance(value, dict) or value.get("intent") not in {"walk","find","obstacle","chat","stop","menu","talk","stay"}:
        raise ValueError("无法确定语音意图")
    item = value.get("item")
    return value["intent"], item.strip()[:50] if isinstance(item, str) else ""
