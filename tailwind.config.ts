import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#f6effa",
          100: "#ead5f3",
          200: "#d2a9e6",
          300: "#b87ed8",
          400: "#a062cc",
          500: "#8a48bd",
          600: "#7339a0",
          700: "#5c2c81",
          800: "#451f61",
          900: "#2d1240",
        },
      },
      fontFamily: {
        sans: [
          "Segoe UI Variable",
          "Segoe UI",
          "system-ui",
          "ui-sans-serif",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
} satisfies Config;
