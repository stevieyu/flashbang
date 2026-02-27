import { COOKIE_MAX_AGE_S } from "../shared/constants";

export function setSuggestCookie(
  provider: string,
  trigger: string,
  customUrl: string,
  custom?: string[]
) {
  let value = `${provider},${trigger},${encodeURIComponent(customUrl)}`;
  if (custom?.length) {
    value += `||${custom.join(".")}`;
  }
  document.cookie = `suggest=${value};path=/;max-age=${COOKIE_MAX_AGE_S};SameSite=Lax;Secure`;
}
