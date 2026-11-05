"""极简 PNG 读取器 —— 只用 Python 标准库。

为什么要自己写：CI 跑 e2e 时，为了「导出 PNG 里到底有没有真的画出文字」这一个
检查去装 Pillow 太重，而这个项目本身强调零依赖、离线。

这里只解 8bit 的 RGB / RGBA 非隔行 PNG（canvas.toBlob 产出的正是这种），
足够判断图上有没有深色像素。有 Pillow 时优先用它（快得多），没有就走纯标准库路径。
"""
import struct
import zlib

PNG_SIG = b"\x89PNG\r\n\x1a\n"


def _decode_rows(data):
    """解出 (width, height, channels, 每行的像素字节)"""
    if data[:8] != PNG_SIG:
        raise ValueError("不是 PNG")
    pos = 8
    idat = bytearray()
    w = h = depth = ctype = interlace = None
    while pos + 8 <= len(data):
        (ln,) = struct.unpack(">I", data[pos:pos + 4])
        typ = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        pos += 12 + ln
        if typ == b"IHDR":
            w, h, depth, ctype, _comp, _filt, interlace = struct.unpack(">IIBBBBB", body)
        elif typ == b"IDAT":
            idat += body
        elif typ == b"IEND":
            break
    if depth != 8 or interlace != 0 or ctype not in (2, 6):
        raise ValueError(f"暂不支持的 PNG 格式：depth={depth} colorType={ctype} interlace={interlace}")
    channels = 3 if ctype == 2 else 4
    raw = zlib.decompress(bytes(idat))
    stride = w * channels
    rows = []
    prev = bytearray(stride)
    p = 0
    for _y in range(h):
        ft = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        if ft == 1:          # Sub
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif ft == 2:        # Up
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ft == 3:        # Average
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ft == 4:        # Paeth
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        elif ft != 0:
            raise ValueError(f"未知的 PNG 行过滤器：{ft}")
        rows.append(line)
        prev = line
    return w, h, channels, rows


def dark_pixel_count(data, threshold=128):
    """统计亮度低于 threshold 的像素数（把 RGB 当灰度近似）。

    有 Pillow 就用它（快），没有就用纯标准库解码。
    """
    try:
        import io
        from PIL import Image
        img = Image.open(io.BytesIO(data)).convert("L")
        return sum(1 for v in img.getdata() if v < threshold)
    except ImportError:
        pass

    w, h, channels, rows = _decode_rows(data)
    count = 0
    for row in rows:
        for i in range(0, len(row), channels):
            r = row[i]
            g = row[i + 1]
            b = row[i + 2]
            if (r * 299 + g * 587 + b * 114) // 1000 < threshold:
                count += 1
    return count
