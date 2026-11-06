// Generated brass artwork drawn into SVGs. The images are not perfectly round or centred,
// so each one carries the measured centre and inner radius of its opening (in image pixels).
// Scaling x and y separately makes the opening a true circle of the requested radius.

type RingAsset = { href: string; cx: number; cy: number; rx: number; ry: number };

const RING: RingAsset = { href: "/art/ring.webp", cx: 511, cy: 488, rx: 376, ry: 358 };
const MEDALLION: RingAsset = { href: "/art/medallion.webp", cx: 511, cy: 488, rx: 308, ry: 293 };
const IMAGE_SIZE = 1024;

function FittedRing({ asset, cx, cy, innerRadius, className }: { asset: RingAsset; cx: number; cy: number; innerRadius: number; className?: string }) {
  const sx = innerRadius / asset.rx;
  const sy = innerRadius / asset.ry;
  return (
    <image
      className={className}
      height={IMAGE_SIZE * sy}
      href={asset.href}
      pointerEvents="none"
      preserveAspectRatio="none"
      width={IMAGE_SIZE * sx}
      x={cx - asset.cx * sx}
      y={cy - asset.cy * sy}
    />
  );
}

// The ornate astrolabe ring; its opening has the given radius.
export function BrassRing(props: { cx: number; cy: number; innerRadius: number; className?: string }) {
  return <FittedRing asset={RING} {...props} />;
}

// The bezel around a seat token; its opening has the given radius.
export function Medallion(props: { cx: number; cy: number; innerRadius: number; className?: string }) {
  return <FittedRing asset={MEDALLION} {...props} />;
}

// A burning star sprite. The glow in the image spans about 48% of its width.
export function StarSprite({ cx, cy, glowRadius, className }: { cx: number; cy: number; glowRadius: number; className?: string }) {
  const size = (glowRadius * 2) / 0.48;
  return (
    <image
      className={className}
      height={size}
      href="/art/star.webp"
      pointerEvents="none"
      width={size}
      x={cx - size / 2}
      y={cy - size / 2 - size * 0.01}
    />
  );
}
