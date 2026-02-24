export function flashAnim(el: HTMLElement) {
  el.classList.remove("flash-anim");
  // NOTE: A well known hack to force reflow to restart CSS animation
  void el.offsetWidth;
  el.classList.add("flash-anim");
  setTimeout(() => el.classList.remove("flash-anim"), 300);
}

export function shakeAnim(el: HTMLElement) {
  el.classList.remove("shake-anim");
  // NOTE: A well known hack to force reflow to restart CSS animation
  void el.offsetWidth;
  el.classList.add("shake-anim");
  setTimeout(() => el.classList.remove("shake-anim"), 200);
}
