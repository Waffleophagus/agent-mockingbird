import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#13100F",
        ash: "#302722",
        ember: "#F25C2A",
        emberSoft: "#FF8C5A",
        brass: "#D7B98D",
        bone: "#F6EFE4",
        moss: "#79936C",
        haze: "#8D8A84",
        slate: "#1E2528",
        ocean: "#7AC7D9"
      },
      boxShadow: {
        "signal-card": "0 14px 34px rgba(12, 8, 6, 0.32)"
      }
    }
  },
  plugins: []
} satisfies Config;
