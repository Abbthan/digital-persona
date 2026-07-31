// Decorative background for the homepage hero — a set of large,
// softly-blurred circles that drift in multi-point loops (see the
// hero-gradient-flow-a/b keyframes in app/globals.css) for a fluid,
// continuously-flowing mesh-gradient feel. CSS supplies a saturated warm
// light version and a mostly-black, restrained blue/purple dark version,
// while reduced-motion freezes both without needing theme state here.
//
// fixed rather than absolute: Hero.tsx's own <section> is back to normal
// document flow (its text/logo/buttons scroll away like any other content),
// but this background layer still needs to stay pinned to the viewport on
// its own while that happens — only it, not the section it's nominally
// inside, is the "reveal" layer HowItWorks slides up and over. -z-10 keeps
// it under all normal-flow page content regardless of DOM order, since a
// fixed element would otherwise paint above earlier siblings by default.
const BLOBS = [
  { color: "#3D5FFF", left: "-8%", top: "-18%", size: "58%", variant: "a", delay: "-1s", duration: "9s" },
  { color: "#F5A6F7", left: "22%", top: "-4%", size: "72%", variant: "b", delay: "-4s", duration: "11s" },
  { color: "#E619C4", left: "16%", top: "26%", size: "64%", variant: "a", delay: "-6s", duration: "8s" },
  { color: "#E0027E", left: "2%", top: "40%", size: "58%", variant: "b", delay: "-2s", duration: "10s" },
  { color: "#FA4B1A", left: "40%", top: "46%", size: "72%", variant: "a", delay: "-5s", duration: "12s" },
] as const;

export function HeroGradientBackground() {
  return (
    <div
      className="hero-gradient-bg pointer-events-none fixed inset-0 -z-10"
      style={{ background: "linear-gradient(135deg, #f9ddff 0%, #ffd9e8 100%)" }}
      aria-hidden="true"
    >
      {BLOBS.map((blob, index) => (
        <span
          key={index}
          className={`hero-gradient-blob hero-gradient-blob-${blob.variant} absolute rounded-full blur-[90px]`}
          style={{
            backgroundColor: blob.color,
            left: blob.left,
            top: blob.top,
            width: blob.size,
            height: blob.size,
            opacity: 0.88,
            animationDelay: blob.delay,
            animationDuration: blob.duration,
          }}
        />
      ))}
    </div>
  );
}
