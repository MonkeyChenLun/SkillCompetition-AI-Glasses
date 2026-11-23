"""Run the original glasses navigation pipeline on a local video."""

import argparse
import os
import shutil
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

import av

from original_pipeline import original_pipeline

ROOT = Path(__file__).resolve().parent
MODES = {"blind": "盲道", "crossing": "过马路", "traffic": "红绿灯检测"}


def mux_narration(video, speech, output, start, time_base, has_audio):
    ffmpeg = shutil.which("ffmpeg") or (
        Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "EVCapture/ffmpeg.exe"
    )
    offset = float(start)
    if has_audio:
        graph = (
            f"[0:a:0]asetpts=PTS-({offset:.9f})/TB,aresample=48000:async=1:first_pts=0,apad[base];"
            "[1:a]aresample=48000[speech];"
            "[speech][base]amix=inputs=2:duration=first:dropout_transition=0:"
            "weights='1 0.4',volume=1.4,"
            f"asetpts=PTS+({offset:.9f})/TB[narrated]"
        )
    else:
        graph = f"[1:a]aresample=48000,asetpts=PTS+({offset:.9f})/TB[narrated]"
    subprocess.run([
        str(ffmpeg), "-nostdin", "-hide_banner", "-loglevel", "error", "-copyts",
        "-i", str(video), "-i", str(speech), "-filter_complex", graph,
        "-map", "0:v:0", "-map", "[narrated]", "-map", "0:a?", "-c", "copy",
        "-c:a:0", "aac", "-b:a:0", "160k", "-disposition:a", "0", "-disposition:a:0", "default",
        "-metadata:s:a:0", "language=zho", "-metadata:s:a:0", "handler_name=原项目导航提示",
        "-video_track_timescale", str(time_base.denominator), "-avoid_negative_ts", "disabled",
        "-movflags", "+faststart", str(output),
    ], check=True)


def verify(path, size, rate, timeline, audio_codecs):
    with av.open(str(path)) as output:
        stream = output.streams.video[0]
        if (stream.width, stream.height) != size or stream.average_rate != rate:
            raise ValueError("成片分辨率或帧率与输入不一致")
        if [track.codec_context.name for track in output.streams.audio] != audio_codecs:
            raise ValueError("成片音轨与预期不符")
        for index, (frame, (pts, duration)) in enumerate(zip(output.decode(stream), timeline, strict=True), 1):
            if frame.pts * frame.time_base != pts or (
                duration and frame.duration * frame.time_base != duration
            ):
                raise ValueError(f"成片第 {index} 帧时间戳或帧时长不一致")


def process(source, mode, destination):
    source = source.resolve(strict=True)
    destination = destination.resolve()
    if destination.exists():
        raise FileExistsError(f"已有文件：{destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    timeline = []
    durations = {}

    with TemporaryDirectory(prefix=".render-", dir=destination.parent) as tmp:
        staging = Path(tmp)
        partial = staging / "video.mp4"
        with (
            av.open(str(source)) as src,
            av.open(str(partial), "w", options={"movflags": "+faststart"}) as dst,
            original_pipeline(mode, staging) as (annotate, narration),
        ):
            vin = src.streams.video[0]
            size, rate, time_base = (vin.width, vin.height), vin.average_rate or vin.guessed_rate, vin.time_base
            if not rate or not time_base:
                raise ValueError("输入缺少帧率或时间基准")
            vout = dst.add_stream("libx264", rate=rate)
            vout.width, vout.height = size
            vout.pix_fmt = "yuv420p" if all(n % 2 == 0 for n in size) else "yuv444p"
            vout.time_base = vout.codec_context.time_base = time_base
            if vin.sample_aspect_ratio:
                vout.codec_context.sample_aspect_ratio = vin.sample_aspect_ratio
            vout.options = {"preset": "veryfast", "crf": "18"}
            audio_codecs = [track.codec_context.name for track in src.streams.audio]
            audio = {track.index: dst.add_stream_from_template(track) for track in src.streams.audio}

            def encode(frame):
                for packet in vout.encode(frame):
                    duration = durations.pop(packet.pts * packet.time_base)
                    if duration:
                        packet.duration = round(duration / packet.time_base)
                    dst.mux(packet)

            for packet in src.demux(vin, *src.streams.audio):
                if packet.stream.index in audio:
                    if packet.dts is not None:
                        packet.stream = audio[packet.stream.index]
                        dst.mux(packet)
                    continue
                for frame in packet.decode():
                    if frame.pts is None:
                        raise ValueError("输入帧缺少时间戳")
                    pts = frame.pts * frame.time_base
                    duration = (frame.duration or 0) * frame.time_base
                    timeline.append((pts, duration))
                    narration.advance(pts - timeline[0][0])
                    bgr = annotate(frame.to_ndarray(format="bgr24"))
                    if (bgr.shape[1], bgr.shape[0]) != size:
                        raise ValueError("原项目标注画面尺寸与输入不一致")
                    marked = av.VideoFrame.from_ndarray(bgr, format="bgr24")
                    marked.pts, marked.time_base = frame.pts, frame.time_base
                    durations[pts] = duration
                    encode(marked)
                    if len(timeline) % 240 == 0:
                        print(f"{MODES[mode]} {len(timeline)}/{vin.frames or '?'} 帧", flush=True)

            if not timeline or (vin.frames and vin.frames != len(timeline)):
                raise ValueError(f"源视频未完整解码，读到 {len(timeline)} 帧")
            encode(None)
            if durations:
                raise ValueError("编码器未输出全部视频帧")

        if narration.events:
            start = timeline[0][0]
            last, length = timeline[-1]
            speech = staging / "speech.wav"
            narration.write(speech, last + (length or 1 / rate) - start)
            result = staging / "narrated.mp4"
            mux_narration(partial, speech, result, start, time_base, bool(audio_codecs))
            audio_codecs.insert(0, "aac")
        else:
            result = partial
        verify(result, size, rate, timeline, audio_codecs)
        result.rename(destination)

    print(f"{destination} | {size[0]}x{size[1]} @ {rate} | {len(timeline)} 帧 | {len(narration.events)} 段原项目语音")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="将本地视频送入原项目导航工作流")
    parser.add_argument("mode", choices=MODES, help="blind=盲道，crossing=过马路，traffic=独立红绿灯检测")
    parser.add_argument("video", type=Path, help="本地视频路径")
    args = parser.parse_args()
    name = f"{args.video.stem}_原项目_{MODES[args.mode]}.mp4"
    process(args.video, args.mode, ROOT / "out" / name)
