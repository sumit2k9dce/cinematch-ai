// Frontend config. Set VITE_API_URL in Vercel to your Render backend URL.
// Falls back to localhost for dev.
export const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:8000";

// Your UPI ID for the "Buy me a chai" button.
export const UPI_ID = "sumit2k9dce-2@okaxis";
export const UPI_NAME = "CineMatch";

export const REGIONS = [
  { code: "IN", label: "🇮🇳 India" },
  { code: "US", label: "🇺🇸 United States" },
  { code: "GB", label: "🇬🇧 United Kingdom" },
  { code: "CA", label: "🇨🇦 Canada" },
  { code: "AU", label: "🇦🇺 Australia" },
  { code: "DE", label: "🇩🇪 Germany" },
  { code: "FR", label: "🇫🇷 France" },
];
