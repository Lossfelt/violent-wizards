import { useEffect, useState, type CSSProperties } from "react";

// Brightest point-like stars in the two sky backgrounds, as [x, y, radius] where x and y are
// fractions of the image and radius is the star's core size in image pixels. Found by scanning
// the images for local brightness peaks that stand out from their surroundings.
type SkyStar = [number, number, number];

type Sky = { width: number; height: number; alignTop: boolean; stars: SkyStar[] };

const TALL: Sky = {
  width: 1024,
  height: 1536,
  alignTop: true,
  stars: [[0.5586,0.959,1],[0.751,0.0801,0],[0.3965,0.9232,1],[0.375,0.0918,1],[0.9785,0.612,1],[0.543,0.2533,1],[0.4414,0.0684,1],[0.333,0.8581,1],[0.8643,0.9512,0],[0.7178,0.9492,0],[0.0469,0.2383,0],[0.0459,0.0234,1],[0.377,0.6641,0],[0.9248,0.6432,1],[0.5234,0.8984,1],[0.3506,0.9388,1],[0.6094,0.8659,1],[0.9492,0.0501,1],[0.1895,0.8236,0],[0.1582,0.9342,1],[0.9893,0.2793,1],[0.835,0.5299,1],[0.8027,0.638,1],[0.3818,0.0586,0],[0.9404,0.6895,1],[0.0254,0.5729,1],[0.3457,0.1543,0],[0.335,0.7409,0],[0.2207,0.4063,0],[0.7549,0.4219,1],[0.7012,0.3561,0],[0.2842,0.0124,2],[0.8027,0.0313,0],[0.5264,0.2044,0],[0.8682,0.4655,1],[0.6611,0.0814,1],[0.6406,0.1224,1],[0.5254,0.1361,0],[0.4189,0.1517,2],[0.7373,0.0352,0],[0.9512,0.015,0],[0.6924,0.7565,1],[0.8467,0.125,1],[0.4268,0.5566,0],[0.3916,0.8789,0]],
};

const WIDE: Sky = {
  width: 1536,
  height: 1024,
  alignTop: false,
  stars: [[0.0065,0.5283,0],[0.1029,0.1191,1],[0.3568,0.0674,1],[0.168,0.9668,0],[0.4421,0.082,0],[0.5326,0.0576,1],[0.8294,0.2363,0],[0.6829,0.7783,0],[0.8965,0.6191,0],[0.069,0.9639,1],[0.7773,0.752,1],[0.1113,0.5879,1],[0.7109,0.1162,0],[0.1367,0.9766,1],[0.6445,0.1299,0],[0.7311,0.0283,0],[0.778,0.6875,0],[0.1608,0.2451,1],[0.0423,0.1396,0],[0.8613,0.8838,1],[0.9798,0.877,0],[0.1022,0.4697,1],[0.9779,0.4141,1],[0.929,0.9717,0],[0.1328,0.0342,1],[0.2311,0.6084,1],[0.2031,0.1543,1],[0.903,0.1191,0],[0.8639,0.0762,0],[0.1602,0.3857,1],[0.6738,0.0127,1],[0.0247,0.8828,0],[0.944,0.1699,1],[0.4017,0.0137,1],[0.429,0.4297,0],[0.9876,0.5957,1],[0.5866,0.8545,1],[0.431,0.8818,1],[0.9264,0.2012,0],[0.8014,0.2617,1],[0.1777,0.2139,0],[0.0169,0.79,0],[0.6478,0.0283,1],[0.194,0.1191,0],[0.849,0.6924,0],[0.0397,0.5391,0],[0.1419,0.6504,1],[0.9785,0.5039,0],[0.7448,0.6846,0],[0.054,0.208,0],[0.8861,0.3447,1],[0.8906,0.9307,1],[0.9616,0.0293,0],[0.5241,0.8379,1],[0.235,0.0977,1]],
};

// The fixed sky is sized to the viewport without scrollbars, which is what clientWidth measures.
function useViewport() {
  const [size, setSize] = useState(() => ({ width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }));
  useEffect(() => {
    const update = () => setSize({ width: document.documentElement.clientWidth, height: document.documentElement.clientHeight });
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return size;
}

// A stable pseudo-random number per star, so the rhythm does not change between renders.
function noise(index: number, salt: number) {
  const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// Lays small twinkles exactly over the brightest stars of the fixed sky background. The sky is
// drawn with `background-size: cover`, so the same cover maths places each star on screen.
export function SkyTwinkle() {
  const { width, height } = useViewport();
  // Matches the `min-aspect-ratio: 1/1` switch between the two sky images in styles.css.
  const sky = width >= height ? WIDE : TALL;
  const scale = Math.max(width / sky.width, height / sky.height);
  const offsetX = (width - sky.width * scale) / 2;
  const offsetY = sky.alignTop ? 0 : (height - sky.height * scale) / 2;

  return (
    <div aria-hidden="true" className="sky-twinkle">
      {sky.stars.map(([x, y, radius], index) => {
        const left = offsetX + x * sky.width * scale;
        const top = offsetY + y * sky.height * scale;
        if (left < -10 || top < -10 || left > width + 10 || top > height + 10) return null;
        // The background is darkened towards the edges, so twinkles there stay dimmer too.
        const fromCentre = Math.hypot((left / width - 0.5) / 0.6, (top / height - 0.42) / 0.6);
        const style = {
          left,
          top,
          "--twinkle-size": `${(5 + radius * 2.5) * Math.max(0.8, Math.min(1.3, scale * 1.4))}px`,
          "--twinkle-peak": (0.85 - 0.5 * Math.min(1, fromCentre)).toFixed(2),
          animationDuration: `${(3.5 + noise(index, 1) * 5).toFixed(2)}s`,
          animationDelay: `${(-noise(index, 2) * 8).toFixed(2)}s`,
        } as CSSProperties;
        return <span className="sky-twinkle-star" data-sparkle={radius > 0 && noise(index, 3) > 0.45} key={index} style={style} />;
      })}
    </div>
  );
}
