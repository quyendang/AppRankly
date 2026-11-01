import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { resources } from "./locales.js";
let language = "vi";
try {
  localStorage.removeItem("apprankly_token");
  language = localStorage.getItem("apprankly_language") || "vi";
} catch {}
i18n.use(initReactI18next).init({
  resources,
  lng: ["vi", "en"].includes(language) ? language : "vi",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});
i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
  try {
    localStorage.setItem("apprankly_language", lng);
  } catch {}
});
export default i18n;
