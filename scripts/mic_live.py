#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
IPRC1000 麦克风实时播放桥

接收 etw_consumer.exe 通过 UDP 发来的 PCM，实时播放到指定音频输出设备。

UDP 协议（与 tools/etw_consumer.exe 对齐）：
    b"CLEAR"               会话开始
    <PCM 数据包>            48000 Hz / 单声道 / int16 LE
    b"END"                 会话结束

用法：
    python scripts/mic_live.py --list                 # 列出输出设备
    python scripts/mic_live.py                        # 播到系统默认输出
    python scripts/mic_live.py --device CABLE         # 播到虚拟声卡（装了 VB-CABLE 之后）
    python scripts/mic_live.py --device 扬声器 --gain 2.0

注意：最后一环要让输入法用上它，需要把输出指到虚拟声卡的 Input，
      输入法的录音设备再选同一张卡的 Output。
"""
import argparse
import math
import socket
import sys
import threading
import time
from array import array

RATE = 48000
CHANNELS = 1
SAMPLE_BYTES = 2
# 缓冲上限：超过就丢最老的，宁可断一点也不要越拖越长的延迟
MAX_BUFFER_BYTES = RATE * SAMPLE_BYTES * 1  # 约 1 秒


def list_devices():
    import sounddevice as sd
    print('可用的音频输出设备：')
    for i, d in enumerate(sd.query_devices()):
        if d['max_output_channels'] > 0:
            api = sd.query_hostapis(d['hostapi'])['name']
            print('  {:>2}  {:>2}ch  {}  [{}]'.format(i, d['max_output_channels'], d['name'], api))
    print('')
    print('用 --device 传名字的一部分即可，例如 --device Realtek')
    print('装了 VB-CABLE 之后会出现 "CABLE Input"，那就是要选的目标。')


def pick_device(needle):
    """needle 为空时：优先自动用虚拟声卡，没有就用系统默认。"""
    import sounddevice as sd
    outputs = [(i, d) for i, d in enumerate(sd.query_devices()) if d['max_output_channels'] > 0]

    if not needle:
        # 装过 VB-CABLE 就自动走它 —— 这样输入法就能把遥控器当麦克风用
        for i, d in outputs:
            if 'cable input' in d['name'].lower():
                print('检测到虚拟声卡，自动输出到: {}'.format(d['name']))
                print('（想让声音同时从扬声器出来，加 --device Realtek）')
                return i
        return None  # 系统默认

    hits = [(i, d) for i, d in outputs if needle.lower() in d['name'].lower()]
    if not hits:
        msg = '找不到名字里含 "{}" 的输出设备，用 --list 看看有哪些'.format(needle)
        if 'cable' in needle.lower():
            msg += '\n提示：还没装虚拟声卡。先运行 install-vbcable.cmd，装完重启。'
        raise SystemExit(msg)
    # 优先 WASAPI，延迟更低、也更容易和虚拟声卡对上
    for i, d in hits:
        if 'WASAPI' in sd.query_hostapis(d['hostapi'])['name']:
            return i
    return hits[0][0]


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument('--udp', default='127.0.0.1:31680', help='监听地址')
    ap.add_argument('--device', default='', help='输出设备名的一部分（留空=系统默认）')
    ap.add_argument('--gain', type=float, default=1.0, help='音量倍数')
    ap.add_argument('--list', action='store_true', help='列出输出设备后退出')
    ap.add_argument('--seconds', type=float, default=0, help='跑多久后退出，0=一直跑')
    ap.add_argument('--quiet', action='store_true', help='不打印每秒电平')
    args = ap.parse_args()

    if args.list:
        list_devices()
        return 0

    import sounddevice as sd

    host, port = args.udp.rsplit(':', 1)
    port = int(port)

    buf = bytearray()
    lock = threading.Lock()
    state = {'session': 0, 'pcm_packets': 0, 'bytes': 0, 'peak': 0, 'running': True}

    def callback(outdata, frames, time_info, status):
        need = frames * CHANNELS * SAMPLE_BYTES
        with lock:
            take = min(need, len(buf))
            chunk = bytes(buf[:take]) if take else b''
            if take:
                del buf[:take]
        if len(chunk) < need:
            chunk = chunk + b'\x00' * (need - len(chunk))
        outdata[:] = chunk

        if chunk:
            a = array('h')
            a.frombytes(chunk)
            pk = max(abs(v) for v in a) if len(a) else 0
            if pk > state['peak']:
                state['peak'] = pk

    dev = pick_device(args.device)
    if dev is not None:
        info = sd.query_devices(dev)
        print('输出设备: {} [{}]'.format(info['name'], sd.query_hostapis(info['hostapi'])['name']))
    else:
        print('输出设备: 系统默认')

    stream = sd.RawOutputStream(
        samplerate=RATE, channels=CHANNELS, dtype='int16',
        device=dev, blocksize=0, callback=callback,
    )
    stream.start()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((host, port))
    sock.settimeout(0.5)
    print('监听 UDP {}:{}  （按 Ctrl+C 退出）'.format(host, port))
    print('等待 etw_consumer.exe 送数据 …… 按住遥控器语音键说话即可')
    print('')

    t_end = time.time() + args.seconds if args.seconds > 0 else None
    last_report = time.time()
    active = False

    try:
        while True:
            if t_end and time.time() >= t_end:
                break
            try:
                data, _ = sock.recvfrom(65536)
            except socket.timeout:
                data = None

            if data:
                if data == b'CLEAR':
                    with lock:
                        buf.clear()
                    if not active:
                        state['session'] += 1
                        active = True
                        if not args.quiet:
                            print('[会话 {}] 开始收音'.format(state['session']))
                elif data == b'END':
                    if active:
                        active = False
                        if not args.quiet:
                            print('[会话 {}] 结束'.format(state['session']))
                else:
                    pcm = data
                    if args.gain != 1.0:
                        a = array('h')
                        a.frombytes(pcm)
                        for i in range(len(a)):
                            v = int(a[i] * args.gain)
                            a[i] = 32767 if v > 32767 else (-32768 if v < -32768 else v)
                        pcm = a.tobytes()
                    with lock:
                        buf.extend(pcm)
                        if len(buf) > MAX_BUFFER_BYTES:
                            del buf[:len(buf) - MAX_BUFFER_BYTES]
                    state['pcm_packets'] += 1
                    state['bytes'] += len(pcm)

            now = time.time()
            if not args.quiet and now - last_report >= 1.0:
                peak = state['peak']
                state['peak'] = 0
                dbv = -120.0 if peak <= 0 else 20 * math.log10(peak / 32768.0)
                bar = '' if dbv <= -60 else '#' * int(max(0, (dbv + 60) / 60 * 30))
                print('  电平 {:>6.1f} dB   收包 {:>5}   已收 {:>7.1f} KB  {}'.format(
                    dbv, state['pcm_packets'], state['bytes'] / 1024.0, bar))
                last_report = now
    except KeyboardInterrupt:
        print('')
        print('已停止')
    finally:
        try:
            stream.stop()
            stream.close()
        except Exception:
            pass
        sock.close()

    print('')
    print('共收到 {} 个音频包 / {:.1f} KB'.format(state['pcm_packets'], state['bytes'] / 1024.0))
    return 0


if __name__ == '__main__':
    sys.exit(main())
