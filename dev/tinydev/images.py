"""Pillow 이미지 도우미: 여백 자르기, 크기 조정, 배경 영역 찾기/칠하기, 저장."""
import io

from PIL import Image, ImageChops, ImageDraw, ImageOps


def open_image(data_or_path):
    if isinstance(data_or_path, (bytes, bytearray)):
        img = Image.open(io.BytesIO(data_or_path))
    else:
        img = Image.open(data_or_path)
    img.load()
    return img


def to_png_bytes(img):
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def estimate_bg_color(img):
    """네 모서리 근처 픽셀의 중간값으로 배경색 추정"""
    rgb = img.convert("RGB")
    w, h = rgb.size
    pts = []
    for x, y in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]:
        pts.append(rgb.getpixel((x, y)))
    pts.sort(key=sum)
    return pts[len(pts) // 2]


def background_mask(img, tolerance=18):
    """테두리와 이어진 '배경색 비슷한' 영역 = 255, 나머지 = 0 (L 모드)

    방법: 배경색과의 차이(R/G/B 중 가장 큰 차이)로 흑백 이미지를 만든 뒤,
    테두리에서부터 칠하기(floodfill)로 가장자리와 연결된 배경만 고릅니다.
    (인물 안쪽의 흰 부분은 지워지지 않음. 밝은 피부색도 색 차이로 구분)
    """
    rgb = img.convert("RGB")
    bg = Image.new("RGB", rgb.size, estimate_bg_color(rgb))
    r, g, b = ImageChops.difference(rgb, bg).split()
    diff = ImageChops.lighter(ImageChops.lighter(r, g), b)
    # 배경과 비슷하면 0, 다르면 255
    binary = diff.point(lambda v: 0 if v <= tolerance else 255)
    w, h = binary.size
    marker = 128
    step = max(1, min(w, h) // 64)
    seeds = [(x, 0) for x in range(0, w, step)] + [(x, h - 1) for x in range(0, w, step)]
    seeds += [(0, y) for y in range(0, h, step)] + [(w - 1, y) for y in range(0, h, step)]
    for s in seeds:
        if binary.getpixel(s) == 0:
            ImageDraw.floodfill(binary, s, marker, thresh=0)
    return binary.point(lambda v: 255 if v == marker else 0)


def simple_cutout(img, tolerance=18):
    """AI 모델 없이 하는 간단한 배경 제거 (단색 배경일 때 쓸 만함)"""
    rgba = img.convert("RGBA")
    bgmask = background_mask(rgba, tolerance)
    alpha = ImageOps.invert(bgmask)
    # 가장자리를 살짝 부드럽게
    from PIL import ImageFilter

    alpha = alpha.filter(ImageFilter.GaussianBlur(0.8))
    rgba.putalpha(ImageChops.multiply(alpha, rgba.getchannel("A")))
    return rgba


def flatten_background(img, color=(255, 255, 255), tolerance=30):
    """배경 영역(테두리와 이어진 비슷한 색)을 단색으로 칠함 → 배경 제거가 쉬워짐"""
    rgb = img.convert("RGB")
    mask = background_mask(rgb, tolerance)
    solid = Image.new("RGB", rgb.size, color)
    return Image.composite(solid, rgb, mask)


def trim_transparent(img, pad=8, alpha_threshold=12):
    """투명한 여백을 잘라냄 (pad 픽셀만큼 여유)"""
    rgba = img.convert("RGBA")
    alpha = rgba.getchannel("A").point(lambda v: 255 if v > alpha_threshold else 0)
    box = alpha.getbbox()
    if not box:
        return rgba
    l, t, r, b = box
    l, t = max(0, l - pad), max(0, t - pad)
    r, b = min(rgba.width, r + pad), min(rgba.height, b + pad)
    return rgba.crop((l, t, r, b))


def resize_long_side(img, long_side):
    w, h = img.size
    scale = long_side / max(w, h)
    if abs(scale - 1) < 1e-6:
        return img
    return img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)


def cover_resize(img, size):
    """비율을 유지하며 size를 꽉 채우도록 자르기 (배너/배경용)"""
    return ImageOps.fit(img.convert("RGB"), size, Image.LANCZOS, centering=(0.5, 0.45))


def save_jpeg(img, path, quality=88):
    img.convert("RGB").save(path, "JPEG", quality=quality, optimize=True, progressive=True)


def parse_hex_color(value, default=(255, 255, 255)):
    try:
        v = value.lstrip("#")
        if len(v) == 3:
            v = "".join(c * 2 for c in v)
        return tuple(int(v[i : i + 2], 16) for i in (0, 2, 4))
    except (AttributeError, ValueError, IndexError):
        return default
