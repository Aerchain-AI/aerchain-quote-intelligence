/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Geist over Inter. Inter is the default every generated interface
        // reaches for; Geist has tighter apertures and a real mono companion,
        // which matters in a product that is mostly columns of figures.
        sans: ["Geist Variable", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["Geist Mono Variable", "Consolas", "ui-monospace", "monospace"],
      },
      // One named scale instead of arbitrary 9999s scattered through the app.
      zIndex: {
        base: "0",
        sticky: "20",
        header: "30",
        overlay: "40",
        modal: "50",
        toast: "60",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "none" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "translateY(8px) scale(0.985)" },
          to: { opacity: "1", transform: "none" },
        },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        shimmer: { from: { backgroundPosition: "200% 0" }, to: { backgroundPosition: "-200% 0" } },
      },
      animation: {
        "fade-up": "fade-up 380ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "scale-in": "scale-in 240ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "fade-in": "fade-in 180ms ease-out both",
      },
    },
  },
  plugins: [],
};
