#!/usr/bin/env bash
#
# Фото или видео → трёхсекундный ролик для экрана телевизора.
#
#   ./test/fixtures/make-clip.sh снимок.HEIC test/fixtures/local/broadcast-0.mp4
#   ./test/fixtures/make-clip.sh снимок.jpg out.mp4 0.35   # центр кадра выше
#
# Кадр всегда заполняет экран целиком: то, что не влезло, обрезается. Полей
# по краям не бывает — ни чёрных, ни размытых. На экране в 120 пикселей поле
# съедает четверть картинки и читается поломкой телевизора, а не приёмом.
#
# Отсюда следствие, которое стоит знать заранее: вертикальный снимок в
# пропорцию 1.6:1 целиком не входит никогда. Лицо выше, чем помещается, и
# что-то придётся срезать. Третий аргумент говорит, вокруг чего резать:
# доля высоты исходника, которая станет центром кадра. 0.5 — середина,
# меньше — выше (для портретов обычно 0.3…0.5, чтобы не срезать подбородок).
#
# Ролик молчит и весит десятки килобайт. EXIF, включая геометку, до выхода не
# доживает: перекодирование его не переносит.
set -euo pipefail

SRC=${1:?нужен исходный файл}
OUT=${2:?нужен выходной .mp4}
CENTER=${3:-0.5}

W=256
H=160
SEC=3
FPS=12

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Фото или видео решаем по расширению, а не по опросу ffprobe: на снимке он
# отвечает по-разному в зависимости от контейнера, и ошибка тут молчаливая —
# ролик просто выйдет неправильно кадрированным. Расширение врёт реже.
case "${SRC##*.}" in
[hH][eE][iI][cC] | [hH][eE][iI][fF] | [jJ][pP][gG] | [jJ][pP][eE][gG] | [pP][nN][gG] | [wW][eE][bB][pP] | [tT][iI][fF] | [tT][iI][fF][fF] | [gG][iI][fF])
	is_photo=1
	;;
*)
	is_photo=0
	;;
esac

if [ "$is_photo" = 0 ]; then
	# Настоящее видео: первые секунды, обрезка по покрытию, звук долой.
	ffmpeg -v error -y -i "$SRC" -t "$SEC" -r "$FPS" -an \
		-vf "scale=$W:$H:force_original_aspect_ratio=increase,crop=$W:$H,format=yuv420p" \
		-c:v libx264 -profile:v baseline -level 3.0 -crf 31 -movflags +faststart "$OUT"
else
	# Фотография. Сначала разворот по EXIF — снимок с телефона почти всегда
	# лежит на боку, и без этого шага портрет уедет в кадр горизонтально.
	magick "$SRC" -auto-orient "$tmp/up.png"

	# Перевод строки обязателен: без него read упирается в EOF, возвращает
	# ненулевой код, и set -e роняет скрипт на ровном месте.
	read -r sw sh < <(magick identify -format '%w %h\n' "$tmp/up.png")
	# Кадр по покрытию: берём всю ширину, если исходник уже нужной пропорции
	# или выше, иначе всю высоту.
	ch=$(python3 -c "print(min($sh, round($sw / ($W/$H))))")
	cw=$(python3 -c "print(min($sw, round($ch * ($W/$H))))")
	# Центр по третьему аргументу, но кадр не выпускается за края картинки.
	cy=$(python3 -c "print(max(0, min($sh - $ch, round($sh * $CENTER - $ch / 2))))")
	cx=$(python3 -c "print(round(($sw - $cw) / 2))")

	# Неподвижный кадр на экране выглядит зависшим телевизором, поэтому
	# медленный наезд: за три секунды на одиннадцать процентов.
	ffmpeg -v error -y -loop 1 -i "$tmp/up.png" -t "$SEC" -r "$FPS" -an \
		-vf "crop=$cw:$ch:$cx:$cy,zoompan=z='min(1.0+0.0030*on\,1.11)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=$FPS,format=yuv420p" \
		-c:v libx264 -profile:v baseline -level 3.0 -crf 31 -movflags +faststart "$OUT"
fi

printf '%s — %s, %s\n' "$OUT" \
	"$(ffprobe -v error -show_entries stream=width,height -of csv=p=0:nk=1 "$OUT" | head -1)" \
	"$(du -h "$OUT" | cut -f1)"
