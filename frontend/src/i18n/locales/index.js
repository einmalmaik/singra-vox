import mergeLocale from "./_shared/mergeLocale";
import en from "./en";
import de from "./de";
import fr from "./fr";
import es from "./es";
import it from "./it";
import nl from "./nl";
import pt from "./pt";
import pl from "./pl";
import sv from "./sv";
import da from "./da";
import no from "./no";
import fi from "./fi";

export const localeSectionRegistry = {
  en,
  de,
  fr,
  es,
  it,
  nl,
  pt,
  pl,
  sv,
  da,
  no,
  fi,
};

export const localeRegistry = Object.fromEntries(
  Object.entries(localeSectionRegistry).map(([code, sections]) => [
    code,
    code === "en" ? sections : mergeLocale(en, sections),
  ]),
);

export const localeResources = Object.fromEntries(
  Object.entries(localeRegistry).map(([code, translation]) => [code, { translation }]),
);

export default localeRegistry;
