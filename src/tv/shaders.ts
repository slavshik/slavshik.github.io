/*
 * Шейдер белого шума.
 *
 * Аплоад DataTexture каждый кадр — это генерация массива на CPU плюс
 * texSubImage2D шестьдесят раз в секунду. Шейдер даёт то же самое даром и
 * сразу с развёрткой и виньеткой.
 */

export const SCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const SCREEN_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime, uIntensity, uRoll;
  uniform vec3  uAccent;

  float hash(vec2 p) {
    p = fract(p * vec2(443.897, 441.423));
    p += dot(p, p.yx + 19.19);
    return fract((p.x + p.y) * p.x);
  }

  void main() {
    vec2 uv = vec2(vUv.x, fract(vUv.y + uRoll));

    // Зерно крупное и квантованное по времени: 24 кадра в секунду, как у
    // плёнки. Попиксельный шум на 60 Гц читается как цифровой мусор, а не
    // как аналоговая трубка.
    vec2  cell = floor(uv * vec2(160.0, 115.0));
    float n = hash(cell + floor(uTime * 24.0) * 7.31);

    // Широкие полосы помех, медленно ползущие вверх
    float band = smoothstep(0.87, 1.0, sin((uv.y + uTime * 0.07) * 84.0) * 0.5 + 0.5);
    n = mix(n, min(n * 1.5, 1.0), band);

    // Строчная развёртка
    float scan = 0.84 + 0.16 * sin(uv.y * 560.0);

    // Шум идёт до самого края стекла. Виньетка осталась только как намёк на
    // толщину колбы — на последних процентах ширины, не больше.
    vec2  c   = abs(uv - 0.5) * 2.0;
    float vig = smoothstep(1.02, 0.95, c.x) * smoothstep(1.02, 0.94, c.y);

    // Снег белый: акцент уходит в свечение, а не в сам шум.
    vec3 col = vec3(n) * scan * vig;
    col = mix(col, col * uAccent * 1.6, 0.09);
    col += uAccent * 0.05 * vig;                 // ореол трубки

    // Блик на стекле. Камера смотрит в лоб, и геометрический купол сам по
    // себе почти не читается — выпуклость продаёт именно это пятно.
    // Считается по неискажённым UV, чтобы не ездило вместе со срывом кадра.
    vec2  hp = (vUv - vec2(0.28, 0.74)) * vec2(1.0, 1.9);
    float hl = exp(-dot(hp, hp) * 9.0);
    col += vec3(0.26) * hl;

    gl_FragColor = vec4(col * uIntensity, 1.0);

    #include <colorspace_fragment>
  }
`;
