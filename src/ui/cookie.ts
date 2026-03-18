import { COOKIE_MAX_AGE_S } from "../shared/constants";
import { encodeSuggestCookieValue } from "../shared/suggest-cookie";

export function setSuggestCookie(
  provider: string,
  trigger: string,
  customUrl: string,
  custom?: string[]
) {
  const value = encodeSuggestCookieValue(provider, trigger, customUrl, custom);
  document.cookie = `suggest=${value};path=/;max-age=${COOKIE_MAX_AGE_S};SameSite=Lax;Secure`;
}
