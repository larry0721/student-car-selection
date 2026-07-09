import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#222228",
        muted: "#6f625d",
        panel: "#fffaf7",
        surface: "#f2e6df",
        line: "#d8c5b9",
        accent: "#91b9ac",
        accentStrong: "#5f8f82",
      },
      boxShadow: {
        panel: "0 18px 44px rgba(34, 34, 40, 0.16)",
      },
    },
  },
  plugins: [],
};

export default config;
