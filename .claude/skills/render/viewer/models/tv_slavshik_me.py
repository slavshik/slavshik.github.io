"""Телевизор со slavshik.me, пересобранный в CAD.

Оригинал — процедурная геометрия three.js в src/tv/scene.ts; здесь те же
пропорции, но телом, а не мешем. Единицы: сцена ×100, то есть корпус
110 × 88 × 80 мм, и числа читаются как в src/tv/constants.ts.

Кадр модели: X — ширина, Y — глубина (фасад в +Y), Z — высота.
"""

from build123d import *
from viewer.render import render

# ── габариты (src/tv/constants.ts × 100) ──────────────────────────────────
BODY_W, BODY_H, BODY_D = 110.0, 88.0, 80.0
FOOT_H = 4.5
CORNER_R = 15.0

PAL = {
	"shell": "#e8543a",
	"bezel": "#f6ead3",
	"knob": "#322f38",
	"steel": "#b6bcc3",
	"accent": "#2f6b57",
}


def color(name):
	h = PAL[name].lstrip("#")
	return Color(*(int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)))


def paint(shape, name):
	shape.color = color(name)
	return shape


# ── корпус: сужается к затылку ровно тем же smoothstep, что и taperAt() ───
def smoothstep(x, e0, e1):
	t = min(max((x - e0) / (e1 - e0), 0.0), 1.0)
	return t * t * (3 - 2 * t)


def taper_at(y):
	return 0.84 + 0.16 * smoothstep(y, -BODY_D * 0.5, BODY_D * 0.34)


def shell_solid():
	# Loft по выборке профилей вместо аналитического сужения: smoothstep
	# честнее описать десятком сечений, чем подобранным конусом.
	depths = [-40, -34, -28, -22, -16, -10, -4, 2, 8, 14, 20, 27.2, 40]
	sections = []
	for y in depths:
		k = taper_at(y)
		sections.append(
			Plane.XZ.offset(-y) * RectangleRounded(BODY_W * k, BODY_H * k, CORNER_R * k)
		)
	body = loft(sections)
	# Фасад и затылок — острые рёбра после loft; в оригинале скруглено всё.
	for r in (12.0, 8.0, 5.0):
		try:
			return fillet(body.edges().group_by(Axis.Y)[0] + body.edges().group_by(Axis.Y)[-1], r)
		except Exception as e:
			print(f"фаска корпуса r={r} не села ({type(e).__name__}), пробую меньше")
	return body


# ── рамка: плита во всю ширину фасада с окном ─────────────────────────────
def bezel_solid():
	frame = RectangleRounded(98, 66, 13) - RectangleRounded(84, 52, 10)
	return Pos(0, 40.5, 0) * (Rot(-90, 0, 0) * extrude(frame, amount=7))


# ── стекло кинескопа: колпак, обрезанный по окну рамки ────────────────────
def screen_solid():
	sag, half_w = 17.0, 43.0
	r = (half_w**2 + sag**2) / (2 * sag)
	window = Rot(-90, 0, 0) * extrude(RectangleRounded(86, 54, 10), amount=sag + 1)
	dome = Pos(0, 41 + sag - r, 0) * Rot(-90, 0, 0) * Sphere(r)
	return (Pos(0, 41, 0) * window) & dome


# ── антенны: блюдце, винт и два телескопических рожка ─────────────────────
ANT_Y = -3.0
ANT_Z = BODY_H / 2 + 7.5
SEG_R = [2.1, 1.55, 1.05]
SEG_PART = [0.28, 0.33, 0.39]
ANT_SPEC = [
	{"side": -1, "len": 56.0, "splay": 8.6, "back": 5.2},
	{"side": 1, "len": 49.0, "splay": 6.3, "back": 3.4},
]


def antenna_dish():
	dish = scale(Sphere(19, arc_size1=0), (1, 1, 0.42))
	return Pos(0, ANT_Y, BODY_H / 2 + 1.5) * dish


def antenna_screw():
	return Pos(0, ANT_Y, ANT_Z + 1.2) * Cone(2.6, 1.9, 5)


def antenna_arm(spec):
	arm, z = None, 0.0
	for i, part in enumerate(SEG_PART):
		h = spec["len"] * part
		seg = Pos(0, 0, z + h / 2) * Cone(SEG_R[i], SEG_R[i] * 0.9, h)
		arm = seg if arm is None else arm + seg
		if i:  # обжимка на стыке, иначе три конуса читаются одним
			arm += Pos(0, 0, z) * Cylinder(SEG_R[i] * 1.45, 1.4)
		z += h
	arm += Pos(0, 0, z) * Sphere(2.7)
	placed = Rot(spec["back"], spec["side"] * spec["splay"], 0) * arm
	return Pos(spec["side"] * 5.0, ANT_Y, ANT_Z) * placed


# ── ножки: каждая садится по своей глубине, корпус там уже ужат ───────────
def feet():
	out = None
	for sx in (-1, 1):
		for sy in (-1, 1):
			y = sy * 26.0
			k = taper_at(y)
			z = (-BODY_H / 2) * k - FOOT_H / 2 + 1.2
			foot = Pos(sx * 40.0 * k, y, z) * Cone(3.0, 2.6, FOOT_H)
			out = foot if out is None else out + foot
	return out


parts = [
	paint(shell_solid(), "shell"),
	paint(bezel_solid(), "bezel"),
	paint(screen_solid(), "accent"),
	paint(antenna_dish(), "knob"),
	paint(antenna_screw(), "steel"),
	paint(feet(), "knob"),
]
for spec in ANT_SPEC:
	parts.append(paint(antenna_arm(spec), "steel"))

tv = Compound(children=parts)
render("tv_slavshik_me", tv)
