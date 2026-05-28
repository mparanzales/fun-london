import Image from "next/image";

type Variant = "gradient" | "white" | "icon";
type Size = "sm" | "md" | "lg" | "xl";

const HEIGHT_PX: Record<Size, number> = {
  sm: 24,
  md: 32,
  lg: 64,
  xl: 96,
};

// Intrinsic aspect ratio (width / height) of each source PNG.
// All three files are 1536×1024 (3:2) after the white logo was re-exported
// from its original 1:1 canvas to a tight-cropped landscape canvas.
const ASPECT: Record<Variant, number> = {
  gradient: 1.5,
  white: 1.5,
  icon: 1.5,
};

const SRC: Record<Variant, string> = {
  gradient: "/logo-fun.png",
  white: "/logo-fun-white.png",
  icon: "/app-icon.png",
};

export function Logo({
  variant = "gradient",
  size = "md",
  className,
}: {
  variant?: Variant;
  size?: Size;
  className?: string;
}) {
  const height = HEIGHT_PX[size];
  const width = Math.round(height * ASPECT[variant]);
  return (
    <Image
      src={SRC[variant]}
      alt="Fun London"
      width={width}
      height={height}
      priority={size === "lg"}
      className={className}
    />
  );
}
