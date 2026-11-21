"""게임 화면에 쓰는 UI 에셋 칸(slot) 정의.

게임(js/ui/theme.js)은 data/ui.json의 같은 키를 읽어서 그림이 있으면 쓰고, 없으면 CSS 디자인으로 보여 줍니다.
  backgrounds.<화면>  → 1280x720 JPG (화면 배경)
  icons.<이름>        → 투명 PNG (로고, 보석, 메뉴 아이콘)
"""

# key: ui.json 안의 위치, kind: 'bg' | 'icon' | 'logo', subject: 그림 내용 설명(프롬프트 재료)
SLOTS = [
    {"key": "backgrounds.home", "label": "홈 배경", "kind": "bg", "subject": "main lobby: a cozy magical plaza at night with lanterns; keep the right third calm (menu buttons go there) and the left side open (a character stands there)"},
    {"key": "backgrounds.gacha", "label": "뽑기 화면 배경", "kind": "bg", "subject": "a mystical summoning hall with a glowing star circle, dramatic but not busy"},
    {"key": "backgrounds.reveal", "label": "뽑기 결과 배경", "kind": "bg", "subject": "deep starry space with soft radial light in the center, very simple, cards will be shown on top"},
    {"key": "backgrounds.collection", "label": "도감 배경", "kind": "bg", "subject": "a calm library-like gallery wall with empty frames, soft and simple, low contrast"},
    {"key": "backgrounds.stories", "label": "스토리 목록 배경", "kind": "bg", "subject": "an open storybook on a desk under moonlight, soft focus, low contrast"},
    {"key": "backgrounds.mail", "label": "우편함 배경", "kind": "bg", "subject": "a cute magical post office counter with letters and parcels, soft focus, low contrast"},
    {"key": "backgrounds.notices", "label": "공지 배경", "kind": "bg", "subject": "a town notice board area at dusk, soft focus, low contrast"},
    {"key": "backgrounds.settings", "label": "설정 배경", "kind": "bg", "subject": "a quiet workshop with clockwork gears and stars, soft focus, low contrast"},
    {"key": "icons.logo", "label": "게임 로고", "kind": "logo", "subject": "game title logo emblem for 'Tiny Gacha': a cute ornate star-and-card emblem with a ribbon banner; the ribbon may contain the words 'Tiny Gacha' in clean bold lettering"},
    {"key": "icons.gem", "label": "보석(재화) 아이콘", "kind": "icon", "subject": "a single shiny blue faceted gemstone"},
    {"key": "icons.menu_gacha", "label": "메뉴: 뽑기", "kind": "icon", "subject": "a glowing four-pointed star with sparkles (summon icon)"},
    {"key": "icons.menu_collection", "label": "메뉴: 도감", "kind": "icon", "subject": "a small fanned stack of collectible cards"},
    {"key": "icons.menu_stories", "label": "메뉴: 모험 (스토리)", "kind": "icon", "subject": "an open storybook with a bookmark"},
    {"key": "icons.menu_mail", "label": "메뉴: 우편", "kind": "icon", "subject": "a sealed envelope with a heart wax seal"},
    {"key": "icons.menu_notices", "label": "메뉴: 공지", "kind": "icon", "subject": "a rolled parchment scroll with a ribbon"},
    {"key": "icons.menu_settings", "label": "메뉴: 설정", "kind": "icon", "subject": "a cute gear cog"},
]
SLOT_BY_KEY = {s["key"]: s for s in SLOTS}

# 결과 그림 규격
ICON_LONG_SIDE = 256
LOGO_LONG_SIDE = 640


def file_name(key):
    """'icons.menu_mail' → 'icon_menu_mail.png' / 'backgrounds.home' → 'bg_home.jpg'"""
    group, name = key.split(".", 1)
    return f"bg_{name}.jpg" if group == "backgrounds" else f"icon_{name}.png"


def empty_ui():
    return {"backgrounds": {}, "icons": {}}


def get_path(ui, key):
    group, name = key.split(".", 1)
    return (ui.get(group) or {}).get(name) or ""


def set_path(ui, key, path):
    group, name = key.split(".", 1)
    ui.setdefault(group, {})
    if path:
        ui[group][name] = path
    else:
        ui[group].pop(name, None)
    return ui
