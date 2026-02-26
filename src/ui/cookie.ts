export function setSuggestCookie(
  provider: string,
  trigger: string,
  customUrl: string,
  frecent?: string[],
  custom?: string[]
) {
  let value = `${provider},${trigger},${encodeURIComponent(customUrl)}`;
  if (frecent?.length || custom?.length) {
    value += `|${(frecent || []).join(".")}|${(custom || []).join(".")}`;
  }
  document.cookie = `suggest=${value};path=/;max-age=31536000;SameSite=Lax`;
}
