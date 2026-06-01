import {
  BrandVariants,
  createDarkTheme,
  createLightTheme,
  Theme,
} from "@fluentui/react-components";

// Brand ramp generated to roughly match LUXE's purple. Refined in M6.
export const luxeBrand: BrandVariants = {
  10:  "#070213",
  20:  "#1B0E2C",
  30:  "#2D1240",
  40:  "#3B1A55",
  50:  "#48226B",
  60:  "#572B82",
  70:  "#65349A",
  80:  "#763FB3",
  90:  "#864ABA",
  100: "#9558C1",
  110: "#A467C8",
  120: "#B477CF",
  130: "#C388D6",
  140: "#D29ADD",
  150: "#E0ADE4",
  160: "#EDC0EB",
};

export const luxeDarkTheme:  Theme = createDarkTheme(luxeBrand);
export const luxeLightTheme: Theme = {
  ...createLightTheme(luxeBrand),
  // The stock Fluent light neutral backgrounds are very close to white, which
  // makes hover masks hard to distinguish on LUXE's pale violet canvas.
  colorNeutralBackground2: "#F0EEF8",
  colorNeutralBackground3: "#E7E3F2",
  colorNeutralBackground4: "#DDD7EA",
  colorSubtleBackgroundHover: "#E7E3F2",
  colorSubtleBackgroundPressed: "#DDD7EA",
  colorSubtleBackgroundSelected: "#E7E3F2",
};

/** Resolve the persisted theme key ("dark" | "light" | "system") to a Theme. */
export function pickTheme(key: string): Theme {
  if (key === "light") return luxeLightTheme;
  if (key === "system") {
    return typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? luxeDarkTheme
      : luxeLightTheme;
  }
  return luxeDarkTheme;
}
