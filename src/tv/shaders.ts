/*
 * Шейдер белого шума.
 *
 * Аплоад DataTexture каждый кадр — это генерация массива на CPU плюс
 * texSubImage2D шестьдесят раз в секунду. Шейдер даёт то же самое даром и
 * сразу с развёрткой и виньеткой.
 */

export const SCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal, vView;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vView = -(modelViewMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const SCREEN_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime, uIntensity, uRoll, uTexMix;
  uniform vec3  uAccent, uGlowColor;
  varying vec3 vNormal, vView;
  uniform float uExposure, uSaturation, uGlassEdge;
  uniform sampler2D uTex;
  uniform bool uVideo;

  float hash(vec2 p) {
    p = fract(p * vec2(443.897, 441.423));
    p += dot(p, p.yx + 19.19);
    return fract((p.x + p.y) * p.x);
  }

  void main() {
    vec2 uv = vec2(vUv.x, fract(vUv.y + uRoll));

    // Крупное зерно, 30 обновлений в секунду. Семя ограничено: большие
    // координаты со временем теряют младшие биты float и гасят шум.
    float frame = mod(floor(uTime * 30.0), 4096.0);
    vec2 seed = vec2(mod(frame, 64.0), floor(frame / 64.0));
    vec2 cell = floor(uv * vec2(96.0, 64.0));
    float n = hash(cell + seed * vec2(3.17, 7.13));
    // Независимая помеха на строку, без синуса и без загрузок текстуры.
    float line = hash(vec2(cell.y, seed.x + seed.y * 1.37));
    n = n * n * (0.8 + 0.2 * line);

    /* Строчная развёртка.
     *
     * Частота была 560 — это 89 полос на высоту экрана, а экран на странице
     * высотой около 170 пикселей. Меньше двух пикселей на полосу, то есть
     * ниже Найквиста: полосы не рисовались, а складывались в муар, и на
     * повёрнутом выпуклом экране он читался широкими диагоналями поперёк
     * фотографии. Именно их видно как «диагональный шум»; никакого шума в
     * передаче нет, снег к ней не подмешивается вовсе.
     *
     * Теперь 235 — около 37 полос, по четыре-пять пикселей на каждую.
     *
     * Одной частоты мало: DPR, размер окна и выпуклость трубки всё равно
     * где-нибудь загонят период под пиксель. Поэтому полосы гаснут там, где
     * перестают быть различимыми — fwidth говорит, на сколько радиан фазы
     * приходится пиксель. Производные тут ядерные: телевизор и так требует
     * WebGL2, и three этой версии уже не принимает пометку derivatives.
     * Гаснут полосы в среднее, а не в единицу, иначе
     * картинка в этих местах становилась бы ярче соседних.
     */
    float amp = mix(0.16, 0.05, uTexMix);
    float ph  = uv.y * 235.0;
    float fade = 1.0 - smoothstep(1.0, 3.0, fwidth(ph));
    float scan = (1.0 - amp) + amp * sin(ph) * fade;

    // Шум идёт до самого края стекла. Виньетка осталась только как намёк на
    // толщину колбы — на последних процентах ширины, не больше.
    vec2  c   = abs(uv - 0.5) * 2.0;
    float vig = (1.0 - smoothstep(0.95, 1.02, c.x)) * (1.0 - smoothstep(0.94, 1.02, c.y));

    // Передача, если она пришла. Сэмплируется теми же uv, что и шум, — то
    // есть уже сорванными: срыв кадра рвёт картинку так же, как рвал снег.
    // Пока uTexMix нулевой, в uTex лежит заглушка 1×1, и текстурная выборка
    // ни на что не влияет — ветвление тут было бы дороже самой выборки.
    vec4 sampled = texture2D(uTex, uv);
    // VideoTexture хранится в sRGB, но аппаратно не декодируется, в отличие
    // от обычной sRGB-текстуры. У ShaderMaterial нет автоматического map-
    // декодирования three: делаем его здесь, только для видео.
    if (uVideo) sampled = sRGBTransferEOTF(sampled);
    vec3 sig = sampled.rgb;
    float luma = dot(sig, vec3(0.2126, 0.7152, 0.0722));
    sig = max(mix(vec3(luma), sig, uSaturation), vec3(0.0));
    // A monotonic shoulder keeps white below clipping and black at zero.
    sig = sig * uExposure / (1.0 + max(uExposure - 1.0, 0.0) * sig);

    // Передача без примеси снега; развёртка даёт фактуру люминофора.
    vec3 signal = mix(vec3(n), sig, uTexMix);

    // Снег белый: акцент уходит в свечение, а не в сам шум.
    vec3 col = signal * scan * vig;
    col = mix(col, col * uAccent * 1.6, 0.09 * (1.0 - uTexMix));
    col += uAccent * 0.025 * vig * (1.0 - uTexMix);                 // ореол трубки

    vec2 glass = abs(vUv - 0.5) * 2.0;
    float edge = smoothstep(0.78, 1.0, max(glass.x, glass.y));
    float grazing = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.0);
    col += uGlowColor * uGlassEdge * edge * (0.2 + grazing) * dot(signal, vec3(0.2126, 0.7152, 0.0722));
    // Compress the combined picture and edge light, before impact intensity.
    vec3 shoulder = max(col - 0.75, vec3(0.0));
    col = min(col, vec3(0.75)) + shoulder / (1.0 + 4.0 * shoulder);
    gl_FragColor = vec4(col * uIntensity, 1.0);

    #include <colorspace_fragment>
  }
`;
