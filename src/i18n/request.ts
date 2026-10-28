import { getRequestConfig } from "next-intl/server";
import { currentLocale } from "./server";
import { messages } from "./messages";
export default getRequestConfig(async () => {
  const locale = await currentLocale();
  return { locale, messages: messages[locale] };
});
