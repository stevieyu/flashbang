export function setSuggestCookie(
  provider: string,
  trigger: string,
  customUrl: string
) {
  const value = `${provider},${trigger},${encodeURIComponent(customUrl)}`;
  document.cookie = `suggest=${value};path=/;max-age=31536000;SameSite=Lax`;
}
